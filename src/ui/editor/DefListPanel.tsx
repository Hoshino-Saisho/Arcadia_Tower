import type { ReactNode } from 'react';
import type { DraftItem } from './useListDraft';

/** 左侧的定义列表（角色 / 敌人共用） */
export function DefListPanel<T extends { id: string; name: string }>({
  title,
  items,
  selectedKey,
  errors,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
  renderIcon,
  renderMeta,
}: {
  title: string;
  items: DraftItem<T>[];
  selectedKey: string | null;
  errors: Map<string, string>;
  onSelect: (key: string) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (delta: number) => void;
  renderIcon: (v: T) => ReactNode;
  renderMeta?: (v: T) => ReactNode;
}) {
  const index = items.findIndex((d) => d.key === selectedKey);
  return (
    <aside className="def-list">
      <div className="panel-head">
        <span>
          {title} <span className="muted">({items.length})</span>
        </span>
        <button className="btn btn-s btn-primary" onClick={onAdd}>
          + 新建
        </button>
      </div>
      <div className="def-list-items">
        {items.map((d) => (
          <button key={d.key} className={`def-item${d.key === selectedKey ? ' active' : ''}${errors.has(d.key) ? ' has-error' : ''}`} onClick={() => onSelect(d.key)}>
            {renderIcon(d.value)}
            <span className="def-item-text">
              <span className="def-item-id mono">{d.value.id || '(无ID)'}</span>
              <span className="def-item-name">{d.value.name}</span>
            </span>
            {renderMeta && <span className="def-item-meta">{renderMeta(d.value)}</span>}
            {d.origId === null && <span className="badge">新</span>}
          </button>
        ))}
        {items.length === 0 && <div className="empty-hint">列表为空，点击「+ 新建」</div>}
      </div>
      <div className="def-list-actions">
        <button className="btn btn-s" disabled={index < 0} onClick={onDuplicate} title="复制当前条目">
          复制
        </button>
        <button className="btn btn-s" disabled={index <= 0} onClick={() => onMove(-1)} title="上移">
          ↑
        </button>
        <button className="btn btn-s" disabled={index < 0 || index >= items.length - 1} onClick={() => onMove(1)} title="下移">
          ↓
        </button>
        <button className="btn btn-s btn-danger" disabled={index < 0} onClick={onDelete}>
          删除
        </button>
      </div>
    </aside>
  );
}

/** 编辑器底部的保存栏 */
export function SaveBar({ dirty, saving, onSave, extra }: { dirty: boolean; saving: boolean; onSave: () => void; extra?: ReactNode }) {
  return (
    <div className="save-bar">
      <span className={dirty ? 'dirty-text' : 'muted'}>{dirty ? '● 有未保存的修改' : '✓ 已保存'}</span>
      <span className="grow" />
      {extra}
      <button className="btn btn-primary" disabled={saving || !dirty} onClick={onSave}>
        {saving ? '保存中…' : '保存（Ctrl+S）'}
      </button>
    </div>
  );
}
