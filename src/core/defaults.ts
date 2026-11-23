import { levelCode, shortUid } from './ids';
import { STATS } from './stats';
import { makeEmptyGrid, resizeGrid } from './tiles';
import type {
  BookDrop,
  ChapterDef,
  CharacterDef,
  CharacterGrowth,
  CharacterProgress,
  CurrencyConfig,
  EnemyDef,
  EnemyLine,
  EnemySides,
  ExpBookDef,
  GameSettings,
  GridPos,
  IconPoint,
  LevelDef,
  LevelSettings,
  OnHitEffect,
  ProgressData,
  RouteDef,
  RouteWait,
  SkillDef,
  SkillEffect,
  SpawnBlock,
  StatKey,
  StatModifier,
} from './types';

export const LEVEL_FORMAT_VERSION = 2;
/** 撤退角色时返还的费用比例 */
export const RETREAT_REFUND_RATIO = 0.5;
/** 敌人到达基地时扣除的血量 */
export const LEAK_DAMAGE = 1;
/** 选中角色（部署卡片或场上角色）时的时间流速倍率 */
export const SELECT_SLOW_FACTOR = 0.2;
/** 新建停留点的默认停留时间（秒） */
export const DEFAULT_WAIT = 2;
/** 没有设置升级成长的角色：每级增加基础数值的 5% */
export const DEFAULT_GROWTH_RATIO = 0.05;

export const LINE_COLORS = ['#e8a33d', '#4fb3a9', '#d1605e', '#8f7ad6', '#6aa84f', '#d98cc0', '#5b9bd5', '#c9b458'];

/* ---------- 新建对象 ---------- */

export function newCharacter(id: string): CharacterDef {
  const base = { maxHp: 1000, atk: 50, def: 50, res: 0 };
  return {
    id,
    name: '新角色',
    color: '#4a90d9',
    placement: 'ground',
    cost: 10,
    ...base,
    damageType: 'physical',
    attackTarget: 'enemy',
    targetCount: 1,
    attackInterval: 1,
    range: 1,
    blockCount: 1,
    maxDeploy: 0,
    deployCooldown: 0,
    attackType: 'basic',
    skills: [],
    skillSlots: 1,
    onHit: null,
    growth: defaultGrowth(base),
  };
}

/** 默认的升级成长：每级增加基础生命 / 攻击（治疗量）/ 物抗的 5%（取整），法抗不增加 */
export function defaultGrowth(base: { maxHp: number; atk: number; def: number }): CharacterGrowth {
  const r = (v: number) => Math.round(Math.abs(v) * DEFAULT_GROWTH_RATIO);
  return { maxHp: r(base.maxHp), atk: r(base.atk), def: r(base.def), res: 0 };
}

export function newEnemy(id: string): EnemyDef {
  return {
    id,
    name: '新敌人',
    color: '#d9534f',
    sides: 3,
    size: 1,
    maxHp: 500,
    atk: 50,
    def: 0,
    res: 0,
    speed: 1,
    canAttack: true,
    damageType: 'physical',
    attackTarget: 'enemy',
    targetCount: 1,
    attackInterval: 1.5,
    attackRange: 0,
    reward: 0,
    attackType: 'basic',
    skills: [],
    skillSlots: 1,
    onHit: null,
  };
}

export function newEffect(kind: SkillEffect['kind'] = 'modify'): SkillEffect {
  return {
    kind,
    target: kind === 'damage' ? 'enemies' : 'self',
    scope: 'range',
    radius: 0,
    maxTargets: -1,
    modifiers: kind === 'modify' ? [{ stat: 'atk', mode: 'percent', value: 30 }] : [],
    duration: 0,
    amount: kind === 'damage' ? 150 : 0,
    damageType: 'physical',
    money: kind === 'money' ? 10 : 0,
    moneyRate: 0,
  };
}

export function newSkill(id: string): SkillDef {
  return {
    id,
    name: '新技能',
    color: '#f2b544',
    spMax: 20,
    spInitial: 0,
    spGain: 'auto',
    spRate: 1,
    trigger: 'manual',
    duration: 10,
    effects: [newEffect('modify')],
  };
}

