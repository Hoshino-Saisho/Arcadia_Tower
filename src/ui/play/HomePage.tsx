import { useEffect, useState } from 'react';
import { getBridge } from '../../core/storage/backend';
import { loadCurrency, loadProgress, saveProgress } from '../../core/storage/repository';
import type { CurrencyConfig, ProgressData } from '../../core/types';
import { music, useMusicState } from '../../game/music';
import { GAME_VERSION, IS_WEB_PLAY } from '../../version';
import { toast } from '../common/toast';
import { Wallet } from '../common/wallet';
import { navigate } from '../router';

/** 游戏主页：Play → 章节选择；下方是图鉴和角色设定；右上角是游戏外货币和经验书 */
export function HomePage() {
  const bridge = getBridge();
  const [wallet, setWallet] = useState<{ cfg: CurrencyConfig; progress: ProgressData } | null>(null);
  useEffect(() => {
    void Promise.all([loadCurrency(), loadProgress()]).then(([cfg, progress]) => setWallet({ cfg, progress }));
  }, []);
  return (
    <div className="home">
      <div className="home-bg" />
      {wallet && (
        <div className="home-wallet">
          <Wallet cfg={wallet.cfg} currency={wallet.progress.currency} books={wallet.progress.books} />
        </div>
      )}
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
            <span>用经验书升级 · 选择携带的技能</span>
          </button>
        </div>
        <div className="home-links">
          <MusicControl />
          <button
            className="btn btn-s btn-ghost"
            onClick={async () => {
              const name = wallet?.cfg.name ?? '货币';
              if (!window.confirm(`确定要重置全部进度吗？\n通关记录、${name}、经验书和角色等级都会清空（携带的技能设定会保留）。`)) return;
              const p = await loadProgress();
              const next: ProgressData = { ...p, cleared: [], currency: 0, books: {}, levels: {} };
              await saveProgress(next);
              setWallet((w) => (w ? { ...w, progress: next } : w));
              toast('进度已重置', 'ok');
            }}
          >
            重置进度
          </button>
          {!bridge && !IS_WEB_PLAY && (
            <button className="btn btn-s btn-ghost" onClick={() => navigate('/')}>
              返回启动器
            </button>
          )}
        </div>
      </div>
      <div className="version-tag">
        v{GAME_VERSION}
        {IS_WEB_PLAY && ' · 网页版（进度保存在本浏览器）'}
      </div>
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
