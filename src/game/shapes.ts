import type { TileInfo } from '../core/tiles';
import type { CharacterDef, EnemyDef } from '../core/types';

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

function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, r: number) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return;
  const s = (2 * r) / Math.min(w, h);
  ctx.drawImage(img, cx - (w * s) / 2, cy - (h * s) / 2, w * s, h * s);
}

export interface TokenOptions {
  icon?: HTMLImageElement | null;
  /** 在圆形里显示名称首字（没有图标时） */
  label?: string;
  flash?: number;
  alpha?: number;
}

/** 角色：彩色圆形（或图标） */
export function drawCharacterToken(
  ctx: CanvasRenderingContext2D,
  def: Pick<CharacterDef, 'color'>,
  cx: number,
  cy: number,
  r: number,
  opt: TokenOptions = {},
) {
  ctx.save();
  ctx.globalAlpha = opt.alpha ?? 1;
  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.82, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (opt.icon) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = shade(def.color, -0.5);
    ctx.fill();
    drawImageCover(ctx, opt.icon, cx, cy, r);
    ctx.restore();
  } else {
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, shade(def.color, 0.35));
    g.addColorStop(1, def.color);
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.strokeStyle = shade(def.color, -0.45);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  if (!opt.icon && opt.label) {
    ctx.fillStyle = contrastText(def.color);
    ctx.font = `bold ${Math.round(r * 0.95)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opt.label, cx, cy + r * 0.04);
  }
  if (opt.flash && opt.flash > 0) {
    ctx.globalAlpha = Math.min(1, opt.flash * 6) * 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 敌人：3~6 边形（或图标），一个顶点朝向前进方向 */
export function drawEnemyToken(
  ctx: CanvasRenderingContext2D,
  def: Pick<EnemyDef, 'color' | 'sides'>,
  cx: number,
  cy: number,
  r: number,
  angle: number,
  opt: TokenOptions = {},
) {
  ctx.save();
  ctx.globalAlpha = opt.alpha ?? 1;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.85, r * 0.8, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();

  if (opt.icon) {
    // 图标不旋转，保持正向显示
    polygonPath(ctx, cx, cy, r * 1.08, def.sides, -Math.PI / 2);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = shade(def.color, -0.5);
    ctx.fill();
    drawImageCover(ctx, opt.icon, cx, cy, r);
    ctx.restore();
    polygonPath(ctx, cx, cy, r * 1.08, def.sides, -Math.PI / 2);
  } else {
    polygonPath(ctx, cx, cy, r, def.sides, angle);
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, shade(def.color, 0.3));
    g.addColorStop(1, shade(def.color, -0.15));
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.lineWidth = Math.max(1.5, r * 0.13);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = shade(def.color, -0.55);
  ctx.stroke();

  if (opt.flash && opt.flash > 0) {
    ctx.globalAlpha = Math.min(1, opt.flash * 6) * 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  ctx.restore();
}

export function drawHpBar(ctx: CanvasRenderingContext2D, cx: number, top: number, w: number, ratio: number, color: string) {
  const h = Math.max(3, w * 0.12);
  const x = cx - w / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x - 1, top - 1, w + 2, h + 2);
  ctx.fillStyle = color;
  ctx.fillRect(x, top, w * Math.max(0, Math.min(1, ratio)), h);
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
