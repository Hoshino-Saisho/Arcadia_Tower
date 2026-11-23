import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { ICON_ZOOM_MAX, ICON_ZOOM_MIN, iconPoint, iconZoom } from '../../core/defaults';
import type { CharacterDef, EnemyDef, IconPoint } from '../../core/types';
import { useIcon } from '../../game/icons';
import { drawCharacterToken, drawEnemyToken } from '../../game/shapes';

const BOX = 220;

export interface IconFramePatch {
  iconCenter?: IconPoint;
  iconZoom?: number;
}

/**
 * 图标取景：在图片上点击 / 拖动选择中心点（对齐到圆形 / 多边形的中心），滑块调整缩放。
 * 图片上圈出的区域就是游戏中显示的部分，右侧是实时预览（和游戏中的绘制完全一致）。
 */
export function IconFramer({
  kind,
  def,
  onChange,
}: {
  kind: 'character' | 'enemy';
  def: CharacterDef | EnemyDef;
  onChange: (patch: IconFramePatch) => void;
}) {
  const img = useIcon(def.icon);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const maskId = useId();

  if (!def.icon) return null;
  if (!img) return <div className="icon-framer-loading muted small">图标加载中…</div>;

  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const fit = Math.min(BOX / w, BOX / h);
  const center = def.iconCenter ?? { x: 0.5, y: 0.5 };
  const zoom = def.iconZoom ?? 1;
  // 游戏中显示的区域（图片像素）：圆形半径 = 短边 / 2 / 缩放；敌人的多边形比圆形大 8%
  const radius = (Math.min(w, h) / 2 / zoom) * (kind === 'enemy' ? 1.08 : 1);
  const cx = center.x * w;
  const cy = center.y * h;
  const sides = kind === 'enemy' ? (def as EnemyDef).sides : 0;
  const shapePoints = sides
    ? Array.from({ length: sides }, (_, i) => {
        const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
        return `${cx + Math.cos(a) * radius},${cy + Math.sin(a) * radius}`;
      }).join(' ')
    : '';
  const stroke = Math.max(w, h) / 160;

  const setCenter = (p: IconPoint) => onChange({ iconCenter: iconPoint(p) });
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = boxRef.current!.getBoundingClientRect();
    setCenter({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.shiftKey ? 0.05 : 0.01;
    const move: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
    const m = move[e.key];
    if (!m) return;
    e.preventDefault();
    setCenter({ x: center.x + m[0], y: center.y + m[1] });
  };

  return (
    <div className="icon-framer">
      <div className="icon-framer-main">
        <div
          ref={boxRef}
          className="icon-framer-box"
          style={{ width: w * fit, height: h * fit }}
          tabIndex={0}
          title="点击或拖动选择中心点（方向键微调，按住 Shift 移动更多）"
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => dragging.current && fromPointer(e)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          onKeyDown={onKey}
        >
          <img src={img.src} alt="" draggable={false} />
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
            <defs>
              <mask id={maskId}>
                <rect x={0} y={0} width={w} height={h} fill="white" />
                {sides ? <polygon points={shapePoints} fill="black" /> : <circle cx={cx} cy={cy} r={radius} fill="black" />}
              </mask>
            </defs>
            <rect x={0} y={0} width={w} height={h} fill="rgba(8,10,16,0.62)" mask={`url(#${maskId})`} />
            {sides ? (
              <polygon points={shapePoints} fill="none" stroke="#ffffff" strokeWidth={stroke} strokeLinejoin="round" />
            ) : (
              <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#ffffff" strokeWidth={stroke} />
            )}
            <line x1={cx - radius * 0.22} y1={cy} x2={cx + radius * 0.22} y2={cy} stroke="#ffd166" strokeWidth={stroke} />
            <line x1={cx} y1={cy - radius * 0.22} x2={cx} y2={cy + radius * 0.22} stroke="#ffd166" strokeWidth={stroke} />
            <circle cx={cx} cy={cy} r={stroke * 2.2} fill="#ffd166" />
          </svg>
        </div>
        <div className="icon-framer-side">
          <div className="icon-framer-previews">
            <FramedToken kind={kind} def={def} img={img} size={84} />
            <FramedToken kind={kind} def={def} img={img} size={36} />
          </div>
          <label className="icon-framer-zoom">
            <span className="field-label">
              缩放 <span className="mono">{zoom.toFixed(2)}×</span>
            </span>
            <input
              type="range"
              min={ICON_ZOOM_MIN}
              max={ICON_ZOOM_MAX}
              step={0.05}
              value={zoom}
              onChange={(e) => onChange({ iconZoom: iconZoom(Number(e.target.value)) })}
            />
          </label>
          <div className="muted small mono">
            中心 {Math.round(center.x * 100)}% · {Math.round(center.y * 100)}%
          </div>
          <button
            type="button"
            className="btn btn-s btn-ghost"
            disabled={!def.iconCenter && !def.iconZoom}
            onClick={() => onChange({ iconCenter: undefined, iconZoom: undefined })}
          >
            重置（居中 · 1×）
          </button>
        </div>
      </div>
      <div className="muted small">在图片上点击或拖动，选择对齐到{kind === 'enemy' ? '多边形' : '圆形'}中心的位置；框内就是游戏中显示的部分。</div>
    </div>
  );
}

/** 用游戏的绘制函数画出取景后的效果 */
function FramedToken({ kind, def, img, size }: { kind: 'character' | 'enemy'; def: CharacterDef | EnemyDef; img: HTMLImageElement; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (kind === 'character') drawCharacterToken(ctx, def as CharacterDef, size / 2, size / 2 - size * 0.04, size * 0.38, { icon: img });
    else drawEnemyToken(ctx, def as EnemyDef, size / 2, size / 2, size * 0.36, -Math.PI / 2, { icon: img });
  }, [kind, def, img, size]);
  return <canvas ref={ref} className="unit-token" style={{ width: size, height: size }} title={size > 50 ? '预览' : '游戏中的大小'} />;
}
