import type { DamageType, SkillDamageType, StatKey, StatModifier } from './types';

/** 可修改属性的说明（编辑器下拉框、技能说明文字、战斗面板共用） */
export interface StatInfo {
  key: StatKey;
  label: string;
  unit: string;
  /** 数值越小越好（如攻击间隔），用于判断修改是增益还是减益 */
  lowerIsBetter?: boolean;
  /** 只对敌人有意义 */
  enemyOnly?: boolean;
}

export const STATS: StatInfo[] = [
  { key: 'maxHp', label: '生命上限', unit: '' },
  { key: 'atk', label: '攻击力', unit: '' },
  { key: 'def', label: '物抗', unit: '' },
  { key: 'res', label: '法抗', unit: '%' },
  { key: 'attackInterval', label: '攻击间隔', unit: '秒', lowerIsBetter: true },
  { key: 'range', label: '攻击范围', unit: '格' },
  { key: 'targetCount', label: '攻击目标数', unit: '' },
  { key: 'blockCount', label: '阻挡数', unit: '' },
  { key: 'speed', label: '移动速度', unit: '格/秒' },
  { key: 'hpRegen', label: '每秒生命回复', unit: '' },
];

const BY_KEY = new Map(STATS.map((s) => [s.key, s]));
export const statInfo = (k: StatKey): StatInfo => BY_KEY.get(k)!;

/** 战斗中实际使用的属性 */
export type Stats = Record<StatKey, number>;

/** 某条修改是增益（true）还是减益（false） */
export function isBuff(m: StatModifier): boolean {
  const lower = statInfo(m.stat)?.lowerIsBetter;
  return lower ? m.value < 0 : m.value > 0;
}

/**
 * 计算修改后的属性：(基础值 + 固定值之和) × (1 + 百分比之和 / 100)
 * 再限制在合理范围内。攻击目标数为 -1（射程内全部）时不受修改影响。
 */
export function applyModifiers(base: Stats, modifierLists: StatModifier[][]): Stats {
  const add: Partial<Record<StatKey, number>> = {};
  const pct: Partial<Record<StatKey, number>> = {};
  for (const list of modifierLists) {
    for (const m of list) {
      if (m.mode === 'add') add[m.stat] = (add[m.stat] ?? 0) + m.value;
      else pct[m.stat] = (pct[m.stat] ?? 0) + m.value;
    }
  }
  const out = { ...base };
  for (const k of Object.keys(base) as StatKey[]) {
    if (add[k] === undefined && pct[k] === undefined) continue;
    if (k === 'targetCount' && base.targetCount < 0) continue;
    out[k] = (base[k] + (add[k] ?? 0)) * (1 + (pct[k] ?? 0) / 100);
  }
  out.maxHp = Math.max(1, out.maxHp);
  out.def = Math.max(0, out.def);
  out.res = Math.min(100, Math.max(0, out.res));
  out.attackInterval = Math.max(0.1, out.attackInterval);
  out.range = Math.max(0, out.range);
  if (out.targetCount >= 0) out.targetCount = Math.max(1, Math.round(out.targetCount));
  out.blockCount = Math.max(0, Math.round(out.blockCount));
  out.speed = Math.max(0, out.speed);
  return out;
}

/**
 * 伤害公式：
 *  - 物伤：攻击 − 物抗，至少为攻击力的 5%（无视法抗）
 *  - 法伤：攻击 × (1 − 法抗%)，至少为攻击力的 5%（无视物抗）
 *  - 真伤：无视物抗和法抗，不被减免
 */
export function computeDamage(atk: number, type: DamageType | SkillDamageType, def: number, res: number): number {
  if (atk <= 0) return 0;
  if (type === 'true') return atk;
  if (type === 'magic') return Math.max(atk * (1 - Math.min(100, Math.max(0, res)) / 100), atk * 0.05);
  return Math.max(atk - def, atk * 0.05);
}

export const DAMAGE_TYPE_LABEL: Record<SkillDamageType, string> = { physical: '物伤', magic: '法伤', true: '真伤' };

/** 格式化一条修改，例如「攻击力 +30%」「物抗 −50」 */
export function formatModifier(m: StatModifier): string {
  const info = statInfo(m.stat);
  const sign = m.value >= 0 ? '+' : '−';
  const abs = Math.abs(m.value);
  // 法抗本身是百分数：固定值修改显示为「点」，百分比修改显示为「%」
  const unit = m.mode === 'percent' ? '%' : info.unit === '%' ? ' 点' : info.unit ? ` ${info.unit}` : '';
  return `${info.label} ${sign}${abs}${unit}`;
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
