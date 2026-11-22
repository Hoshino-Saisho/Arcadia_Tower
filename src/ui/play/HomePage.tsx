import { getBridge } from '../../core/storage/backend';
import { loadProgress, saveProgress } from '../../core/storage/repository';
import { music, useMusicState } from '../../game/music';
import { GAME_VERSION } from '../../version';
import { toast } from '../common/toast';
import { navigate } from '../router';

/** 游戏主页：Play → 章节选择；下方是图鉴和角色设定 */
export function HomePage() {
  const bridge = getBridge();
  return (
    <div className="home">
      <div className="home-bg" />
      <div className="home-content">
        <div className="home-kicker">2D TOWER DEFENSE</div>
        <h1 className="home-title">
          ARCADIA
          <br />
          TOWER
        </h1>
        <button className="play-btn" onClick={() => navigate('/game/chapters')}>
          Play
        </button>
        <div className="home-menu">
          <button className="home-menu-btn" onClick={() => navigate('/game/codex')}>
            <strong>图鉴</strong>
            <span>角色与敌人的数值和技能</span>
          </button>
          <button className="home-menu-btn" onClick={() => navigate('/game/characters')}>
            <strong>角色设定</strong>
            <span>选择每个角色携带的技能</span>
          </button>
        </div>
        <div className="home-links">
          <MusicControl />
          <button
            className="btn btn-s btn-ghost"
            onClick={async () => {
              if (!window.confirm('确定要重置全部通关进度吗？（角色设定会保留）')) return;
              const p = await loadProgress();
              await saveProgress({ ...p, cleared: [] });
              toast('进度已重置', 'ok');
            }}
          >
            重置进度
          </button>
          {!bridge && (
            <button className="btn btn-s btn-ghost" onClick={() => navigate('/')}>
              返回启动器
            </button>
          )}
        </div>
      </div>
      <div className="version-tag">v{GAME_VERSION}</div>
    </div>
  );
}

/** 音乐音量 / 静音 */
export function MusicControl({ compact }: { compact?: boolean }) {
  const st = useMusicState();
  return (
    <div className={`music-control${compact ? ' compact' : ''}`} title={st.nowPlaying ? `正在播放：${st.nowPlaying}` : '没有正在播放的音乐'}>
      <button className="icon-btn" onClick={() => music.setMuted(!st.muted)} aria-label={st.muted ? '取消静音' : '静音'}>
        {st.muted || st.volume === 0 ? '🔇' : '♪'}
      </button>
      <input type="range" min={0} max={100} value={Math.round(st.volume * 100)} onChange={(e) => music.setVolume(Number(e.target.value) / 100)} aria-label="音乐音量" />
    </div>
  );
}
