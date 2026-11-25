import { LEAK_DAMAGE, isSummonDef, resolveLoadout, retreatRefund } from '../core/defaults';
import { planWave } from '../core/endless';
import { leveledCharacter } from '../core/leveling';
import { tileInRange, tileOf } from '../core/range';
import { applyModifiers, computeDamage, isBuff } from '../core/stats';
import { TileGrid } from '../core/tiles';
import type { CharacterDef, EndlessConfig, EnemyDef, GridPos, LevelDef, SkillDamageType, SkillDef, SkillEffect, StatModifier, SummonDef } from '../core/types';
import { attackBehavior, tileOfCombatant } from './attacks';
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
import { buildSchedule, type LineRoute, type RouteInfo, type SpawnEvent } from './spawn';

export type GameStatus = 'running' | 'won' | 'lost';

export const FIXED_DT = 1 / 60;
const PROJECTILE_SPEED = 9;
/** 场上敌人的上限（无尽模式后期太多时暂缓出现，避免卡顿） */
const MAX_ENEMIES = 300;

/** 技能带来的持续金钱变化（施放者离场后停止） */
export interface MoneyFlow {
  key: string;
  sourceUid: number;
  sourceSide: 'ally' | 'enemy';
  /** 每秒变化量（已按阵营换算：敌人释放 = 负数） */
  rate: number;
  remaining: number;
  /** 飘字用：累计的变化量和计时 */
  acc: number;
  tick: number;
}

export interface EngineOptions {
  /** 技能库 */
  skills?: SkillDef[];
  /** 玩家的角色设定：角色 ID → 携带的技能 ID */
  loadouts?: Record<string, string[]>;
  /** 角色等级：角色 ID → 等级（没有 = 1 级），按升级成长提高基础数值 */
  levels?: Record<string, number>;
  /** 无尽模式：敌人按波次规则不断出现，没有胜利，血量归零（或玩家结束挑战）时结束 */
  endless?: EndlessConfig;
  /** 随机数（无尽模式选敌人 / 路线；测试时传入可重复的随机数） */
  rng?: () => number;
  /** 角色试用（训练场）：只有一个来回移动的敌人，被击败后重新出现，战斗不会结束 */
  training?: TrainingOptions;
  /** 召唤物库 */
  summons?: SummonDef[];
  /** 玩家的召唤物选择：角色 ID → 召唤物 ID（没有选择 = 第一个） */
  summonChoice?: Record<string, string>;
}

/** 攻击方式：召唤者按「自身攻击」攻击；none = 不攻击 */
export function attackTypeOf(def: Pick<CharacterDef, 'attackType' | 'summonAttack'>): string {
  return def.attackType === 'summon' ? def.summonAttack || 'basic' : def.attackType;
}

export interface TrainingOptions {
  /** 来回移动的敌人 */
  enemyId: string;
  /** 来回移动的路线（至少 2 格） */
  path: GridPos[];
  /** 被击败后多少秒重新出现 */
  respawnDelay?: number;
}

/** 卡片状态：能否部署；冷却中时附带剩余时间 */
export interface CardState {
  ok: boolean;
  reason?: string;
  /** 部署冷却的剩余时间（秒），没有冷却为 0 */
  cooldown: number;
}

/**
 * 战斗引擎：纯逻辑，不依赖 DOM，可以在 Node 中做无界面测试。
 * 每帧按固定步长调用 step()，渲染层只读取引擎状态。
 */
export class GameEngine {
  readonly level: LevelDef;
  readonly grid: TileGrid;
  /** 本关可用角色（按编辑器中的顺序；已经按玩家的角色等级提高了数值） */
  readonly roster: CharacterDef[];
  /** 角色等级：角色 ID → 等级 */
  readonly levels: Record<string, number>;
  readonly enemyDefs: Map<string, EnemyDef>;
  readonly skillDefs: Map<string, SkillDef>;
  readonly summonDefs: Map<string, SummonDef>;
  readonly loadouts: Record<string, string[]>;
  readonly routes: RouteInfo[];
  readonly warnings: string[];
  readonly totalEnemies: number;
  readonly lastSpawnTime: number;
  /** 无尽模式设置（普通关卡为 null） */
  readonly endless: EndlessConfig | null;
  /** 角色试用设置（普通关卡为 null） */
  readonly training: TrainingOptions | null;

