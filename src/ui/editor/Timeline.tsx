import { useMemo, useRef, useState } from 'react';
import { blockDuration, newBlock } from '../../core/defaults';
import { shortUid } from '../../core/ids';
import type { EnemyDef, EnemyLine, SpawnBlock } from '../../core/types';
import { withAlpha } from '../../game/shapes';
import { UnitToken } from '../common/tokens';

const ROW_H = 50;
const HEAD_W = 210;
const CAP = 30; // 积木两端留白（像素），保证只有 1 个敌人的积木也有宽度
const SNAP = 0.5;

export type LinesApply = (fn: (lines: EnemyLine[]) => EnemyLine[], mode: 'push' | 'replace') => void;

/** 把积木移动到 targetLine 并设置开始时间 */
function moveBlock(lines: EnemyLine[], blockId: string, targetLineId: string, startTime: number): EnemyLine[] {
  let moving: SpawnBlock | null = null;
  const stripped = lines.map((l) => {
    const b = l.blocks.find((x) => x.id === blockId);
    if (!b) return l;
    moving = b;
    return { ...l, blocks: l.blocks.filter((x) => x.id !== blockId) };
  });
  if (!moving) return lines;
  const mv: SpawnBlock = { ...(moving as SpawnBlock), startTime };
  return stripped.map((l) => (l.id === targetLineId ? { ...l, blocks: [...l.blocks, mv].sort((a, b) => a.startTime - b.startTime) } : l));
}

function niceStep(pps: number): number {
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120]) if (s * pps >= 56) return s;
  return 300;
}

