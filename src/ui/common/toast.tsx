import { useEffect, useState } from 'react';

type ToastKind = 'info' | 'ok' | 'error';
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

let seq = 0;
let items: ToastItem[] = [];
const subs = new Set<(list: ToastItem[]) => void>();

function emit() {
  for (const s of subs) s(items);
}

/** 弹出一条短消息 */
export function toast(text: string, kind: ToastKind = 'info', ms = 2600) {
  const id = ++seq;
  items = [...items.slice(-4), { id, text, kind }];
  emit();
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, ms);
}

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    subs.add(setList);
    return () => {
      subs.delete(setList);
    };
  }, []);
  return (
    <div className="toast-host">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
