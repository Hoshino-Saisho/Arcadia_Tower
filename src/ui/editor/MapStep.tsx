import { useEffect, useMemo, useRef, useState } from 'react';
import { findPath } from '../../core/pathfinding';
import {
  EMPTY_CODE,
  TILE_TYPES,
  TileGrid,
  formatPos,
  getCode,
  resizeGrid,
  setCode,
  shiftGrid,
  tileFromCode,
} from '../../core/tiles';
import type { CharacterDef, GridPos, LevelDef, LevelSettings } from '../../core/types';
import { drawGrid } from '../../game/renderer';
import { drawTile } from '../../game/shapes';
import { Checkbox, Field, NumberInput, TextInput } from '../common/fields';
import { toast } from '../common/toast';
import { UnitToken } from '../common/tokens';
import { MusicSelect, useMusicTracks } from './effectEditors';
import { GridCanvas, type GridPointer } from './GridCanvas';
import type { ApplyFn } from './LevelEditor';

type Tool = 'brush' | 'rect';

/** 地图问题检查：至少 1 个出现点和 1 个基地，出现点要能走到基地 */
export function mapProblems(level: LevelDef): { errors: string[]; warnings: string[] } {
  const grid = TileGrid.fromLevel(level);
  const spawns = grid.find('spawn');
  const bases = grid.find('base');
  const errors: string[] = [];
  const warnings: string[] = [];
  if (spawns.length === 0) errors.push('地图上至少需要 1 个「敌人出现点」');
  if (bases.length === 0) errors.push('地图上至少需要 1 个「敌人目的地（基地）」');
  if (spawns.length && bases.length) {
    for (const s of spawns) if (!findPath(grid, s, null)) warnings.push(`出现点 ${formatPos(s)} 无法沿可行走方块到达任何基地`);
  }
  const deployable = TILE_TYPES.filter((t) => t.deploy).map((t) => t.code);
  if (!level.grid.some((row) => [...row].some((c) => deployable.includes(c)))) warnings.push('地图上没有可以放置角色的方块（地面 / 高台）');
  return { errors, warnings };
}

