import { tileInRange, tileOf } from '../core/range';
import type { GameEngine } from './engine';
import { dist, type Combatant, type Enemy, type Unit } from './entities';

/**
 * 攻击方式注册表（角色 / 敌人的 attackType 字段）：
 *  - basic 默认攻击：向目标发射子弹，子弹命中时结算伤害 / 治疗；每次攻击的目标数可设置（-1 = 射程内全部）
 *  - area  范围伤害：不发射子弹，同时对射程内全部攻击对象立即造成伤害 / 治疗
 * 两种方式都支持：攻击敌人 / 攻击队友（攻击力为负数 = 治疗）、物伤 / 法伤 / 真伤、命中附带增益减益。
 * 以后要加特殊攻击（如链式、穿透）只需在这里注册新的行为，引擎主循环不用修改。
 */
export interface AttackBehavior {
  id: string;
  name: string;
  description: string;
  /** 是否使用「每次攻击目标数」设置 */
  usesTargetCount: boolean;
  /** 选择本次攻击的目标（空数组 = 没有可攻击的目标） */
  pickTargets(engine: GameEngine, attacker: Combatant): Combatant[];
  /** 对选中的目标执行一次攻击 */
  execute(engine: GameEngine, attacker: Combatant, targets: Combatant[]): void;
}

/** 单位所在的方块（场上角色固定在部署的方块上） */
export function tileOfCombatant(c: Combatant) {
  return c.side === 'ally' ? (c as Unit).tile : tileOf(c);
}

/** 目标是否在攻击者的射程内（按方块判断） */
export function inAttackRange(a: Combatant, t: Combatant): boolean {
  return tileInRange(tileOfCombatant(a), tileOf(t), a.stats.range);
}

/** 射程内所有可以攻击的对象，按优先级排序 */
function candidates(engine: GameEngine, a: Combatant): Combatant[] {
  if (a.def.attackTarget === 'ally') {
    const inRange = engine.alliesOf(a).filter((t) => t === a || inAttackRange(a, t));
    if (a.stats.atk < 0) {
      const hurt = inRange.filter((t) => t.hp < t.stats.maxHp - 0.01);
      return hurt.sort((p, q) => p.hp / p.stats.maxHp - q.hp / q.stats.maxHp);
    }
    return inRange.filter((t) => t !== a).sort((p, q) => dist(a, p) - dist(a, q));
  }
  if (a.side === 'ally') {
    const u = a as Unit;
    const list = engine.enemies.filter((e) => e.hp > 0 && (e.blockedBy === u.uid || inAttackRange(u, e)));
    const score = (e: Enemy) => (e.blockedBy === u.uid ? -1e6 : 0) + e.distLeft;
    return list.sort((p, q) => score(p) - score(q));
  }
  // 敌人：优先攻击阻挡自己的角色；攻击范围为 0 时只攻击阻挡者
  const e = a as Enemy;
  const out: Combatant[] = [];
  const blocker = e.blockedBy != null ? engine.unitByUid(e.blockedBy) : undefined;
  if (blocker) out.push(blocker);
  if (e.stats.range > 0) {
    out.push(...engine.units.filter((u) => u !== blocker && inAttackRange(e, u)).sort((p, q) => dist(e, p) - dist(e, q)));
  }
  return out;
}

const isHeal = (a: Combatant) => a.def.attackTarget === 'ally' && a.stats.atk < 0;

const basic: AttackBehavior = {
  id: 'basic',
  name: '默认攻击（子弹）',
  description: '向目标发射子弹，命中时结算。攻击敌人时优先攻击自己阻挡的敌人，其次是离基地最近的敌人；攻击队友且攻击力为负数时，治疗射程内生命比例最低的队友。',
  usesTargetCount: true,
  pickTargets(engine, a) {
    const list = candidates(engine, a);
    const n = a.stats.targetCount;
    return n < 0 ? list : list.slice(0, Math.max(1, n));
  },
  execute(engine, a, targets) {
    a.attackAnim = 0.18;
    if (a.side === 'ally' && targets[0]) (a as Unit).facing = Math.atan2(targets[0].y - a.y, targets[0].x - a.x);
    for (const t of targets) engine.fireProjectile(a, t);
  },
};

const area: AttackBehavior = {
  id: 'area',
  name: '范围伤害',
  description: '不发射子弹：每次攻击同时对射程内的全部攻击对象立即造成伤害（攻击队友且攻击力为负数时为范围治疗）。',
  usesTargetCount: false,
  pickTargets(engine, a) {
    return candidates(engine, a);
  },
  execute(engine, a, targets) {
    a.attackAnim = 0.25;
    const heal = isHeal(a);
    const tile = tileOfCombatant(a);
    engine.addEffect({ kind: 'area', x: tile.x + 0.5, y: tile.y + 0.5, duration: 0.35, color: heal ? '#5dff9d' : a.def.color, size: a.stats.range });
    for (const t of targets) {
      if (heal) engine.healWithAttack(a, t);
      else {
        engine.hitWithAttack(a, t);
        engine.addEffect({ kind: 'hit', x: t.x, y: t.y, duration: 0.2, color: a.def.color });
      }
    }
  },
};

export const ATTACKS: Record<string, AttackBehavior> = { basic, area };

export function attackBehavior(id: string): AttackBehavior {
  return ATTACKS[id] ?? basic;
}

/** 编辑器下拉框使用的攻击方式列表 */
export function listAttackTypes(): { id: string; name: string; description: string; usesTargetCount: boolean }[] {
  return Object.values(ATTACKS).map(({ id, name, description, usesTargetCount }) => ({ id, name, description, usesTargetCount }));
}
