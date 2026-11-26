import type { EndlessConfig, EnemyDef } from './types';

/**
 * 无尽模式的波次规则（纯函数，战斗引擎和编辑器预览共用）：
 *  - 当前难度 = 起始难度 + (波次 − 1) × 每波增加；只出现「难度 ≤ 当前难度」的敌人
 *  - 每波的组数 = 第 1 波组数 + (波次 − 1) × 每波增加（四舍五入，至少 1 组）
 *  - 每组随机选一种敌人，「出现位列」越低越容易被选中：机会 = 1 / 位列（位列 1 是位列 2 的 2 倍、位列 3 的 3 倍）
 *  - 每组的数量 = 敌人的「出现数量」×（1 + 每波数量增加% × (波次 − 1)），同一组的敌人每隔「组内间隔」秒出现一个
 *  - 每波敌人的生命 / 攻击按百分比增加
 */

export interface EndlessGroup {
  enemyId: string;
  count: number;
  /** 组内每个敌人的出现间隔（秒） */
  interval: number;
  /** 这一组相对波次开始的出现时间（秒） */
  offset: number;
  /** 使用第几条路线 */
  routeIndex: number;
}

export interface WavePlan {
  wave: number;
  difficulty: number;
  groups: EndlessGroup[];
  /** 这一波敌人的生命 / 攻击倍率 */
  hpScale: number;
  atkScale: number;
}

export function waveDifficulty(cfg: EndlessConfig, wave: number): number {
  return cfg.startDifficulty + (wave - 1) * cfg.difficultyPerWave;
}

export function waveGroupCount(cfg: EndlessConfig, wave: number): number {
  return Math.max(1, Math.round(cfg.groupsPerWave + (wave - 1) * cfg.groupsGrowth));
}

/** 每组的数量（敌人的「出现数量」，每波按百分比增加）和组内间隔 */
export function groupSize(cfg: EndlessConfig, enemy: Pick<EnemyDef, 'endlessCount'>, wave: number): { count: number; interval: number } {
  const growth = Math.max(0, 1 + (cfg.countGrowth / 100) * (wave - 1));
  return {
    count: Math.max(1, Math.min(99, Math.round(enemy.endlessCount * growth))),
    interval: Math.max(0.05, Math.round(cfg.groupInterval * 100) / 100),
  };
}

/** 出现位列对应的权重：位列越低越容易被选中（1 / 位列） */
export function rankWeight(rank: number): number {
  return 1 / Math.max(1, rank);
}

/** 第 wave 波的敌人强化倍率（至少 5%） */
export function waveScale(cfg: EndlessConfig, wave: number): { hp: number; atk: number } {
  const f = (pct: number) => Math.max(0.05, 1 + (pct / 100) * (wave - 1));
  return { hp: f(cfg.hpGrowth), atk: f(cfg.atkGrowth) };
}

/**
 * 第 wave 波可以出现的敌人和权重：难度 ≤ 当前难度；权重 = 1 / 出现位列（位列越低出现得越频繁）。
 * 没有敌人的难度够低时，使用难度最低的敌人（保证每一波都有敌人）。
 */
export function eligibleEnemies(cfg: EndlessConfig, enemies: EnemyDef[], wave: number): { def: EnemyDef; weight: number }[] {
  const d = waveDifficulty(cfg, wave);
  let pool = enemies.filter((e) => e.endlessDifficulty <= d + 1e-9);
  if (!pool.length && enemies.length) {
    const min = Math.min(...enemies.map((e) => e.endlessDifficulty));
    pool = enemies.filter((e) => e.endlessDifficulty === min);
  }
  return pool.map((def) => ({ def, weight: rankWeight(def.endlessRank) }));
}

/**
 * 第 wave 波每种敌人被选中的概率（0~1，每组按这个概率选敌人）；这一波不会出现的敌人没有记录。
 * 编辑器用它显示「出现位列」的效果。
 */
export function waveShares(cfg: EndlessConfig, enemies: EnemyDef[], wave: number): Map<string, number> {
  const pool = eligibleEnemies(cfg, enemies, wave);
  const total = pool.reduce((s, p) => s + p.weight, 0);
  return new Map(pool.map((p) => [p.def.id, total > 0 ? p.weight / total : 0]));
}

/** 敌人第一次可以出现的波次；永远不会出现返回 null */
export function firstWaveOf(cfg: EndlessConfig, difficulty: number, enemies: EnemyDef[] = []): number | null {
  if (difficulty <= cfg.startDifficulty + 1e-9) return 1;
  // 没有敌人够格时会用难度最低的敌人
  if (enemies.length && difficulty <= Math.min(...enemies.map((e) => e.endlessDifficulty)) + 1e-9) return 1;
  if (cfg.difficultyPerWave <= 0) return null;
  return 1 + Math.ceil((difficulty - cfg.startDifficulty) / cfg.difficultyPerWave - 1e-9);
}

/** 全部能出现的敌人都已经出现的波次（至少第 1 波）：在这一波看「出现位列」的效果最完整 */
export function allAppearedWave(cfg: EndlessConfig, enemies: EnemyDef[]): number {
  let wave = 1;
  for (const e of enemies) {
    const w = firstWaveOf(cfg, e.endlessDifficulty, enemies);
    if (w != null && w > wave) wave = w;
  }
  return wave;
}

/** 安排一波敌人：按权重随机选敌人，每组随机选一条路线，组与组在波次的前 70% 时间里依次出现 */
export function planWave(cfg: EndlessConfig, enemies: EnemyDef[], routeCount: number, wave: number, rng: () => number): WavePlan {
  const pool = eligibleEnemies(cfg, enemies, wave);
  const total = pool.reduce((s, p) => s + p.weight, 0);
  const n = waveGroupCount(cfg, wave);
  const groups: EndlessGroup[] = [];
  for (let g = 0; g < n && pool.length && routeCount > 0; g++) {
    let r = rng() * total;
    let pick = pool[pool.length - 1].def;
    for (const p of pool) {
      r -= p.weight;
      if (r < 0) {
        pick = p.def;
        break;
      }
    }
    const size = groupSize(cfg, pick, wave);
    groups.push({ enemyId: pick.id, ...size, offset: Math.round(((g * cfg.waveInterval * 0.7) / n) * 100) / 100, routeIndex: Math.floor(rng() * routeCount) });
  }
  const scale = waveScale(cfg, wave);
  return { wave, difficulty: waveDifficulty(cfg, wave), groups, hpScale: scale.hp, atkScale: scale.atk };
}

/** 可重复的随机数（编辑器预览和测试用） */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
