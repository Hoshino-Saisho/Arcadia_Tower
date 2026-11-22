import type { Stats } from '../core/stats';
import type { CharacterDef, EnemyDef, GridPos, SkillDamageType, SkillDef, StatModifier } from '../core/types';

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
  /** 地面上的角色才能阻挡敌人 */
  canBlock: boolean;
  /** 当前阻挡的敌人 uid */
  blocked: number[];
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
  blockedBy: number | null;
  /** 剩余到达基地的距离（格），用于角色选择优先攻击的目标 */
  distLeft: number;
  /** 朝向（弧度） */
  angle: number;
  spawnedAt: number;
  /** 已进入基地（不算击杀） */
  leaked?: boolean;
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
  /** 攻击力（命中时再结算抗性） */
  atk: number;
  damageType: SkillDamageType;
  onHit: { modifiers: StatModifier[]; duration: number; key: string } | null;
  color: string;
  radius: number;
}

export type EffectKind = 'hit' | 'slash' | 'leak' | 'death' | 'spawn' | 'deploy' | 'text' | 'heal' | 'beam' | 'skill';

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
export const ENEMY_BASE_RADIUS = 0.27;
/** 敌人中心与地面角色中心距离小于该值时被阻挡 */
export const BLOCK_DISTANCE = 0.62;
/** 攻击范围不超过该值时视为近战（直接命中，无弹道） */
export const MELEE_RANGE = 1.3;

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
