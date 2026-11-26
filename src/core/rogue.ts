/**
 * 无尽模式的肉鸽玩法（纯逻辑，战斗引擎、游戏界面、编辑器和测试共用）：
 *  - 开局和每隔几波，从牌组里按权重随机抽出几张不同的牌，玩家选择 1 张
 *  - 再次选择持有的牌 = 升级进度 +1，凑够这一级需要的数量就升级（数值按每一级的设置）
 *  - 持有的种类达到上限后，只会抽到已经持有、还能升级的牌；满级的牌不会再被抽到
 */
import { formatModifier, formatNumber, statInfo } from './stats';
import type { RogueCard, RogueConfig, RogueEffect, RogueEffectKind, StatModifier } from './types';

/** 持有的一张牌：等级和当前等级积累的升级进度（再抽到几张） */
export interface HeldCard {
  id: string;
  level: number;
  copies: number;
}

/** 持有的牌带来的加成（ally / enemy 是全体角色 / 敌人的属性修改） */
export interface RogueBonus {
  ally: StatModifier[];
  enemy: StatModifier[];
  /** 每分钟金钱 */
  moneyRate: number;
  /** 每击败 1 个敌人额外的金钱 */
  killMoney: number;
  /** 部署费用 */
  cost: number;
  /** 基地血量 */
  baseHp: number;
  /** 分数加成（%） */
  score: number;
}

export function emptyBonus(): RogueBonus {
  return { ally: [], enemy: [], moneyRate: 0, killMoney: 0, cost: 0, baseHp: 0, score: 0 };
}

/** 效果种类的说明（编辑器下拉框） */
export const ROGUE_EFFECT_KINDS: { kind: RogueEffectKind; label: string; hint: string }[] = [
  { kind: 'ally', label: '角色属性', hint: '全体角色（包括召唤物）的属性，持有期间一直有效' },
  { kind: 'enemy', label: '敌人属性', hint: '全体敌人（包括敌人的召唤物）的属性，持有期间一直有效' },
  { kind: 'money', label: '立即获得金钱', hint: '每次选择这张牌时立即获得（负数 = 失去）' },
  { kind: 'moneyRate', label: '每分钟金钱', hint: '持有期间每分钟额外获得的金钱' },
  { kind: 'killMoney', label: '击败奖励', hint: '每击败 1 个敌人额外获得的金钱' },
  { kind: 'cost', label: '部署费用', hint: '全体角色和召唤物的部署费用（负数 = 更便宜）' },
  { kind: 'baseHp', label: '基地血量', hint: '基地的血量上限和当前血量一起增加' },
  { kind: 'score', label: '分数加成', hint: '击败敌人获得的分数增加（%）' },
];

/** 牌的最高等级 */
export function maxLevelOf(card: Pick<RogueCard, 'copies'>): number {
  return card.copies.length + 1;
}

/** 效果在某一级的数值（超过设置的等级时用最后一级） */
export function valueAt(e: Pick<RogueEffect, 'values'>, level: number): number {
  if (!e.values.length) return 0;
  return e.values[Math.max(0, Math.min(level, e.values.length) - 1)];
}

const signed = (v: number) => (v >= 0 ? `+${formatNumber(v)}` : `−${formatNumber(Math.abs(v))}`);

/** 效果说明（某一级），例如「全体角色 攻击力 +10%」「每分钟金钱 +20」 */
export function describeRogueEffect(e: RogueEffect, level: number): string {
  const v = valueAt(e, level);
  switch (e.kind) {
    case 'ally':
      return `全体角色 ${formatModifier({ stat: e.stat, mode: e.mode, value: v })}`;
    case 'enemy':
      return `全体敌人 ${formatModifier({ stat: e.stat, mode: e.mode, value: v })}`;
    case 'money':
      return v >= 0 ? `立即获得 ${formatNumber(v)} 金钱` : `立即失去 ${formatNumber(-v)} 金钱`;
    case 'moneyRate':
      return `每分钟金钱 ${signed(v)}`;
    case 'killMoney':
      return `每击败 1 个敌人 ${signed(v)} 金钱`;
    case 'cost':
      return `部署费用 ${signed(v)}`;
    case 'baseHp':
      return `基地血量 ${signed(v)}`;
    case 'score':
      return `分数 ${signed(v)}%`;
  }
}