export function newChapter(id: string): ChapterDef {
  return { id, name: '新章节', levelCount: 3, battleMusic: '' };
}

export function defaultLevelSettings(code: string): LevelSettings {
  return {
    name: code,
    initialHp: 10,
    initialMoney: 20,
    autoMoney: true,
    moneyPerMinute: 30,
    availableCharacters: [],
    battleMusic: '',
    rewardCurrency: null,
    rewardBooks: null,
  };
}

export function newLevel(chapterId: string, index: number): LevelDef {
  const id = levelCode(chapterId, index);
  return {
    id,
    chapterId,
    index,
    version: LEVEL_FORMAT_VERSION,
    width: 16,
    height: 9,
    grid: makeEmptyGrid(16, 9),
    settings: defaultLevelSettings(id),
    lines: [],
  };
}

export function newRoute(spawn: GridPos | null): RouteDef {
  return { mode: 'auto', spawn, target: null, path: [], waits: [] };
}

export function newLine(index: number, spawn: GridPos | null): EnemyLine {
  return {
    id: shortUid('L'),
    name: `敌人线 ${index + 1}`,
    color: LINE_COLORS[index % LINE_COLORS.length],
    route: newRoute(spawn),
    blocks: [],
  };
}

export function newBlock(enemyId: string, startTime: number): SpawnBlock {
  return { id: shortUid('B'), enemyId, count: 3, interval: 2, startTime };
}

/* ---------- 货币编辑 ---------- */

export function newBook(id: string, name = '经验书', exp = 100, cost = 10, color = '#5b9bd5'): ExpBookDef {
  return { id, name, color, exp, cost };
}

export function newDrop(bookId: string): BookDrop {
  return { bookId, chance: 100, min: 1, max: 1 };
}

/** 默认的货币设置（还没有 data/currency.json 时使用） */
export function newCurrencyConfig(): CurrencyConfig {
  return {
    name: '金币',
    color: '#f2c94c',
    baseExp: 100,
    expGrowth: 0.75,
    maxLevel: 20,
    books: [
      newBook('B001', '初级经验书', 100, 10, '#6aa84f'),
      newBook('B002', '中级经验书', 300, 30, '#5b9bd5'),
      newBook('B003', '高级经验书', 1000, 100, '#b07ad9'),
    ],
    defaultCurrency: 100,
    defaultBooks: [
      { bookId: 'B001', chance: 100, min: 2, max: 3 },
      { bookId: 'B002', chance: 50, min: 1, max: 1 },
      { bookId: 'B003', chance: 10, min: 1, max: 1 },
    ],
    dropDisplay: 'exact',
  };
}

/** 一块积木持续的时间（第一个到最后一个敌人生成的时间差） */
export function blockDuration(b: SpawnBlock): number {
  return Math.max(0, b.count - 1) * b.interval;
}

/** 角色在战斗中携带的技能：玩家的角色设定（过滤掉无效的）或默认的前 N 个 */
export function resolveLoadout(def: { skills: string[]; skillSlots: number }, chosen: string[] | undefined): string[] {
  const slots = Math.max(0, def.skillSlots);
  if (chosen) {
    const valid = chosen.filter((id, i) => def.skills.includes(id) && chosen.indexOf(id) === i);
    if (valid.length) return valid.slice(0, slots);
  }
  return def.skills.slice(0, slots);
}

/* ---------- 读取旧数据时补全字段（以后加字段不会让旧存档失效） ---------- */

