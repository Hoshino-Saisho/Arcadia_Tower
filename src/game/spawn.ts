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

/** 把关卡里的敌人线（路线 + 时间线积木）展开成按时间排序的生成事件 */
export function buildSchedule(level: LevelDef, grid: TileGrid, enemies: Map<string, EnemyDef>): Schedule {
  const events: SpawnEvent[] = [];
  const routes: RouteInfo[] = [];
  const warnings: string[] = [];
  for (const line of level.lines) {
    if (line.blocks.length === 0) continue;
    const r = resolveRoute(grid, line.route);
    if (!r.path) {
      warnings.push(`「${line.name}」路线无效：${r.error ?? '未知错误'}，该线的敌人不会出现`);
      continue;
    }
    const perStep = r.waits?.perStep ?? [];
    const marks = r.path.flatMap((p, i) => (perStep[i] > 0 ? [{ x: p.x, y: p.y, duration: perStep[i] }] : []));
    routes.push({ lineId: line.id, name: line.name, color: line.color, path: r.path, waits: marks });
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
  return { events, routes, warnings, duration: events.length ? events[events.length - 1].time : 0 };
}
