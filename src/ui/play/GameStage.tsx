import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { STAGE_H, STAGE_W, isTouchDevice, needsStage, stage } from '../common/stage';

/**
 * 游戏页面的外壳。
 * 电脑上：铺满窗口（和以前一样）。
 * 手机 / 很窄的窗口：按 960×540 的设计尺寸排版后整体等比缩放（保持原来的比例），
 *   竖屏时显示在屏幕中间（约占一半高度），下面有「横屏」按钮：
 *   优先使用全屏 + 锁定横屏；浏览器不支持锁定方向时（如 iPhone Safari），把画面旋转 90°，横着拿手机就是横屏。
 * 不管是否缩放，子页面的位置都不变，所以切换时不会重新加载战斗。
 */
export function GameStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [forced, setForced] = useState(false);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
    screen.orientation?.addEventListener?.('change', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onResize);
      screen.orientation?.removeEventListener?.('change', onResize);
    };
  }, []);

  const staged = needsStage(vp.w, vp.h);
  const portrait = vp.h > vp.w;
  const touch = isTouchDevice();
  const rotated = staged && forced && portrait;

  let s = 1;
  let ox = 0;
  let oy = 0;
  if (rotated) {
    // 顺时针旋转 90°：横着拿手机（顶部朝左）时画面是正的
    s = Math.min(vp.w / STAGE_H, vp.h / STAGE_W);
    ox = (vp.w - STAGE_H * s) / 2 + STAGE_H * s;
    oy = (vp.h - STAGE_W * s) / 2;
  } else if (staged) {
    s = Math.min(vp.w / STAGE_W, vp.h / STAGE_H);
    ox = (vp.w - STAGE_W * s) / 2;
    oy = (vp.h - STAGE_H * s) / 2;
    // 竖屏时稍微往上放，给下面的「横屏」按钮留位置
    if (portrait && touch) oy = Math.max(0, oy - 36);
  }

  useLayoutEffect(() => {
    stage.active = staged;
    stage.rotated = rotated;
    stage.s = s;
    stage.ox = ox;
    stage.oy = oy;
    stage.el = ref.current;
  });
  useEffect(
    () => () => {
      stage.active = false;
      stage.rotated = false;
      stage.el = null;
    },
    [],
  );

  const enterLandscape = async () => {
    setForced(true);
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o?.lock?.('landscape');
    } catch {
      // 不支持全屏 / 锁定方向：保持旋转 90° 的显示方式
    }
  };
  const exitLandscape = () => {
    setForced(false);
    try {
      screen.orientation?.unlock?.();
    } catch {
      /* 忽略 */
    }
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  };

  const style = staged
    ? {
        width: STAGE_W,
        height: STAGE_H,
        transform: `translate(${ox}px, ${oy}px)${rotated ? ' rotate(90deg)' : ''} scale(${s})`,
      }
    : undefined;

  // 「退出横屏」放在画面外的黑边里（旋转时文字也跟着转）；黑边太窄时放在画面右下角
  const EXIT = 70;
  let exitStyle: React.CSSProperties;
  if (rotated) {
    const bottom = oy + STAGE_W * s;
    const room = vp.h - bottom;
    exitStyle =
      room >= EXIT
        ? { left: vp.w / 2, top: bottom + room / 2, transform: 'translate(-50%, -50%) rotate(90deg)' }
        : { left: ox - STAGE_H * s + 26, top: bottom - 46, transform: 'translate(-50%, -50%) rotate(90deg)' };
  } else {
    const right = ox + STAGE_W * s;
    const room = vp.w - right;
    exitStyle =
      room >= EXIT
        ? { left: right + room / 2, top: vp.h / 2, transform: 'translate(-50%, -50%)' }
        : { left: right - 46, top: oy + STAGE_H * s - 26, transform: 'translate(-50%, -50%)' };
  }

  return (
    <div className={`game-viewport${staged ? ' staged' : ''}`}>
      <div ref={ref} className={`game-stage${staged ? ' active' : ''}${rotated ? ' rotated' : ''}`} style={style}>
        {children}
      </div>
      {staged && portrait && touch && !rotated && (
        <div className="stage-rotate-bar" style={{ top: oy + STAGE_H * s + 18 }}>
          <button className="btn btn-primary stage-rotate-btn" onClick={() => void enterLandscape()}>
            ⟳ 横屏
          </button>
          <div className="muted small">横屏后画面更大，操作更方便</div>
        </div>
      )}
      {staged && forced && (
        <button className="btn btn-s stage-exit-btn" style={exitStyle} onClick={exitLandscape} title="退出横屏">
          ↺ 竖屏
        </button>
      )}
    </div>
  );
}
