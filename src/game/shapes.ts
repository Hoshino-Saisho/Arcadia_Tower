import type { TileInfo } from '../core/tiles';
import type { CharacterDef, EnemyDef, IconPoint } from '../core/types';

/**
 * 共用的绘制函数：游戏画面与编辑器预览都调用这里，
 * 保证“有图标时显示图标，没有图标时显示颜色圆形 / 多边形”的逻辑只有一份。
 */

export function parseColor(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** amount > 0 变亮，< 0 变暗（-1 ~ 1） */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parseColor(hex);
  const f = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = parseColor(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** 深色（例如黑色、深蓝）：在深色的界面上看不清，需要浅色描边 */
export function isDarkColor(hex: string): boolean {
  const [r, g, b] = parseColor(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 < 90;
}

/** 描边颜色：深色文字 / 线条用浅色描边，其他用深色描边 */
export function outlineColor(hex: string): string {
  return isDarkColor(hex) ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)';
}

/** CSS 文字描边（text-shadow）：任何颜色的文字在深色界面上都看得清 */
export function textOutline(hex: string): string {
  if (!isDarkColor(hex)) return '0 1px 2px rgba(0,0,0,0.85), 0 0 1px rgba(0,0,0,0.9)';
  const c = 'rgba(255,255,255,0.85)';
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ]
    .map(([x, y]) => `${x}px ${y}px 0 ${c}`)
    .join(', ');
}

/** 彩色文字的样式（颜色 + 描边） */
export function outlinedText(hex: string): { color: string; textShadow: string } {
  return { color: hex, textShadow: textOutline(hex) };
}

/** 文字颜色：深色背景用白字，浅色背景用黑字 */
export function contrastText(hex: string): string {
  const [r, g, b] = parseColor(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#14181f' : '#ffffff';
}

export function polygonPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, sides: number, rotation: number) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * 图片在方形里的位置（像素）：缩放 1 = 图片短边刚好等于方形的边长；
 * 图片上的中心点 center（宽 / 高比例）对齐到 (cx, cy)。
 */
export function imageBox(img: HTMLImageElement, cx: number, cy: number, side: number, center?: IconPoint | null, zoom?: number | null) {
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const s = (side / Math.min(w, h)) * (zoom && zoom > 0 ? zoom : 1);
  const fx = (center?.x ?? 0.5) * w;
  const fy = (center?.y ?? 0.5) * h;
  return { x: cx - fx * s, y: cy - fy * s, w: w * s, h: h * s };
}

/** 图片的白色剪影（受击闪白用；按图片缓存，最大 512 像素） */
const silhouettes = new WeakMap<HTMLImageElement, HTMLCanvasElement | null>();
function whiteSilhouette(img: HTMLImageElement): HTMLCanvasElement | null {
  if (silhouettes.has(img)) return silhouettes.get(img) ?? null;
  let out: HTMLCanvasElement | null = null;
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w && h && typeof document !== 'undefined') {
      const k = Math.min(1, 512 / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      const g = c.getContext('2d');
      if (g) {
        g.drawImage(img, 0, 0, c.width, c.height);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, c.width, c.height);
        out = c;
      }
    }
  } catch {
    out = null;
  }
  silhouettes.set(img, out);
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * 用图片显示的单位：不裁成圆形，而是以 (cx, cy) 为中心、边长 side 的方形（地图上是 3×3 格）。
 * 受击时图片的形状整体闪白，外面有一圈白光，并且稍微变大一下。
 */
export function drawImageToken(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  def: Pick<CharacterDef, 'iconCenter' | 'iconZoom'>,
  cx: number,
  cy: number,
  side: number,
  opt: { flash?: number; alpha?: number } = {},
) {
  const f = clamp01(opt.flash ?? 0);
  const alpha = opt.alpha ?? 1;
  const s = side * (1 + 0.06 * f);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.rect(cx - s / 2, cy - s / 2, s, s);
  ctx.clip();
  const b = imageBox(img, cx, cy, s, def.iconCenter, def.iconZoom);
  const white = f > 0 ? whiteSilhouette(img) : null;
  if (white) {
    // 白光：模糊的白色剪影垫在图片下面
    ctx.save();
    ctx.globalAlpha = alpha * 0.9 * f;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = Math.max(6, s * 0.08) * f;
    ctx.drawImage(white, b.x, b.y, b.w, b.h);
    ctx.restore();
  }
  ctx.drawImage(img, b.x, b.y, b.w, b.h);
  if (f > 0) {
    ctx.globalAlpha = alpha * Math.min(1, f * 1.2) * 0.85;
    if (white) ctx.drawImage(white, b.x, b.y, b.w, b.h);
    else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    }
  }
  ctx.restore();
}