const num = (v: unknown, d: number, min = -Infinity, max = Infinity) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.min(max, Math.max(min, n));
};
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
/** 图标中心点：0~1；默认值（正中）不保存，保持 JSON 简洁 */
export function iconPoint(v: any): IconPoint | undefined {
  if (!v || typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return undefined;
  const p = { x: Math.round(Math.min(1, Math.max(0, v.x)) * 1000) / 1000, y: Math.round(Math.min(1, Math.max(0, v.y)) * 1000) / 1000 };
  return p.x === 0.5 && p.y === 0.5 ? undefined : p;
}
/** 图标缩放：0.5~4；默认值 1 不保存 */
export function iconZoom(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const z = Math.round(Math.min(ICON_ZOOM_MAX, Math.max(ICON_ZOOM_MIN, v)) * 100) / 100;
  return z === 1 ? undefined : z;
}
export const ICON_ZOOM_MIN = 0.5;
export const ICON_ZOOM_MAX = 4;
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
const pos = (v: any): GridPos | null =>
  v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: Math.round(v.x), y: Math.round(v.y) } : null;
const STAT_KEYS = new Set<string>(STATS.map((s) => s.key));

export function normalizeModifier(raw: any): StatModifier | null {
  if (!raw || !STAT_KEYS.has(raw.stat)) return null;
  return { stat: raw.stat as StatKey, mode: raw.mode === 'add' ? 'add' : 'percent', value: num(raw.value, 0, -100000, 100000) };
}

const modList = (v: unknown): StatModifier[] =>
  Array.isArray(v) ? v.map(normalizeModifier).filter((m): m is StatModifier => !!m) : [];

function normalizeOnHit(raw: any): OnHitEffect | null {
  if (!raw || !Array.isArray(raw.modifiers)) return null;
  const modifiers = modList(raw.modifiers);
  return modifiers.length ? { modifiers, duration: num(raw.duration, 3, 0.1, 3600) } : null;
}

export function normalizeCharacter(raw: any): CharacterDef {
  const d = newCharacter(str(raw?.id, 'C000'));
  const placement = raw?.placement === 'high' || raw?.placement === 'any' ? raw.placement : 'ground';
  return {
    ...d,
    id: str(raw?.id, d.id),
    name: str(raw?.name, d.name),
    color: str(raw?.color, d.color),
    icon: typeof raw?.icon === 'string' && raw.icon ? raw.icon : undefined,
    iconCenter: iconPoint(raw?.iconCenter),
    iconZoom: iconZoom(raw?.iconZoom),
    placement,
    cost: num(raw?.cost, d.cost, 0),
    maxHp: num(raw?.maxHp, d.maxHp, 1),
    atk: num(raw?.atk, d.atk, -99999, 99999),
    def: num(raw?.def, d.def, 0),
    res: num(raw?.res, 0, 0, 100),
    damageType: raw?.damageType === 'magic' || raw?.damageType === 'true' ? raw.damageType : 'physical',
    attackTarget: raw?.attackTarget === 'ally' ? 'ally' : 'enemy',
    targetCount: Math.round(num(raw?.targetCount, 1, -1, 99)) || 1,
    attackInterval: num(raw?.attackInterval, d.attackInterval, 0.05),
    range: num(raw?.range, d.range, 0),
    blockCount: Math.round(num(raw?.blockCount, d.blockCount, 0, 10)),
    maxDeploy: Math.round(num(raw?.maxDeploy, d.maxDeploy, 0, 99)),
    deployCooldown: num(raw?.deployCooldown, 0, 0, 3600),
    attackType: str(raw?.attackType, 'basic'),
    skills: strList(raw?.skills),
    skillSlots: Math.round(num(raw?.skillSlots, 1, 0, 9)),
    onHit: normalizeOnHit(raw?.onHit),
    growth: normalizeGrowth(raw?.growth, {
      maxHp: num(raw?.maxHp, d.maxHp, 1),
      atk: num(raw?.atk, d.atk, -99999, 99999),
      def: num(raw?.def, d.def, 0),
    }),
    description: typeof raw?.description === 'string' ? raw.description : undefined,
  };
}

/** 升级成长：没有设置时按基础数值的 5% 生成；不允许负数 */
function normalizeGrowth(raw: any, base: { maxHp: number; atk: number; def: number }): CharacterGrowth {
  if (!raw || typeof raw !== 'object') return defaultGrowth(base);
  return {
    maxHp: num(raw.maxHp, 0, 0, 99999),
    atk: num(raw.atk, 0, 0, 99999),
    def: num(raw.def, 0, 0, 99999),
    res: num(raw.res, 0, 0, 100),
  };
}

