import { useMemo, useState } from 'react';
import { LINE_COLORS, blockDuration, newLine } from '../../core/defaults';
import { shortUid } from '../../core/ids';
import { connectTiles, findPath, isAdjacent, resolveRoute, type ResolvedRoute } from '../../core/pathfinding';
import { TileGrid, formatPos, samePos } from '../../core/tiles';
import type { EnemyDef, EnemyLine, GridPos, LevelDef, RouteDef, SpawnBlock } from '../../core/types';
import { drawGrid, drawRoute, type Viewport } from '../../game/renderer';
import { Field, NumberInput, Segmented, TextInput } from '../common/fields';
import { toast } from '../common/toast';
import { UnitToken } from '../common/tokens';
import { GridCanvas, type GridPointer } from './GridCanvas';
import type { ApplyFn } from './LevelEditor';
import { Timeline, cloneLine } from './Timeline';

/**
 * 敌人路线规划：上方地图显示 / 编辑路线，下方时间线安排敌人出现时间。
 *  - 自动寻路：程序在地图上找到出现点 → 基地的最短路线
 *  - 手动设置：在地图上逐个点击相连的方块，设定路线和顺序
 */
export function RouteStep({ level, enemies, apply, onBack }: { level: LevelDef; enemies: EnemyDef[]; apply: ApplyFn; onBack: () => void }) {
  const grid = useMemo(() => TileGrid.fromLevel(level), [level.grid, level.width, level.height]);
  const spawns = useMemo(() => grid.find('spawn'), [grid]);
  const bases = useMemo(() => grid.find('base'), [grid]);
  const [sel, setSel] = useState<{ line: string | null; block: string | null }>({ line: level.lines[0]?.id ?? null, block: null });
  const [hover, setHover] = useState<GridPos | null>(null);

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

  const applyLines = (fn: (lines: EnemyLine[]) => EnemyLine[], mode: 'push' | 'replace') => apply((lv) => ({ ...lv, lines: fn(lv.lines) }), mode);
  const setLine = (patch: Partial<EnemyLine>) => line && applyLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, ...patch } : l)), 'push');
  const setRoute = (patch: Partial<RouteDef>) => line && setLine({ route: { ...line.route, ...patch } });
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

    if (route.mode === 'auto') {
      if (t?.type === 'spawn') setRoute({ spawn: p });
      else if (t?.type === 'base') setRoute({ target: samePos(route.target, p) ? null : p });
      else toast('自动寻路模式：点击出现点选择起点，点击基地选择目的地', 'info');
      return;
    }

    // 手动路线
    const path = route.path;
    if (ev.button === 2) {
      if (path.length > 1) setRoute({ path: path.slice(0, -1) });
      return;
    }
    const lastTile = path[path.length - 1];
    const passThroughSpawn = t?.type === 'spawn' && lastTile && isAdjacent(lastTile, p) && !path.some((q) => samePos(q, p));
    if (path.length === 0 || (t?.type === 'spawn' && !passThroughSpawn)) {
      if (t?.type !== 'spawn') return toast('手动路线需要从敌人出现点开始，请先点击一个出现点', 'error');
      if (path.length > 0 && samePos(path[0], p)) return;
      setRoute({ spawn: p, path: [p] });
      return;
    }
    const idx = path.findIndex((q) => samePos(q, p));
    if (idx >= 0) {
      if (idx < path.length - 1) setRoute({ path: path.slice(0, idx + 1) });
      return;
    }
    const last = path[path.length - 1];
    if (grid.isType(last.x, last.y, 'base')) return toast('路线已经到达基地。点击路线上的方块可以从该处截断重画', 'info');
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
      if (line.route.mode === 'manual') {
        const path = line.route.path;
        if (path.length) drawRoute(ctx, path, vp, line.color, { width: Math.max(3, vp.scale * 0.12), numbers: vp.scale >= 22 });
        // 可以继续点击的相邻方块
        const last = path[path.length - 1];
        if (last && !grid.isType(last.x, last.y, 'base')) {
          for (const d of [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 },
          ]) {
            const q = { x: last.x + d.x, y: last.y + d.y };
            if (grid.isWalkable(q.x, q.y) && !path.some((pp) => samePos(pp, q))) {
              ctx.strokeStyle = 'rgba(125,255,176,0.8)';
              ctx.lineWidth = 2;
              ctx.setLineDash([4, 3]);
              ctx.strokeRect(vp.ox + q.x * vp.scale + 3, vp.oy + q.y * vp.scale + 3, vp.scale - 6, vp.scale - 6);
              ctx.setLineDash([]);
            }
          }
        }
      } else if (lineRoute?.path) {
        drawRoute(ctx, lineRoute.path, vp, line.color, { width: Math.max(3, vp.scale * 0.12) });
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
            <span className="muted small">
              {line
                ? line.route.mode === 'manual'
                  ? `手动设置「${line.name}」：从出现点开始，逐个点击相连的地面方块直到基地；右键撤销一格，点击路线上的方块可从该处截断`
                  : `自动寻路「${line.name}」：点击出现点选择起点，点击基地指定目的地（再次点击取消，取消后前往最近的基地）`
                : '选择或新建一条敌人线'}
            </span>
          </div>
          <GridCanvas cols={level.width} rows={level.height} draw={draw} onPointer={onPointer} onHover={setHover} cursor={line ? 'pointer' : 'default'} maxCell={60} />
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
                      <button className="btn btn-s" disabled={line.route.path.length <= 1} onClick={() => setRoute({ path: line.route.path.slice(0, -1) })}>
                        撤销一格
                      </button>
                      <button className="btn btn-s" onClick={() => setRoute({ path: line.route.spawn ? [line.route.spawn] : [] })}>
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
                    <span className="field-note">已设置 {line.route.path.length} 格</span>
                  </Field>
                )}
                <div className={`route-status ${lineRoute?.path ? 'ok' : 'bad'}`}>
                  {lineRoute?.path ? `✓ 路线有效：${lineRoute.path.length} 格，${formatPos(lineRoute.path[0])} → ${formatPos(lineRoute.path[lineRoute.path.length - 1])}` : `✗ ${lineRoute?.error}`}
                </div>
              </div>

              {block ? (
                <BlockProps
                  block={block}
                  enemies={enemies}
                  pathLength={lineRoute?.path?.length ?? 0}
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
  onChange,
  onDuplicate,
  onDelete,
}: {
  block: SpawnBlock;
  enemies: EnemyDef[];
  pathLength: number;
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
      {e && pathLength > 0 && <div className="muted small help-text">该敌人走完这条路线约需 {((pathLength - 1) / e.speed).toFixed(1)} 秒</div>}
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
