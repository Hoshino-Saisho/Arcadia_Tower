/**
 * Arcadia Tower —— 全局数据模型
 * 所有可编辑的内容都是纯 JSON 数据，保存在 data/ 目录下（可同步到 GitHub 仓库）：
 *   data/characters.json   角色列表
 *   data/enemies.json      敌人列表
 *   data/skills.json       技能库（角色和敌人通过技能 ID 引用）
 *   data/chapters.json     章节顺序
 *   data/settings.json     全局设置（主页音乐等）
 *   data/levels/<章节>_<关卡>.json   关卡（地图 + 敌人线 + 数值设置）
 *   data/icons/            以后绘制好的图标（png/jpg/webp）
 *   data/music/home/       主页音乐（未进入战斗时播放）
 *   data/music/battle/     战斗音乐（在章节规划 / 关卡设置中选择）
 *   data/progress.json     玩家进度与角色技能设定（不上传 GitHub）
 */

/** 网格坐标（单位：格） */
export interface GridPos {
  x: number;
  y: number;
}

/** 图标中心点：图片宽 / 高的比例（0~1），这一点会对齐到圆形 / 多边形的中心 */
export interface IconPoint {
  x: number;
  y: number;
}

/** 角色可部署的位置 */
export type PlacementType = 'ground' | 'high' | 'any';

/** 伤害类型：物伤只被物抗减免，法伤只被法抗减免，真伤无视物抗和法抗 */
export type DamageType = 'physical' | 'magic' | 'true';
export type SkillDamageType = DamageType;

/** 攻击对象：敌人（默认）或队友（伤害值为负数时为治疗） */
export type AttackTarget = 'enemy' | 'ally';

/** 可以被增益 / 减益修改的属性 */
export type StatKey =
  | 'maxHp'
  | 'atk'
  | 'def'
  | 'res'
  | 'attackInterval'
  | 'range'
  | 'targetCount'
  | 'blockCount'
  | 'speed'
  | 'hpRegen';

/** 一条属性修改：固定值（add）或百分比（percent），正数 / 负数都可以 */
export interface StatModifier {
  stat: StatKey;
  mode: 'add' | 'percent';
  value: number;
}

/** 普通攻击命中时附带的效果（增益 / 减益），作用于被攻击的目标 */
export interface OnHitEffect {
  modifiers: StatModifier[];
  /** 持续时间（秒） */
  duration: number;
}

/** 技能效果 */
export interface SkillEffect {
  /**
   * modify = 增益 / 减益（修改属性一段时间）；damage = 伤害 / 治疗（立即生效）；
   * money = 金钱（释放时立即获得 + 持续期间每秒获得；敌人释放时玩家失去对应金钱）
   */
  kind: 'modify' | 'damage' | 'money';
  /** 作用对象：自身 / 友方 / 敌方（money 不使用） */
  target: 'self' | 'allies' | 'enemies';
  /** range = 半径内；all = 全场 */
  scope: 'range' | 'all';
  /** 半径（格），0 = 使用施放者当前的攻击范围 */
  radius: number;
  /** 最多影响的目标数，-1 = 不限 */
  maxTargets: number;
  /** modify：属性修改列表（可同时有增益和减益） */
  modifiers: StatModifier[];
  /** modify / money：持续时间（秒），0 = 跟随技能持续时间 */
  duration: number;
  /** damage：数值为攻击力（绝对值）的百分比；正数 = 伤害，负数 = 治疗 */
  amount: number;
  damageType: SkillDamageType;
  /** money：释放时立即获得的金钱（负数 = 消耗） */
  money: number;
  /** money：持续期间每秒获得的金钱（负数 = 每秒消耗）；施放者离场后停止 */
  moneyRate: number;
}

/** 技能定义（技能库 data/skills.json） */
export interface SkillDef {
  id: string;
  name: string;
  /** 界面中显示技能用的颜色 */
  color: string;
  /** 以后的技能图标 */
  icon?: string;
  description?: string;
  /** SP 上限：SP 积满后才能释放 */
  spMax: number;
  /** 部署 / 出现时的初始 SP */
  spInitial: number;
  /** SP 积累方式：attack = 每次攻击成功（无论攻击敌人还是队友）；auto = 随时间自动积累 */
  spGain: 'attack' | 'auto';
  /** 积累速度：每次攻击获得的 SP，或每秒获得的 SP */
  spRate: number;
  /** 释放方式：auto = SP 满后自动释放；manual = 点击角色后手动释放（敌人总是自动） */
  trigger: 'auto' | 'manual';
  /** 技能持续时间（秒），0 = 瞬间生效；持续期间不积累 SP */
  duration: number;
  effects: SkillEffect[];
}

