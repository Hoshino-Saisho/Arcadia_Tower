import { useEffect, useState } from 'react';
import { getBridge } from '../core/storage/backend';

/**
 * 极简 hash 路由：
 *   #/                     启动器
 *   #/game                 游戏主页（Play）
 *   #/game/chapters        章节选择
 *   #/game/chapter/ZH      关卡选择
 *   #/game/play/ZH_1       战斗（?test=1 为编辑器试玩）
 *   #/editor               关卡编辑器（?level=ZH_1 直接打开关卡）
 */
export interface Route {
  segments: string[];
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [p, q = ''] = raw.split('?');
  return { segments: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}

/**
 * 打开游戏 / 编辑器：Electron 中打开独立窗口（窗口已存在且没有指定页面时只切换到前台，不会打断正在进行的战斗），
 * 浏览器中在当前页跳转（或新标签页）
 */
export function openApp(kind: 'game' | 'editor', hashPath?: string, newTab = false) {
  const bridge = getBridge();
  const path = hashPath ?? `/${kind}`;
  if (bridge) {
    void bridge.openWindow(kind, hashPath);
  } else if (newTab) {
    window.open(`${window.location.pathname}${window.location.search}#${path}`, '_blank');
  } else {
    navigate(path);
  }
}
