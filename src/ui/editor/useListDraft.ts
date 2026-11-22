import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shortUid } from '../../core/ids';
import { toast } from '../common/toast';

export interface DraftItem<T> {
  key: string;
  /** 读取时的 ID（新建的为 null），保存时用于识别改名 */
  origId: string | null;
  value: T;
}

/**
 * 列表类编辑器（角色、敌人、章节）的通用草稿逻辑：
 * 新建 / 复制 / 删除 / 排序 / 校验 / 保存（自动识别 ID 改名并同步引用）
 */
export function useListDraft<T extends { id: string }>(opts: {
  load: () => Promise<T[]>;
  save: (items: T[], renames: Map<string, string>) => Promise<void>;
  validateId: (id: string) => string | null;
  onDirtyChange?: (dirty: boolean) => void;
  label: string;
}) {
  const [items, setItems] = useState<DraftItem<T>[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const setDirty = useCallback((d: boolean) => {
    setDirtyState(d);
    optsRef.current.onDirtyChange?.(d);
  }, []);

  const reload = useCallback(async () => {
    try {
      const list = await optsRef.current.load();
      const drafts = list.map((v) => ({ key: shortUid('k'), origId: v.id, value: v }));
      setItems(drafts);
      setSelectedKey((k) => (k && drafts.some((d) => d.key === k) ? k : drafts[0]?.key ?? null));
      setDirty(false);
    } catch (err) {
      setLoadError(String(err));
    }
  }, [setDirty]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback(
    (key: string, patch: Partial<T>) => {
      setItems((list) => list && list.map((d) => (d.key === key ? { ...d, value: { ...d.value, ...patch } } : d)));
      setDirty(true);
    },
    [setDirty],
  );

  const add = useCallback(
    (value: T, afterKey?: string | null) => {
      const key = shortUid('k');
      setItems((list) => {
        if (!list) return list;
        const i = afterKey ? list.findIndex((d) => d.key === afterKey) : -1;
        const next = list.slice();
        next.splice(i >= 0 ? i + 1 : next.length, 0, { key, origId: null, value });
        return next;
      });
      setSelectedKey(key);
      setDirty(true);
    },
    [setDirty],
  );

  const remove = useCallback(
    (key: string) => {
      if (!items) return;
      const i = items.findIndex((d) => d.key === key);
      const next = items.filter((d) => d.key !== key);
      setItems(next);
      setSelectedKey(next[Math.min(i, next.length - 1)]?.key ?? null);
      setDirty(true);
    },
    [items, setDirty],
  );

  const move = useCallback(
    (key: string, to: number) => {
      setItems((list) => {
        if (!list) return list;
        const i = list.findIndex((d) => d.key === key);
        if (i < 0 || to < 0 || to >= list.length || to === i) return list;
        const next = list.slice();
        const [it] = next.splice(i, 1);
        next.splice(to, 0, it);
        return next;
      });
      setDirty(true);
    },
    [setDirty],
  );

  /** 每个条目的错误（ID 非法或重复） */
  const errors = useMemo(() => {
    const map = new Map<string, string>();
    if (!items) return map;
    const count = new Map<string, number>();
    for (const d of items) count.set(d.value.id, (count.get(d.value.id) ?? 0) + 1);
    for (const d of items) {
      const e = optsRef.current.validateId(d.value.id) ?? ((count.get(d.value.id) ?? 0) > 1 ? `ID「${d.value.id}」重复` : null);
      if (e) map.set(d.key, e);
    }
    return map;
  }, [items]);

  const saveAll = useCallback(async () => {
    if (!items || saving) return false;
    if (errors.size) {
      const first = items.find((d) => errors.has(d.key))!;
      setSelectedKey(first.key);
      toast(`无法保存：${errors.get(first.key)}`, 'error');
      return false;
    }
    const renames = new Map<string, string>();
    for (const d of items) if (d.origId && d.origId !== d.value.id) renames.set(d.origId, d.value.id);
    setSaving(true);
    try {
      await optsRef.current.save(
        items.map((d) => d.value),
        renames,
      );
      setItems(items.map((d) => ({ ...d, origId: d.value.id })));
      setDirty(false);
      toast(renames.size ? `${optsRef.current.label}已保存，并同步更新了 ${renames.size} 个改名的引用` : `${optsRef.current.label}已保存`, 'ok');
      return true;
    } catch (err) {
      toast(`保存失败：${String(err)}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [items, errors, saving, setDirty]);

  const selected = items?.find((d) => d.key === selectedKey) ?? null;
  return { items, selected, selectedKey, setSelectedKey, update, add, remove, move, errors, dirty, saving, saveAll, reload, loadError };
}

/** Ctrl/Cmd + S 保存 */
export function useSaveShortcut(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
