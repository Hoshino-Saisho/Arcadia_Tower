import { resolveRoute } from '../core/pathfinding';
import type { TileGrid } from '../core/tiles';
import type { EnemyDef, GridPos, LevelDef } from '../core/types';

export interface SpawnEvent {
  time: number;
  enemyId: string;
  lineId: string;
  path: GridPos[];
}

export interface RouteInfo {
  lineId: string;
  name: string;
  color: string;
  path: GridPos[];
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
    routes.push({ lineId: line.id, name: line.name, color: line.color, path: r.path });
    for (const b of line.blocks) {
      if (!enemies.has(b.enemyId)) {
        warnings.push(`「${line.name}」中的敌人 ${b.enemyId || '(未选择)'} 不存在，已跳过`);
        continue;
      }
      for (let i = 0; i < b.count; i++) {
        events.push({ time: b.startTime + i * b.interval, enemyId: b.enemyId, lineId: line.id, path: r.path });
      }
    }
  }
  events.sort((a, b) => a.time - b.time);
  return { events, routes, warnings, duration: events.length ? events[events.length - 1].time : 0 };
}
