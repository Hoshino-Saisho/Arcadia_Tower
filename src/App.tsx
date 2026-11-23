import { useEffect } from 'react';
import { useMusic } from './game/music';
import { ToastHost } from './ui/common/toast';
import { EditorApp } from './ui/editor/EditorApp';
import { LauncherPage } from './ui/launcher/LauncherPage';
import { BattlePage } from './ui/play/BattlePage';
import { ChapterSelectPage } from './ui/play/ChapterSelectPage';
import { CharactersPage } from './ui/play/CharactersPage';
import { CodexPage } from './ui/play/CodexPage';
import { GameStage } from './ui/play/GameStage';
import { HomePage } from './ui/play/HomePage';
import { LevelSelectPage } from './ui/play/LevelSelectPage';
import { navigate, useRoute } from './ui/router';
import { IS_WEB_PLAY } from './version';

export function App() {
  const route = useRoute();
  // 网页游玩版只有游戏：启动器 / 编辑器的地址都转到游戏主页
  const redirect = IS_WEB_PLAY && route.segments[0] !== 'game';
  useEffect(() => {
    if (redirect) navigate('/game');
  }, [redirect]);
  const [top, sub, arg] = redirect ? ['game'] : route.segments;
  const inBattle = top === 'game' && sub === 'play' && !!arg;

  useEffect(() => {
    document.title = top === 'editor' ? 'Arcadia Tower · 关卡编辑器' : top === 'game' ? 'Arcadia Tower' : 'Arcadia Tower 启动器';
  }, [top]);

  // 背景音乐：游戏的菜单页面播放主页音乐；战斗页面由 BattlePage 自己选择战斗音乐；启动器 / 编辑器不播放
  useMusic(top === 'game' && !inBattle ? { kind: 'home' } : inBattle ? { kind: 'battle', file: '' } : { kind: 'none' });

  let page: React.ReactNode;
  if (top === 'editor') {
    page = <EditorApp initialLevel={route.query.get('level') ?? undefined} />;
  } else if (top === 'game') {
    if (sub === 'chapters') page = <ChapterSelectPage />;
    else if (sub === 'chapter' && arg) page = <LevelSelectPage chapterId={arg} />;
    else if (sub === 'codex') page = <CodexPage />;
    else if (sub === 'characters') page = <CharactersPage />;
    else if (inBattle) page = <BattlePage key={arg + route.query.toString()} code={arg} test={route.query.get('test') === '1'} />;
    else page = <HomePage />;
  } else {
    page = <LauncherPage />;
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
