import { LEAK_DAMAGE, RETREAT_REFUND_RATIO, resolveLoadout } from '../core/defaults';
import { applyModifiers, computeDamage, isBuff } from '../core/stats';
import { TileGrid } from '../core/tiles';
import type { CharacterDef, EnemyDef, GridPos, LevelDef, SkillDamageType, SkillDef, SkillEffect, StatModifier } from '../core/types';
import { attackBehavior } from './attacks';
import {
  BLOCK_DISTANCE,
  UNIT_RADIUS,
  dist,
  enemyBaseStats,
  enemyRadius,
  tileCenter,
  unitBaseStats,
  type Combatant,
  type Effect,
  type Enemy,
  type Projectile,
  type SkillState,
  type Unit,
} from './entities';
import { buildSchedule, type RouteInfo, type SpawnEvent } from './spawn';

export type GameStatus = 'running' | 'won' | 'lost';

export const FIXED_DT = 1 / 60;
const PROJECTILE_SPEED = 9;

export interface EngineOptions {
  /** 技能库 */
  skills?: SkillDef[];
  /** 玩家的角色设定：角色 ID → 携带的技能 ID */
  loadouts?: Record<string, string[]>;
}

/**
 * 战斗引擎：纯逻辑，不依赖 DOM，可以在 Node 中做无界面测试。
 * 每帧按固定步长调用 step()，渲染层只读取引擎状态。
 */
export class GameEngine {
  readonly level: LevelDef;
  readonly grid: TileGrid;
  /** 本关可用角色（按编辑器中的顺序） */
  readonly roster: CharacterDef[];
  readonly enemyDefs: Map<string, EnemyDef>;
  readonly skillDefs: Map<string, SkillDef>;
  readonly loadouts: Record<string, string[]>;
  readonly routes: RouteInfo[];
  readonly warnings: string[];
  readonly totalEnemies: number;
  readonly lastSpawnTime: number;

  time = 0;
  hp: number;
  readonly maxHp: number;
  money: number;
  status: GameStatus = 'running';
  killed = 0;
  leaked = 0;
  spawned = 0;

  units: Unit[] = [];
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  effects: Effect[] = [];

  private schedule: SpawnEvent[];
  private nextEvent = 0;
  private seq = 1;

  constructor(level: LevelDef, characters: CharacterDef[], enemies: EnemyDef[], opts: EngineOptions = {}) {
    this.level = level;
    this.grid = TileGrid.fromLevel(level);
    const allowed = level.settings.availableCharacters;
    this.roster = allowed.length ? characters.filter((c) => allowed.includes(c.id)) : characters.slice();
    this.enemyDefs = new Map(enemies.map((e) => [e.id, e]));
    this.skillDefs = new Map((opts.skills ?? []).map((s) => [s.id, s]));
    this.loadouts = opts.loadouts ?? {};
    const sched = buildSchedule(level, this.grid, this.enemyDefs);
    this.schedule = sched.events;
    this.routes = sched.routes;
    this.warnings = sched.warnings;
    this.totalEnemies = sched.events.length;
    this.lastSpawnTime = sched.duration;
    this.hp = this.maxHp = level.settings.initialHp;
    this.money = level.settings.initialMoney;
  }

  get moneyPerSecond(): number {
    return this.level.settings.autoMoney ? this.level.settings.moneyPerMinute / 60 : 0;
  }

  /* ================= 主循环 ================= */

  step(dt: number = FIXED_DT): void {
    if (this.status !== 'running') {
      this.updateEffects(dt);
      return;
    }
    this.time += dt;
    this.money += this.moneyPerSecond * dt;

    this.spawnDue();
    this.updateStatuses(dt);
    this.updateSkills(dt);
    this.moveEnemies(dt);
    this.updateBlocking();
    this.combatantsAct(this.units, dt);
    this.combatantsAct(this.enemies, dt);
    this.updateProjectiles(dt);
    this.cleanup();
    this.updateEffects(dt);
    this.checkEnd();
  }

  private makeSkillStates(ids: string[]): SkillState[] {
    const out: SkillState[] = [];
    for (const id of ids) {
      const def = this.skillDefs.get(id);
      if (def) out.push({ def, sp: Math.min(def.spMax, def.spInitial), active: false, remaining: 0 });
    }
    return out;
  }