/** 只有数值的部分（升级预览用），例如「+10%」「+20」「−5 点」 */
export function rogueValueText(e: RogueEffect, level: number): string {
  const v = valueAt(e, level);
  if (e.kind === 'ally' || e.kind === 'enemy') {
    const info = statInfo(e.stat);
    // 和 formatModifier 一样：法抗本身是百分数，固定值修改显示为「点」
    const unit = e.mode === 'percent' ? '%' : info.unit === '%' ? ' 点' : info.unit ? ` ${info.unit}` : '';
    return `${signed(v)}${unit}`;
  }
  return e.kind === 'score' ? `${signed(v)}%` : signed(v);
}

/** 效果的名称部分（升级预览用），例如「全体角色 攻击力」「每分钟金钱」 */
export function rogueEffectLabel(e: RogueEffect): string {
  switch (e.kind) {
    case 'ally':
      return `全体角色 ${statInfo(e.stat).label}`;
    case 'enemy':
      return `全体敌人 ${statInfo(e.stat).label}`;
    case 'money':
      return '立即获得金钱';
    case 'moneyRate':
      return '每分钟金钱';
    case 'killMoney':
      return '每击败 1 个敌人的金钱';
    case 'cost':
      return '部署费用';
    case 'baseHp':
      return '基地血量';
    case 'score':
      return '分数';
  }
}

/** 持有的牌带来的全部加成 */
export function rogueBonus(cards: Map<string, RogueCard>, held: HeldCard[]): RogueBonus {
  const b = emptyBonus();
  for (const h of held) {
    const c = cards.get(h.id);
    if (!c) continue;
    for (const e of c.effects) {
      const v = valueAt(e, h.level);
      if (e.kind === 'ally') b.ally.push({ stat: e.stat, mode: e.mode, value: v });
      else if (e.kind === 'enemy') b.enemy.push({ stat: e.stat, mode: e.mode, value: v });
      else if (e.kind === 'moneyRate') b.moneyRate += v;
      else if (e.kind === 'killMoney') b.killMoney += v;
      else if (e.kind === 'cost') b.cost += v;
      else if (e.kind === 'baseHp') b.baseHp += v;
      else if (e.kind === 'score') b.score += v;
    }
  }
  return b;
}

/** 现在可以抽到的牌：权重大于 0、没有满级；持有的种类达到上限时只有已经持有的牌 */
export function drawPool(cfg: RogueConfig, held: HeldCard[]): RogueCard[] {
  const full = cfg.maxHeld > 0 && held.length >= cfg.maxHeld;
  return cfg.cards.filter((c) => {
    if (c.weight <= 0) return false;
    const h = held.find((x) => x.id === c.id);
    return h ? h.level < maxLevelOf(c) : !full;
  });
}

/** 按权重抽出几张不同的牌（可以抽的牌不够时少于设置的数量，没有可以抽的牌时为空） */
export function drawOffer(cfg: RogueConfig, held: HeldCard[], rng: () => number): string[] {
  const pool = drawPool(cfg, held);
  const out: string[] = [];
  while (out.length < Math.max(1, cfg.choices) && pool.length) {
    const total = pool.reduce((s, c) => s + c.weight, 0);
    let r = rng() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= pool[i].weight;
      if (r < 0) break;
    }
    out.push(pool[i].id);
    pool.splice(i, 1);
  }
  return out;
}

/** 选择一张牌的结果：新获得 / 升级进度 +1 / 升级 */
export interface GainResult {
  held: HeldCard[];
  /** 选择后的等级和升级进度 */
  level: number;
  copies: number;
  isNew: boolean;
  leveled: boolean;
}

/** 选择一张牌（不修改传入的数组） */
export function gainCard(held: HeldCard[], card: RogueCard): GainResult {
  const i = held.findIndex((h) => h.id === card.id);
  if (i < 0) return { held: [...held, { id: card.id, level: 1, copies: 0 }], level: 1, copies: 0, isNew: true, leveled: false };
  const h = { ...held[i] };
  let leveled = false;
  if (h.level < maxLevelOf(card)) {
    h.copies++;
    if (h.copies >= (card.copies[h.level - 1] ?? 1)) {
      h.level++;
      h.copies = 0;
      leveled = true;
    }
  }
  const next = held.slice();
  next[i] = h;
  return { held: next, level: h.level, copies: h.copies, isNew: false, leveled };
}

