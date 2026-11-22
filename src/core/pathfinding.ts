import { TileGrid, formatPos, samePos } from './tiles';
import type { GridPos, RouteDef } from './types';

const DIRS: GridPos[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

export function isAdjacent(a: GridPos, b: GridPos): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/**
 * 从若干个终点反向做广度优先搜索，得到每个方块到终点的步数。
 * 除终点本身以外的基地方块视为不可通过（敌人一旦踩到基地中心就会结算）。
 */
function distanceField(grid: TileGrid, goals: GridPos[], start: GridPos): Int32Array {
  const dist = new Int32Array(grid.width * grid.height).fill(-1);
  const queue: number[] = [];
  for (const g of goals) {
    if (!grid.isWalkable(g.x, g.y)) continue;
    const i = g.y * grid.width + g.x;
    if (dist[i] === -1) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % grid.width;
    const y = (i - x) / grid.width;
    for (const d of DIRS) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (!grid.isWalkable(nx, ny)) continue;
      const ni = ny * grid.width + nx;
      if (dist[ni] !== -1) continue;
      // 途中不允许穿过其他基地（但起点本身例外）
      if (grid.isType(nx, ny, 'base') && !(nx === start.x && ny === start.y)) continue;
      dist[ni] = dist[i] + 1;
      queue.push(ni);
    }
  }
  return dist;
}

/**
 * 自动寻路：返回从 start 到目标基地（target 为空时取最近的基地）的最短路线，
 * 在多条等长路线中优先少拐弯。找不到时返回 null。
 */
export function findPath(grid: TileGrid, start: GridPos, target: GridPos | null): GridPos[] | null {
  const goals = target ? [target] : grid.find('base');
  if (goals.length === 0 || !grid.isWalkable(start.x, start.y)) return null;
  const dist = distanceField(grid, goals, start);
  const at = (p: GridPos) => (grid.inBounds(p.x, p.y) ? dist[p.y * grid.width + p.x] : -1);
  if (at(start) < 0) return null;

  const path: GridPos[] = [{ ...start }];
  let cur = start;
  let lastDir: GridPos | null = null;
  while (at(cur) > 0) {
    const want = at(cur) - 1;
    let next: GridPos | null = null;
    let nextDir: GridPos | null = null;
    const prev: GridPos | null = lastDir;
    const order: GridPos[] = prev ? [prev, ...DIRS.filter((d) => d !== prev)] : DIRS;
    for (const d of order) {
      const p = { x: cur.x + d.x, y: cur.y + d.y };
      if (at(p) === want) {
        next = p;
        nextDir = d;
        break;
      }
    }
    if (!next) return null;
    path.push(next);
    cur = next;
    lastDir = nextDir;
  }
  return path;
}

/** 手动设置路线时的补全：用最短路连接 from → to（不穿过基地，to 本身除外） */
export function connectTiles(grid: TileGrid, from: GridPos, to: GridPos): GridPos[] | null {
  if (!grid.isWalkable(to.x, to.y)) return null;
  const path = findPath(grid, from, to);
  return path;
}

export interface PathCheck {
  ok: boolean;
  /** 是否已经到达基地 */
  complete: boolean;
  error?: string;
}

/** 校验手动路线 */
export function checkManualPath(grid: TileGrid, path: GridPos[]): PathCheck {
  if (path.length === 0) return { ok: false, complete: false, error: '路线为空' };
  if (!grid.isType(path[0].x, path[0].y, 'spawn')) {
    return { ok: false, complete: false, error: `起点 ${formatPos(path[0])} 不是敌人出现点` };
  }
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!grid.isWalkable(p.x, p.y)) {
      return { ok: false, complete: false, error: `第 ${i + 1} 格 ${formatPos(p)} 不可行走` };
    }
    if (i > 0 && !isAdjacent(path[i - 1], p)) {
      return { ok: false, complete: false, error: `第 ${i} 格与第 ${i + 1} 格不相连` };
    }
    if (i < path.length - 1 && grid.isType(p.x, p.y, 'base')) {
      return { ok: false, complete: false, error: `路线在第 ${i + 1} 格中途进入了基地` };
    }
  }
  const last = path[path.length - 1];
  const complete = grid.isType(last.x, last.y, 'base');
  return complete
    ? { ok: true, complete: true }
    : { ok: false, complete: false, error: '路线还没有到达基地' };
}

export interface ResolvedRoute {
  path: GridPos[] | null;
  spawn: GridPos | null;
  error?: string;
}

/** 根据路线设置得到最终行走的方块序列 */
export function resolveRoute(grid: TileGrid, route: RouteDef): ResolvedRoute {
  const spawns = grid.find('spawn');
  if (spawns.length === 0) return { path: null, spawn: null, error: '地图上没有敌人出现点' };
  const spawn = route.spawn ?? spawns[0];
  if (!grid.isType(spawn.x, spawn.y, 'spawn')) {
    return { path: null, spawn, error: `出现点 ${formatPos(spawn)} 已不存在` };
  }
  if (route.mode === 'manual') {
    if (route.path.length === 0) return { path: null, spawn, error: '手动路线尚未设置' };
    if (!samePos(route.path[0], spawn)) {
      return { path: null, spawn, error: '手动路线的起点与所选出现点不一致' };
    }
    const check = checkManualPath(grid, route.path);
    return check.ok ? { path: route.path, spawn } : { path: null, spawn, error: check.error };
  }
  if (route.target && !grid.isType(route.target.x, route.target.y, 'base')) {
    return { path: null, spawn, error: `目的地 ${formatPos(route.target)} 不是基地` };
  }
  const path = findPath(grid, spawn, route.target);
  return path ? { path, spawn } : { path: null, spawn, error: '自动寻路失败：出现点无法到达基地' };
}