/** 形状（圆形 / 多边形）受击：整体闪白 + 向外扩散的白光（path 是已经设置好的形状路径） */
function flashShape(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, f: number, alpha: number) {
  ctx.globalAlpha = alpha * Math.min(1, f * 1.2) * 0.85;
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  const halo = r * (1.15 + 0.6 * (1 - f));
  const g = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, halo);
  g.addColorStop(0, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = alpha * f;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, halo, 0, Math.PI * 2);
  ctx.fill();
}

export interface TokenOptions {
  icon?: HTMLImageElement | null;
  /** 在圆形里显示名称首字（没有图标时） */
  label?: string;
  /** 受击闪白的强度（0~1） */
  flash?: number;
  alpha?: number;
  /** 有图标时图片方形的边长（像素）：地图上 = 3 格；界面里的小图标 = 图标框的大小。没有设置 = 圆形的直径 */
  imageSize?: number;
}

/** 角色：彩色圆形，或者图片（3×3 格的方形） */
export function drawCharacterToken(
  ctx: CanvasRenderingContext2D,
  def: Pick<CharacterDef, 'color' | 'iconCenter' | 'iconZoom'>,
  cx: number,
  cy: number,
  r: number,
  opt: TokenOptions = {},
) {
  if (opt.icon) return drawImageToken(ctx, opt.icon, def, cx, cy, opt.imageSize ?? r * 2, opt);
  const f = clamp01(opt.flash ?? 0);
  const alpha = opt.alpha ?? 1;
  const rr = r * (1 + 0.1 * f);
  ctx.save();
  ctx.globalAlpha = alpha;
  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + rr * 0.82, rr * 0.85, rr * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx - rr * 0.35, cy - rr * 0.35, rr * 0.1, cx, cy, rr);
  g.addColorStop(0, shade(def.color, 0.35));
  g.addColorStop(1, def.color);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, rr * 0.14);
  // 深色的角色用浅色描边，否则在地图上看不清
  ctx.strokeStyle = isDarkColor(def.color) ? 'rgba(235,240,250,0.75)' : shade(def.color, -0.45);
  ctx.stroke();

  if (opt.label) {
    ctx.fillStyle = contrastText(def.color);
    ctx.font = `bold ${Math.round(rr * 0.95)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opt.label, cx, cy + rr * 0.04);
  }
  if (f > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    flashShape(ctx, cx, cy, rr, f, alpha);
  }
  ctx.restore();
}

/** 敌人：3~6 边形（一个顶点朝向前进方向），或者图片（3×3 格的方形，乘以体型） */
export function drawEnemyToken(
  ctx: CanvasRenderingContext2D,
  def: Pick<EnemyDef, 'color' | 'sides' | 'iconCenter' | 'iconZoom'>,
  cx: number,
  cy: number,
  r: number,
  angle: number,
  opt: TokenOptions = {},
) {
  if (opt.icon) return drawImageToken(ctx, opt.icon, def, cx, cy, opt.imageSize ?? r * 2, opt);
  const f = clamp01(opt.flash ?? 0);
  const alpha = opt.alpha ?? 1;
  const rr = r * (1 + 0.1 * f);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + rr * 0.85, rr * 0.8, rr * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();

  polygonPath(ctx, cx, cy, rr, def.sides, angle);
  const g = ctx.createLinearGradient(cx - rr, cy - rr, cx + rr, cy + rr);
  g.addColorStop(0, shade(def.color, 0.3));
  g.addColorStop(1, shade(def.color, -0.15));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, rr * 0.13);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = isDarkColor(def.color) ? 'rgba(235,240,250,0.75)' : shade(def.color, -0.55);
  ctx.stroke();

  if (f > 0) {
    polygonPath(ctx, cx, cy, rr, def.sides, angle);
    flashShape(ctx, cx, cy, rr, f, alpha);
  }
  ctx.restore();
}

/**
 * 血条：trail = 白色的延迟血条（受伤前的血量，过一会儿追上当前血量）；flash = 受击时血条外框闪白（0~1）
 */
export function drawHpBar(ctx: CanvasRenderingContext2D, cx: number, top: number, w: number, ratio: number, color: string, trail = ratio, flash = 0) {
  const h = Math.max(3, w * 0.12);
  const x = cx - w / 2;
  const r = clamp01(ratio);
  const t = Math.max(r, clamp01(trail));
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x - 1, top - 1, w + 2, h + 2);
  if (t > r) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(x + w * r, top, w * (t - r), h);
  }
  ctx.fillStyle = color;
  ctx.fillRect(x, top, w * r, h);
  if (flash > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${0.85 * clamp01(flash)})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 1.75, top - 1.75, w + 3.5, h + 3.5);
    ctx.restore();
  }
}

/** 绘制一个地图方块（游戏与编辑器共用） */
export function drawTile(ctx: CanvasRenderingContext2D, info: TileInfo, x: number, y: number, size: number, time = 0) {
  const gap = Math.max(1, size * 0.04);
  const sx = x + gap / 2;
  const sy = y + gap / 2;
  const s = size - gap;
  switch (info.type) {
    case 'high': {
      const lip = s * 0.12;
      ctx.fillStyle = shade(info.color, -0.45);
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = info.color;
      ctx.fillRect(sx, sy, s, s - lip);
      ctx.fillStyle = shade(info.color, 0.18);
      ctx.fillRect(sx, sy, s, lip * 0.5);
      ctx.strokeStyle = shade(info.color, -0.25);
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + s * 0.12, sy + s * 0.1, s * 0.76, s * 0.66);
      break;
    }
    case 'nodeploy': {
      ctx.fillStyle = info.color;
      ctx.fillRect(sx, sy, s, s);
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, sy, s, s);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = Math.max(1, s * 0.06);
      for (let k = -s; k < s; k += s / 4) {
        ctx.beginPath();
        ctx.moveTo(sx + k, sy + s);
        ctx.lineTo(sx + k + s, sy);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'spawn': {
      ctx.fillStyle = shade(info.color, -0.35);
      ctx.fillRect(sx, sy, s, s);
      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      ctx.strokeStyle = info.color;
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.strokeRect(sx + s * 0.1, sy + s * 0.1, s * 0.8, s * 0.8);
      ctx.fillStyle = withAlpha(info.color, 0.35 + pulse * 0.3);
      ctx.beginPath();
      ctx.moveTo(sx + s * 0.5, sy + s * 0.74);
      ctx.lineTo(sx + s * 0.26, sy + s * 0.34);
      ctx.lineTo(sx + s * 0.74, sy + s * 0.34);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'base': {
      ctx.fillStyle = shade(info.color, -0.35);
      ctx.fillRect(sx, sy, s, s);
      ctx.strokeStyle = info.color;
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.strokeRect(sx + s * 0.1, sy + s * 0.1, s * 0.8, s * 0.8);
      ctx.fillStyle = shade(info.color, 0.25);
      ctx.beginPath();
      ctx.moveTo(sx + s * 0.5, sy + s * 0.22);
      ctx.lineTo(sx + s * 0.78, sy + s * 0.46);
      ctx.lineTo(sx + s * 0.7, sy + s * 0.46);
      ctx.lineTo(sx + s * 0.7, sy + s * 0.76);
      ctx.lineTo(sx + s * 0.3, sy + s * 0.76);
      ctx.lineTo(sx + s * 0.3, sy + s * 0.46);
      ctx.lineTo(sx + s * 0.22, sy + s * 0.46);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default: {
      ctx.fillStyle = info.color;
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(sx, sy, s, s * 0.08);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(sx, sy + s * 0.92, s, s * 0.08);
    }
  }
}