/** 抽牌概率：这张牌在一次抽牌中被抽到的大约概率（按权重，牌组里全部可以抽的牌都计算） */
export function drawChance(cfg: RogueConfig, card: RogueCard): number {
  const pool = cfg.cards.filter((c) => c.weight > 0);
  if (card.weight <= 0 || !pool.length) return 0;
  const n = Math.min(Math.max(1, cfg.choices), pool.length);
  if (n >= pool.length) return 1;
  // 近似：不放回抽 n 张，按权重比例估计（模拟太慢，编辑器里只做参考）
  const total = pool.reduce((s, c) => s + c.weight, 0);
  return Math.min(1, 1 - Math.pow(1 - card.weight / total, n));
}

/** 下一次抽牌的波次（没有开启 / 不按波次抽 = null） */
export function nextDrawWave(cfg: RogueConfig, wave: number): number | null {
  if (!cfg.enabled || cfg.everyWaves <= 0) return null;
  return (Math.floor(wave / cfg.everyWaves) + 1) * cfg.everyWaves;
}

/** 样本牌组：角色强化、敌人削弱、金钱、费用、基地血量、分数（带代价）各几张 */
export function sampleRogueCards(): RogueCard[] {
  const ally = (stat: RogueEffect['stat'], mode: RogueEffect['mode'], values: number[]): RogueEffect => ({ kind: 'ally', stat, mode, values });
  const enemy = (stat: RogueEffect['stat'], mode: RogueEffect['mode'], values: number[]): RogueEffect => ({ kind: 'enemy', stat, mode, values });
  const plain = (kind: RogueEffectKind, values: number[]): RogueEffect => ({ kind, stat: 'atk', mode: 'add', values });
  return [
    { id: 'K001', name: '锋刃', color: '#e8590c', weight: 10, copies: [1, 2], effects: [ally('atk', 'percent', [10, 18, 28])], description: '全体角色的攻击力提升' },
    {
      id: 'K002',
      name: '坚壁',
      color: '#4c6ef5',
      weight: 10,
      copies: [1, 2],
      effects: [ally('maxHp', 'percent', [15, 25, 40]), ally('def', 'add', [10, 20, 35])],
      description: '全体角色更耐打',
    },
    { id: 'K003', name: '疾风', color: '#20c997', weight: 8, copies: [1, 2], effects: [ally('attackInterval', 'percent', [-8, -14, -20])], description: '全体角色攻击更快' },
    { id: 'K004', name: '鹰眼', color: '#fab005', weight: 4, copies: [2], effects: [ally('range', 'add', [0.5, 1])], description: '稀有：全体角色的攻击范围变大' },
    { id: 'K005', name: '泥沼', color: '#8d6e63', weight: 8, copies: [1, 2], effects: [enemy('speed', 'percent', [-10, -18, -25])], description: '全体敌人走得更慢' },
    {
      id: 'K006',
      name: '破甲',
      color: '#ae3ec9',
      weight: 8,
      copies: [1, 2],
      effects: [enemy('def', 'percent', [-15, -25, -40]), enemy('res', 'add', [-5, -10, -15])],
      description: '全体敌人的物抗和法抗降低',
    },
    {
      id: 'K007',
      name: '军饷',
      color: '#f59f00',
      weight: 10,
      copies: [1, 1, 2],
      effects: [plain('moneyRate', [20, 35, 50, 70]), plain('money', [10, 15, 20, 30])],
      description: '每分钟多一些金钱，选择时立即获得一笔',
    },
    { id: 'K008', name: '赏金', color: '#d9480f', weight: 6, copies: [1, 2], effects: [plain('killMoney', [1, 2, 3])], description: '击败敌人额外获得金钱' },
    { id: 'K009', name: '精简', color: '#15aabf', weight: 3, copies: [2, 3], effects: [plain('cost', [-1, -2, -3])], description: '稀有：全体部署费用降低' },
    { id: 'K010', name: '城防', color: '#82c91e', weight: 6, copies: [1, 1], effects: [plain('baseHp', [2, 4, 6])], description: '基地血量增加' },
    {
      id: 'K011',
      name: '野心',
      color: '#e64980',
      weight: 5,
      copies: [1, 2],
      effects: [plain('score', [30, 50, 80]), enemy('atk', 'percent', [10, 15, 20])],
      description: '有代价：分数大幅增加，但敌人的攻击力也提高',
    },
  ];
}