  private spawnDue() {
    while (this.nextEvent < this.schedule.length && this.schedule[this.nextEvent].time <= this.time + 1e-9) {
      const ev = this.schedule[this.nextEvent++];
      const def = this.enemyDefs.get(ev.enemyId);
      if (!def) continue;
      const start = tileCenter(ev.path[0]);
      const base = enemyBaseStats(def);
      const e: Enemy = {
        uid: this.seq++,
        side: 'enemy',
        def,
        lineId: ev.lineId,
        path: ev.path,
        waypoint: 1,
        x: start.x,
        y: start.y,
        hp: def.maxHp,
        base,
        stats: { ...base },
        statuses: [],
        skills: this.makeSkillStates(def.skills.slice(0, def.skillSlots)),
        attackCd: def.attackInterval * 0.5,
        blockedBy: null,
        distLeft: pathLength(ev.path),
        angle: 0,
        flash: 0,
        healFlash: 0,
        attackAnim: 0,
        spawnedAt: this.time,
      };
      if (ev.path.length > 1) {
        const n = tileCenter(ev.path[1]);
        e.angle = Math.atan2(n.y - e.y, n.x - e.x);
      }
      this.enemies.push(e);
      this.spawned++;
      this.addEffect({ kind: 'spawn', x: e.x, y: e.y, duration: 0.45, color: def.color });
      // 出现点本身就是基地的极端情况
      if (ev.path.length === 1) this.leak(e);
    }
  }

  /** 增益 / 减益计时、属性重算、持续回复 / 持续伤害 */
  private updateStatuses(dt: number) {
    for (const c of this.allCombatants()) {
      if (c.hp <= 0) continue;
      if (c.statuses.length) {
        for (const s of c.statuses) s.remaining -= dt;
        c.statuses = c.statuses.filter((s) => s.remaining > 0);
      }
      c.stats = c.statuses.length ? applyModifiers(c.base, c.statuses.map((s) => s.modifiers)) : { ...c.base };
      if (c.stats.hpRegen !== 0) {
        if (c.stats.hpRegen > 0) c.hp = Math.min(c.stats.maxHp, c.hp + c.stats.hpRegen * dt);
        else c.hp += c.stats.hpRegen * dt;
      }
      if (c.hp > c.stats.maxHp) c.hp = c.stats.maxHp;
    }
  }

  /** SP 自动积累、技能持续时间、自动释放 */
  private updateSkills(dt: number) {
    for (const c of this.allCombatants()) {
      if (c.hp <= 0) continue;
      for (const s of c.skills) {
        if (s.active) {
          s.remaining -= dt;
          if (s.remaining <= 0) {
            s.active = false;
            s.remaining = 0;
          }
          continue;
        }
        if (s.def.spGain === 'auto') s.sp = Math.min(s.def.spMax, s.sp + s.def.spRate * dt);
        const autoCast = s.def.trigger === 'auto' || c.side === 'enemy';
        if (autoCast && s.sp >= s.def.spMax - 1e-9 && this.worthCasting(c, s.def)) this.castSkill(c, s);
      }
    }
  }

