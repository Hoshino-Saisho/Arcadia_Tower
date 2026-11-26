/**
 * Arcadia Tower —— 全局数据模型
 * 所有可编辑的内容都是纯 JSON 数据，保存在 data/ 目录下（可同步到 GitHub 仓库）：
 *   data/characters.json   角色列表
 *   data/enemies.json      敌人列表
 *   data/skills.json       技能库（角色和敌人通过技能 ID 引用）
 *   data/summons.json      召唤物（攻击方式为「召唤」的角色 / 敌人引用）
 *   data/chapters.json     章节顺序
 *   data/settings.json     全局设置（主页音乐等）
 *   data/currency.json     货币编辑：游戏外货币、经验书、升级经验、基础通关奖励
 *   data/endless.json      无尽模式：地图、波次规则、分数兑换
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
  | 'hpRegen'
  /** 技能 SP 积累速度（倍数，默认 1；攻击获得的 SP 和每秒自动获得的 SP 都乘以它） */
  | 'spRate';

/** 一条属性修改：固定值（add）或百分比（percent），正数 / 负数都可以 */
export interface StatModifier {
  stat: StatKey;
  mode: 'add' | 'percent';
  value: number;
}

/** 普通攻击命中时附带的效果：增益 / 减益作用于被攻击的目标；部署冷却作用于玩家 */
export interface OnHitEffect {
  modifiers: StatModifier[];
  /** 持续时间（秒） */
  duration: number;
  /** 每次命中减少玩家剩余的部署冷却（秒，负数 = 增加）；敌人命中时反过来（玩家的部署冷却增加） */
  cooldown?: number;
}