export function normalizeEnemy(raw: any): EnemyDef {
  const d = newEnemy(str(raw?.id, 'E000'));
  const sides = Math.round(num(raw?.sides, 3, 3, 6)) as EnemySides;
  return {
    ...d,
    id: str(raw?.id, d.id),
    name: str(raw?.name, d.name),
    color: str(raw?.color, d.color),
    icon: typeof raw?.icon === 'string' && raw.icon ? raw.icon : undefined,
    iconCenter: iconPoint(raw?.iconCenter),
    iconZoom: iconZoom(raw?.iconZoom),
    sides,
    size: num(raw?.size, 1, 0.5, 2),
    maxHp: num(raw?.maxHp, d.maxHp, 1),
    atk: num(raw?.atk, d.atk, -99999, 99999),
    def: num(raw?.def, d.def, 0),
    res: num(raw?.res, 0, 0, 100),
    speed: num(raw?.speed, d.speed, 0.05, 20),
    canAttack: typeof raw?.canAttack === 'boolean' ? raw.canAttack : d.canAttack,
    damageType: raw?.damageType === 'magic' || raw?.damageType === 'true' ? raw.damageType : 'physical',
    attackTarget: raw?.attackTarget === 'ally' ? 'ally' : 'enemy',
    targetCount: Math.round(num(raw?.targetCount, 1, -1, 99)) || 1,
    attackInterval: num(raw?.attackInterval, d.attackInterval, 0.05),
    attackRange: num(raw?.attackRange, d.attackRange, 0),
    reward: num(raw?.reward, d.reward, 0),
    attackType: str(raw?.attackType, 'basic'),
    skills: strList(raw?.skills),
    skillSlots: Math.round(num(raw?.skillSlots, 1, 0, 9)),
    onHit: normalizeOnHit(raw?.onHit),
    description: typeof raw?.description === 'string' ? raw.description : undefined,
  };
}

export function normalizeEffect(raw: any): SkillEffect {
  const kind: SkillEffect['kind'] = raw?.kind === 'damage' || raw?.kind === 'money' ? raw.kind : 'modify';
  const d = newEffect(kind);
  return {
    kind,
    target: raw?.target === 'allies' || raw?.target === 'enemies' ? raw.target : raw?.target === 'self' ? 'self' : d.target,
    scope: raw?.scope === 'all' ? 'all' : 'range',
    radius: num(raw?.radius, 0, 0, 50),
    maxTargets: Math.round(num(raw?.maxTargets, -1, -1, 99)) || -1,
    modifiers: modList(raw?.modifiers),
    duration: num(raw?.duration, 0, 0, 3600),
    amount: num(raw?.amount, d.amount, -100000, 100000),
    damageType: raw?.damageType === 'magic' || raw?.damageType === 'true' ? raw.damageType : 'physical',
    money: num(raw?.money, d.money, -100000, 100000),
    moneyRate: num(raw?.moneyRate, 0, -100000, 100000),
  };
}

export function normalizeSkill(raw: any): SkillDef {
  const d = newSkill(str(raw?.id, 'S000'));
  return {
    id: str(raw?.id, d.id),
    name: str(raw?.name, d.name),
    color: str(raw?.color, d.color),
    icon: typeof raw?.icon === 'string' && raw.icon ? raw.icon : undefined,
    description: typeof raw?.description === 'string' ? raw.description : undefined,
    spMax: num(raw?.spMax, d.spMax, 0, 9999),
    spInitial: num(raw?.spInitial, 0, 0, 9999),
    spGain: raw?.spGain === 'attack' ? 'attack' : 'auto',
    spRate: num(raw?.spRate, d.spRate, 0, 9999),
    trigger: raw?.trigger === 'auto' ? 'auto' : 'manual',
    duration: num(raw?.duration, d.duration, 0, 3600),
    effects: Array.isArray(raw?.effects) ? raw.effects.map(normalizeEffect) : [],
  };
}

