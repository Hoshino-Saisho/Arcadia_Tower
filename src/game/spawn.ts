import { resolveRoute } from '../core/pathfinding';
import type { TileGrid } from '../core/tiles';
import type { EnemyDef, GridPos, LevelDef } from '../core/types';

export interface SpawnEvent {
  time: number;
  enemyId: string;
  lineId: string;
  path: GridPos[];
  /** 路线上每一格的停留时间（秒），和 path 下标一致 */
  waits: number[];
  /** 无尽模式：这一波敌人的生命 / 攻击倍率 */
  hpScale?: number;
  atkScale?: number;
}

/** 路线上的停留点（显示用） */
export interface RouteWaitMark {
  x: number;
  y: number;
  duration: number;
}

export interface RouteInfo {
  lineId: string;
  name: string;
  color: string;
  path: GridPos[];
  waits: RouteWaitMark[];
}

export interface Schedule {
  events: SpawnEvent[];
  routes: RouteInfo[];
  warnings: string[];
  /** 最后一个敌人的出现时间 */
  duration: number;
}

/** 一条可以使用的路线（无尽模式从这里随机选路线） */
export interface LineRoute {
  info: RouteInfo;
  /** 每一格的停留时间 */
  perStep: number[];
}

/**
 * 把关卡里的敌人线（路线 + 时间线积木）展开成按时间排序的生成事件。
 * allLines = true 时（无尽模式）没有积木的敌人线也会检查路线，用于随机出怪。
 */
export function buildSchedule(level: LevelDef, grid: TileGrid, enemies: Map<string, EnemyDef>, allLines = false): Schedule & { lineRoutes: LineRoute[] } {
  const events: SpawnEvent[] = [];
  const routes: RouteInfo[] = [];
  const lineRoutes: LineRoute[] = [];
  const warnings: string[] = [];
  for (const line of level.lines) {
    if (line.blocks.length === 0 && !allLines) continue;
    const r = resolveRoute(grid, line.route);
    if (!r.path) {
      warnings.push(`「${line.name}」路线无效：${r.error ?? '未知错误'}，该线的敌人不会出现`);
      continue;
    }
    const perStep = r.waits?.perStep ?? [];
    const marks = r.path.flatMap((p, i) => (perStep[i] > 0 ? [{ x: p.x, y: p.y, duration: perStep[i] }] : []));
    const info = { lineId: line.id, name: line.name, color: line.color, path: r.path, waits: marks };
    routes.push(info);
    lineRoutes.push({ info, perStep });
    if (r.waits?.invalid.length) warnings.push(`「${line.name}」有 ${r.waits.invalid.length} 个停留点不在路线上，不会生效`);
    for (const b of line.blocks) {
      if (!enemies.has(b.enemyId)) {
        warnings.push(`「${line.name}」中的敌人 ${b.enemyId || '(未选择)'} 不存在，已跳过`);
        continue;
      }
      for (let i = 0; i < b.count; i++) {
        events.push({ time: b.startTime + i * b.interval, enemyId: b.enemyId, lineId: line.id, path: r.path, waits: perStep });
      }
    }
  }
  events.sort((a, b) => a.time - b.time);
  return { events, routes, lineRoutes, warnings, duration: events.length ? events[events.length - 1].time : 0 };
}