/** 角色（塔）定义 */
export interface CharacterDef {
  /** 唯一 ID，用于区分角色，例如 "C001" */
  id: string;
  name: string;
  /** 无图标时显示为该颜色的圆形 */
  color: string;
  /** 可选图标：data 目录下的相对路径（如 "icons/C001.png"）或 data URL。设置后优先显示图标 */
  icon?: string;
  /** 图标中心点（默认图片正中 0.5 / 0.5） */
  iconCenter?: IconPoint;
  /** 图标缩放：1 = 短边刚好铺满圆形，>1 放大，<1 缩小（默认 1） */
  iconZoom?: number;
  placement: PlacementType;
  /** 部署费用 */
  cost: number;
  maxHp: number;
  /** 攻击力；攻击队友时为负数表示治疗量 */
  atk: number;
  /** 物抗（物理防御，固定值减免物伤） */
  def: number;
  /** 法抗（0~100，按百分比减免法伤） */
  res: number;
  /** 攻击的伤害类型 */
  damageType: DamageType;
  /** 攻击对象 */
  attackTarget: AttackTarget;
  /** 每次攻击的目标数量，-1 = 射程内全部 */
  targetCount: number;
  /** 攻击间隔（秒） */
  attackInterval: number;
  /** 攻击范围（格）：以所在方块为中心，方块中心距离不超过该值的方块都在射程内 */
  range: number;
  /** 阻挡数：部署在地面上时最多同时阻挡的敌人数，0 = 不阻挡 */
  blockCount: number;
  /** 同时部署上限，0 = 不限 */
  maxDeploy: number;
  /** 攻击方式：basic = 发射子弹（默认）；area = 范围伤害（同时攻击射程内全部目标，不发射子弹） */
  attackType: string;
  /** 可用技能 ID（按顺序，默认携带前 skillSlots 个） */
  skills: string[];
  /** 战斗中可以携带的技能数量 */
  skillSlots: number;
  /** 普通攻击命中时附带的效果 */
  onHit: OnHitEffect | null;
  description?: string;
}

/** 敌人外形边数 */
export type EnemySides = 3 | 4 | 5 | 6;

/** 敌人定义 */
export interface EnemyDef {
  id: string;
  name: string;
  color: string;
  icon?: string;
  /** 图标中心点（默认图片正中 0.5 / 0.5） */
  iconCenter?: IconPoint;
  /** 图标缩放（默认 1） */
  iconZoom?: number;
  /** 外形：3~6 边形 */
  sides: EnemySides;
  /** 体型缩放（0.5 ~ 2） */
  size: number;
  maxHp: number;
  atk: number;
  /** 物抗 */
  def: number;
  /** 法抗（0~100%） */
  res: number;
  /** 移动速度（格/秒） */
  speed: number;
  /** 是否会攻击（攻击对象为队友时 = 会治疗 / 攻击其他敌人） */
  canAttack: boolean;
  damageType: DamageType;
  attackTarget: AttackTarget;
  targetCount: number;
  /** 攻击间隔（秒） */
  attackInterval: number;
  /** 攻击范围（格）。0 = 只攻击正在阻挡它的角色（近战） */
  attackRange: number;
  /** 击杀奖励金钱 */
  reward: number;
  attackType: string;
  skills: string[];
  skillSlots: number;
  onHit: OnHitEffect | null;
  description?: string;
}

/** 章节定义；chapters.json 中数组的顺序就是章节顺序 */
export interface ChapterDef {
  /** 章节编号，例如 "ZH"（不能包含下划线） */
  id: string;
  name: string;
  /** 本章节的关卡数量 */
  levelCount: number;
  description?: string;
  /** 本章节的战斗音乐（data/music/battle/ 下的文件名，空 = 无） */
  battleMusic: string;
}

/** 地图方块类型 */
export type TileType = 'ground' | 'high' | 'spawn' | 'base' | 'nodeploy';

/** 敌人线上的一块“积木”：在 startTime 开始，每隔 interval 秒生成一个 enemyId，共 count 个 */
export interface SpawnBlock {
  id: string;
  enemyId: string;
  count: number;
  interval: number;
  startTime: number;
}

/** 敌人路线 */
export interface RouteDef {
  /** auto = 程序自动寻路；manual = 手动逐格设置 */
  mode: 'auto' | 'manual';
  /** 使用的敌人出现点（null = 地图上的第一个出现点） */
  spawn: GridPos | null;
  /** 自动寻路的目的地（null = 最近的基地） */
  target: GridPos | null;
  /** 手动路线：从出现点到基地的连续方块序列 */
  path: GridPos[];
}

/** 敌人线：一条路线 + 时间线上的若干积木 */
export interface EnemyLine {
  id: string;
  name: string;
  color: string;
  route: RouteDef;
  blocks: SpawnBlock[];
}

/** 关卡数值设置 */
export interface LevelSettings {
  name: string;
  /** 玩家初始血量 */
  initialHp: number;
  /** 初始金钱 */
  initialMoney: number;
  /** 是否自动回复金钱 */
  autoMoney: boolean;
  /** 每分钟回复数量 */
  moneyPerMinute: number;
  /** 本关可用角色 ID；空数组 = 全部角色可用 */
  availableCharacters: string[];
  /** 本关战斗音乐；空 = 跟随章节设置 */
  battleMusic: string;
}

/** 关卡：编号为 "<章节编号>_<关卡序号>"，例如 "ZH_1" */
export interface LevelDef {
  id: string;
  chapterId: string;
  index: number;
  version: number;
  /** 网格宽高（格） */
  width: number;
  height: number;
  /** 每行一个字符串，每个字符代表一个方块，见 tiles.ts（'.' = 空） */
  grid: string[];
  settings: LevelSettings;
  lines: EnemyLine[];
}

/** 全局设置（data/settings.json） */
export interface GameSettings {
  /** 主页音乐：空 = 按顺序循环播放 music/home/ 下的全部音乐 */
  homeMusic: string;
}

/** 玩家进度（data/progress.json，只保存在本机） */
export interface ProgressData {
  cleared: string[];
  /** 角色设定：角色 ID → 携带的技能 ID */
  loadouts: Record<string, string[]>;
}
