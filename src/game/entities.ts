import type { Stats } from '../core/stats';
import type { CharacterDef, EnemyDef, GridPos, SkillDamageType, SkillDef, StatModifier, SummonDef } from '../core/types';

/** 身上的增益 / 减益 */
export interface StatusInstance {
  /** 同一个来源再次施加时刷新持续时间而不是叠加 */
  key: string;
  name: string;
  color: string;
  modifiers: StatModifier[];
  remaining: number;
  total: number;
  hasBuff: boolean;
  hasDebuff: boolean;
}

/** 身上的持续治疗 / 持续伤害（每秒结算一次） */
export interface RegenInstance {
  /** 同一来源再次施加时刷新持续时间 */
  key: string;
  name: string;
  color: string;
  /** 每秒的数值：正数 = 治疗，负数 = 伤害 */
  perSecond: number;
  damageType: SkillDamageType;
  remaining: number;
  total: number;
  /** 距离下一次结算的时间 */
  tick: number;
}

/** 战斗中某个技能的状态 */
export interface SkillState {
  def: SkillDef;
  sp: number;
  /** 持续中（持续期间不积累 SP） */
  active: boolean;
  remaining: number;
}

interface CombatantBase {
  uid: number;
  x: number;
  y: number;
  hp: number;
  /** 基础属性（来自定义） */
  base: Stats;
  /** 加上增益 / 减益后的实际属性 */
  stats: Stats;
  statuses: StatusInstance[];
  /** 持续治疗 / 持续伤害 */
  regens: RegenInstance[];
  skills: SkillState[];
  attackCd: number;
  /** 受击闪烁 / 治疗闪烁 / 攻击动作计时（用于渲染） */
  flash: number;
  healFlash: number;
  attackAnim: number;
}

/** 场上的角色（单位：格；方块 (x,y) 的中心是 (x+0.5, y+0.5)） */
export interface Unit extends CombatantBase {
  side: 'ally';
  def: CharacterDef;
  tile: GridPos;
  /** 角色等级（影响基础数值；召唤物为召唤者的等级） */
  level: number;
  /** 召唤物：召唤它的角色（召唤者离场时一起离场） */
  summonerUid?: number;
  /** 地面上的角色才能阻挡敌人 */
  canBlock: boolean;
  /** 当前阻挡的敌人 uid */
  blocked: number[];
  /** 部署时付的费用（撤退时按它返还；肉鸽的牌可以改变费用） */
  cost: number;
  deployedAt: number;
  /** 最近一次攻击的朝向（弧度） */
  facing: number;
}

export interface Enemy extends CombatantBase {
  side: 'enemy';
  def: EnemyDef;
  lineId: string;
  /** 行走路线（方块序列） */
  path: GridPos[];
  /** 下一个要走向的路点下标 */
  waypoint: number;
  /** 路线上每一格的停留时间（秒） */
  waits: number[];
  /** 正在停留：剩余时间 / 这次停留的总时间（秒） */
  waitLeft: number;
  waitTotal: number;
  blockedBy: number | null;
  /** 剩余到达基地的距离（格），用于角色选择优先攻击的目标 */
  distLeft: number;
  /** 朝向（弧度） */
  angle: number;
  spawnedAt: number;
  /** 已进入基地（不算击杀） */
  leaked?: boolean;
  /** 召唤者离场时一起消失（不算击杀，没有奖励） */
  dismissed?: boolean;
  /** 角色试用：在路线上来回移动（走到头就掉头，不会进入基地） */
  patrol?: boolean;
  /** 无尽模式的波次加成（这个敌人召唤的召唤物同样加成） */
  hpScale?: number;
  atkScale?: number;
  /** 敌人的召唤物：召唤者的 uid 和召唤物设置（def 是转换后的敌人数据） */
  summonerUid?: number;
  summon?: SummonDef;
  /** 召唤者：每种召唤物下一次召唤的时间 */
  summonTimers?: { id: string; next: number }[];
}

export type Combatant = Unit | Enemy;

export interface Projectile {
  id: number;
  sourceUid: number;
  sourceSide: 'ally' | 'enemy';
  targetUid: number;
  targetSide: 'ally' | 'enemy';
  x: number;
  y: number;
  speed: number;
  /** 攻击力（命中时再结算抗性）；治疗子弹为治疗量 */
  atk: number;
  /** 治疗子弹（攻击队友且攻击力为负数） */
  heal: boolean;
  damageType: SkillDamageType;
  onHit: { modifiers: StatModifier[]; duration: number; key: string } | null;
  color: string;
  radius: number;
}

export type EffectKind = 'hit' | 'slash' | 'leak' | 'death' | 'spawn' | 'deploy' | 'text' | 'heal' | 'beam' | 'skill' | 'area';

export interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  /** beam 的终点 */
  x2?: number;
  y2?: number;
  t: number;
  duration: number;
  color: string;
  text?: string;
  angle?: number;
  size?: number;
}

export const UNIT_RADIUS = 0.36;
/** 召唤物比角色小 */
export const SUMMON_RADIUS = 0.26;
export const ENEMY_BASE_RADIUS = 0.27;
/** 敌人中心与地面角色中心距离小于该值时被阻挡 */
export const BLOCK_DISTANCE = 0.62;

export function enemyRadius(def: EnemyDef): number {
  return ENEMY_BASE_RADIUS * def.size;
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function tileCenter(p: GridPos): { x: number; y: number } {
  return { x: p.x + 0.5, y: p.y + 0.5 };
}

export function unitBaseStats(d: CharacterDef): Stats {
  return {
    maxHp: d.maxHp,
    atk: d.atk,
    def: d.def,
    res: d.res,
    attackInterval: d.attackInterval,
    range: d.range,
    targetCount: d.targetCount,
    blockCount: d.blockCount,
    speed: 0,
    hpRegen: 0,
  };
}

export function enemyBaseStats(d: EnemyDef): Stats {
  return {
    maxHp: d.maxHp,
    atk: d.atk,
    def: d.def,
    res: d.res,
    attackInterval: d.attackInterval,
    range: d.attackRange,
    targetCount: d.targetCount,
    blockCount: 0,
    speed: d.speed,
    hpRegen: 0,
  };
}