function fmt(t: number) {
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 敌人时间线：每一行是一条敌人线，行内的积木 = 在某个时间点开始、按间隔生成若干个敌人。
 * 积木可以左右拖动调整时间、上下拖动换到别的敌人线；从积木库拖入敌人可新建积木。
 */
export function Timeline({
  lines,
  enemies,
  selLine,
  selBlock,
  onSelect,
  apply,
  routeOk,
  onAddLine,
  onDuplicateLine,
  onDeleteLine,
}: {
  lines: EnemyLine[];
  enemies: EnemyDef[];
  selLine: string | null;
  selBlock: string | null;
  onSelect: (lineId: string | null, blockId: string | null) => void;
  apply: LinesApply;
  routeOk: Map<string, { ok: boolean; text: string }>;
  onAddLine: () => void;
  onDuplicateLine: (id: string) => void;
  onDeleteLine: (id: string) => void;
}) {
  const [pps, setPps] = useState(14);
  const [palette, setPalette] = useState<string | null>(enemies[0]?.id ?? null);
  const [dropHint, setDropHint] = useState<{ row: number; time: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    blockId: string;
    lineId: string;
    row: number;
    x0: number;
    y0: number;
    start0: number;
    moved: boolean;
    pushed: boolean;
  } | null>(null);

  const enemyMap = useMemo(() => new Map(enemies.map((e) => [e.id, e])), [enemies]);
  const paletteId = palette && enemyMap.has(palette) ? palette : enemies[0]?.id ?? null;

  const maxEnd = useMemo(() => {
    let m = 0;
    for (const l of lines) for (const b of l.blocks) m = Math.max(m, b.startTime + blockDuration(b));
    return m;
  }, [lines]);
  const totalSec = Math.max(60, Math.ceil((maxEnd + 25) / 10) * 10);
  const width = totalSec * pps + CAP * 2;
  const step = niceStep(pps);
  const totalEnemies = lines.reduce((n, l) => n + l.blocks.reduce((k, b) => k + b.count, 0), 0);

  const snap = (t: number) => Math.max(0, Math.round(t / SNAP) * SNAP);

  const posFromEvent = (clientX: number, clientY: number) => {
    const r = contentRef.current!.getBoundingClientRect();
    const time = snap((clientX - r.left - CAP) / pps);
    const row = Math.floor((clientY - r.top) / ROW_H);
    return { time, row };
  };

  const addBlockAt = (lineId: string, enemyId: string, time: number) => {
    const b = newBlock(enemyId, time);
    apply((ls) => ls.map((l) => (l.id === lineId ? { ...l, blocks: [...l.blocks, b].sort((x, y) => x.startTime - y.startTime) } : l)), 'push');
    onSelect(lineId, b.id);
  };

  const addBlockAtEnd = (line: EnemyLine) => {
    if (!paletteId) return;
    const end = line.blocks.reduce((m, b) => Math.max(m, b.startTime + blockDuration(b)), -2);
    addBlockAt(line.id, paletteId, snap(end + 2));
  };

  return (
    <div className="timeline">
      <div className="timeline-bar">
        <span className="panel-title">敌人出现时间线</span>
        <div className="enemy-palette" title="拖动敌人到下方的敌人线上，即可在对应时间创建积木">
          <span className="muted small">积木库：</span>
          {enemies.length === 0 && <span className="field-error">请先在「敌人编辑」中创建敌人</span>}
          {enemies.map((e) => (
            <div
              key={e.id}
              className={`enemy-chip${paletteId === e.id ? ' active' : ''}`}
              draggable
              onClick={() => setPalette(e.id)}
              onDragStart={(ev) => {
                ev.dataTransfer.setData('application/x-arcadia-enemy', e.id);
                ev.dataTransfer.setData('text/plain', e.id);
                ev.dataTransfer.effectAllowed = 'copy';
                setPalette(e.id);
              }}
              title={`${e.name}（${e.id}）— 拖到时间线上`}
            >
              <UnitToken kind="enemy" def={e} size={20} />
              <span className="mono">{e.id}</span>
              <span>{e.name}</span>
            </div>
          ))}
        </div>
        <span className="grow" />
        <span className="muted small">
          共 {lines.length} 条线 · {totalEnemies} 个敌人 · 最后出现 {fmt(Math.round(maxEnd * 10) / 10)}
        </span>
        <label className="zoom muted small">
          缩放
          <input type="range" min={4} max={60} value={pps} onChange={(e) => setPps(Number(e.target.value))} />
        </label>
        <button className="btn btn-s btn-primary" onClick={onAddLine}>
          + 新建敌人线
        </button>
      </div>

      <div className="timeline-body">
        <div className="timeline-heads" style={{ width: HEAD_W }}>
          <div className="timeline-corner">敌人线 / 路线</div>
          {lines.map((l) => {
            const st = routeOk.get(l.id);
            return (
              <div
                key={l.id}
                className={`line-head${selLine === l.id ? ' active' : ''}`}
                style={{ height: ROW_H, borderLeftColor: l.color }}
                onClick={() => onSelect(l.id, null)}
              >
                <div className="line-head-main">
                  <span className="line-name">{l.name}</span>
                  <span className={`line-route ${st?.ok ? 'ok' : 'bad'}`} title={st?.text}>
                    {st?.ok ? '✓' : '✗'} {l.route.mode === 'auto' ? '自动寻路' : '手动路线'}
                  </span>
                </div>
                <div className="line-head-actions">
                  <button className="icon-btn" title={`添加积木（${paletteId ?? '无敌人'}）`} disabled={!paletteId} onClick={(e) => (e.stopPropagation(), addBlockAtEnd(l))}>
                    +
                  </button>
                  <button className="icon-btn" title="复制这条敌人线" onClick={(e) => (e.stopPropagation(), onDuplicateLine(l.id))}>
                    ⧉
                  </button>
                  <button className="icon-btn danger" title="删除这条敌人线" onClick={(e) => (e.stopPropagation(), onDeleteLine(l.id))}>
                    ×
                  </button>
                </div>
              </div>
            );
          })}
          {lines.length === 0 && <div className="empty-hint small">点击右上角「+ 新建敌人线」</div>}
        </div>

        <div className="timeline-scroll">
          <div className="timeline-ruler" style={{ width }}>
            {Array.from({ length: Math.floor(totalSec / step) + 1 }, (_, i) => i * step).map((t) => (
              <div key={t} className="tick" style={{ left: CAP + t * pps }}>
                <span>{fmt(t)}</span>
              </div>
            ))}
          </div>
          <div
            ref={contentRef}
            className="timeline-content"
            style={{ width, height: Math.max(ROW_H, lines.length * ROW_H) }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/x-arcadia-enemy')) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              const p = posFromEvent(e.clientX, e.clientY);
              if (!dropHint || dropHint.row !== p.row || dropHint.time !== p.time) setDropHint(p);
            }}
            onDragLeave={() => setDropHint(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDropHint(null);
              const id = e.dataTransfer.getData('application/x-arcadia-enemy');
              const p = posFromEvent(e.clientX, e.clientY);
              const line = lines[p.row];
              if (id && line) addBlockAt(line.id, id, p.time);
            }}
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              const p = posFromEvent(e.clientX, e.clientY);
              const line = lines[p.row];
              onSelect(line ? line.id : null, null);
            }}
          >
            {/* 行背景 */}
            {lines.map((l, i) => (
              <div key={l.id} className={`timeline-row${selLine === l.id ? ' active' : ''}`} style={{ top: i * ROW_H, height: ROW_H }} />
            ))}
            {/* 时间网格线 */}
            {Array.from({ length: Math.floor(totalSec / step) + 1 }, (_, i) => i * step).map((t) => (
              <div key={t} className="grid-line" style={{ left: CAP + t * pps }} />
            ))}
            {dropHint && lines[dropHint.row] && (
              <div className="drop-hint" style={{ left: CAP + dropHint.time * pps, top: dropHint.row * ROW_H }}>
                <span>{fmt(dropHint.time)}</span>
              </div>
            )}
            {/* 积木（放在同一层里，拖到别的行时元素不会被重新创建） */}
            {lines.flatMap((l, row) =>
              l.blocks.map((b) => {
                const e = enemyMap.get(b.enemyId);
                const dur = blockDuration(b);
                const left = CAP + b.startTime * pps - CAP / 2;
                const w = dur * pps + CAP;
                const color = e?.color ?? '#888888';
                const selected = selBlock === b.id;
                return (
                  <div
                    key={b.id}
                    className={`tl-block${selected ? ' selected' : ''}${e ? '' : ' missing'}`}
                    style={{
                      left,
                      top: row * ROW_H + 6,
                      width: w,
                      height: ROW_H - 12,
                      background: withAlpha(color, 0.28),
                      borderColor: selected ? '#ffffff' : withAlpha(color, 0.9),
                      boxShadow: `inset 3px 0 0 ${l.color}`,
                    }}
                    title={`${e ? `${e.name}（${e.id}）` : `未知敌人 ${b.enemyId}`} × ${b.count}\n开始 ${b.startTime}s，间隔 ${b.interval}s，结束 ${b.startTime + dur}s\n拖动：左右改时间，上下换敌人线`}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
                      onSelect(l.id, b.id);
                      drag.current = { blockId: b.id, lineId: l.id, row, x0: ev.clientX, y0: ev.clientY, start0: b.startTime, moved: false, pushed: false };
                    }}
                    onPointerMove={(ev) => {
                      const d = drag.current;
                      if (!d || d.blockId !== b.id) return;
                      const dx = ev.clientX - d.x0;
                      const dy = ev.clientY - d.y0;
                      if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
                      d.moved = true;
                      const t = snap(d.start0 + dx / pps);
                      const targetRow = Math.max(0, Math.min(lines.length - 1, d.row + Math.round(dy / ROW_H)));
                      const target = lines[targetRow].id;
                      const curLine = lines.find((x) => x.blocks.some((y) => y.id === b.id));
                      const cur = curLine?.blocks.find((y) => y.id === b.id);
                      if (cur && curLine && cur.startTime === t && curLine.id === target) return;
                      apply((ls) => moveBlock(ls, b.id, target, t), d.pushed ? 'replace' : 'push');
                      d.pushed = true;
                      if (curLine?.id !== target) onSelect(target, b.id);
                    }}
                    onPointerUp={() => {
                      drag.current = null;
                    }}
                  >
                    {/* 每个敌人的生成时刻 */}
                    {b.interval > 0 &&
                      b.count > 1 &&
                      b.interval * pps >= 3 &&
                      Array.from({ length: b.count }, (_, k) => (
                        <span key={k} className="spawn-tick" style={{ left: CAP / 2 + k * b.interval * pps }} />
                      ))}
                    <span className="tl-block-label">
                      {e && <UnitToken kind="enemy" def={e} size={18} />}
                      <strong>×{b.count}</strong>
                      {w > 90 && <span className="mono">{e ? e.id : b.enemyId}</span>}
                      {w > 150 && <span className="muted">/{b.interval}s</span>}
                    </span>
                  </div>
                );
              }),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 复制敌人线（新的 ID） */
export function cloneLine(l: EnemyLine, name: string, color: string): EnemyLine {
  return {
    ...structuredClone(l),
    id: shortUid('L'),
    name,
    color,
    blocks: l.blocks.map((b) => ({ ...b, id: shortUid('B') })),
  };
}