export function normalizeChapter(raw: any): ChapterDef {
  return {
    id: str(raw?.id, 'CH'),
    name: str(raw?.name, '未命名章节'),
    levelCount: Math.round(num(raw?.levelCount, 1, 1, 99)),
    description: typeof raw?.description === 'string' ? raw.description : undefined,
    battleMusic: str(raw?.battleMusic, ''),
  };
}

function normalizeBlock(raw: any): SpawnBlock {
  return {
    id: str(raw?.id, shortUid('B')),
    enemyId: str(raw?.enemyId, ''),
    count: Math.round(num(raw?.count, 1, 1, 999)),
    interval: num(raw?.interval, 1, 0, 600),
    startTime: num(raw?.startTime, 0, 0, 36000),
  };
}

/** 停留点：同一方块的同一次经过只保留一个，按方块和次数排序 */
export function normalizeWaits(v: unknown): RouteWait[] {
  if (!Array.isArray(v)) return [];
  const seen = new Map<string, RouteWait>();
  for (const raw of v as any[]) {
    const p = pos(raw);
    if (!p) continue;
    const visit = Math.round(num(raw?.visit, 1, 1, 999));
    const duration = Math.round(num(raw?.duration, DEFAULT_WAIT, 0.1, 3600) * 100) / 100;
    seen.set(`${p.x},${p.y},${visit}`, { x: p.x, y: p.y, visit, duration });
  }
  return [...seen.values()];
}

function normalizeLine(raw: any, i: number): EnemyLine {
  const r = raw?.route ?? {};
  return {
    id: str(raw?.id, shortUid('L')),
    name: str(raw?.name, `敌人线 ${i + 1}`),
    color: str(raw?.color, LINE_COLORS[i % LINE_COLORS.length]),
    route: {
      mode: r.mode === 'manual' ? 'manual' : 'auto',
      spawn: pos(r.spawn),
      target: pos(r.target),
      path: Array.isArray(r.path) ? r.path.map(pos).filter((p: GridPos | null): p is GridPos => !!p) : [],
      waits: normalizeWaits(r.waits),
    },
    blocks: Array.isArray(raw?.blocks) ? raw.blocks.map(normalizeBlock) : [],
  };
}

export function normalizeLevel(raw: any, fallbackCode?: string): LevelDef {
  const code = str(raw?.id, fallbackCode ?? 'CH_1');
  const i = code.lastIndexOf('_');
  const chapterId = str(raw?.chapterId, i > 0 ? code.slice(0, i) : 'CH');
  const index = Math.round(num(raw?.index, i > 0 ? Number(code.slice(i + 1)) || 1 : 1, 1));
  const width = Math.round(num(raw?.width, 16, 1, 64));
  const height = Math.round(num(raw?.height, 9, 1, 64));
  const grid = Array.isArray(raw?.grid) ? raw.grid.map((r: unknown) => (typeof r === 'string' ? r : '')) : [];
  const s = raw?.settings ?? {};
  const ds = defaultLevelSettings(code);
  return {
    id: code,
    chapterId,
    index,
    version: LEVEL_FORMAT_VERSION,
    width,
    height,
    grid: resizeGrid(grid, width, height),
    settings: {
      name: str(s.name, ds.name),
      initialHp: Math.round(num(s.initialHp, ds.initialHp, 1, 9999)),
      initialMoney: Math.round(num(s.initialMoney, ds.initialMoney, 0, 999999)),
      autoMoney: typeof s.autoMoney === 'boolean' ? s.autoMoney : ds.autoMoney,
      moneyPerMinute: num(s.moneyPerMinute, ds.moneyPerMinute, 0, 99999),
      availableCharacters: strList(s.availableCharacters),
      battleMusic: str(s.battleMusic, ''),
      rewardCurrency: typeof s.rewardCurrency === 'number' && Number.isFinite(s.rewardCurrency) ? Math.round(num(s.rewardCurrency, 0, 0, 1e9)) : null,
      rewardBooks: Array.isArray(s.rewardBooks) ? normalizeDrops(s.rewardBooks) : null,
    },
    lines: Array.isArray(raw?.lines) ? raw.lines.map(normalizeLine) : [],
  };
}

