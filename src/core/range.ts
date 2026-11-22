import type { GridPos } from './types';

/**
 * 射程按方块计算（和地图的地块一样）：
 * 以单位所在的方块为中心，方块中心之间的距离不超过射程的方块都在射程内。
 * 例如射程 1 = 上下左右 + 自身（十字），1.5 = 3×3，2 = 13 格，2.5 = 5×5 去掉四角。
 * 目标是否在射程内，看它的中心点现在站在哪个方块上。
 */
export function tileOf(p: { x: number; y: number }): GridPos {
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

export function tileInRange(from: GridPos, to: GridPos, range: number): boolean {
  if (range < 0) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx * dx + dy * dy <= range * range + 1e-6;
}

/** 射程覆盖的方块（相对于中心方块的偏移） */
export function rangeOffsets(range: number): GridPos[] {
  const out: GridPos[] = [];
  if (range < 0) return out;
  const r = Math.floor(range + 1e-6);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= range * range + 1e-6) out.push({ x: dx, y: dy });
    }
  }
  return out;
}