  private moveEnemies(dt: number) {
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.blockedBy != null) continue;
      let step = e.stats.speed * dt;
      while (step > 0 && e.waypoint < e.path.length) {
        const target = tileCenter(e.path[e.waypoint]);
        const d = dist(e, target);
        if (d > 1e-9) e.angle = Math.atan2(target.y - e.y, target.x - e.x);
        if (d <= step) {
          e.x = target.x;
          e.y = target.y;
          step -= d;
          e.distLeft = Math.max(0, e.distLeft - d);
          const tile = e.path[e.waypoint];
          // 敌人中心与基地方块中心重合 → 扣血
          if (this.grid.isType(tile.x, tile.y, 'base')) {
            this.leak(e);
            break;
          }
          e.waypoint++;
        } else {
          e.x += ((target.x - e.x) / d) * step;
          e.y += ((target.y - e.y) / d) * step;
          e.distLeft = Math.max(0, e.distLeft - step);
          step = 0;
        }
      }
      if (e.hp > 0 && e.waypoint >= e.path.length) this.leak(e);
    }
  }

  private leak(e: Enemy) {
    if (e.hp <= 0) return;
    e.hp = 0;
    e.leaked = true;
    this.leaked++;
    this.hp = Math.max(0, this.hp - LEAK_DAMAGE);
    this.addEffect({ kind: 'leak', x: e.x, y: e.y, duration: 0.8, color: '#ff5a5a' });
    this.addEffect({ kind: 'text', x: e.x, y: e.y - 0.4, duration: 1, color: '#ff6b6b', text: `-${LEAK_DAMAGE}` });
  }

  /** 地面角色阻挡接近的敌人；阻挡数被减益降低时放开多出来的敌人 */
  private updateBlocking() {
    for (const u of this.units) {
      const cap = u.canBlock ? u.stats.blockCount : 0;
      while (u.blocked.length > cap) {
        const id = u.blocked.pop()!;
        const e = this.enemyByUid(id);
        if (e) e.blockedBy = null;
      }
      if (cap <= 0) continue;
      for (const e of this.enemies) {
        if (u.blocked.length >= cap) break;
        if (e.hp <= 0 || e.blockedBy != null) continue;
        if (dist(u, e) < BLOCK_DISTANCE + (enemyRadius(e.def) - 0.27) * 0.5) {
          e.blockedBy = u.uid;
          u.blocked.push(e.uid);
        }
      }
    }
  }

  private combatantsAct(list: Combatant[], dt: number) {
    for (const c of list) {
      c.flash = Math.max(0, c.flash - dt);
      c.healFlash = Math.max(0, c.healFlash - dt);
      c.attackAnim = Math.max(0, c.attackAnim - dt);
      if (c.hp <= 0) continue;
      if (c.side === 'enemy' && !c.def.canAttack) continue;
      c.attackCd -= dt;
      if (c.attackCd > 0) continue;
      const behavior = attackBehavior(c.def.attackType);
      const targets = behavior.pickTargets(this, c);
      if (targets.length) {
        behavior.execute(this, c, targets);
        c.attackCd = c.stats.attackInterval;
        // 攻击成功（无论攻击敌人还是队友）→ 积累 SP
        for (const s of c.skills) {
          if (!s.active && s.def.spGain === 'attack') s.sp = Math.min(s.def.spMax, s.sp + s.def.spRate);
        }
      } else {
        c.attackCd = 0;
      }
    }
  }

  private updateProjectiles(dt: number) {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      const target = p.targetSide === 'enemy' ? this.enemyByUid(p.targetUid) : this.unitByUid(p.targetUid);
      if (!target || target.hp <= 0) continue;
      const d = dist(p, target);
      const step = p.speed * dt;
      if (d <= step + 0.05) {
        const src = p.sourceSide === 'enemy' ? this.enemyByUid(p.sourceUid) : this.unitByUid(p.sourceUid);
        this.dealDamage(target, p.atk, p.damageType);
        if (p.onHit) this.applyOnHit(target, p.onHit, src);
        this.addEffect({ kind: 'hit', x: target.x, y: target.y, duration: 0.18, color: p.color });
        continue;
      }
      p.x += ((target.x - p.x) / d) * step;
      p.y += ((target.y - p.y) / d) * step;
      keep.push(p);
    }
    this.projectiles = keep;
  }

  private cleanup() {
    const dead = this.enemies.filter((e) => e.hp <= 0);
    if (dead.length) {
      for (const e of dead) {
        if (e.blockedBy != null) {
          const u = this.unitByUid(e.blockedBy);
          if (u) u.blocked = u.blocked.filter((id) => id !== e.uid);
        }
        if (!e.leaked) {
          this.killed++;
          if (e.def.reward > 0) {
            this.money += e.def.reward;
            this.addEffect({ kind: 'text', x: e.x, y: e.y - 0.35, duration: 0.9, color: '#ffd166', text: `+${e.def.reward}` });
          }
          this.addEffect({ kind: 'death', x: e.x, y: e.y, duration: 0.4, color: e.def.color, size: enemyRadius(e.def) });
        }
      }
      this.enemies = this.enemies.filter((e) => e.hp > 0);
    }
    const fallen = this.units.filter((u) => u.hp <= 0);
    if (fallen.length) {
      for (const u of fallen) {
        this.releaseBlocked(u);
        this.addEffect({ kind: 'death', x: u.x, y: u.y, duration: 0.5, color: u.def.color, size: UNIT_RADIUS });
      }
      this.units = this.units.filter((u) => u.hp > 0);
    }
  }

  private updateEffects(dt: number) {
    if (!this.effects.length) return;
    for (const fx of this.effects) fx.t += dt;
    this.effects = this.effects.filter((fx) => fx.t < fx.duration);
  }

  private checkEnd() {
    if (this.hp <= 0) {
      this.status = 'lost';
      return;
    }
    if (this.nextEvent >= this.schedule.length && this.enemies.length === 0) {
      this.status = 'won';
    }
  }

  /* ================= 战斗规则（攻击方式 / 技能调用） ================= */

  allCombatants(): Combatant[] {
    return [...this.units, ...this.enemies];
  }

  /** 同一阵营（包括自己）中还活着的单位 */
  alliesOf(c: Combatant): Combatant[] {
    return c.side === 'ally' ? this.units.filter((u) => u.hp > 0) : this.enemies.filter((e) => e.hp > 0);
  }

  /** 敌对阵营中还活着的单位 */
  opponentsOf(c: Combatant): Combatant[] {
    return c.side === 'ally' ? this.enemies.filter((e) => e.hp > 0) : this.units.filter((u) => u.hp > 0);
  }

  addEffect(fx: Omit<Effect, 't'>) {
    if (this.effects.length > 500) return;
    this.effects.push({ ...fx, t: 0 });
  }

  /** 造成伤害（按伤害类型结算物抗 / 法抗），返回实际伤害 */
  dealDamage(target: Combatant, atk: number, type: SkillDamageType): number {
    if (target.hp <= 0) return 0;
    const dmg = computeDamage(atk, type, target.stats.def, target.stats.res);
    target.hp -= dmg;
    target.flash = 0.12;
    return dmg;
  }

  heal(_source: Combatant | null, target: Combatant, amount: number): number {
    if (target.hp <= 0 || amount <= 0) return 0;
    const before = target.hp;
    target.hp = Math.min(target.stats.maxHp, target.hp + amount);
    const healed = target.hp - before;
    target.healFlash = 0.35;
    this.addEffect({ kind: 'heal', x: target.x, y: target.y, duration: 0.7, color: '#5dff9d' });
    if (healed >= 1) {
      this.addEffect({ kind: 'text', x: target.x + 0.15, y: target.y - 0.45, duration: 0.8, color: '#7dffb0', text: `+${Math.round(healed)}` });
    }
    return healed;
  }

  /** 普通攻击命中（近战）：伤害 + 命中附带效果 */
  hitWithAttack(attacker: Combatant, target: Combatant) {
    this.dealDamage(target, attacker.stats.atk, attacker.def.damageType);
    const oh = attacker.def.onHit;
    if (oh && oh.modifiers.length) this.applyOnHit(target, { ...oh, key: `onhit:${attacker.def.id}` }, attacker);
  }

  private applyOnHit(target: Combatant, oh: { modifiers: StatModifier[]; duration: number; key: string }, src: Combatant | null | undefined) {
    this.addStatus(target, { key: oh.key, name: src ? `${src.def.name}的攻击效果` : '攻击效果', color: src?.def.color ?? '#ffffff', modifiers: oh.modifiers, duration: oh.duration });
  }

  fireProjectile(attacker: Combatant, target: Combatant) {
    const oh = attacker.def.onHit;
    this.projectiles.push({
      id: this.seq++,
      sourceUid: attacker.uid,
      sourceSide: attacker.side,
      targetUid: target.uid,
      targetSide: target.side,
      x: attacker.x,
      y: attacker.y,
      speed: PROJECTILE_SPEED,
      atk: attacker.stats.atk,
      damageType: attacker.def.damageType,
      onHit: oh && oh.modifiers.length ? { ...oh, key: `onhit:${attacker.def.id}` } : null,
      color: attacker.def.damageType === 'magic' ? '#c79bff' : attacker.def.color,
      radius: 0.08,
    });
  }

  /** 施加增益 / 减益（同一来源再次施加时刷新时间） */
  addStatus(target: Combatant, s: { key: string; name: string; color: string; modifiers: StatModifier[]; duration: number }) {
    if (target.hp <= 0 || s.duration <= 0 || !s.modifiers.length) return;
    const hasBuff = s.modifiers.some(isBuff);
    const hasDebuff = s.modifiers.some((m) => !isBuff(m));
    const existing = target.statuses.find((x) => x.key === s.key);
    if (existing) {
      existing.remaining = existing.total = s.duration;
      existing.modifiers = s.modifiers;
    } else {
      target.statuses.push({ key: s.key, name: s.name, color: s.color, modifiers: s.modifiers, remaining: s.duration, total: s.duration, hasBuff, hasDebuff });
    }
    // 立即重算属性，让本帧的攻击就能用上
    target.stats = applyModifiers(target.base, target.statuses.map((x) => x.modifiers));
    if (target.hp > target.stats.maxHp) target.hp = target.stats.maxHp;
  }

  /** 技能效果作用的目标 */
  effectTargets(caster: Combatant, eff: SkillEffect): Combatant[] {
    if (eff.target === 'self') return caster.hp > 0 ? [caster] : [];
    let pool = eff.target === 'allies' ? this.alliesOf(caster) : this.opponentsOf(caster);
    if (eff.scope === 'range') {
      const r = eff.radius > 0 ? eff.radius : caster.stats.range;
      pool = pool.filter((t) => dist(caster, t) <= r + 1e-6 || (caster.side === 'ally' && t.side === 'enemy' && (t as Enemy).blockedBy === caster.uid));
    }
    pool.sort((p, q) => dist(caster, p) - dist(caster, q));
    return eff.maxTargets > 0 ? pool.slice(0, eff.maxTargets) : pool;
  }

  /** 自动释放前判断是否值得释放：攻击敌人的技能需要有敌人，治疗技能需要有受伤的队友 */
  private worthCasting(c: Combatant, skill: SkillDef): boolean {
    const offensive = skill.effects.filter((e) => e.target === 'enemies');
    if (offensive.length) return offensive.some((e) => this.effectTargets(c, e).length > 0);
    const heals = skill.effects.filter((e) => e.kind === 'damage' && e.amount < 0);
    if (heals.length) return heals.some((e) => this.effectTargets(c, e).some((t) => t.hp < t.stats.maxHp - 0.01));
    return true;
  }

  private castSkill(c: Combatant, s: SkillState) {
    const skill = s.def;
    s.sp = 0;
    if (skill.duration > 0) {
      s.active = true;
      s.remaining = skill.duration;
    }
    skill.effects.forEach((eff, i) => {
      const targets = this.effectTargets(c, eff);
      if (eff.kind === 'damage') {
        const value = (Math.abs(c.stats.atk) * eff.amount) / 100;
        for (const t of targets) {
          if (value < 0) this.heal(c, t, -value);
          else if (value > 0) {
            this.dealDamage(t, value, eff.damageType);
            this.addEffect({ kind: 'hit', x: t.x, y: t.y, duration: 0.3, color: skill.color });
          }
        }
      } else {
        const duration = eff.duration > 0 ? eff.duration : skill.duration;
        for (const t of targets) {
          this.addStatus(t, { key: `skill:${skill.id}:${c.uid}:${i}`, name: skill.name, color: skill.color, modifiers: eff.modifiers, duration });
        }
      }
    });
    this.addEffect({ kind: 'skill', x: c.x, y: c.y, duration: 0.9, color: skill.color, text: skill.name });
  }

  /** 手动释放技能（玩家点击角色后选择技能），返回错误原因或 null */
  activateSkill(uid: number, index: number): string | null {
    if (this.status !== 'running') return '战斗已结束';
    const u = this.unitByUid(uid);
    const s = u?.skills[index];
    if (!u || !s) return '技能不存在';
    if (s.active) return '技能正在持续中';
    if (s.sp < s.def.spMax - 1e-9) return 'SP 不足';
    this.castSkill(u, s);
    return null;
  }

  unitByUid(uid: number): Unit | undefined {
    return this.units.find((u) => u.uid === uid);
  }

  enemyByUid(uid: number): Enemy | undefined {
    return this.enemies.find((e) => e.uid === uid);
  }

  unitAt(x: number, y: number): Unit | undefined {
    return this.units.find((u) => u.tile.x === x && u.tile.y === y);
  }

  deployedCount(charId: string): number {
    return this.units.filter((u) => u.def.id === charId).length;
  }

  /** 角色在本场战斗中携带的技能 */
  loadoutOf(def: CharacterDef): SkillDef[] {
    return resolveLoadout(def, this.loadouts[def.id])
      .map((id) => this.skillDefs.get(id))
      .filter((s): s is SkillDef => !!s);
  }

  /** 当前是否买得起 / 还能部署（不看位置） */
  cardState(def: CharacterDef): { ok: boolean; reason?: string } {
    if (this.status !== 'running') return { ok: false, reason: '战斗已结束' };
    if (def.maxDeploy > 0 && this.deployedCount(def.id) >= def.maxDeploy) return { ok: false, reason: '已达部署上限' };
    if (Math.floor(this.money + 1e-9) < def.cost) return { ok: false, reason: '金钱不足' };
    return { ok: true };
  }

  /** 检查能否部署到某个方块，返回 null 表示可以，否则返回原因 */
  checkDeploy(def: CharacterDef, tile: GridPos): string | null {
    const card = this.cardState(def);
    if (!card.ok) return card.reason!;
    if (!this.grid.canPlace(tile.x, tile.y, def.placement)) {
      const t = this.grid.get(tile.x, tile.y);
      if (!t) return '这里没有方块';
      if (!t.deploy) return `「${t.label}」不能放置角色`;
      return def.placement === 'ground' ? '该角色只能放在地面上' : '该角色只能放在高台上';
    }
    if (this.unitAt(tile.x, tile.y)) return '该位置已有角色';
    return null;
  }

  deploy(charId: string, tile: GridPos): string | null {
    const def = this.roster.find((c) => c.id === charId);
    if (!def) return '本关不能使用该角色';
    const err = this.checkDeploy(def, tile);
    if (err) return err;
    this.money -= def.cost;
    const c = tileCenter(tile);
    const t = this.grid.get(tile.x, tile.y)!;
    const base = unitBaseStats(def);
    this.units.push({
      uid: this.seq++,
      side: 'ally',
      def,
      tile: { ...tile },
      x: c.x,
      y: c.y,
      hp: def.maxHp,
      base,
      stats: { ...base },
      statuses: [],
      skills: this.makeSkillStates(this.loadoutOf(def).map((s) => s.id)),
      attackCd: 0,
      canBlock: t.walkable,
      blocked: [],
      deployedAt: this.time,
      flash: 0,
      healFlash: 0,
      attackAnim: 0,
      facing: 0,
    });
    this.addEffect({ kind: 'deploy', x: c.x, y: c.y, duration: 0.4, color: def.color });
    return null;
  }

  /** 撤退：返还部分费用 */
  retreat(uid: number): number {
    const u = this.unitByUid(uid);
    if (!u || this.status !== 'running') return 0;
    const refund = Math.floor(u.def.cost * RETREAT_REFUND_RATIO);
    this.money += refund;
    this.releaseBlocked(u);
    this.units = this.units.filter((x) => x !== u);
    this.addEffect({ kind: 'text', x: u.x, y: u.y - 0.4, duration: 0.9, color: '#ffd166', text: `+${refund}` });
    return refund;
  }

  private releaseBlocked(u: Unit) {
    for (const e of this.enemies) if (e.blockedBy === u.uid) e.blockedBy = null;
    u.blocked = [];
  }

  /** 剩余尚未出现的敌人数 */
  get pendingSpawns(): number {
    return this.schedule.length - this.nextEvent;
  }

  /** 下一个敌人出现的时间（没有则为 null） */
  get nextSpawnTime(): number | null {
    return this.nextEvent < this.schedule.length ? this.schedule[this.nextEvent].time : null;
  }
}

function pathLength(path: GridPos[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return len;
}