/* ---------- 货币编辑 ---------- */

export function normalizeDrop(raw: any): BookDrop | null {
  if (!raw || typeof raw.bookId !== 'string' || !raw.bookId) return null;
  const a = Math.round(num(raw.min, 1, 0, 9999));
  const b = Math.round(num(raw.max, a, 0, 9999));
  return { bookId: raw.bookId, chance: Math.round(num(raw.chance, 100, 0, 100) * 100) / 100, min: Math.min(a, b), max: Math.max(a, b) };
}

export function normalizeDrops(v: unknown): BookDrop[] {
  return Array.isArray(v) ? v.map(normalizeDrop).filter((d): d is BookDrop => !!d) : [];
}

function normalizeBook(raw: any, i: number): ExpBookDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = newBook(`B${String(i + 1).padStart(3, '0')}`);
  return {
    id: str(raw.id, d.id) || d.id,
    name: str(raw.name, d.name),
    color: str(raw.color, d.color),
    exp: Math.round(num(raw.exp, d.exp, 1, 1e9)),
    cost: Math.round(num(raw.cost, d.cost, 0, 1e9)),
  };
}

export function normalizeCurrency(raw: any): CurrencyConfig {
  const d = newCurrencyConfig();
  if (!raw || typeof raw !== 'object') return d;
  const books: ExpBookDef[] = [];
  if (Array.isArray(raw.books)) {
    raw.books.forEach((b: any, i: number) => {
      const book = normalizeBook(b, i);
      if (book && !books.some((x) => x.id === book.id)) books.push(book);
    });
  }
  return {
    name: str(raw.name, d.name).trim() || d.name,
    color: str(raw.color, d.color),
    baseExp: Math.round(num(raw.baseExp, d.baseExp, 1, 1e9)),
    expGrowth: Math.round(num(raw.expGrowth, d.expGrowth, 0, 10) * 1000) / 1000,
    maxLevel: Math.round(num(raw.maxLevel, d.maxLevel, 1, 999)),
    books: Array.isArray(raw.books) ? books : d.books,
    defaultCurrency: Math.round(num(raw.defaultCurrency, d.defaultCurrency, 0, 1e9)),
    defaultBooks: Array.isArray(raw.defaultBooks) ? normalizeDrops(raw.defaultBooks) : d.defaultBooks,
    dropDisplay: raw.dropDisplay === 'tier' || raw.dropDisplay === 'hidden' ? raw.dropDisplay : 'exact',
  };
}

export function normalizeSettings(raw: any): GameSettings {
  return { homeMusic: str(raw?.homeMusic, '') };
}

export function normalizeProgress(raw: any): ProgressData {
  const loadouts: Record<string, string[]> = {};
  if (raw?.loadouts && typeof raw.loadouts === 'object') {
    for (const [k, v] of Object.entries(raw.loadouts)) loadouts[k] = strList(v);
  }
  const books: Record<string, number> = {};
  if (raw?.books && typeof raw.books === 'object') {
    for (const [k, v] of Object.entries(raw.books)) {
      const n = Math.floor(num(v, 0, 0, 1e9));
      if (n > 0) books[k] = n;
    }
  }
  const levels: Record<string, CharacterProgress> = {};
  if (raw?.levels && typeof raw.levels === 'object') {
    for (const [k, v] of Object.entries(raw.levels as Record<string, any>)) {
      const level = Math.round(num(v?.level, 1, 1, 999));
      const exp = Math.floor(num(v?.exp, 0, 0, 1e15));
      if (level > 1 || exp > 0) levels[k] = { level, exp };
    }
  }
  return { cleared: strList(raw?.cleared), loadouts, currency: Math.floor(num(raw?.currency, 0, 0, 1e15)), books, levels };
}
