import type { BookDrop, CharacterDef, CharacterProgress, CurrencyConfig, DropDisplay, ExpBookDef, LevelSettings, ProgressData } from './types';

/**
 * 角色升级与通关奖励（数值都在「货币编辑」中设置）：
 *  - 升级经验：1 级升 2 级需要「基础升级经验」（全部角色通用），之后每一级 = 上一级 × (1 + 增长)，默认增长 0.75
 *  - 经验书：每本增加固定的经验值，使用时每本消耗一定的游戏外货币
 *  - 每升 1 级，角色的基础数值增加角色编辑中设置的「升级成长」
 *  - 通关奖励：固定的游戏外货币 + 按概率掉落的经验书（关卡可以单独设置，否则用默认值）
 */

const MAX_EXP = 1e15;

/** 升级经验表：table[L] = 从 L 级升到 L+1 级需要的经验（L = 1 ~ 等级上限 − 1），table[0] 不使用 */
export function expTable(cfg: CurrencyConfig): number[] {
  const table = [0];
  let prev = 0;
  for (let level = 1; level < cfg.maxLevel; level++) {
    const req = level === 1 ? cfg.baseExp : Math.round(prev * (1 + cfg.expGrowth));
    prev = Math.min(MAX_EXP, Math.max(1, req));
    table.push(prev);
  }
  return table;
}

export function clampLevel(cfg: CurrencyConfig, level: number): number {
  return Math.min(cfg.maxLevel, Math.max(1, Math.floor(level) || 1));
}

/** 当前等级升到下一级需要的经验；已满级返回 0 */
export function expToNext(cfg: CurrencyConfig, level: number, table = expTable(cfg)): number {
  const l = clampLevel(cfg, level);
  return l >= cfg.maxLevel ? 0 : table[l];
}

export interface AddExpResult {
  result: CharacterProgress;
  /** 升了几级 */
  levels: number;
  /** 因为已经满级而浪费的经验 */
  wasted: number;
}

/** 增加经验并自动升级（经验够了就连续升级，满级后多出来的经验作废） */
export function addExp(cfg: CurrencyConfig, p: CharacterProgress, exp: number, table = expTable(cfg)): AddExpResult {
  let level = clampLevel(cfg, p.level);
  const start = level;
  let cur = Math.max(0, p.exp) + Math.max(0, exp);
  while (level < cfg.maxLevel && cur >= table[level]) {
    cur -= table[level];
    level++;
  }
  let wasted = 0;
  if (level >= cfg.maxLevel) {
    wasted = cur;
    cur = 0;
  }
  return { result: { level, exp: cur }, levels: level - start, wasted };
}

/** 整理进度：等级不超过上限；修改过升级经验后，已经够升级的经验自动升级 */
export function settle(cfg: CurrencyConfig, p: CharacterProgress | undefined, table = expTable(cfg)): CharacterProgress {
  return addExp(cfg, p ?? { level: 1, exp: 0 }, 0, table).result;
}

/** 角色的当前等级进度（没有记录 = 1 级） */
export function characterProgress(cfg: CurrencyConfig, progress: ProgressData, charId: string): CharacterProgress {
  return settle(cfg, progress.levels[charId]);
}

/** 全部角色的等级（战斗中使用） */
export function levelMap(cfg: CurrencyConfig, progress: ProgressData): Record<string, number> {
  const table = expTable(cfg);
  const out: Record<string, number> = {};
  for (const [id, p] of Object.entries(progress.levels)) out[id] = settle(cfg, p, table).level;
  return out;
}

/** 从当前进度升到满级还需要的经验 */
export function expToMax(cfg: CurrencyConfig, p: CharacterProgress, table = expTable(cfg)): number {
  const s = settle(cfg, p, table);
  if (s.level >= cfg.maxLevel) return 0;
  let need = table[s.level] - s.exp;
  for (let l = s.level + 1; l < cfg.maxLevel; l++) need += table[l];
  return Math.max(0, need);
}

/** 从 1 级升到某一级需要的累计经验 */
export function totalExpTo(cfg: CurrencyConfig, level: number, table = expTable(cfg)): number {
  let sum = 0;
  for (let l = 1; l < clampLevel(cfg, level); l++) sum += table[l];
  return sum;
}

/** 升到满级最多还用得上几本这种经验书（再多就会浪费） */
export function usefulBooks(cfg: CurrencyConfig, p: CharacterProgress, book: ExpBookDef): number {
  return Math.ceil(expToMax(cfg, p) / Math.max(1, book.exp));
}

/** 角色在某个等级时的数值：基础数值 + 升级成长 × (等级 − 1)；治疗角色的攻击力成长 = 治疗量增加 */
export function leveledCharacter(def: CharacterDef, level: number): CharacterDef {
  const n = Math.max(0, Math.floor(level) - 1);
  if (n === 0) return def;
  const g = def.growth;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    ...def,
    maxHp: r(Math.max(1, def.maxHp + g.maxHp * n)),
    atk: r(def.atk < 0 ? def.atk - g.atk * n : def.atk + g.atk * n),
    def: r(Math.max(0, def.def + g.def * n)),
    res: r(Math.min(100, Math.max(0, def.res + g.res * n))),
  };
}

