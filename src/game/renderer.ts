import { rangeOffsets } from '../core/range';
import { tileInfo, type TileGrid } from '../core/tiles';
import type { CharacterDef, GridPos } from '../core/types';
import type { GameEngine } from './engine';
import { UNIT_RADIUS, enemyRadius, type Combatant } from './entities';
import { getIcon } from './icons';
import { drawCharacterToken, drawEnemyToken, drawHpBar, drawTile, withAlpha } from './shapes';

/** 世界坐标（格）→ 屏幕像素：sx = ox + x * scale */
export interface Viewport {
  scale: number;
  ox: number;
  oy: number;
}

export function fitViewport(grid: TileGrid, width: number, height: number, pad = 24): Viewport {
  const b = grid.bounds() ?? { minX: 0, minY: 0, maxX: grid.width - 1, maxY: grid.height - 1 };
  const w = b.maxX - b.minX + 1;
  const h = b.maxY - b.minY + 1;
  const scale = Math.max(8, Math.min((width - pad * 2) / w, (height - pad * 2) / h, 96));
  return {
    scale,
    ox: (width - w * scale) / 2 - b.minX * scale,
    oy: (height - h * scale) / 2 - b.minY * scale,
  };
}

export function screenToTile(vp: Viewport, sx: number, sy: number): GridPos {
  return { x: Math.floor((sx - vp.ox) / vp.scale), y: Math.floor((sy - vp.oy) / vp.scale) };
}

export function screenToWorld(vp: Viewport, sx: number, sy: number) {
  return { x: (sx - vp.ox) / vp.scale, y: (sy - vp.oy) / vp.scale };
}

export interface BattleView {
  hoverTile: GridPos | null;
  /** 正在部署的角色（已选中卡片） */
  placing: CharacterDef | null;
  selectedUid: number | null;
  showRoutes: boolean;
}

/** 画出所有方块（游戏和编辑器预览都会用到） */
export function drawGrid(ctx: CanvasRenderingContext2D, grid: TileGrid, vp: Viewport, time = 0, skipSpawn = false) {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const t = grid.get(x, y);
      if (!t || (skipSpawn && t.type === 'spawn')) continue;
      drawTile(ctx, t, vp.ox + x * vp.scale, vp.oy + y * vp.scale, vp.scale, time);
    }
  }
}

