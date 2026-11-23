import { levelCode, shortUid } from './ids';
import { STATS } from './stats';
import { makeEmptyGrid, resizeGrid } from './tiles';
import type {
  ChapterDef,
  CharacterDef,
  EnemyDef,
  EnemyLine,
  EnemySides,
  GameSettings,
  GridPos,
  IconPoint,
  LevelDef,
  LevelSettings,
  OnHitEffect,
  ProgressData,
  RouteDef,
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

export const LINE_COLORS = ['#e8a33d', '#4fb3a9', '#d1605e', '#8f7ad6', '#6aa84f', '#d98cc0', '#5b9bd5', '#c9b458'];

/* ---------- 新建对象 ---------- */

export function newCharacter(id: string): CharacterDef {
  return {
    id,
    name: '新角色',
    color: '#4a90d9',
    placement: 'ground',
    cost: 10,
    maxHp: 1000,
    atk: 50,
    def: 50,
    res: 0,
    damageType: 'physical',
    attackTarget: 'enemy',
    targetCount: 1,
    attackInterval: 1,
    range: 1,
    blockCount: 1,
    maxDeploy: 0,
    attackType: 'basic',
    skills: [],
    skillSlots: 1,
    onHit: null,
  };
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
  return { mode: 'auto', spawn, target: null, path: [] };
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
    attackType: str(raw?.attackType, 'basic'),
    skills: strList(raw?.skills),
    skillSlots: Math.round(num(raw?.skillSlots, 1, 0, 9)),
    onHit: normalizeOnHit(raw?.onHit),
    description: typeof raw?.description === 'string' ? raw.description : undefined,
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
    },
    lines: Array.isArray(raw?.lines) ? raw.lines.map(normalizeLine) : [],
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
  return { cleared: strList(raw?.cleared), loadouts };
}