export type ApplyBooksResult =
  | { ok: true; progress: ProgressData; levels: number; exp: number; cost: number; wasted: number; result: CharacterProgress }
  | { ok: false; error: string };

/** 给角色使用经验书：检查库存、货币和等级上限，扣除经验书和货币后增加经验 */
export function applyBooks(cfg: CurrencyConfig, progress: ProgressData, charId: string, bookId: string, count: number): ApplyBooksResult {
  const book = cfg.books.find((b) => b.id === bookId);
  if (!book) return { ok: false, error: '经验书不存在' };
  const n = Math.floor(count);
  if (!(n >= 1)) return { ok: false, error: '至少使用 1 本' };
  const have = progress.books[bookId] ?? 0;
  if (have < n) return { ok: false, error: `${book.name}不足（拥有 ${have} 本）` };
  const cost = book.cost * n;
  if (progress.currency < cost) return { ok: false, error: `${cfg.name}不足（需要 ${formatCount(cost)}，拥有 ${formatCount(progress.currency)}）` };
  const table = expTable(cfg);
  const cur = settle(cfg, progress.levels[charId], table);
  if (cur.level >= cfg.maxLevel) return { ok: false, error: `已经满级（Lv.${cfg.maxLevel}）` };
  const r = addExp(cfg, cur, book.exp * n, table);
  const books = { ...progress.books, [bookId]: have - n };
  if (books[bookId] <= 0) delete books[bookId];
  return {
    ok: true,
    progress: { ...progress, currency: progress.currency - cost, books, levels: { ...progress.levels, [charId]: r.result } },
    levels: r.levels,
    exp: book.exp * n,
    cost,
    wasted: r.wasted,
    result: r.result,
  };
}

/* ---------- 通关奖励 ---------- */

export interface LevelRewardInfo {
  currency: number;
  /** 有效的掉落（经验书存在、概率和数量大于 0） */
  books: BookDrop[];
  /** 是否使用默认奖励 */
  defaultCurrency: boolean;
  defaultBooks: boolean;
}

export function levelRewardInfo(cfg: CurrencyConfig, settings: Pick<LevelSettings, 'rewardCurrency' | 'rewardBooks'>): LevelRewardInfo {
  const drops = settings.rewardBooks ?? cfg.defaultBooks;
  return {
    currency: settings.rewardCurrency ?? cfg.defaultCurrency,
    books: drops.filter((d) => d.chance > 0 && d.max > 0 && cfg.books.some((b) => b.id === d.bookId)),
    defaultCurrency: settings.rewardCurrency == null,
    defaultBooks: settings.rewardBooks == null,
  };
}

export interface RolledRewards {
  currency: number;
  /** 经验书 ID → 数量 */
  books: Record<string, number>;
}

/** 通关时抽取奖励：货币固定获得；每项经验书按概率掉落，数量在 min ~ max 之间随机 */
export function rollRewards(cfg: CurrencyConfig, settings: Pick<LevelSettings, 'rewardCurrency' | 'rewardBooks'>, rng: () => number = Math.random): RolledRewards {
  const info = levelRewardInfo(cfg, settings);
  const books: Record<string, number> = {};
  for (const d of info.books) {
    if (rng() * 100 >= d.chance) continue;
    const n = d.min + Math.floor(rng() * (d.max - d.min + 1));
    if (n > 0) books[d.bookId] = (books[d.bookId] ?? 0) + n;
  }
  return { currency: info.currency, books };
}

/** 把奖励加进玩家进度 */
export function grantRewards(progress: ProgressData, r: RolledRewards): ProgressData {
  const books = { ...progress.books };
  for (const [id, n] of Object.entries(r.books)) books[id] = (books[id] ?? 0) + n;
  return { ...progress, currency: progress.currency + r.currency, books };
}

/** 概率等级（「概率等级」显示方式用） */
export function dropTier(chance: number): string {
  if (chance >= 100) return '固定';
  if (chance >= 50) return '大概率';
  if (chance >= 20) return '小概率';
  return '罕见';
}

export function dropCountText(d: Pick<BookDrop, 'min' | 'max'>): string {
  return d.min === d.max ? `×${d.min}` : `×${d.min}~${d.max}`;
}

/** 掉落的说明文字，例如「初级经验书 ×2~3（60%）」或「初级经验书 ×2~3 · 大概率」 */
export function formatDrop(d: BookDrop, book: ExpBookDef, display: DropDisplay = 'exact'): string {
  const chance = display === 'tier' ? ` · ${dropTier(d.chance)}` : d.chance >= 100 ? '' : `（${formatPercent(d.chance)}）`;
  return `${book.name} ${dropCountText(d)}${chance}`;
}

export function formatPercent(v: number): string {
  return `${Math.round(v * 100) / 100}%`;
}

/** 1234567 → "1,234,567" */
export function formatCount(n: number): string {
  const v = Math.floor(n);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
