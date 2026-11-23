import { useMemo, useState } from 'react';
import { DEFAULT_WAIT, LINE_COLORS, blockDuration, newLine } from '../../core/defaults';
import { shortUid } from '../../core/ids';
import { connectTiles, findPath, isAdjacent, resolveRoute, stepOfVisit, type ResolvedRoute } from '../../core/pathfinding';
import { TileGrid, formatPos, samePos } from '../../core/tiles';
import type { EnemyDef, EnemyLine, GridPos, LevelDef, RouteDef, RouteWait, SpawnBlock } from '../../core/types';
import { drawGrid, drawRoute, type Viewport, type WaitMark } from '../../game/renderer';
import { Field, NumberInput, Segmented, TextInput } from '../common/fields';
import { toast } from '../common/toast';
import { UnitToken } from '../common/tokens';
import { GridCanvas, type GridPointer } from './GridCanvas';
import type { ApplyFn } from './LevelEditor';
import { Timeline, cloneLine } from './Timeline';

/** 每条敌人线自己的路线修改记录（撤回 / 取消撤回），保存在关卡编辑器里，切换步骤不会丢失 */
export type RouteHistory = Map<string, { past: RouteDef[]; future: RouteDef[] }>;

type Tool = 'path' | 'wait';

/**
 * 敌人路线规划：上方地图显示 / 编辑路线，下方时间线安排敌人出现时间。
 *  - 自动寻路：程序在地图上找到出现点 → 基地的最短路线
 *  - 手动设置：在地图上逐个点击相连的方块，设定路线和顺序（可以重复经过同一个方块，例如转圈）
 *  - 停留点：在路线上的方块设置停留时间，敌人走到那里会停下来
 */