/** 平移地图时同时平移敌人路线中的坐标 */
function shiftLevel(lv: LevelDef, dx: number, dy: number): LevelDef {
  const mv = (p: GridPos | null) => (p ? { x: p.x + dx, y: p.y + dy } : null);
  return {
    ...lv,
    grid: shiftGrid(lv.grid, dx, dy),
    lines: lv.lines.map((l) => ({
      ...l,
      route: { ...l.route, spawn: mv(l.route.spawn), target: mv(l.route.target), path: l.route.path.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
    })),
  };
}

export function MapStep({
  level,
  characters,
  apply,
  onConfirm,
}: {
  level: LevelDef;
  characters: CharacterDef[];
  apply: ApplyFn;
  onConfirm: () => void;
}) {
  const [tool, setTool] = useState<Tool>('brush');
  const [brush, setBrush] = useState<string>('G');
  const [hover, setHover] = useState<GridPos | null>(null);
  const [rect, setRectState] = useState<{ a: GridPos; b: GridPos; code: string } | null>(null);
  const rectRef = useRef(rect);
  const setRect = (r: typeof rect) => {
    rectRef.current = r;
    setRectState(r);
  };
  /** 当前笔划：使用的方块 + 上一个画过的格子（null = 没有在画） */
  const strokeRef = useRef<{ code: string; last: GridPos } | null>(null);

  const grid = useMemo(() => TileGrid.fromLevel(level), [level]);
  const tracks = useMusicTracks();
  const problems = useMemo(() => mapProblems(level), [level]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of level.grid) for (const c of row) if (c !== EMPTY_CODE) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  }, [level.grid]);

  // 快捷键：1~5 选择积木，0/E 橡皮擦，B 画笔，R 矩形
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || e.ctrlKey || e.metaKey) return;
      const t = TILE_TYPES.find((t) => t.hotkey === e.key);
      if (t) setBrush(t.code);
      else if (e.key === '0' || e.key.toLowerCase() === 'e') setBrush(EMPTY_CODE);
      else if (e.key.toLowerCase() === 'b') setTool('brush');
      else if (e.key.toLowerCase() === 'r') setTool('rect');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const paint = (cells: GridPos[], code: string, mode: 'push' | 'replace') => {
    apply((lv) => {
      let g = lv.grid;
      for (const p of cells) g = setCode(g, p.x, p.y, code);
      if (g === lv.grid) return mode === 'push' ? { ...lv } : lv;
      return { ...lv, grid: g };
    }, mode);
  };

  const onPointer = (ev: GridPointer) => {
    const erase = ev.button === 2 || (ev.buttons & 2) === 2;
    if (tool === 'rect') {
      const cur = rectRef.current;
      if (ev.type === 'down' && ev.inside) setRect({ a: ev.tile, b: ev.tile, code: erase ? EMPTY_CODE : brush });
      else if (ev.type === 'move' && cur) setRect({ ...cur, b: clampTile(ev.tile, level) });
      else if (ev.type === 'up' && cur) {
        const r = cur;
        setRect(null);
        apply((lv) => {
          let g = lv.grid;
          for (let y = Math.min(r.a.y, r.b.y); y <= Math.max(r.a.y, r.b.y); y++)
            for (let x = Math.min(r.a.x, r.b.x); x <= Math.max(r.a.x, r.b.x); x++) g = setCode(g, x, y, r.code);
          return { ...lv, grid: g };
        }, 'push');
      }
      return;
    }
    if (ev.type === 'down' && ev.inside) {
      const code = erase ? EMPTY_CODE : brush;
      strokeRef.current = { code, last: ev.tile };
      paint([ev.tile], code, 'push');
    } else if (ev.type === 'move' && strokeRef.current) {
      // 鼠标移动很快时补齐中间跳过的格子
      const st = strokeRef.current;
      const target = clampTile(ev.tile, level);
      paint(lineCells(st.last, target), st.code, 'replace');
      st.last = target;
    } else if (ev.type === 'up') {
      strokeRef.current = null;
    }
  };

  const draw = (ctx: CanvasRenderingContext2D, vp: { scale: number; ox: number; oy: number }) => {
    drawGrid(ctx, grid, vp);
    // 坐标刻度
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${Math.max(9, Math.min(12, vp.scale * 0.3))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let x = 0; x < level.width; x++) ctx.fillText(String(x), vp.ox + (x + 0.5) * vp.scale, vp.oy - 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < level.height; y++) ctx.fillText(String(y), vp.ox - 4, vp.oy + (y + 0.5) * vp.scale);

    const preview = (x: number, y: number, code: string) => {
      const sx = vp.ox + x * vp.scale;
      const sy = vp.oy + y * vp.scale;
      const info = tileFromCode(code);
      ctx.save();
      ctx.globalAlpha = 0.6;
      if (info) drawTile(ctx, info, sx, sy, vp.scale);
      else {
        ctx.fillStyle = 'rgba(255,80,80,0.35)';
        ctx.fillRect(sx, sy, vp.scale, vp.scale);
      }
      ctx.restore();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx + 1, sy + 1, vp.scale - 2, vp.scale - 2);
    };
    if (rect) {
      for (let y = Math.min(rect.a.y, rect.b.y); y <= Math.max(rect.a.y, rect.b.y); y++)
        for (let x = Math.min(rect.a.x, rect.b.x); x <= Math.max(rect.a.x, rect.b.x); x++) preview(x, y, rect.code);
    } else if (hover) {
      preview(hover.x, hover.y, brush);
    }
  };

  const setSettings = (patch: Partial<LevelSettings>) => apply((lv) => ({ ...lv, settings: { ...lv.settings, ...patch } }), 'push');
  const s = level.settings;
  const allChars = s.availableCharacters.length === 0;
  const hoverInfo = hover ? tileFromCode(getCode(level.grid, hover.x, hover.y)) : null;

  return (
    <div className="map-step">
      <aside className="palette">
        <div className="panel-head">地图积木</div>
        <div className="palette-items">
          {TILE_TYPES.map((t) => (
            <button key={t.code} className={`palette-item${brush === t.code ? ' active' : ''}`} onClick={() => setBrush(t.code)} title={t.hint}>
              <TileSwatch code={t.code} />
              <span className="palette-text">
                <strong>{t.label}</strong>
                <small>{t.hint}</small>
              </span>
              <kbd>{t.hotkey}</kbd>
            </button>
          ))}
          <button className={`palette-item${brush === EMPTY_CODE ? ' active' : ''}`} onClick={() => setBrush(EMPTY_CODE)} title="擦除方块">
            <span className="tile-swatch eraser">✕</span>
            <span className="palette-text">
              <strong>橡皮擦</strong>
              <small>清除方块（也可以按住右键拖动）</small>
            </span>
            <kbd>0</kbd>
          </button>
        </div>

        <div className="panel-head">工具</div>
        <div className="segmented full">
          <button className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')}>
            画笔 <kbd>B</kbd>
          </button>
          <button className={tool === 'rect' ? 'active' : ''} onClick={() => setTool('rect')}>
            矩形 <kbd>R</kbd>
          </button>
        </div>

        <div className="panel-head">网格尺寸</div>
        <div className="row gap-s">
          <NumberInput value={level.width} min={3} max={40} integer width={64} onChange={(w) => apply((lv) => ({ ...lv, width: w, grid: resizeGrid(lv.grid, w, lv.height) }), 'push')} />
          <span className="muted">×</span>
          <NumberInput value={level.height} min={3} max={30} integer width={64} onChange={(h) => apply((lv) => ({ ...lv, height: h, grid: resizeGrid(lv.grid, lv.width, h) }), 'push')} />
        </div>
        <div className="panel-head">整体平移</div>
        <div className="shift-pad">
          <span />
          <button className="btn btn-s" onClick={() => apply((lv) => shiftLevel(lv, 0, -1), 'push')}>↑</button>
          <span />
          <button className="btn btn-s" onClick={() => apply((lv) => shiftLevel(lv, -1, 0), 'push')}>←</button>
          <button
            className="btn btn-s btn-danger"
            title="清空全部方块"
            onClick={() => window.confirm('清空全部方块？') && apply((lv) => ({ ...lv, grid: lv.grid.map((r) => EMPTY_CODE.repeat(r.length)) }), 'push')}
          >
            清空
          </button>
          <button className="btn btn-s" onClick={() => apply((lv) => shiftLevel(lv, 1, 0), 'push')}>→</button>
          <span />
          <button className="btn btn-s" onClick={() => apply((lv) => shiftLevel(lv, 0, 1), 'push')}>↓</button>
          <span />
        </div>
        <div className="muted small help-text">左键放置，右键擦除，可按住拖动连续绘制。Ctrl+Z 撤销，Ctrl+Shift+Z 重做。</div>
      </aside>

      <section className="map-center">
        <GridCanvas cols={level.width} rows={level.height} draw={draw} onPointer={onPointer} onHover={setHover} />
        <div className="map-status">
          <span className="mono">{hover ? `(${hover.x}, ${hover.y}) ${hoverInfo ? hoverInfo.label : '空'}` : '—'}</span>
          <span className="grow" />
          {TILE_TYPES.map((t) => (
            <span key={t.code} className="count-chip">
              <TileSwatch code={t.code} small />
              {counts.get(t.code) ?? 0}
            </span>
          ))}
        </div>
      </section>

      <aside className="level-settings">
        <div className="panel-head">关卡设置</div>
        <div className="form-grid single">
          <Field label="关卡名称">
            <TextInput value={s.name} maxLength={30} onChange={(v) => setSettings({ name: v })} />
          </Field>
          <Field label="玩家初始血量" hint="每个敌人进入基地扣 1 点">
            <NumberInput value={s.initialHp} min={1} max={9999} integer onChange={(v) => setSettings({ initialHp: v })} />
          </Field>
          <Field label="初始金钱">
            <NumberInput value={s.initialMoney} min={0} max={999999} integer onChange={(v) => setSettings({ initialMoney: v })} />
          </Field>
          <Field label="金钱回复">
            <Checkbox checked={s.autoMoney} onChange={(v) => setSettings({ autoMoney: v })} label="自动回复金钱" />
          </Field>
          <Field label="每分钟恢复数量">
            <NumberInput value={s.moneyPerMinute} min={0} max={99999} step={1} disabled={!s.autoMoney} onChange={(v) => setSettings({ moneyPerMinute: v })} />
          </Field>
          <Field label="战斗音乐" hint="默认跟随章节">
            <MusicSelect kind="battle" value={s.battleMusic} tracks={tracks.battle} emptyLabel="跟随章节设置" onChange={(v) => setSettings({ battleMusic: v })} />
          </Field>
          <Field label="可用角色">
            <Checkbox
              checked={allChars}
              onChange={(v) => setSettings({ availableCharacters: v ? [] : characters.map((c) => c.id) })}
              label="全部角色可用"
            />
            {!allChars && (
              <div className="roster-list">
                {characters.map((c) => {
                  const on = s.availableCharacters.includes(c.id);
                  return (
                    <label key={c.id} className={`roster-item${on ? ' on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setSettings({
                            availableCharacters: e.target.checked
                              ? characters.filter((x) => x.id === c.id || s.availableCharacters.includes(x.id)).map((x) => x.id)
                              : s.availableCharacters.filter((id) => id !== c.id),
                          })
                        }
                      />
                      <UnitToken kind="character" def={c} size={22} />
                      <span>{c.name}</span>
                      <span className="muted small mono">{c.id}</span>
                    </label>
                  );
                })}
                {s.availableCharacters.filter((id) => !characters.some((c) => c.id === id)).map((id) => (
                  <span key={id} className="field-error">
                    未知角色 {id}
                  </span>
                ))}
              </div>
            )}
          </Field>
        </div>

        <div className="panel-head">地图检查</div>
        <ul className="check-list">
          {problems.errors.map((e) => (
            <li key={e} className="err">
              ✗ {e}
            </li>
          ))}
          {problems.warnings.map((w) => (
            <li key={w} className="warn">
              ⚠ {w}
            </li>
          ))}
          {!problems.errors.length && !problems.warnings.length && <li className="ok">✓ 地图可用</li>}
        </ul>
        <button
          className="btn btn-primary btn-block"
          onClick={() => {
            if (problems.errors.length) return toast(problems.errors[0], 'error');
            onConfirm();
          }}
        >
          确认地图 → 敌人路线规划
        </button>
      </aside>
    </div>
  );
}

/** 两个格子之间的直线经过的格子（Bresenham） */
function lineCells(a: GridPos, b: GridPos): GridPos[] {
  const out: GridPos[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 400; guard++) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

function clampTile(p: GridPos, lv: LevelDef): GridPos {
  return { x: Math.max(0, Math.min(lv.width - 1, p.x)), y: Math.max(0, Math.min(lv.height - 1, p.y)) };
}

/** 积木面板中的方块样式小图 */
export function TileSwatch({ code, small }: { code: string; small?: boolean }) {
  const size = small ? 14 : 30;
  return (
    <canvas
      className="tile-swatch"
      width={size * 2}
      height={size * 2}
      style={{ width: size, height: size }}
      ref={(cv) => {
        if (!cv) return;
        const ctx = cv.getContext('2d')!;
        const info = tileFromCode(code);
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        ctx.clearRect(0, 0, size, size);
        if (info) drawTile(ctx, info, 0, 0, size, 0);
      }}
    />
  );
}
