import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GridPos } from '../../core/types';
import type { Viewport } from '../../game/renderer';

export interface GridPointer {
  type: 'down' | 'move' | 'up';
  tile: GridPos;
  /** 指针是否在网格范围内 */
  inside: boolean;
  button: number;
  buttons: number;
  shiftKey: boolean;
}

function fitFull(cols: number, rows: number, w: number, h: number, maxCell: number, pad = 16): Viewport {
  const scale = Math.max(6, Math.min((w - pad * 2) / cols, (h - pad * 2) / rows, maxCell));
  return { scale, ox: Math.floor((w - cols * scale) / 2), oy: Math.floor((h - rows * scale) / 2) };
}

/**
 * 编辑器里的网格画布：负责尺寸自适应、坐标换算和指针事件，具体内容由 draw 回调绘制。
 */
export function GridCanvas({
  cols,
  rows,
  draw,
  onPointer,
  onHover,
  cursor = 'crosshair',
  maxCell = 56,
}: {
  cols: number;
  rows: number;
  draw: (ctx: CanvasRenderingContext2D, vp: Viewport) => void;
  onPointer?: (ev: GridPointer) => void;
  onHover?: (tile: GridPos | null) => void;
  cursor?: string;
  maxCell?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400, dpr: 1 });
  const lastTile = useRef<string>('');
  const down = useRef(false);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      setSize({ w: Math.max(50, r.width), h: Math.max(50, r.height), dpr: window.devicePixelRatio || 1 });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const vp = useMemo(() => fitFull(cols, rows, size.w, size.h, maxCell), [cols, rows, size, maxCell]);

  // 每次渲染后重绘（编辑器的数据量很小，直接全部重画）
  useLayoutEffect(() => {
    const cv = canvasRef.current!;
    const W = Math.round(size.w * size.dpr);
    const H = Math.round(size.h * size.dpr);
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.fillStyle = '#0d1118';
    ctx.fillRect(0, 0, size.w, size.h);
    // 空格子的网格线
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) {
      const sx = Math.round(vp.ox + x * vp.scale) + 0.5;
      ctx.moveTo(sx, vp.oy);
      ctx.lineTo(sx, vp.oy + rows * vp.scale);
    }
    for (let y = 0; y <= rows; y++) {
      const sy = Math.round(vp.oy + y * vp.scale) + 0.5;
      ctx.moveTo(vp.ox, sy);
      ctx.lineTo(vp.ox + cols * vp.scale, sy);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeRect(vp.ox + 0.5, vp.oy + 0.5, cols * vp.scale, rows * vp.scale);
    draw(ctx, vp);
  });

  const toTile = (e: React.PointerEvent): { tile: GridPos; inside: boolean } => {
    const r = canvasRef.current!.getBoundingClientRect();
    const tile = { x: Math.floor((e.clientX - r.left - vp.ox) / vp.scale), y: Math.floor((e.clientY - r.top - vp.oy) / vp.scale) };
    return { tile, inside: tile.x >= 0 && tile.y >= 0 && tile.x < cols && tile.y < rows };
  };

  return (
    <div className="grid-canvas" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, cursor }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          const { tile, inside } = toTile(e);
          down.current = true;
          lastTile.current = `${tile.x},${tile.y}`;
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          onPointer?.({ type: 'down', tile, inside, button: e.button, buttons: e.buttons, shiftKey: e.shiftKey });
        }}
        onPointerMove={(e) => {
          const { tile, inside } = toTile(e);
          const key = `${tile.x},${tile.y}`;
          if (key === lastTile.current) return;
          lastTile.current = key;
          onHover?.(inside ? tile : null);
          if (down.current) onPointer?.({ type: 'move', tile, inside, button: e.button, buttons: e.buttons, shiftKey: e.shiftKey });
        }}
        onPointerUp={(e) => {
          if (!down.current) return;
          down.current = false;
          const { tile, inside } = toTile(e);
          onPointer?.({ type: 'up', tile, inside, button: e.button, buttons: e.buttons, shiftKey: e.shiftKey });
        }}
        onPointerLeave={() => {
          if (!down.current) {
            lastTile.current = '';
            onHover?.(null);
          }
        }}
      />
    </div>
  );
}
