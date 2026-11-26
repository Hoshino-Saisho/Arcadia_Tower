import { Suspense, lazy, useEffect, type ComponentType } from 'react';
import { useMusic } from './game/music';
import { ToastHost } from './ui/common/toast';
import { BattlePage } from './ui/play/BattlePage';
import { ChapterSelectPage } from './ui/play/ChapterSelectPage';
import { CharactersPage } from './ui/play/CharactersPage';
import { CodexPage } from './ui/play/CodexPage';
import { EndlessPage } from './ui/play/EndlessPage';
import { GameStage } from './ui/play/GameStage';
import { HomePage } from './ui/play/HomePage';
import { LevelSelectPage } from './ui/play/LevelSelectPage';
import { ShopPage } from './ui/play/ShopPage';
import { SquadPage } from './ui/play/SquadPage';
import { navigate, useRoute } from './ui/router';
import { IS_WEB_PLAY } from './version';

/**
 * 编辑器和启动器（含 GitHub 同步）的源代码只保存在本机，不上传到公开的 GitHub 仓库：
 * 文件存在时才加载（按需加载）；网页游玩版（mode = pages）完全不包含这些代码。
 */
const TOOLS = import.meta.env.MODE !== 'pages';
const EditorApp = lazyModule<{ initialLevel?: string }>(TOOLS ? import.meta.glob('./ui/editor/EditorApp.tsx') : {}, 'EditorApp');
const LauncherPage = lazyModule<object>(TOOLS ? import.meta.glob('./ui/launcher/LauncherPage.tsx') : {}, 'LauncherPage');

function lazyModule<P>(mods: Record<string, () => Promise<unknown>>, name: string): ComponentType<P> | null {
  const load = Object.values(mods)[0];
  if (!load) return null;
  return lazy(async () => ({ default: ((await load()) as Record<string, ComponentType<P>>)[name] }));
}

export function App() {
  const route = useRoute();
  // 网页游玩版只有游戏：启动器 / 编辑器的地址都转到游戏主页（没有启动器的版本也一样）
  const redirect = (IS_WEB_PLAY || !LauncherPage) && route.segments[0] !== 'game' && !(route.segments[0] === 'editor' && EditorApp);
  useEffect(() => {
    if (redirect) navigate('/game');
  }, [redirect]);
  const [top, sub, arg] = redirect ? ['game'] : route.segments;
  const endlessBattle = top === 'game' && sub === 'endless' && arg === 'play';
  const inBattle = (top === 'game' && sub === 'play' && !!arg) || endlessBattle;

  useEffect(() => {
    document.title = top === 'editor' ? 'Arcadia Tower · 关卡编辑器' : top === 'game' ? 'Arcadia Tower' : 'Arcadia Tower 启动器';
  }, [top]);

  // 背景音乐：游戏的菜单页面播放主页音乐；战斗页面由 BattlePage 自己选择战斗音乐；启动器 / 编辑器不播放
  useMusic(top === 'game' && !inBattle ? { kind: 'home' } : inBattle ? { kind: 'battle', file: '' } : { kind: 'none' });

  let page: React.ReactNode;
  if (top === 'editor' && EditorApp) {
    page = (
      <Suspense fallback={<div className="page-msg">加载编辑器…</div>}>
        <EditorApp initialLevel={route.query.get('level') ?? undefined} />
      </Suspense>
    );
  } else if (top === 'game') {
    if (sub === 'chapters') page = <ChapterSelectPage />;
    else if (sub === 'chapter' && arg) page = <LevelSelectPage chapterId={arg} />;
    else if (sub === 'codex') page = <CodexPage />;
    else if (sub === 'characters') page = <CharactersPage />;
    else if (sub === 'squad') page = <SquadPage />;
    else if (sub === 'shop') page = <ShopPage />;
    else if (endlessBattle) page = <BattlePage key={'endless' + route.query.toString()} code="" endless test={route.query.get('test') === '1'} />;
    else if (sub === 'endless') page = <EndlessPage />;
    else if (inBattle) page = <BattlePage key={arg + route.query.toString()} code={arg} test={route.query.get('test') === '1'} />;
    else page = <HomePage />;
  } else if (LauncherPage) {
    page = (
      <Suspense fallback={<div className="page-msg">加载中…</div>}>
        <LauncherPage />
      </Suspense>
    );
  } else {
    page = <div className="page-msg">加载中…</div>;
  }
  // 游戏页面放在舞台里：手机上等比缩放 / 横屏（提示消息也在舞台里，横屏时跟着旋转）
  if (top === 'game') {
    return (
      <GameStage>
        {page}
        <ToastHost />
      </GameStage>
    );
  }
  return (
    <>
      {page}
      <ToastHost />
    </>
  );
}