export function RouteStep({
  level,
  enemies,
  apply,
  onBack,
  routeHistory,
}: {
  level: LevelDef;
  enemies: EnemyDef[];
  apply: ApplyFn;
  onBack: () => void;
  routeHistory: RouteHistory;
}) {
  const grid = useMemo(() => TileGrid.fromLevel(level), [level.grid, level.width, level.height]);
  const spawns = useMemo(() => grid.find('spawn'), [grid]);
  const bases = useMemo(() => grid.find('base'), [grid]);
  const [sel, setSel] = useState<{ line: string | null; block: string | null }>({ line: level.lines[0]?.id ?? null, block: null });
  const [hover, setHover] = useState<GridPos | null>(null);
  const [tool, setTool] = useState<Tool>('path');
  /** 停留点工具中选中的方块 */
  const [selWait, setSelWait] = useState<GridPos | null>(null);

  const resolved = useMemo(() => {
    const m = new Map<string, ResolvedRoute>();
    for (const l of level.lines) m.set(l.id, resolveRoute(grid, l.route));
    return m;
  }, [level.lines, grid]);
  const routeOk = useMemo(() => {
    const m = new Map<string, { ok: boolean; text: string }>();
    for (const l of level.lines) {
      const r = resolved.get(l.id)!;
      m.set(l.id, r.path ? { ok: true, text: `路线有效，共 ${r.path.length} 格` } : { ok: false, text: r.error ?? '路线无效' });
    }
    return m;
  }, [level.lines, resolved]);

  const line = level.lines.find((l) => l.id === sel.line) ?? null;
  const block = line?.blocks.find((b) => b.id === sel.block) ?? null;
  const lineRoute = line ? resolved.get(line.id)! : null;

  /** 当前线实际行走的方块：手动路线用正在设置的方块（还没到达基地时也可以设置停留点），自动寻路用寻路结果 */
  const effPath: GridPos[] = line ? (line.route.mode === 'manual' ? line.route.path : lineRoute?.path ?? []) : [];

  const applyLines = (fn: (lines: EnemyLine[]) => EnemyLine[], mode: 'push' | 'replace') => apply((lv) => ({ ...lv, lines: fn(lv.lines) }), mode);
  const setLine = (patch: Partial<EnemyLine>) => line && applyLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, ...patch } : l)), 'push');

  /* ---------- 路线修改：每次修改都记录下来，可以撤回 / 取消撤回 ---------- */
  const histOf = (id: string) => {
    let h = routeHistory.get(id);
    if (!h) routeHistory.set(id, (h = { past: [], future: [] }));
    return h;
  };
  const hist = line ? histOf(line.id) : null;
  const setRoute = (patch: Partial<RouteDef>) => {
    if (!line) return;
    const h = histOf(line.id);
    h.past.push(line.route);
    if (h.past.length > 300) h.past.shift();
    h.future = [];
    setLine({ route: { ...line.route, ...patch } });
  };
  const undoRoute = () => {
    const prev = line && hist?.past.pop();
    if (!line || !hist || !prev) return;
    hist.future.push(line.route);
    setLine({ route: prev });
  };
  const redoRoute = () => {
    const next = line && hist?.future.pop();
    if (!line || !hist || !next) return;
    hist.past.push(line.route);
    setLine({ route: next });
  };
  const setWaits = (fn: (ws: RouteWait[]) => RouteWait[]) => line && setRoute({ waits: fn(line.route.waits) });
  const setBlock = (patch: Partial<SpawnBlock>) =>
    line &&
    block &&
    applyLines(
      (ls) =>
        ls.map((l) =>
          l.id === line.id ? { ...l, blocks: l.blocks.map((b) => (b.id === block.id ? { ...b, ...patch } : b)).sort((a, b) => a.startTime - b.startTime) } : l,
        ),
      'push',
    );

  const addLine = () => {
    const l = newLine(level.lines.length, spawns[0] ?? null);
    applyLines((ls) => [...ls, l], 'push');
    setSel({ line: l.id, block: null });
  };

  /* ---------- 地图上的点击 ---------- */
  const onPointer = (ev: GridPointer) => {
    if (ev.type !== 'down' || !ev.inside) return;
    if (!line) return toast('请先在下方选择或新建一条敌人线', 'info');
    const p = ev.tile;
    const t = grid.get(p.x, p.y);
    const route = line.route;

    if (tool === 'wait') return onWaitPointer(p, ev.button === 2);

    if (route.mode === 'auto') {
      if (t?.type === 'spawn') setRoute({ spawn: p });
      else if (t?.type === 'base') setRoute({ target: samePos(route.target, p) ? null : p });
      else toast('自动寻路模式：点击出现点选择起点，点击基地选择目的地', 'info');
      return;
    }

    // 手动路线：可以重复经过同一个方块（转圈 / 往返）
    const path = route.path;
    if (ev.button === 2) {
      if (path.length > 1) setRoute({ path: path.slice(0, -1) });
      return;
    }
    const last = path[path.length - 1];
    if (ev.shiftKey && last) {
      // Shift + 点击路线上的方块：从最后一次经过该方块的地方截断
      const idx = path.map((q) => samePos(q, p)).lastIndexOf(true);
      if (idx >= 0 && idx < path.length - 1) setRoute({ path: path.slice(0, idx + 1) });
      else if (idx < 0) toast('Shift + 点击路线上的方块，可以从该处截断', 'info');
      return;
    }
    if (!last || (t?.type === 'spawn' && !isAdjacent(last, p) && !samePos(path[0], p))) {
      // 还没有起点，或点击了另一个不相邻的出现点：从这个出现点重新开始
      if (t?.type !== 'spawn') return toast('手动路线需要从敌人出现点开始，请先点击一个出现点', 'error');
      setRoute({ spawn: p, path: [p] });
      if (last) toast(`已从出现点 ${formatPos(p)} 重新开始（可以「撤回」）`, 'info', 1800);
      return;
    }
    if (grid.isType(last.x, last.y, 'base')) return toast('路线已经到达基地。可以「撤回」或右键删除最后一格后继续', 'info');
    if (samePos(last, p)) return;
    if (!t?.walkable) return toast(`「${t ? t.label : '空白'}」不可行走`, 'error');
    if (isAdjacent(last, p)) {
      setRoute({ path: [...path, p] });
    } else {
      const seg = connectTiles(grid, last, p);
      if (!seg) return toast('无法从路线末端连接到这里', 'error');
      setRoute({ path: [...path, ...seg.slice(1)] });
      toast(`已自动补全 ${seg.length - 1} 格相连的路线`, 'info', 1500);
    }
  };

  /** 停留点工具：点击路线上的方块添加 / 选中停留点，右键删除该方块的停留点 */
  const onWaitPointer = (p: GridPos, right: boolean) => {
    if (!line) return;
    const waitsHere = line.route.waits.filter((w) => samePos(w, p));
    if (right) {
      if (waitsHere.length) setWaits((ws) => ws.filter((w) => !samePos(w, p)));
      setSelWait(null);
      return;
    }
    const visits = effPath.filter((q) => samePos(q, p)).length;
    if (!visits && !waitsHere.length) return toast('停留点只能设置在路线经过的方块上', 'info');
    if (grid.isType(p.x, p.y, 'base')) return toast('基地（终点）不能设置停留点', 'info');
    setSelWait(p);
    if (!waitsHere.length) setWaits((ws) => [...ws, { x: p.x, y: p.y, visit: 1, duration: DEFAULT_WAIT }]);
  };

  /** 停留点按路线顺序排列；不在路线上的排在最后 */
  const waitRows = useMemo(() => {
    if (!line) return [];
    return line.route.waits
      .map((w) => ({ w, step: stepOfVisit(effPath, w.x, w.y, w.visit) }))
      .map((r) => ({ ...r, valid: r.step >= 0 && !grid.isType(r.w.x, r.w.y, 'base') }))
      .sort((a, b) => (a.valid === b.valid ? a.step - b.step || a.w.visit - b.w.visit : a.valid ? -1 : 1));
  }, [line, effPath, grid]);
  const totalWait = waitRows.reduce((sum, r) => sum + (r.valid ? r.w.duration : 0), 0);
  const invalidWaits = waitRows.filter((r) => !r.valid).length;

  const draw = (ctx: CanvasRenderingContext2D, vp: Viewport) => {
    drawGrid(ctx, grid, vp);
    // 出现点 / 基地编号
    const label = (p: GridPos, text: string, color: string) => {
      ctx.font = `bold ${Math.max(10, vp.scale * 0.26)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(vp.ox + p.x * vp.scale + 2, vp.oy + p.y * vp.scale + 2, ctx.measureText(text).width + 6, Math.max(12, vp.scale * 0.3));
      ctx.fillStyle = color;
      ctx.fillText(text, vp.ox + p.x * vp.scale + 5, vp.oy + p.y * vp.scale + 3);
    };
    spawns.forEach((p, i) => label(p, `S${i + 1}`, '#ff9a96'));
    bases.forEach((p, i) => label(p, `B${i + 1}`, '#9cc8ff'));

    // 其他敌人线的路线（淡）
    level.lines.forEach((l, i) => {
      if (l.id === line?.id) return;
      const r = resolved.get(l.id);
      if (r?.path) drawRoute(ctx, r.path, vp, l.color, { alpha: 0.3, offset: ((i % 3) - 1) * 0.08, dashed: true });
    });
    // 当前线
    if (line) {
      const marks: WaitMark[] = waitRows
        .filter((r) => r.valid)
        .map((r) => ({ x: r.w.x, y: r.w.y, duration: r.w.duration, selected: tool === 'wait' && samePos(selWait, r.w) }));
      if (tool === 'wait') {
        // 停留点工具：路线经过的方块淡淡高亮，表示可以点击
        ctx.fillStyle = 'rgba(255,224,138,0.10)';
        for (const q of effPath) ctx.fillRect(vp.ox + q.x * vp.scale + 2, vp.oy + q.y * vp.scale + 2, vp.scale - 4, vp.scale - 4);
      }
      if (line.route.mode === 'manual') {
        const path = line.route.path;
        if (path.length) drawRoute(ctx, path, vp, line.color, { width: Math.max(3, vp.scale * 0.12), numbers: vp.scale >= 22, arrows: true, waits: marks });
        // 可以继续点击的相邻方块（包括已经走过的方块：可以转圈 / 往返）
        const last = path[path.length - 1];
        if (tool === 'path' && last && !grid.isType(last.x, last.y, 'base')) {
          for (const d of [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 },
          ]) {
            const q = { x: last.x + d.x, y: last.y + d.y };
            if (grid.isWalkable(q.x, q.y)) {
              ctx.strokeStyle = path.some((pp) => samePos(pp, q)) ? 'rgba(255,224,138,0.75)' : 'rgba(125,255,176,0.8)';
              ctx.lineWidth = 2;
              ctx.setLineDash([4, 3]);
              ctx.strokeRect(vp.ox + q.x * vp.scale + 3, vp.oy + q.y * vp.scale + 3, vp.scale - 6, vp.scale - 6);
              ctx.setLineDash([]);
            }
          }
        }
      } else if (lineRoute?.path) {
        drawRoute(ctx, lineRoute.path, vp, line.color, { width: Math.max(3, vp.scale * 0.12), arrows: true, waits: marks });
      }
      if (tool === 'wait' && selWait) {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 3;
        ctx.strokeRect(vp.ox + selWait.x * vp.scale + 1.5, vp.oy + selWait.y * vp.scale + 1.5, vp.scale - 3, vp.scale - 3);
      }
      // 起点 / 目的地高亮
      const ring = (p: GridPos | null, color: string) => {
        if (!p) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(vp.ox + p.x * vp.scale + 1.5, vp.oy + p.y * vp.scale + 1.5, vp.scale - 3, vp.scale - 3);
      };
      ring(line.route.spawn ?? spawns[0] ?? null, '#ffffff');
      if (line.route.mode === 'auto') ring(line.route.target, '#ffe08a');
    }
    if (hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vp.ox + hover.x * vp.scale + 1, vp.oy + hover.y * vp.scale + 1, vp.scale - 2, vp.scale - 2);
    }
  };

  const spawnIndex = line ? spawns.findIndex((p) => samePos(p, line.route.spawn ?? spawns[0])) : -1;
  const targetIndex = line?.route.target ? bases.findIndex((p) => samePos(p, line.route.target)) : -1;

  return (
    <div className="route-step">
      <div className="route-top">
        <section className="route-map">
          <div className="route-map-head">
            <button className="btn btn-s btn-ghost" onClick={onBack}>
              ← 返回地图搭建
            </button>
            <Segmented
              value={tool}
              options={[
                { value: 'path', label: '编辑路线', title: '在地图上设置路线' },
                { value: 'wait', label: '⏸ 停留点', title: '点击路线上的方块，设置敌人在那里停留的时间' },
              ]}
              onChange={(v) => {
                setTool(v);
                setSelWait(null);
              }}
            />
            <span className="muted small">
              {!line
                ? '选择或新建一条敌人线'
                : tool === 'wait'
                  ? `停留点「${line.name}」：点击路线经过的方块添加停留点，在右侧设置停留时间；右键删除该方块的停留点`
                  : line.route.mode === 'manual'
                    ? `手动设置「${line.name}」：从出现点开始逐个点击相连的方块直到基地，可以重复经过同一个方块（转圈）；右键删除最后一格，Shift+点击从该处截断`
                    : `自动寻路「${line.name}」：点击出现点选择起点，点击基地指定目的地（再次点击取消，取消后前往最近的基地）`}
            </span>
          </div>
          <GridCanvas cols={level.width} rows={level.height} draw={draw} onPointer={onPointer} onHover={setHover} cursor={line ? (tool === 'wait' ? 'cell' : 'pointer') : 'default'} maxCell={60} />
        </section>

        <aside className="route-props">
          {line ? (
            <>
              <div className="panel-head">
                <span>敌人线</span>
                <span className="color-dot" style={{ background: line.color }} />
              </div>
              <div className="form-grid single">
                <Field label="名称">
                  <TextInput value={line.name} maxLength={24} onChange={(v) => setLine({ name: v })} />
                </Field>
                <Field label="颜色">
                  <div className="swatches">
                    {LINE_COLORS.map((c) => (
                      <button key={c} className={`swatch${c === line.color ? ' active' : ''}`} style={{ background: c }} onClick={() => setLine({ color: c })} />
                    ))}
                  </div>
                </Field>
                <Field label="敌人出现点">
                  <select
                    className="input"
                    value={spawnIndex}
                    onChange={(e) => {
                      const p = spawns[Number(e.target.value)];
                      if (p) setRoute(line.route.mode === 'manual' ? { spawn: p, path: [p] } : { spawn: p });
                    }}
                  >
                    {spawnIndex < 0 && <option value={-1}>（无效：{formatPos(line.route.spawn)}）</option>}
                    {spawns.map((p, i) => (
                      <option key={i} value={i}>
                        S{i + 1} {formatPos(p)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="行动路线">
                  <Segmented
                    value={line.route.mode}
                    options={[
                      { value: 'auto', label: '自动寻路' },
                      { value: 'manual', label: '手动设置' },
                    ]}
                    onChange={(m) => {
                      if (m === 'manual') {
                        const s = line.route.spawn ?? spawns[0] ?? null;
                        const keep = line.route.path.length > 0 && samePos(line.route.path[0], s);
                        setRoute({ mode: 'manual', spawn: s, path: keep ? line.route.path : s ? [s] : [] });
                      } else setRoute({ mode: 'auto' });
                    }}
                  />
                </Field>
                {line.route.mode === 'auto' ? (
                  <Field label="目的地">
                    <select className="input" value={targetIndex} onChange={(e) => setRoute({ target: bases[Number(e.target.value)] ?? null })}>
                      <option value={-1}>最近的基地</option>
                      {bases.map((p, i) => (
                        <option key={i} value={i}>
                          B{i + 1} {formatPos(p)}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="手动路线">
                    <div className="row gap-s wrap">
                      <button className="btn btn-s" disabled={line.route.path.length <= 1} onClick={() => setRoute({ path: line.route.path.slice(0, -1) })} title="和右键点击地图一样">
                        删除最后一格
                      </button>
                      <button className="btn btn-s" disabled={line.route.path.length <= 1} onClick={() => setRoute({ path: line.route.spawn ? [line.route.spawn] : [] })}>
                        清空
                      </button>
                      <button
                        className="btn btn-s"
                        title="以自动寻路的结果作为手动路线的起点，再自行修改"
                        onClick={() => {
                          const s = line.route.spawn ?? spawns[0];
                          const p = s && findPath(grid, s, null);
                          if (p) setRoute({ spawn: s, path: p });
                          else toast('自动寻路失败', 'error');
                        }}
                      >
                        用自动路线填充
                      </button>
                    </div>
                    <span className="field-note">
                      已设置 {line.route.path.length} 格
                      {line.route.path.length > new Set(line.route.path.map((q) => `${q.x},${q.y}`)).size ? '（有重复经过的方块）' : ''}
                    </span>
                  </Field>
                )}
                <Field label="路线修改">
                  <div className="row gap-s">
                    <button className="btn btn-s" disabled={!hist?.past.length} onClick={undoRoute} title="撤回这条线上一次的路线修改（路线、出现点、目的地、停留点）">
                      ↶ 撤回
                    </button>
                    <button className="btn btn-s" disabled={!hist?.future.length} onClick={redoRoute} title="恢复刚才撤回的修改">
                      ↷ 取消撤回
                    </button>
                    <span className="muted small">
                      {hist?.past.length ? `可撤回 ${hist.past.length} 步` : ''}
                    </span>
                  </div>
                </Field>
                <div className={`route-status ${lineRoute?.path ? 'ok' : 'bad'}`}>
                  {lineRoute?.path
                    ? `✓ 路线有效：${lineRoute.path.length} 格，${formatPos(lineRoute.path[0])} → ${formatPos(lineRoute.path[lineRoute.path.length - 1])}${totalWait > 0 ? `，停留共 ${Math.round(totalWait * 100) / 100} 秒` : ''}`
                    : `✗ ${lineRoute?.error}`}
                </div>
              </div>

              <WaitList
                rows={waitRows}
                path={effPath}
                selected={selWait}
                invalidCount={invalidWaits}
                active={tool === 'wait'}
                onActivate={() => setTool('wait')}
                onSelect={(p) => {
                  setTool('wait');
                  setSelWait(p);
                }}
                onChange={(w, duration) => setWaits((ws) => ws.map((x) => (x === w ? { ...x, duration } : x)))}
                onAdd={(p, visit) => setWaits((ws) => [...ws, { x: p.x, y: p.y, visit, duration: DEFAULT_WAIT }])}
                onRemove={(w) => setWaits((ws) => ws.filter((x) => x !== w))}
              />

              {block ? (
                <BlockProps
                  block={block}
                  enemies={enemies}
                  pathLength={lineRoute?.path?.length ?? 0}
                  totalWait={lineRoute?.waits?.total ?? 0}
                  onChange={setBlock}
                  onDuplicate={() => {
                    const b = { ...block, id: shortUid('B'), startTime: block.startTime + blockDuration(block) + Math.max(1, block.interval) };
                    applyLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, blocks: [...l.blocks, b].sort((x, y) => x.startTime - y.startTime) } : l)), 'push');
                    setSel({ line: line.id, block: b.id });
                  }}
                  onDelete={() => {
                    applyLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, blocks: l.blocks.filter((b) => b.id !== block.id) } : l)), 'push');
                    setSel({ line: line.id, block: null });
                  }}
                />
              ) : (
                <div className="muted small help-text">在下方时间线中点击积木可编辑敌人类型、数量、生成间隔和开始时间。把积木库里的敌人拖到某条线上即可新建积木。</div>
              )}
            </>
          ) : (
            <div className="empty-hint">
              还没有选择敌人线
              <button className="btn btn-primary" onClick={addLine}>
                + 新建敌人线
              </button>
            </div>
          )}
        </aside>
      </div>

      <Timeline
        lines={level.lines}
        enemies={enemies}
        selLine={sel.line}
        selBlock={sel.block}
        onSelect={(l, b) => setSel({ line: l, block: b })}
        apply={applyLines}
        routeOk={routeOk}
        onAddLine={addLine}
        onDuplicateLine={(id) => {
          const src = level.lines.find((l) => l.id === id);
          if (!src) return;
          const copy = cloneLine(src, `${src.name} 副本`, LINE_COLORS[level.lines.length % LINE_COLORS.length]);
          applyLines((ls) => [...ls, copy], 'push');
          setSel({ line: copy.id, block: null });
        }}
        onDeleteLine={(id) => {
          const l = level.lines.find((x) => x.id === id);
          if (!l || !window.confirm(`删除敌人线「${l.name}」及其中的 ${l.blocks.length} 块积木？`)) return;
          applyLines((ls) => ls.filter((x) => x.id !== id), 'push');
          if (sel.line === id) setSel({ line: null, block: null });
        }}
      />
    </div>
  );
}

function BlockProps({
  block,
  enemies,
  pathLength,
  totalWait,
  onChange,
  onDuplicate,
  onDelete,
}: {
  block: SpawnBlock;
  enemies: EnemyDef[];
  pathLength: number;
  totalWait: number;
  onChange: (p: Partial<SpawnBlock>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const e = enemies.find((x) => x.id === block.enemyId);
  const end = block.startTime + blockDuration(block);
  return (
    <>
      <div className="panel-head">
        <span>积木</span>
        {e && <UnitToken kind="enemy" def={e} size={22} />}
      </div>
      <div className="form-grid cols-2">
        <Field label="敌人类型" wide>
          <select className={`input${e ? '' : ' invalid'}`} value={block.enemyId} onChange={(ev) => onChange({ enemyId: ev.target.value })}>
            {!e && <option value={block.enemyId}>未知敌人 {block.enemyId}</option>}
            {enemies.map((x) => (
              <option key={x.id} value={x.id}>
                {x.id} · {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="数量">
          <NumberInput value={block.count} min={1} max={999} integer onChange={(v) => onChange({ count: v })} />
        </Field>
        <Field label="生成间隔" hint="秒">
          <NumberInput value={block.interval} min={0} max={600} step={0.5} onChange={(v) => onChange({ interval: v })} />
        </Field>
        <Field label="开始时间" hint="秒">
          <NumberInput value={block.startTime} min={0} max={36000} step={0.5} onChange={(v) => onChange({ startTime: v })} />
        </Field>
        <Field label="最后一个出现">
          <div className="static-value">{Math.round(end * 10) / 10} 秒</div>
        </Field>
      </div>
      {e && pathLength > 0 && (
        <div className="muted small help-text">
          该敌人走完这条路线约需 {((pathLength - 1) / e.speed + totalWait).toFixed(1)} 秒{totalWait > 0 ? `（含停留 ${Math.round(totalWait * 100) / 100} 秒）` : ''}
        </div>
      )}
      <div className="row gap-s">
        <button className="btn btn-s" onClick={onDuplicate}>
          复制积木
        </button>
        <button className="btn btn-s btn-danger" onClick={onDelete}>
          删除积木
        </button>
      </div>
    </>
  );
}

/** 右侧的停留点列表：按路线顺序列出，每个停留点可以修改停留时间或删除 */
function WaitList({
  rows,
  path,
  selected,
  invalidCount,
  active,
  onActivate,
  onSelect,
  onChange,
  onAdd,
  onRemove,
}: {
  rows: { w: RouteWait; step: number; valid: boolean }[];
  path: GridPos[];
  selected: GridPos | null;
  invalidCount: number;
  active: boolean;
  onActivate: () => void;
  onSelect: (p: GridPos) => void;
  onChange: (w: RouteWait, duration: number) => void;
  onAdd: (p: GridPos, visit: number) => void;
  onRemove: (w: RouteWait) => void;
}) {
  const visitsOf = (p: GridPos) => path.filter((q) => samePos(q, p)).length;
  const selVisits = selected ? visitsOf(selected) : 0;
  const missing = selected
    ? Array.from({ length: selVisits }, (_, i) => i + 1).filter((v) => !rows.some((r) => samePos(r.w, selected) && r.w.visit === v))
    : [];
  return (
    <div className="wait-list">
      <div className="panel-head">
        <span>⏸ 停留点</span>
        {!active && (
          <button className="btn btn-s btn-ghost" onClick={onActivate}>
            设置停留点
          </button>
        )}
      </div>
      {rows.length === 0 && (
        <div className="muted small help-text">
          {active ? '点击地图上路线经过的方块添加停留点。' : '敌人走到停留点会停下来，等待设置的时间后再继续前进。'}
        </div>
      )}
      {rows.map((r) => {
        const multi = visitsOf(r.w) > 1;
        const isSel = samePos(selected, r.w);
        return (
          <div key={`${r.w.x},${r.w.y},${r.w.visit}`} className={`wait-row${isSel ? ' active' : ''}${r.valid ? '' : ' invalid'}`}>
            <button className="wait-pos mono" onClick={() => onSelect(r.w)} title={r.valid ? `路线第 ${r.step + 1} 格` : '不在路线上：路线改过以后失效，不会生效'}>
              {formatPos(r.w)}
              {multi || r.w.visit > 1 ? <small> 第 {r.w.visit} 次</small> : null}
              {r.valid ? <small className="muted"> · 第 {r.step + 1} 格</small> : <small className="field-error"> 不在路线上</small>}
            </button>
            <NumberInput value={r.w.duration} min={0.1} max={3600} step={0.5} width={64} onChange={(v) => onChange(r.w, v)} />
            <span className="muted small">秒</span>
            <button className="icon-btn" onClick={() => onRemove(r.w)} aria-label="删除停留点" title="删除停留点">
              ×
            </button>
          </div>
        );
      })}
      {selected && missing.length > 0 && (
        <div className="row gap-s wrap wait-add">
          <span className="muted small">
            {formatPos(selected)} 经过 {selVisits} 次：
          </span>
          {missing.map((v) => (
            <button key={v} className="btn btn-s" onClick={() => onAdd(selected, v)}>
              + 第 {v} 次经过时停留
            </button>
          ))}
        </div>
      )}
      {invalidCount > 0 && <div className="field-error small">有 {invalidCount} 个停留点不在当前路线上，不会生效（可以删除）。</div>}
      {path.length === 0 && rows.length > 0 && <div className="muted small">路线无效时停留点不会生效。</div>}
    </div>
  );
}
