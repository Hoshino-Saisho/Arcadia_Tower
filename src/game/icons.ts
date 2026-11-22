import { useEffect, useState } from 'react';
import { getBackend } from '../core/storage/backend';

/**
 * 图标加载与缓存。
 * icon 字段可以是 data 目录下的相对路径（icons/xxx.png）、data: URL 或 http(s) URL。
 * 未加载完成或加载失败时返回 null，绘制函数会自动退回到颜色圆形 / 多边形。
 */
type Entry = { img: HTMLImageElement | null; status: 'loading' | 'ready' | 'error' };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

async function load(ref: string, entry: Entry) {
  try {
    let src = ref;
    if (!/^(data:|blob:|https?:)/.test(ref)) {
      const b = await getBackend();
      const bytes = await b.readBinary(ref);
      if (!bytes) throw new Error('图标文件不存在');
      const ext = ref.split('.').pop()?.toLowerCase() ?? 'png';
      src = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[ext] ?? 'image/png' }));
    }
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = src;
    });
    entry.img = img;
    entry.status = 'ready';
  } catch (err) {
    console.warn(`图标加载失败：${ref}`, err);
    entry.status = 'error';
  }
  notify();
}

/** 同步获取已加载好的图标；第一次调用时开始异步加载 */
export function getIcon(ref: string | undefined | null): HTMLImageElement | null {
  if (!ref) return null;
  let entry = cache.get(ref);
  if (!entry) {
    entry = { img: null, status: 'loading' };
    cache.set(ref, entry);
    void load(ref, entry);
  }
  return entry.status === 'ready' ? entry.img : null;
}

export function iconStatus(ref: string | undefined | null): 'none' | 'loading' | 'ready' | 'error' {
  if (!ref) return 'none';
  return cache.get(ref)?.status ?? 'loading';
}

/** 预加载一组图标 */
export function preloadIcons(refs: (string | undefined)[]) {
  for (const r of refs) getIcon(r);
}

export function onIconsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React：图标加载完成后触发重新渲染 */
export function useIcon(ref: string | undefined | null): HTMLImageElement | null {
  const [, force] = useState(0);
  useEffect(() => onIconsChanged(() => force((n) => n + 1)), []);
  return getIcon(ref);
}
