/**
 * 手机版舞台：游戏页面按固定的设计尺寸排版（保持原来的比例），整体等比缩放；
 * 点击「横屏」后在竖着的屏幕上旋转 90° 显示。
 * 这里保存舞台当前的变换，拖动部署等需要「屏幕坐标 → 页面坐标」的地方用 clientToLocal 换算。
 */

/** 舞台的设计尺寸（16:9） */
export const STAGE_W = 960;
export const STAGE_H = 540;

export interface StageTransform {
  /** 是否启用了舞台缩放（手机 / 很窄的窗口） */
  active: boolean;
  /** 是否旋转了 90°（竖屏时的强制横屏） */
  rotated: boolean;
  /** 缩放比例 */
  s: number;
  /** 舞台左上角（设计坐标 0,0）在屏幕上的位置 */
  ox: number;
  oy: number;
  el: HTMLElement | null;
}

export const stage: StageTransform = { active: false, rotated: false, s: 1, ox: 0, oy: 0, el: null };

/** 屏幕坐标 → 舞台的设计坐标 */
export function clientToStage(cx: number, cy: number): { x: number; y: number } {
  if (stage.rotated) return { x: (cy - stage.oy) / stage.s, y: (stage.ox - cx) / stage.s };
  return { x: (cx - stage.ox) / stage.s, y: (cy - stage.oy) / stage.s };
}

/** 屏幕坐标（clientX / clientY）→ 元素内部的坐标（CSS 像素，不受舞台缩放 / 旋转影响） */
export function clientToLocal(el: Element, cx: number, cy: number): { x: number; y: number } {
  const root = stage.el;
  if (!stage.active || !root || !root.contains(el) || !(el instanceof HTMLElement)) {
    const r = el.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  }
  const p = clientToStage(cx, cy);
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
    x -= a.scrollLeft;
    y -= a.scrollTop;
  }
  return { x: p.x - x, y: p.y - y };
}

/** 手机 / 很窄的窗口使用舞台缩放 */
export function needsStage(w: number, h: number): boolean {
  return Math.min(w, h) < 600 || w < 760;
}

export function isTouchDevice(): boolean {
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints ?? 0) > 0;
}