/** 技能效果 */
export interface SkillEffect {
  /**
   * modify = 增益 / 减益（修改属性一段时间）；damage = 伤害 / 治疗（立即生效）；
   * money = 金钱（释放时立即获得 + 持续期间每秒获得；敌人释放时玩家失去对应金钱）；
   * regen = 持续治疗（每秒治疗）/ 持续伤害（数值为负数时每秒受到伤害，按伤害类型结算物抗 / 法抗）；
   * cooldown = 部署冷却（释放时立即减少全部角色剩余的部署冷却；敌人释放时玩家的部署冷却增加）
   */
  kind: 'modify' | 'damage' | 'money' | 'regen' | 'cooldown';
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
  /** modify / money / regen：持续时间（秒），0 = 跟随技能持续时间 */
  duration: number;
  /**
   * damage：数值为攻击力（绝对值）的百分比；正数 = 伤害，负数 = 治疗
   * regen：每秒的数值；正数 = 每秒治疗，负数 = 每秒受到伤害
   */
  amount: number;
  /** regen：数值是固定值（flat）还是施放者攻击力的百分比（atk） */
  regenMode: 'flat' | 'atk';
  damageType: SkillDamageType;
  /** money：释放时立即获得的金钱（负数 = 消耗） */
  money: number;
  /** money：持续期间每秒获得的金钱（负数 = 每秒消耗）；施放者离场后停止 */
  moneyRate: number;
  /** cooldown：减少的部署冷却（秒，负数 = 增加） */
  cooldown: number;
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

/** 升级成长：每升 1 级增加的数值（负数 = 减少；攻击力对治疗角色 = 治疗量） */
export interface CharacterGrowth {
  maxHp: number;
  atk: number;
  def: number;
  res: number;
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
  /** 部署费用（负数 = 部署时获得金钱，撤退时扣回一半） */
  cost: number;
  maxHp: number;
  /** 攻击力；攻击队友时为负数表示治疗量 */
  atk: number;
  /** 物抗（物理防御，固定值减免物伤；负数 = 受到额外的物伤） */
  def: number;
  /** 法抗（最高 100，按百分比减免法伤；负数 = 受到额外的法伤） */
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
  /** 部署冷却（秒）：部署后这段时间内不能再次部署同一个角色，0 = 没有冷却 */
  deployCooldown: number;
  /**
   * 攻击方式：basic = 发射子弹（默认）；area = 范围伤害（同时攻击射程内全部目标，不发射子弹）；
   * summon = 召唤（部署后召唤物出现在部署栏，角色自己按 summonAttack 攻击）；none = 不攻击（只有召唤物可以选）
   */
  attackType: string;
  /** 攻击方式为「召唤」时，角色自己的攻击方式：basic / area / none */
  summonAttack: string;
  /** 可以召唤的召唤物 ID（玩家在角色设定中选择 1 个，默认第一个） */
  summons: string[];
  /** 可用技能 ID（按顺序，默认携带前 skillSlots 个） */
  skills: string[];
  /** 战斗中可以携带的技能数量 */
  skillSlots: number;
  /** 普通攻击命中时附带的效果 */
  onHit: OnHitEffect | null;
  /** 升级成长（等级上限和升级经验在「货币编辑」中设置） */
  growth: CharacterGrowth;
  description?: string;
}

/** 召唤物从召唤者继承的数值（%）：召唤者（按等级）的数值 × 百分比，加到召唤物自己的数值上 */
export interface SummonInherit {
  maxHp: number;
  atk: number;
  def: number;
  res: number;
}

/** 召唤物属于哪一方：ally = 角色的召唤物；enemy = 敌人的召唤物 */
export type SummonSide = 'ally' | 'enemy';

/**
 * 召唤物（data/summons.json，在「召唤物编辑」中编辑）：几乎和角色一样（数值、攻击方式、技能……）。
 * 不使用角色的 growth / summons / summonAttack（召唤物不升级，按继承的数值变强）。
 *  - 角色的召唤物：攻击方式为「召唤」的角色部署后，它选择的召唤物出现在部署栏里，可以像角色一样拖到地图上。
 *  - 敌人的召唤物：攻击方式为「召唤」的敌人按召唤间隔自动召唤，召唤物出现在召唤者的位置，
 *    像敌人一样沿召唤者剩下的路线前进（不会被放置）。range = 攻击范围（0 = 只攻击阻挡它的角色），
 *    maxDeploy = 每个召唤者同时存在的上限；cost / placement / blockCount / deployCooldown / nearSummoner 不使用。
 */
export interface SummonDef extends CharacterDef {
  /** 召唤者是角色还是敌人（召唤物编辑最上面的设置） */
  side: SummonSide;
  /** 从召唤者继承的数值（%） */
  inherit: SummonInherit;
  /** 无敌：不会受到伤害 */
  invincible: boolean;
  /** 角色的召唤物：只能部署在召唤者的攻击范围内 */
  nearSummoner: boolean;
  /** 召唤者离场（撤退 / 被击败 / 进入基地）后召唤物仍然留在场上 */
  keepAfterSummoner: boolean;
  /** 敌人的召唤物：移动速度（格/秒） */
  speed: number;
  /** 敌人的召唤物：外形（3~6 边形） */
  sides: EnemySides;
  /** 敌人的召唤物：体型（0.5 ~ 2；召唤物比同样体型的敌人小一些） */
  size: number;
  /** 敌人的召唤物：被击败时的金钱奖励（负数 = 扣除金钱） */
  reward: number;
  /** 敌人的召唤物：无尽模式中被击败时获得的分数 */
  endlessScore: number;
  /** 敌人的召唤物：召唤者出现后第几秒第一次召唤 */
  summonFirst: number;
  /** 敌人的召唤物：之后每隔几秒召唤一次（0 = 只召唤一次） */
  summonInterval: number;
  /** 敌人的召唤物：每次召唤的数量 */
  summonCount: number;
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
  /** 击杀奖励金钱（负数 = 击败时扣除金钱） */
  reward: number;
  /**
   * 攻击方式：basic = 子弹（默认）；area = 范围伤害；
   * summon = 召唤（按召唤物的召唤间隔自动召唤敌人的召唤物，自己按 summonAttack 攻击）
   */
  attackType: string;
  /** 攻击方式为「召唤」时，敌人自己的攻击方式：basic / area / none */
  summonAttack: string;
  /** 攻击方式为「召唤」时召唤的召唤物（敌人的召唤物）：每种按自己的召唤间隔召唤 */
  summons: string[];
  skills: string[];
  skillSlots: number;
  onHit: OnHitEffect | null;
  /** 无尽模式：被击败时获得的分数（负数 = 扣分） */
  endlessScore: number;
  /** 无尽模式：敌人难度，越低越早出现（当前难度 ≥ 敌人难度时才会出现） */
  endlessDifficulty: number;
  /** 无尽模式：出现位列，越低每组出现的数量越少、组内的出现间隔越短 */
  endlessRank: number;
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

/**
 * 路线上的停留点：敌人第 visit 次走到方块 (x, y) 的中心时，停在那里 duration 秒再继续走。
 * 路线可以重复经过同一个方块（转圈），所以用 visit 区分是第几次经过。
 */
export interface RouteWait {
  x: number;
  y: number;
  /** 第几次经过这个方块（从 1 开始） */
  visit: number;
  /** 停留时间（秒） */
  duration: number;
}

/** 敌人路线 */
export interface RouteDef {
  /** auto = 程序自动寻路；manual = 手动逐格设置 */
  mode: 'auto' | 'manual';
  /** 使用的敌人出现点（null = 地图上的第一个出现点） */
  spawn: GridPos | null;
  /** 自动寻路的目的地（null = 最近的基地） */
  target: GridPos | null;
  /** 手动路线：从出现点到基地的连续方块序列（可以重复经过同一个方块） */
  path: GridPos[];
  /** 停留点（自动寻路和手动路线都可以设置） */
  waits: RouteWait[];
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
  /** 每分钟回复数量（负数 = 金钱随时间减少） */
  moneyPerMinute: number;
  /** 本关可用角色 ID；空数组 = 全部角色可用 */
  availableCharacters: string[];
  /** 本关战斗音乐；空 = 跟随章节设置 */
  battleMusic: string;
  /** 通关奖励倍数：本关奖励 = 「货币编辑」中的基础奖励（货币和经验书数量）× 倍数 */
  rewardMultiplier: number;
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

/** 经验书：给角色使用后增加固定的经验值，每使用 1 本消耗一定的游戏外货币 */
export interface ExpBookDef {
  /** 自动生成，不能修改（玩家的库存和关卡掉落都用它引用） */
  id: string;
  name: string;
  color: string;
  /** 每本增加的经验值 */
  exp: number;
  /** 使用 1 本消耗的游戏外货币 */
  cost: number;
}

/** 通关时的一项经验书掉落：按概率掉落，数量在 min ~ max 之间随机 */
export interface BookDrop {
  bookId: string;
  /** 掉落概率（%） */
  chance: number;
  min: number;
  max: number;
}

/** 关卡选择中掉落信息的显示方式：精确数值 / 概率等级（固定 · 大概率 · 小概率 · 罕见）/ 不显示 */
export type DropDisplay = 'exact' | 'tier' | 'hidden';

/** 货币编辑（data/currency.json）：游戏外货币、经验书、升级经验和默认通关奖励 */
export interface CurrencyConfig {
  /** 游戏外货币的名称（战斗中的「金钱」是另一种东西，只在一场战斗里有效） */
  name: string;
  color: string;
  /** 基础升级经验：1 级升 2 级需要的经验值（全部角色通用） */
  baseExp: number;
  /** 每一级比上一级多需要的比例：0.75 → 每一级所需经验 = 上一级 × 1.75 */
  expGrowth: number;
  /** 等级上限 */
  maxLevel: number;
  books: ExpBookDef[];
  /** 基础通关奖励（1 倍）：每个关卡按自己的「奖励倍数」放大 */
  defaultCurrency: number;
  defaultBooks: BookDrop[];
  dropDisplay: DropDisplay;
}

/** 无尽模式的分数兑换：每 score 分换 amount 个（货币或某种经验书） */
export interface ScoreRate {
  score: number;
  amount: number;
}

export interface BookScoreRate extends ScoreRate {
  bookId: string;
}

/**
 * 肉鸽牌的效果种类：
 *  ally = 全体角色的属性；enemy = 全体敌人的属性；money = 选择时立即获得金钱；moneyRate = 每分钟金钱；
 *  killMoney = 每击败 1 个敌人额外获得的金钱；cost = 全体部署费用（负数 = 更便宜）；
 *  baseHp = 基地血量（上限和当前血量一起增加）；score = 分数加成（%）；cooldown = 减少部署冷却（%，正数 = 冷却变短，负数 = 变长）
 */
export type RogueEffectKind = 'ally' | 'enemy' | 'money' | 'moneyRate' | 'killMoney' | 'cost' | 'baseHp' | 'score' | 'cooldown';

/** 肉鸽牌的一个效果：Lv.N 的数值 = value + perLevel × (N − 1)（等级没有上限） */
export interface RogueEffect {
  kind: RogueEffectKind;
  /** ally / enemy：修改的属性 */
  stat: StatKey;
  /** ally / enemy：固定值（add）或百分比（percent） */
  mode: 'add' | 'percent';
  /** Lv.1 的数值（负数 = 减少） */
  value: number;
  /** 每次升级增加的数值（负数 = 每级减少） */
  perLevel: number;
}

/** 肉鸽牌（无尽模式的牌组） */
export interface RogueCard {
  /** 自动生成，不能修改 */
  id: string;
  name: string;
  color: string;
  description?: string;
  /** 抽牌权重：越大越容易被抽到，0 = 不会被抽到 */
  weight: number;
  /** 每次升级需要再抽到几张同样的牌（等级没有上限） */
  copies: number;
  effects: RogueEffect[];
}

/**
 * 无尽模式的肉鸽玩法：开局和每隔几波暂停，从牌组里随机抽出几张牌，玩家选择 1 张。
 * 再次选择持有的牌 = 积累升级进度，凑够数量就升级（等级没有上限）；持有的种类达到上限后只会抽到已经持有的牌。
 */
export interface RogueConfig {
  enabled: boolean;
  /** 每隔几波抽一次牌（第 N、2N、3N… 波开始时） */
  everyWaves: number;
  /** 开局（第 1 波之前）先抽一次 */
  startDraw: boolean;
  /** 每次抽出几张（选择 1 张） */
  choices: number;
  /** 最多持有几种不同的牌（0 = 不限）；达到上限后只会抽到已经持有的牌 */
  maxHeld: number;
  cards: RogueCard[];
}

/**
 * 无尽模式（data/endless.json）：
 *  - 地图和路线在无尽模式编辑器里搭建（时间线里的积木 = 额外固定出现的敌人）
 *  - 敌人一波一波自动出现：当前难度 = 起始难度 + (波次 − 1) × 每波增加，只出现难度不超过当前难度的敌人
 *  - 每组敌人的数量和组内间隔由敌人的「出现位列」决定；每波敌人越来越多、越来越强
 *  - 击败敌人获得分数，结束时按兑换比例换成游戏外货币和经验书
 *  - 肉鸽玩法：每隔几波三选一抽牌（见 RogueConfig）
 */
export interface EndlessConfig {
  /** 在游戏主页显示无尽模式 */
  enabled: boolean;
  name: string;
  /** 通关这个关卡后解锁；空 = 一开始就可以玩 */
  unlockAfter: string;
  /** 地图、路线和战斗设置（初始血量、金钱、可用角色、音乐） */
  map: LevelDef;
  /** 第 1 波开始的时间（秒，按「开始作战」后计算） */
  firstWave: number;
  /** 每一波的间隔（秒） */
  waveInterval: number;
  /** 第 1 波的难度 */
  startDifficulty: number;
  /** 每波难度增加 */
  difficultyPerWave: number;
  /** 第 1 波的敌人组数 */
  groupsPerWave: number;
  /** 每波增加的组数（可以是小数：0.5 = 每 2 波多 1 组） */
  groupsGrowth: number;
  /** 每组数量 = 出现位列 × 这个值 */
  countPerRank: number;
  /** 组内出现间隔 = 出现位列 × 这个值（秒） */
  intervalPerRank: number;
  /** 每波每组数量增加（%） */
  countGrowth: number;
  /** 每波敌人生命增加（%） */
  hpGrowth: number;
  /** 每波敌人攻击增加（%） */
  atkGrowth: number;
  /** 分数兑换货币 */
  currencyRate: ScoreRate;
  /** 分数兑换经验书 */
  bookRates: BookScoreRate[];
  /** 肉鸽玩法：抽牌规则和牌组 */
  rogue: RogueConfig;
}

/** 无尽模式的最好成绩 */
export interface EndlessRecord {
  score: number;
  wave: number;
  time: number;
}

/** 角色的等级和当前等级已经积累的经验 */
export interface CharacterProgress {
  level: number;
  exp: number;
}

/** 玩家进度（data/progress.json，只保存在本机） */
export interface ProgressData {
  cleared: string[];
  /** 角色设定：角色 ID → 携带的技能 ID */
  loadouts: Record<string, string[]>;
  /** 游戏外货币 */
  currency: number;
  /** 经验书库存：经验书 ID → 数量 */
  books: Record<string, number>;
  /** 角色等级：角色 ID → 等级与经验（没有记录的角色为 1 级） */
  levels: Record<string, CharacterProgress>;
  /** 无尽模式的最好成绩（没有玩过 = null） */
  endlessBest: EndlessRecord | null;
  /** 召唤物选择：角色 ID → 召唤物 ID（固定只能选 1 个，没有选择 = 第一个） */
  summonChoice: Record<string, string>;
  /** 编队：出战的角色 ID（按顺序，最多 12 个；空 = 前 12 个角色） */
  squad: string[];
}
