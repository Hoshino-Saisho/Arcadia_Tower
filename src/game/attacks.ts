import type { GameEngine } from './engine';
import { MELEE_RANGE, dist, type Combatant, type Enemy, type Unit } from './entities';

/**
 * 攻击方式注册表。
 * 角色与敌人的 attackType 字段对应这里注册的 id。默认攻击（basic）已经支持：
 *   - 攻击对象：敌人 / 队友（攻击力为负数时为治疗）
 *   - 每次攻击的目标数（-1 = 射程内全部）
 *   - 物伤 / 法伤、命中附带增益减益
 * 以后要加特殊攻击（如溅射、链式）只需在这里注册新的行为，引擎主循环不用修改。
 */
export interface AttackBehavior {
  id: string;
  name: string;
  description: string;
  /** 选择本次攻击的目标（空数组 = 没有可攻击的目标） */
  pickTargets(engine: GameEngine, attacker: Combatant): Combatant[];
  /** 对选中的目标执行一次攻击 */
  execute(engine: GameEngine, attacker: Combatant, targets: Combatant[]): void;
}

function limit<T>(list: T[], count: number): T[] {
  return count < 0 ? list : list.slice(0, Math.max(1, count));
}

const basic: AttackBehavior = {
  id: 'basic',
  name: '默认攻击',
  description:
    '攻击敌人：优先攻击自己阻挡的敌人，其次是离基地最近的敌人；攻击队友：攻击力为负数时治疗射程内生命比例最低的队友。近战直接命中，远程发射弹道。',
  pickTargets(engine, a) {
    const range = a.stats.range;
    const count = a.stats.targetCount;
    if (a.def.attackTarget === 'ally') {
      const inRange = engine.alliesOf(a).filter((t) => dist(a, t) <= range + 1e-6);
      if (a.stats.atk < 0) {
        const hurt = inRange.filter((t) => t.hp < t.stats.maxHp - 0.01);
        hurt.sort((p, q) => p.hp / p.stats.maxHp - q.hp / q.stats.maxHp);
        return limit(hurt, count);
      }
      const others = inRange.filter((t) => t !== a).sort((p, q) => dist(a, p) - dist(a, q));
      return limit(others, count);
    }
    if (a.side === 'ally') {
      const u = a as Unit;
      const list = engine.enemies.filter((e) => e.hp > 0 && (e.blockedBy === u.uid || dist(u, e) <= range + 1e-6));
      list.sort((p, q) => (p.blockedBy === u.uid ? -1e6 : 0) + p.distLeft - ((q.blockedBy === u.uid ? -1e6 : 0) + q.distLeft));
      return limit(list, count);
    }
    const e = a as Enemy;
    const out: Combatant[] = [];
    const blocker = e.blockedBy != null ? engine.unitByUid(e.blockedBy) : undefined;
    if (blocker) out.push(blocker);
    if (range > 0) {
      const others = engine.units.filter((u) => u !== blocker && dist(e, u) <= range + 1e-6).sort((p, q) => dist(e, p) - dist(e, q));
      out.push(...others);
    }
    return limit(out, count);
  },
  execute(engine, a, targets) {
    a.attackAnim = 0.18;
    const first = targets[0];
    if (a.side === 'ally' && first) (a as Unit).facing = Math.atan2(first.y - a.y, first.x - a.x);
    const atk = a.stats.atk;
    for (const t of targets) {
      if (a.def.attackTarget === 'ally' && atk < 0) {
        engine.heal(a, t, -atk);
        if (t !== a) engine.addEffect({ kind: 'beam', x: a.x, y: a.y, x2: t.x, y2: t.y, duration: 0.3, color: '#7dffb0' });
        continue;
      }
      const melee = a.stats.range <= MELEE_RANGE || (a.side === 'enemy' && (a as Enemy).blockedBy === t.uid);
      if (melee) {
        engine.hitWithAttack(a, t);
        engine.addEffect({ kind: 'slash', x: t.x, y: t.y, duration: 0.2, color: a.def.color, angle: Math.atan2(t.y - a.y, t.x - a.x) });
      } else {
        engine.fireProjectile(a, t);
      }
    }
  },
};

export const ATTACKS: Record<string, AttackBehavior> = { basic };

export function attackBehavior(id: string): AttackBehavior {
  return ATTACKS[id] ?? basic;
}

/** 编辑器下拉框使用的攻击方式列表 */
export function listAttackTypes(): { id: string; name: string; description: string }[] {
  return Object.values(ATTACKS).map(({ id, name, description }) => ({ id, name, description }));
}