  time = 0;
  hp: number;
  readonly maxHp: number;
  money: number;
  status: GameStatus = 'running';
  killed = 0;
  leaked = 0;
  spawned = 0;
  /** 无尽模式：当前波次、分数、下一波的时间、是否由玩家结束 */
  wave = 0;
  score = 0;
  nextWaveAt = Infinity;
  finishedByPlayer = false;
  /** 角色试用：敌人停止移动；伤害 / 治疗统计（从 meterStart 开始计算） */
  frozen = false;
  damageDealt = 0;
  healingDone = 0;
  meterStart = 0;
  private respawnAt = 0;

  units: Unit[] = [];
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  effects: Effect[] = [];
  moneyFlows: MoneyFlow[] = [];

  private schedule: SpawnEvent[];
  private summonChoice: Record<string, string>;
  private nextEvent = 0;
  /** 无尽模式生成的敌人（按时间排序） */
  private queue: SpawnEvent[] = [];
  private lineRoutes: LineRoute[];
  private rng: () => number;
  private seq = 1;
  /** 部署冷却：角色 ID → 可以再次部署的时间 */
  private readyAt = new Map<string, number>();

  constructor(level: LevelDef, characters: CharacterDef[], enemies: EnemyDef[], opts: EngineOptions = {}) {
    this.level = level;
    this.grid = TileGrid.fromLevel(level);
    const allowed = level.settings.availableCharacters;
    this.levels = opts.levels ?? {};
    this.roster = (allowed.length ? characters.filter((c) => allowed.includes(c.id)) : characters).map((c) => leveledCharacter(c, this.levelOf(c.id)));
    this.enemyDefs = new Map(enemies.map((e) => [e.id, e]));
    this.skillDefs = new Map((opts.skills ?? []).map((s) => [s.id, s]));
    this.summonDefs = new Map((opts.summons ?? []).map((s) => [s.id, s]));
    this.summonChoice = opts.summonChoice ?? {};
    this.loadouts = opts.loadouts ?? {};
    this.endless = opts.endless ?? null;
    this.training = opts.training && opts.training.path.length >= 2 ? opts.training : null;
    this.rng = opts.rng ?? Math.random;
    const sched = buildSchedule(level, this.grid, this.enemyDefs, !!this.endless);
    this.schedule = sched.events;
    this.routes = sched.routes;
    this.lineRoutes = sched.lineRoutes;
    this.warnings = sched.warnings;
    this.totalEnemies = sched.events.length;
    this.lastSpawnTime = sched.duration;
    this.hp = this.maxHp = level.settings.initialHp;
    this.money = level.settings.initialMoney;
    if (this.endless) {
      this.nextWaveAt = this.endless.firstWave;
      if (!this.lineRoutes.length) this.warnings.push('无尽模式的地图没有可以使用的敌人路线，敌人不会出现');
      if (!this.enemyDefs.size) this.warnings.push('还没有任何敌人');
    }
    if (this.training) this.spawnTraining();
    // 攻击方式是「召唤」但没有可以召唤的召唤物：部署后不会出现召唤物
    for (const c of this.roster) {
      if (c.attackType === 'summon' && !this.chosenSummon(c)) this.warnings.push(`「${c.name}」的攻击方式是召唤，但还没有设置召唤物（在角色编辑中添加），部署后不会出现召唤物`);
    }
  }

  /** 角色试用：生成来回移动的敌人 */
  private spawnTraining() {
    const t = this.training!;
    const count = this.enemies.length;
    this.spawnEnemy({ time: this.time, enemyId: t.enemyId, lineId: 'training', path: t.path, waits: [] });
    for (const e of this.enemies.slice(count)) e.patrol = true;
  }

  /** 角色试用：敌人回满生命（已经被击败时立即重新出现） */
  refillEnemies() {
    for (const e of this.enemies) if (e.hp > 0) e.hp = e.stats.maxHp;
    if (this.training && !this.enemies.some((e) => e.hp > 0)) this.spawnTraining();
  }

