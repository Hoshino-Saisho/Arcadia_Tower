import { useEffect, useRef } from 'react';
import { rangeOffsets } from '../../core/range';
import { withAlpha } from '../../game/shapes';

/** 射程示意图：中间实心方块 = 单位所在位置，高亮方块 = 射程内的方块 */
export function RangeGrid({ range, color, cell = 14 }: { range: number; color: string; cell?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = Math.max(1, Math.min(6, Math.ceil(range + 1e-6)));
  const n = r * 2 + 1;
  const size = n * cell;
  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const inRange = new Set(rangeOffsets(range).map((o) => `${o.x},${o.y}`));
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const sx = (x + r) * cell;
        const sy = (y + r) * cell;
        const center = x === 0 && y === 0;
        if (center) ctx.fillStyle = color;
        else if (inRange.has(`${x},${y}`)) ctx.fillStyle = withAlpha(color, 0.35);
        else ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(sx + 1, sy + 1, cell - 2, cell - 2);
        if (!center && inRange.has(`${x},${y}`)) {
          ctx.strokeStyle = withAlpha(color, 0.9);
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 1.5, sy + 1.5, cell - 3, cell - 3);
        }
      }
    }
  }, [range, color, cell, r, size]);
  return <canvas ref={ref} className="range-grid" style={{ width: size, height: size }} title={`射程 ${range} 格（${rangeOffsets(range).length - 1} 个方块）`} />;
}
