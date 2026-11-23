import { newDrop } from '../../core/defaults';
import { formatDrop } from '../../core/leveling';
import type { BookDrop, CurrencyConfig, ExpBookDef } from '../../core/types';
import { NumberInput } from '../common/fields';

/**
 * 经验书掉落列表（货币编辑的默认掉落、关卡设置的单独掉落共用）：
 * 每一项 = 经验书 + 掉落概率 + 数量范围
 */
export function DropListEditor({ value, books, onChange }: { value: BookDrop[]; books: ExpBookDef[]; onChange: (v: BookDrop[]) => void }) {
  const set = (i: number, patch: Partial<BookDrop>) => onChange(value.map((d, j) => (j === i ? fixRange({ ...d, ...patch }, patch) : d)));
  return (
    <div className="drop-list">
      {value.length === 0 && <div className="muted small">没有经验书掉落</div>}
      {value.map((d, i) => {
        const book = books.find((b) => b.id === d.bookId);
        return (
          <div key={i} className={`drop-row${book ? '' : ' invalid'}`}>
            <span className="color-dot" style={{ background: book?.color ?? '#666' }} />
            <select className={`input${book ? '' : ' invalid'}`} value={d.bookId} onChange={(e) => set(i, { bookId: e.target.value })}>
              {!book && <option value={d.bookId}>未知经验书 {d.bookId}</option>}
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}（{b.exp} 经验）
                </option>
              ))}
            </select>
            <span className="drop-field">
              <span className="muted small">概率</span>
              <NumberInput value={d.chance} min={0} max={100} step={5} width={70} onChange={(v) => set(i, { chance: v })} />
              <span className="muted small">%</span>
            </span>
            <span className="drop-field">
              <span className="muted small">数量</span>
              <NumberInput value={d.min} min={0} max={9999} integer width={58} onChange={(v) => set(i, { min: v })} />
              <span className="muted small">~</span>
              <NumberInput value={d.max} min={0} max={9999} integer width={58} onChange={(v) => set(i, { max: v })} />
            </span>
            <button type="button" className="icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="删除掉落" title="删除这一项">
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="btn btn-s"
        disabled={books.length === 0}
        title={books.length ? '' : '请先在「货币编辑」中新建经验书'}
        onClick={() => onChange([...value, newDrop((books.find((b) => !value.some((d) => d.bookId === b.id)) ?? books[0]).id)])}
      >
        + 添加掉落
      </button>
    </div>
  );
}

/** 修改最少 / 最多数量时保持 最少 ≤ 最多 */
function fixRange(d: BookDrop, patch: Partial<BookDrop>): BookDrop {
  if (d.min <= d.max) return d;
  return patch.min !== undefined ? { ...d, max: d.min } : { ...d, min: d.max };
}

/** 一行掉落说明（「使用默认」时显示默认掉落的内容） */
export function DropSummary({ drops, currency }: { drops: BookDrop[]; currency: CurrencyConfig }) {
  const items = drops.flatMap((d) => {
    const b = currency.books.find((x) => x.id === d.bookId);
    return b && d.chance > 0 && d.max > 0 ? [{ d, b }] : [];
  });
  if (!items.length) return <span className="muted small">没有经验书掉落</span>;
  return (
    <span className="drop-summary">
      {items.map(({ d, b }, i) => (
        <span key={i} className="book-chip" style={{ borderColor: b.color }}>
          <span className="color-dot" style={{ background: b.color }} />
          {formatDrop(d, b, 'exact')}
        </span>
      ))}
    </span>
  );
}