/** 画一条路线（折线 + 箭头） */
export function drawRoute(
  ctx: CanvasRenderingContext2D,
  path: GridPos[],
  vp: Viewport,
  color: string,
  opt: { alpha?: number; width?: number; offset?: number; dashed?: boolean; numbers?: boolean } = {},
) {
  if (path.length === 0) return;
  const off = (opt.offset ?? 0) * vp.scale;
  const pts = path.map((p) => ({ x: vp.ox + (p.x + 0.5) * vp.scale + off, y: vp.oy + (p.y + 0.5) * vp.scale + off }));
  ctx.save();
  ctx.globalAlpha = opt.alpha ?? 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = opt.width ?? Math.max(2, vp.scale * 0.08);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (opt.dashed) ctx.setLineDash([vp.scale * 0.18, vp.scale * 0.14]);
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);
  // 起点圆点
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pts[0].x, pts[0].y, Math.max(3, vp.scale * 0.1), 0, Math.PI * 2);
  ctx.fill();
  // 终点箭头
  if (pts.length > 1) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const s = Math.max(6, vp.scale * 0.26);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.cos(ang - 0.5) * s, b.y - Math.sin(ang - 0.5) * s);
    ctx.lineTo(b.x - Math.cos(ang + 0.5) * s, b.y - Math.sin(ang + 0.5) * s);
    ctx.closePath();
    ctx.fill();
  }
  if (opt.numbers) {
    ctx.font = `bold ${Math.max(9, Math.round(vp.scale * 0.28))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    pts.forEach((p, i) => {
      const r = Math.max(7, vp.scale * 0.2);
      ctx.fillStyle = 'rgba(10,12,18,0.85)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(String(i + 1), p.x, p.y + 0.5);
    });
  }
  ctx.restore();
}

/** 战斗画面渲染器 */
export class BattleRenderer {
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = '';

  constructor(private engine: GameEngine) {}

  render(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, view: BattleView, clock: number): Viewport {
    const eng = this.engine;
    const vp = fitViewport(eng.grid, width, height);

    // 背景
    ctx.fillStyle = '#121620';
    ctx.fillRect(0, 0, width, height);

    // 静态方块层（缓存）
    const key = `${width}x${height}@${dpr}`;
    if (key !== this.cacheKey || !this.cache) {
      this.cache = document.createElement('canvas');
      this.cache.width = Math.ceil(width * dpr);
      this.cache.height = Math.ceil(height * dpr);
      const c = this.cache.getContext('2d')!;
      c.scale(dpr, dpr);
      drawGrid(c, eng.grid, vp, 0, true);
      this.cacheKey = key;
    }
    ctx.drawImage(this.cache, 0, 0, width, height);
    for (const p of eng.grid.find('spawn')) {
      drawTile(ctx, tileInfo('spawn'), vp.ox + p.x * vp.scale, vp.oy + p.y * vp.scale, vp.scale, clock);
    }

    // 敌人路线
    if (view.showRoutes) {
      eng.routes.forEach((r, i) => {
        const offset = (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 0.07;
        drawRoute(ctx, r.path, vp, r.color, { alpha: 0.4, offset, dashed: true });
      });
    }

    // 部署提示
    if (view.placing) this.drawPlacement(ctx, vp, view.placing, view.hoverTile);

    // 选中角色的攻击范围
    const sel = view.selectedUid != null ? eng.unitByUid(view.selectedUid) : undefined;
    if (sel) this.drawRange(ctx, vp, sel.x, sel.y, sel.stats.range, sel.def.color);

    // 角色
    for (const u of eng.units) {
      const cx = vp.ox + u.x * vp.scale;
      const cy = vp.oy + u.y * vp.scale;
      const r = UNIT_RADIUS * vp.scale * (1 + u.attackAnim * 0.5);
      if (sel === u) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (u.healFlash > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, u.healFlash * 3) * 0.6;
        ctx.strokeStyle = '#5dff9d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 4 + (0.35 - u.healFlash) * 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      drawCharacterToken(ctx, u.def, cx, cy, r, { icon: getIcon(u.def.icon), label: u.def.name.slice(0, 1), flash: u.flash });
      const hpTop = cy - r - Math.max(6, vp.scale * 0.14);
      drawHpBar(ctx, cx, hpTop, vp.scale * 0.7, u.hp / u.stats.maxHp, '#4cd08a');
      this.drawStatusMarks(ctx, u, cx, hpTop, vp.scale * 0.7);
      this.drawSkillBars(ctx, u, cx, cy + r + Math.max(5, vp.scale * 0.1), vp.scale * 0.62, clock);
      if (u.canBlock && u.stats.blockCount > 0) {
        const n = u.stats.blockCount;
        const pr = Math.max(2, vp.scale * 0.045);
        for (let i = 0; i < n; i++) {
          const px = cx + (i - (n - 1) / 2) * pr * 3;
          const py = cy - r - Math.max(6, vp.scale * 0.14) - pr * 2.6;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, Math.PI * 2);
          ctx.fillStyle = i < u.blocked.length ? '#ffcf5a' : 'rgba(255,255,255,0.35)';
          ctx.fill();
        }
      }
    }

    // 敌人
    for (const e of eng.enemies) {
      const cx = vp.ox + e.x * vp.scale;
      const cy = vp.oy + e.y * vp.scale;
      const r = enemyRadius(e.def) * vp.scale * (1 + e.attackAnim * 0.4);
      const fade = Math.min(1, (eng.time - e.spawnedAt) / 0.25);
      if (e.healFlash > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, e.healFlash * 3) * 0.6;
        ctx.strokeStyle = '#5dff9d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      drawEnemyToken(ctx, e.def, cx, cy, r, e.angle, { icon: getIcon(e.def.icon), flash: e.flash, alpha: fade });
      const hpTop = cy - r - Math.max(6, vp.scale * 0.13);
      drawHpBar(ctx, cx, hpTop, vp.scale * 0.6, e.hp / e.stats.maxHp, '#e5484d');
      this.drawStatusMarks(ctx, e, cx, hpTop, vp.scale * 0.6);
      if (e.skills.length) this.drawSkillBars(ctx, e, cx, hpTop - Math.max(4, vp.scale * 0.08), vp.scale * 0.6, clock);
    }

    // 弹道
    for (const p of eng.projectiles) {
      const cx = vp.ox + p.x * vp.scale;
      const cy = vp.oy + p.y * vp.scale;
      const r = Math.max(2.5, p.radius * vp.scale);
      ctx.fillStyle = withAlpha(p.color, 0.35);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawEffects(ctx, vp);
    return vp;
  }

  /** HP 条左侧绿色 ▲ = 有增益，右侧红色 ▼ = 有减益 */
  private drawStatusMarks(ctx: CanvasRenderingContext2D, c: Combatant, cx: number, hpTop: number, w: number) {
    if (!c.statuses.length) return;
    const buff = c.statuses.some((s) => s.hasBuff);
    const debuff = c.statuses.some((s) => s.hasDebuff);
    const s = Math.max(4, w * 0.12);
    const y = hpTop + 2;
    ctx.save();
    if (buff) {
      const x = cx - w / 2 - s - 3;
      ctx.fillStyle = '#5dff9d';
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.5);
      ctx.lineTo(x + s / 2, y - s * 0.5);
      ctx.lineTo(x + s, y + s * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    if (debuff) {
      const x = cx + w / 2 + 3;
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.5);
      ctx.lineTo(x + s / 2, y + s * 0.5);
      ctx.lineTo(x + s, y - s * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** 技能 SP 条：蓝色 = 积累中，金色闪烁 = 可手动释放，橙色 = 持续中 */
  private drawSkillBars(ctx: CanvasRenderingContext2D, c: Combatant, cx: number, top: number, w: number, clock: number) {
    const h = Math.max(2.5, w * 0.07);
    c.skills.slice(0, 3).forEach((s, i) => {
      const y = top + i * (h + 2);
      const x = cx - w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      let ratio: number;
      let color: string;
      if (s.active) {
        ratio = s.def.duration > 0 ? s.remaining / s.def.duration : 0;
        color = '#ff9f43';
      } else {
        ratio = s.def.spMax > 0 ? s.sp / s.def.spMax : 1;
        const ready = ratio >= 1;
        color = ready ? (s.def.trigger === 'manual' && c.side === 'ally' ? `rgba(255,214,102,${0.6 + 0.4 * Math.sin(clock * 8)})` : '#ffd166') : c.side === 'ally' ? '#4dabf7' : '#b197fc';
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), h);
    });
    // 手动技能可以释放时，在角色右上角显示提示
    if (c.side === 'ally' && c.skills.some((s) => !s.active && s.def.trigger === 'manual' && s.sp >= s.def.spMax)) {
      const bx = cx + w / 2 + 2;
      const by = top - w * 0.9;
      ctx.save();
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(6, w * 0.16), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1405';
      ctx.font = `bold ${Math.max(9, Math.round(w * 0.22))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', bx, by + 0.5);
      ctx.restore();
    }
  }

  /** 射程：高亮射程内的方块（只画在地图上有方块的位置） */
  private drawRange(ctx: CanvasRenderingContext2D, vp: Viewport, x: number, y: number, range: number, color: string, alpha = 1) {
    drawRangeTiles(ctx, vp, this.engine.grid, Math.floor(x), Math.floor(y), range, color, alpha);
  }

  private drawPlacement(ctx: CanvasRenderingContext2D, vp: Viewport, def: CharacterDef, hover: GridPos | null) {
    const eng = this.engine;
    const g = eng.grid;
    ctx.save();
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        if (!g.canPlace(x, y, def.placement) || eng.unitAt(x, y)) continue;
        ctx.fillStyle = 'rgba(90, 220, 140, 0.22)';
        ctx.fillRect(vp.ox + x * vp.scale + 2, vp.oy + y * vp.scale + 2, vp.scale - 4, vp.scale - 4);
      }
    }
    if (hover && g.get(hover.x, hover.y)) {
      const err = eng.checkDeploy(def, hover);
      const sx = vp.ox + hover.x * vp.scale;
      const sy = vp.oy + hover.y * vp.scale;
      ctx.lineWidth = 3;
      ctx.strokeStyle = err ? '#ff5a5a' : '#7dffb0';
      ctx.strokeRect(sx + 2, sy + 2, vp.scale - 4, vp.scale - 4);
      if (!err) {
        ctx.restore();
        this.drawRange(ctx, vp, hover.x + 0.5, hover.y + 0.5, def.range, def.color);
        drawCharacterToken(ctx, def, sx + vp.scale / 2, sy + vp.scale / 2, UNIT_RADIUS * vp.scale, {
          icon: getIcon(def.icon),
          label: def.name.slice(0, 1),
          alpha: 0.6,
        });
        return;
      }
    }
    ctx.restore();
  }

  private drawEffects(ctx: CanvasRenderingContext2D, vp: Viewport) {
    for (const fx of this.engine.effects) {
      const k = fx.t / fx.duration;
      const cx = vp.ox + fx.x * vp.scale;
      const cy = vp.oy + fx.y * vp.scale;
      ctx.save();
      switch (fx.kind) {
        case 'hit':
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, vp.scale * (0.1 + k * 0.25), 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'slash': {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = Math.max(2, vp.scale * 0.06);
          const a = (fx.angle ?? 0) + Math.PI / 2;
          const r = vp.scale * 0.32;
          ctx.beginPath();
          ctx.arc(cx, cy, r, a - 0.9 + k * 0.6, a + 0.3 + k * 0.6);
          ctx.stroke();
          break;
        }
        case 'leak':
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(cx, cy, vp.scale * (0.2 + k * 0.9), 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'spawn':
        case 'deploy':
          ctx.globalAlpha = (1 - k) * 0.9;
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, vp.scale * (0.15 + k * 0.45), 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'death':
          ctx.globalAlpha = (1 - k) * 0.8;
          ctx.fillStyle = fx.color;
          ctx.beginPath();
          ctx.arc(cx, cy, vp.scale * (fx.size ?? 0.3) * (1 + k), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'heal': {
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = fx.color;
          const arm = vp.scale * 0.07;
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + fx.x * 3;
            const px = cx + Math.cos(a) * vp.scale * 0.28;
            const py = cy + Math.sin(a) * vp.scale * 0.2 - k * vp.scale * 0.45;
            ctx.fillRect(px - arm, py - arm / 3, arm * 2, (arm * 2) / 3);
            ctx.fillRect(px - arm / 3, py - arm, (arm * 2) / 3, arm * 2);
          }
          break;
        }
        case 'beam':
          ctx.globalAlpha = (1 - k) * 0.8;
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = Math.max(2, vp.scale * 0.06);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(vp.ox + (fx.x2 ?? fx.x) * vp.scale, vp.oy + (fx.y2 ?? fx.y) * vp.scale);
          ctx.stroke();
          break;
        case 'skill': {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(cx, cy, vp.scale * (0.3 + k * 1.1), 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
          ctx.font = `bold ${Math.max(12, Math.round(vp.scale * 0.3))}px "PingFang SC","Microsoft YaHei",sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          const ty = cy - vp.scale * (0.75 + k * 0.3);
          ctx.strokeText(fx.text ?? '', cx, ty);
          ctx.fillStyle = fx.color;
          ctx.fillText(fx.text ?? '', cx, ty);
          break;
        }
        case 'area':
          // 范围伤害：射程内的方块闪一下
          drawRangeTiles(ctx, vp, this.engine.grid, Math.floor(fx.x), Math.floor(fx.y), fx.size ?? 1, fx.color, (1 - k) * 1.4, true);
          break;
        case 'text':
          ctx.globalAlpha = 1 - k * k;
          ctx.fillStyle = fx.color;
          ctx.font = `bold ${Math.max(12, Math.round(vp.scale * 0.32))}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.lineWidth = 3;
          ctx.strokeText(fx.text ?? '', cx, cy - k * vp.scale * 0.5);
          ctx.fillText(fx.text ?? '', cx, cy - k * vp.scale * 0.5);
          break;
      }
      ctx.restore();
    }
  }
}

/** 画出某个方块周围的射程方块（游戏和编辑器预览共用） */
export function drawRangeTiles(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  grid: TileGrid | null,
  cx: number,
  cy: number,
  range: number,
  color: string,
  alpha = 1,
  flash = false,
) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  const pad = Math.max(1.5, vp.scale * 0.05);
  for (const o of rangeOffsets(range)) {
    const tx = cx + o.x;
    const ty = cy + o.y;
    if (grid && !grid.get(tx, ty)) continue;
    const sx = vp.ox + tx * vp.scale;
    const sy = vp.oy + ty * vp.scale;
    ctx.fillStyle = withAlpha(color, flash ? 0.35 : 0.2);
    ctx.fillRect(sx + pad, sy + pad, vp.scale - pad * 2, vp.scale - pad * 2);
    ctx.strokeStyle = withAlpha(color, flash ? 0.9 : 0.75);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx + pad + 0.75, sy + pad + 0.75, vp.scale - pad * 2 - 1.5, vp.scale - pad * 2 - 1.5);
  }
  ctx.restore();
}