  /** 角色试用：重新开始统计伤害 / 治疗 */
  resetMeter() {
    this.damageDealt = 0;
    this.healingDone = 0;
    this.meterStart = this.time;
  }

  /** 角色等级（没有记录 = 1 级） */
  levelOf(charId: string): number {
    return Math.max(1, Math.floor(this.levels[charId] ?? 1));
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
    // 每分钟回复可以是负数（金钱随时间减少，最少为 0）
    if (this.moneyPerSecond) this.changeMoney(this.moneyPerSecond * dt);
    this.updateMoneyFlows(dt);

    if (this.endless) this.updateEndless();
    // 角色试用：敌人被击败（并清理掉）后，过一会儿重新出现
    if (this.training && this.enemies.length === 0 && this.time + 1e-9 >= this.respawnAt) this.spawnTraining();
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

  /** 无尽模式：到时间就安排下一波（组与组依次出现，见 core/endless.ts） */
  private updateEndless() {
    const cfg = this.endless!;
    let guard = 0;
    while (this.time + 1e-9 >= this.nextWaveAt && guard++ < 10) {
      const start = this.nextWaveAt;
      this.wave++;
      this.nextWaveAt += cfg.waveInterval;
      if (!this.lineRoutes.length) continue;
      const plan = planWave(cfg, [...this.enemyDefs.values()], this.lineRoutes.length, this.wave, this.rng);
      for (const g of plan.groups) {
        const r = this.lineRoutes[g.routeIndex];
        for (let i = 0; i < g.count; i++) {
          this.queue.push({
            time: start + g.offset + i * g.interval,
            enemyId: g.enemyId,
            lineId: r.info.lineId,
            path: r.info.path,
            waits: r.perStep,
            hpScale: plan.hpScale,
            atkScale: plan.atkScale,
          });
        }
      }
      this.queue.sort((a, b) => a.time - b.time);
    }
  }

  private spawnDue() {
    while (this.nextEvent < this.schedule.length && this.schedule[this.nextEvent].time <= this.time + 1e-9) {
      this.spawnEnemy(this.schedule[this.nextEvent++]);
    }
    // 无尽模式：场上敌人太多时暂缓出现
    while (this.queue.length && this.queue[0].time <= this.time + 1e-9 && this.enemies.length < MAX_ENEMIES) {
      this.spawnEnemy(this.queue.shift()!);
    }
  }

  private spawnEnemy(ev: SpawnEvent) {
    const def = this.enemyDefs.get(ev.enemyId);
    if (!def) return;
    const start = tileCenter(ev.path[0]);
    const base = enemyBaseStats(def);
    // 无尽模式：每一波的敌人更强（生命 / 攻击按百分比增加）
    if (ev.hpScale && ev.hpScale !== 1) base.maxHp = Math.max(1, Math.round(base.maxHp * ev.hpScale));
    if (ev.atkScale && ev.atkScale !== 1) base.atk = Math.round(base.atk * ev.atkScale * 100) / 100;
    const e: Enemy = {
      uid: this.seq++,
      side: 'enemy',
      def,
      lineId: ev.lineId,
      path: ev.path,
      waypoint: 1,
      waits: ev.waits,
      // 停留点设在出现点上：出现后先停留
      waitLeft: ev.waits[0] ?? 0,
      waitTotal: ev.waits[0] ?? 0,
      x: start.x,
      y: start.y,
      hp: base.maxHp,
      base,
      stats: { ...base },
      statuses: [],
      regens: [],
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

  /** 增益 / 减益计时、属性重算、持续回复 / 持续伤害 */
  private updateStatuses(dt: number) {
    for (const c of this.allCombatants()) {
      if (c.hp <= 0) continue;
      if (c.statuses.length) {
        for (const s of c.statuses) s.remaining -= dt;
        c.statuses = c.statuses.filter((s) => s.remaining > 0);
      }
      // 效果结束（时间到）：生命上限变回去时当前生命不减少，只是不超过新的上限
      this.refreshStats(c, false);
      if (c.regens.length) this.tickRegens(c, dt);
      if (c.hp <= 0) continue;
      if (c.stats.hpRegen !== 0) {
        if (c.stats.hpRegen > 0) c.hp = Math.min(c.stats.maxHp, c.hp + c.stats.hpRegen * dt);
        else c.hp += c.stats.hpRegen * dt;
      }
      if (c.hp > c.stats.maxHp) c.hp = c.stats.maxHp;
    }
  }

  /** 持续治疗 / 持续伤害：施加后每过 1 秒结算一次（持续 5 秒 = 5 次） */
  private tickRegens(c: Combatant, dt: number) {
    for (const r of c.regens) {
      r.tick -= dt;
      r.remaining -= dt;
      if (r.tick <= 1e-6 && c.hp > 0) {
        r.tick += 1;
        if (r.perSecond > 0) this.heal(null, c, r.perSecond);
        else if (r.perSecond < 0) {
          const dmg = this.dealDamage(c, -r.perSecond, r.damageType);
          if (dmg >= 1) this.addEffect({ kind: 'text', x: c.x - 0.15, y: c.y - 0.45, duration: 0.8, color: '#ff8a65', text: `-${Math.round(dmg)}` });
        }
      }
    }
    c.regens = c.regens.filter((r) => r.remaining > 1e-6);
  }

  /** 施加持续治疗 / 持续伤害（同一来源再次施加时刷新时间和数值） */
  addRegen(target: Combatant, r: { key: string; name: string; color: string; perSecond: number; damageType: SkillDamageType; duration: number }) {
    if (target.hp <= 0 || r.duration <= 0 || !r.perSecond) return;
    const existing = target.regens.find((x) => x.key === r.key);
    if (existing) {
      existing.perSecond = r.perSecond;
      existing.damageType = r.damageType;
      existing.remaining = existing.total = r.duration;
    } else {
      target.regens.push({ key: r.key, name: r.name, color: r.color, perSecond: r.perSecond, damageType: r.damageType, remaining: r.duration, total: r.duration, tick: 1 });
    }
  }

  /**
   * 按当前的增益 / 减益重算属性。
   * sync = true（施加效果时）：生命上限变化多少，当前生命就同步增加 / 减少多少
   *   （例如 100 上限、40 生命，+20% → 120 上限、60 生命）；上限降低不会直接致死，最少保留 1 点生命。
   * sync = false（效果结束时）：当前生命不变，只是不超过新的上限（120 / 60 → 100 / 60；120 / 120 → 100 / 100）。
   */
  private refreshStats(c: Combatant, sync = true) {
    const prevMax = c.stats.maxHp;
    c.stats = c.statuses.length ? applyModifiers(c.base, c.statuses.map((s) => s.modifiers)) : { ...c.base };
    const delta = c.stats.maxHp - prevMax;
    if (sync && c.hp > 0 && Math.abs(delta) > 1e-9) c.hp = Math.max(Math.min(1, c.hp), c.hp + delta);
    if (c.hp > c.stats.maxHp) c.hp = c.stats.maxHp;
  }

  /** 技能的持续金钱：每秒结算，施放者离场（撤退 / 被击败）后停止 */
  private updateMoneyFlows(dt: number) {
    if (!this.moneyFlows.length) return;
    for (const f of this.moneyFlows) {
      const src = f.sourceSide === 'ally' ? this.unitByUid(f.sourceUid) : this.enemyByUid(f.sourceUid);
      const t = Math.min(dt, Math.max(0, f.remaining));
      f.remaining -= dt;
      if (!src || src.hp <= 0) f.remaining = 0;
      else {
        f.acc += this.changeMoney(f.rate * t);
        f.tick += dt;
      }
      if (src && (f.tick >= 1 || f.remaining <= 0)) {
        if (Math.abs(f.acc) >= 0.5) this.moneyText(src, f.acc);
        f.acc = 0;
        f.tick = 0;
      }
    }
    this.moneyFlows = this.moneyFlows.filter((f) => f.remaining > 0);
  }

  /** 改变玩家金钱（最少为 0），返回实际变化量 */
  changeMoney(amount: number): number {
    const before = this.money;
    this.money = Math.max(0, this.money + amount);
    return this.money - before;
  }

  private moneyText(at: { x: number; y: number }, amount: number) {
    const v = Math.round(Math.abs(amount));
    if (v < 1) return;
    this.addEffect({ kind: 'text', x: at.x + 0.2, y: at.y - 0.55, duration: 1, color: amount > 0 ? '#ffd166' : '#ff9f6b', text: `${amount > 0 ? '+' : '−'}${v}` });
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
    // 角色试用：可以让敌人停止移动
    if (this.frozen) return;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      // 停留点：停留时间照常计时（被阻挡时也一样），停留结束后的下一帧继续前进
      if (e.waitLeft > 0) {
        e.waitLeft = Math.max(0, e.waitLeft - dt);
        continue;
      }
      if (e.blockedBy != null) continue;
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
          if (!e.patrol && this.grid.isType(tile.x, tile.y, 'base')) {
            this.leak(e);
            break;
          }
          const wait = e.waits[e.waypoint] ?? 0;
          e.waypoint++;
          if (e.patrol && e.waypoint >= e.path.length) {
            // 来回移动：走到头就掉头
            e.path = [...e.path].reverse();
            e.waypoint = 1;
            e.distLeft = pathLength(e.path);
          }
          if (wait > 0) {
            // 到达停留点：停在方块中心
            e.waitLeft = e.waitTotal = wait;
            break;
          }
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
      const type = c.side === 'ally' ? attackTypeOf(c.def) : c.def.attackType;
      // 不攻击（召唤物可以设置；召唤者可以只召唤不攻击）
      if (type === 'none') continue;
      c.attackCd -= dt;
      if (c.attackCd > 0) continue;
      const behavior = attackBehavior(type);
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
        if (p.heal) {
          this.heal(src ?? null, target, p.atk);
          // 命中附带效果对治疗的队友同样生效（例如治疗时附带增益）
          if (p.onHit) this.applyOnHit(target, p.onHit, src);
        } else {
          this.dealDamage(target, p.atk, p.damageType);
          if (p.onHit) this.applyOnHit(target, p.onHit, src);
          this.addEffect({ kind: 'hit', x: target.x, y: target.y, duration: 0.18, color: p.color });
        }
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
          if (this.training) this.respawnAt = this.time + (this.training.respawnDelay ?? 1.5);
          if (this.endless) this.score += e.def.endlessScore;
          // 击杀奖励可以是负数（击败时扣除金钱）
          if (e.def.reward) this.moneyText({ x: e.x - 0.2, y: e.y + 0.2 }, this.changeMoney(e.def.reward));
          this.addEffect({ kind: 'death', x: e.x, y: e.y, duration: 0.4, color: e.def.color, size: enemyRadius(e.def) });
        }
      }
      this.enemies = this.enemies.filter((e) => e.hp > 0);
    }
    for (const u of this.units) if (u.hp <= 0 && isSummonDef(u.def) && u.def.invincible) u.hp = 1;
    const fallen = this.units.filter((u) => u.hp <= 0);
    if (fallen.length) {
      for (const u of fallen) {
        this.dismissSummons(u.uid);
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
    // 无尽模式没有胜利，只会在血量归零或玩家结束挑战时结束；角色试用不会结束
    if (this.training) return;
    if (!this.endless && this.nextEvent >= this.schedule.length && this.enemies.length === 0) {
      this.status = 'won';
    }
  }

  /** 无尽模式：玩家主动结束挑战（按当前分数结算） */
  finish() {
    if (!this.endless || this.status !== 'running') return;
    this.status = 'lost';
    this.finishedByPlayer = true;
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
    // 无敌的召唤物不会受到伤害
    if (target.side === 'ally' && isSummonDef(target.def) && target.def.invincible) return 0;
    const dmg = computeDamage(atk, type, target.stats.def, target.stats.res);
    if (this.training && target.side === 'enemy') this.damageDealt += Math.min(dmg, target.hp);
    target.hp -= dmg;
    target.flash = 0.12;
    return dmg;
  }

  heal(_source: Combatant | null, target: Combatant, amount: number): number {
    if (target.hp <= 0 || amount <= 0) return 0;
    const before = target.hp;
    target.hp = Math.min(target.stats.maxHp, target.hp + amount);
    const healed = target.hp - before;
    if (this.training && target.side === 'ally') this.healingDone += healed;
    target.healFlash = 0.35;
    this.addEffect({ kind: 'heal', x: target.x, y: target.y, duration: 0.7, color: '#5dff9d' });
    if (healed >= 1) {
      this.addEffect({ kind: 'text', x: target.x + 0.15, y: target.y - 0.45, duration: 0.8, color: '#7dffb0', text: `+${Math.round(healed)}` });
    }
    return healed;
  }

  /** 范围治疗命中：治疗 + 命中附带效果 */
  healWithAttack(attacker: Combatant, target: Combatant) {
    this.heal(attacker, target, -attacker.stats.atk);
    const oh = attacker.def.onHit;
    if (oh && oh.modifiers.length) this.applyOnHit(target, { ...oh, key: `onhit:${attacker.def.id}` }, attacker);
  }

  /** 普通攻击立即命中（范围伤害）：伤害 + 命中附带效果 */
  hitWithAttack(attacker: Combatant, target: Combatant) {
    this.dealDamage(target, attacker.stats.atk, attacker.def.damageType);
    const oh = attacker.def.onHit;
    if (oh && oh.modifiers.length) this.applyOnHit(target, { ...oh, key: `onhit:${attacker.def.id}` }, attacker);
  }

  private applyOnHit(target: Combatant, oh: { modifiers: StatModifier[]; duration: number; key: string }, src: Combatant | null | undefined) {
    this.addStatus(target, { key: oh.key, name: src ? `${src.def.name}的攻击效果` : '攻击效果', color: src?.def.color ?? '#ffffff', modifiers: oh.modifiers, duration: oh.duration });
  }

  /** 发射子弹（默认攻击）：攻击队友且攻击力为负数时发射治疗子弹 */
  fireProjectile(attacker: Combatant, target: Combatant) {
    const oh = attacker.def.onHit;
    const heal = attacker.def.attackTarget === 'ally' && attacker.stats.atk < 0;
    const type = attacker.def.damageType;
    this.projectiles.push({
      id: this.seq++,
      sourceUid: attacker.uid,
      sourceSide: attacker.side,
      targetUid: target.uid,
      targetSide: target.side,
      x: attacker.x,
      y: attacker.y,
      speed: PROJECTILE_SPEED,
      atk: heal ? -attacker.stats.atk : attacker.stats.atk,
      heal,
      damageType: type,
      onHit: oh && oh.modifiers.length ? { ...oh, key: `onhit:${attacker.def.id}` } : null,
      color: heal ? '#5dff9d' : type === 'magic' ? '#c79bff' : type === 'true' ? '#fff3c4' : attacker.def.color,
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
    // 立即重算属性，让本帧的攻击就能用上（生命上限变化时同步当前生命）
    this.refreshStats(target);
  }

  /** 技能效果作用的目标 */
  effectTargets(caster: Combatant, eff: SkillEffect): Combatant[] {
    if (eff.target === 'self') return caster.hp > 0 ? [caster] : [];
    let pool = eff.target === 'allies' ? this.alliesOf(caster) : this.opponentsOf(caster);
    if (eff.scope === 'range') {
      // 和攻击射程一样按方块判断
      const r = eff.radius > 0 ? eff.radius : caster.stats.range;
      const from = tileOfCombatant(caster);
      pool = pool.filter(
        (t) => t === caster || tileInRange(from, tileOf(t), r) || (caster.side === 'ally' && t.side === 'enemy' && (t as Enemy).blockedBy === caster.uid),
      );
    }
    pool.sort((p, q) => dist(caster, p) - dist(caster, q));
    return eff.maxTargets > 0 ? pool.slice(0, eff.maxTargets) : pool;
  }

  /** 自动释放前判断是否值得释放：攻击敌人的技能需要有敌人，治疗技能需要有受伤的队友 */
  private worthCasting(c: Combatant, skill: SkillDef): boolean {
    const offensive = skill.effects.filter((e) => e.kind !== 'money' && e.target === 'enemies');
    if (offensive.length) return offensive.some((e) => this.effectTargets(c, e).length > 0);
    const heals = skill.effects.filter((e) => (e.kind === 'damage' && e.amount < 0) || (e.kind === 'regen' && e.amount > 0));
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
      const key = `skill:${skill.id}:${c.uid}:${i}`;
      if (eff.kind === 'money') {
        // 角色释放 = 玩家获得金钱；敌人释放 = 玩家失去金钱
        const sign = c.side === 'ally' ? 1 : -1;
        if (eff.money) this.moneyText(c, this.changeMoney(sign * eff.money));
        const duration = eff.duration > 0 ? eff.duration : skill.duration;
        if (eff.moneyRate && duration > 0) {
          this.moneyFlows = this.moneyFlows.filter((f) => f.key !== key);
          this.moneyFlows.push({ key, sourceUid: c.uid, sourceSide: c.side, rate: sign * eff.moneyRate, remaining: duration, acc: 0, tick: 0 });
        }
        return;
      }
      const targets = this.effectTargets(c, eff);
      if (eff.kind === 'regen') {
        // 持续治疗 / 持续伤害：固定值或施放者攻击力的百分比（每秒）
        const perSecond = eff.regenMode === 'atk' ? (Math.abs(c.stats.atk) * eff.amount) / 100 : eff.amount;
        const duration = eff.duration > 0 ? eff.duration : skill.duration;
        for (const t of targets) this.addRegen(t, { key, name: skill.name, color: skill.color, perSecond, damageType: eff.damageType, duration });
        return;
      }
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
          this.addStatus(t, { key, name: skill.name, color: skill.color, modifiers: eff.modifiers, duration });
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

  /** 部署冷却的剩余时间（秒） */
  cooldownLeft(charId: string): number {
    const t = this.readyAt.get(charId);
    return t == null ? 0 : Math.max(0, t - this.time);
  }

  /** 角色选择的召唤物（攻击方式不是「召唤」= null；没有选择 = 第一个有效的召唤物） */
  chosenSummon(def: CharacterDef): SummonDef | null {
    if (def.attackType !== 'summon' || isSummonDef(def)) return null;
    const pick = this.summonChoice[def.id];
    const id = pick && def.summons.includes(pick) && this.summonDefs.has(pick) ? pick : def.summons.find((x) => this.summonDefs.has(x));
    return id ? this.summonDefs.get(id) ?? null : null;
  }

  /** 场上可以召唤这个召唤物的角色（按部署顺序） */
  summonersOf(summonId: string): Unit[] {
    return this.units.filter((u) => u.hp > 0 && this.chosenSummon(u.def)?.id === summonId);
  }

  /** 现在出现在部署栏里的召唤物（召唤者在场时才出现） */
  get activeSummons(): SummonDef[] {
    const out: SummonDef[] = [];
    for (const u of this.units) {
      const s = u.hp > 0 ? this.chosenSummon(u.def) : null;
      if (s && !out.includes(s)) out.push(s);
    }
    return out;
  }

  /** 部署栏里的角色或召唤物 */
  deployable(id: string): CharacterDef | undefined {
    return this.roster.find((c) => c.id === id) ?? this.activeSummons.find((s) => s.id === id);
  }

  /** 召唤者离场：召唤物一起离场（设置了「召唤者离场后保留」的除外），不返还费用 */
  private dismissSummons(summonerUid: number) {
    const gone = this.units.filter((u) => u.summonerUid === summonerUid && !(isSummonDef(u.def) && u.def.keepAfterSummoner));
    if (!gone.length) return;
    for (const u of gone) {
      this.releaseBlocked(u);
      this.addEffect({ kind: 'death', x: u.x, y: u.y, duration: 0.4, color: u.def.color, size: 0.26 });
    }
    this.units = this.units.filter((u) => !gone.includes(u));
  }

  /** 当前是否买得起 / 还能部署（不看位置） */
  cardState(def: CharacterDef): CardState {
    const cooldown = this.cooldownLeft(def.id);
    if (this.status !== 'running') return { ok: false, reason: '战斗已结束', cooldown };
    if (isSummonDef(def) && !this.summonersOf(def.id).length) return { ok: false, reason: '召唤者不在场', cooldown };
    if (def.maxDeploy > 0 && this.deployedCount(def.id) >= def.maxDeploy) return { ok: false, reason: '已达部署上限', cooldown };
    if (cooldown > 1e-9) return { ok: false, reason: `部署冷却中（还需 ${Math.ceil(cooldown - 1e-6)} 秒）`, cooldown };
    if (Math.floor(this.money + 1e-9) < def.cost) return { ok: false, reason: '金钱不足', cooldown };
    return { ok: true, cooldown };
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
    if (isSummonDef(def) && def.nearSummoner && !this.summonersOf(def.id).some((u) => tileInRange(u.tile, tile, u.stats.range))) {
      return '召唤物只能放在召唤者的攻击范围内';
    }
    return null;
  }

  deploy(charId: string, tile: GridPos): string | null {
    const def = this.deployable(charId);
    if (!def) return '本关不能使用该角色';
    const err = this.checkDeploy(def, tile);
    if (err) return err;
    // 费用可以是负数：部署时获得金钱
    this.changeMoney(-def.cost);
    // 部署冷却：同一个角色在冷却结束前不能再次部署
    if (def.deployCooldown > 0) this.readyAt.set(def.id, this.time + def.deployCooldown);
    const c = tileCenter(tile);
    const t = this.grid.get(tile.x, tile.y)!;
    const base = unitBaseStats(def);
    // 召唤物：属于最早部署的召唤者（只能放在召唤者攻击范围内时，属于范围包含这个方块的召唤者），并继承召唤者的数值
    let summoner: Unit | undefined;
    if (isSummonDef(def)) {
      const list = this.summonersOf(def.id);
      summoner = (def.nearSummoner ? list.find((u) => tileInRange(u.tile, tile, u.stats.range)) : undefined) ?? list[0];
      if (summoner) {
        const sb = summoner.base;
        const r = (v: number) => Math.round(v * 100) / 100;
        base.maxHp = r(Math.max(1, base.maxHp + (sb.maxHp * def.inherit.maxHp) / 100));
        base.atk = r(base.atk + (sb.atk * def.inherit.atk) / 100);
        base.def = r(base.def + (sb.def * def.inherit.def) / 100);
        base.res = r(Math.min(100, base.res + (sb.res * def.inherit.res) / 100));
      }
    }
    this.units.push({
      uid: this.seq++,
      side: 'ally',
      def,
      level: summoner ? summoner.level : this.levelOf(def.id),
      summonerUid: summoner?.uid,
      tile: { ...tile },
      x: c.x,
      y: c.y,
      hp: base.maxHp,
      base,
      stats: { ...base },
      statuses: [],
      regens: [],
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

  /** 撤退：返还一半费用（费用是负数时扣回一半），返回实际的金钱变化 */
  retreat(uid: number): number {
    const u = this.unitByUid(uid);
    if (!u || this.status !== 'running') return 0;
    const change = this.changeMoney(retreatRefund(u.def.cost));
    this.dismissSummons(u.uid);
    this.releaseBlocked(u);
    this.units = this.units.filter((x) => x !== u);
    this.moneyText({ x: u.x - 0.2, y: u.y + 0.15 }, change);
    return change;
  }

  private releaseBlocked(u: Unit) {
    for (const e of this.enemies) if (e.blockedBy === u.uid) e.blockedBy = null;
    u.blocked = [];
  }

  /** 剩余尚未出现的敌人数（无尽模式只算已经安排好的） */
  get pendingSpawns(): number {
    return this.schedule.length - this.nextEvent + this.queue.length;
  }

  /** 下一个敌人出现的时间（没有则为 null） */
  get nextSpawnTime(): number | null {
    const a = this.nextEvent < this.schedule.length ? this.schedule[this.nextEvent].time : Infinity;
    const b = this.queue.length ? this.queue[0].time : Infinity;
    const t = Math.min(a, b);
    return Number.isFinite(t) ? t : null;
  }
}

function pathLength(path: GridPos[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return len;
}
