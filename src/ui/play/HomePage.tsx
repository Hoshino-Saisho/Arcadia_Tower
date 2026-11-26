import { useEffect, useState } from 'react';
import { getBridge } from '../../core/storage/backend';
import { loadCharacters, loadCurrency, loadEndless, loadProgress, saveProgress } from '../../core/storage/repository';
import type { CharacterDef, CurrencyConfig, EndlessConfig, ProgressData } from '../../core/types';
import { buyableCount, isOwned, ownedCharacters, unlockOf } from '../../core/unlock';
import { music, useMusicState } from '../../game/music';
import { GAME_VERSION, IS_WEB_PLAY } from '../../version';
import { toast } from '../common/toast';
import { Wallet } from '../common/wallet';
import { navigate } from '../router';

/** 游戏主页：Play → 章节选择；下方是编队、商店、图鉴和角色设定；右上角是游戏外货币和经验书 */
export function HomePage() {
  const bridge = getBridge();
  const [wallet, setWallet] = useState<{ cfg: CurrencyConfig; progress: ProgressData } | null>(null);
  const [endless, setEndless] = useState<EndlessConfig | null>(null);
  const [characters, setCharacters] = useState<CharacterDef[]>([]);
  useEffect(() => {
    void Promise.all([loadCurrency(), loadProgress()]).then(([cfg, progress]) => setWallet({ cfg, progress }));
    void loadEndless().then(setEndless);
    void loadCharacters().then(setCharacters);
  }, []);
  const endlessLocked = !!endless?.unlockAfter && !wallet?.progress.cleared.includes(endless.unlockAfter);
  // 商店：还没有获得的「商店购买」角色，其中现在就能买的
  const forSale = wallet ? characters.filter((c) => unlockOf(c).mode === 'shop' && !isOwned(c, wallet.progress)).length : 0;
  const buyable = wallet ? buyableCount(characters, wallet.progress) : 0;
  // 编队里实际能出战的角色（没有获得的角色不算）
  const ownedIds = wallet ? new Set(ownedCharacters(characters, wallet.progress).map((c) => c.id)) : new Set<string>();
  const squadCount = wallet ? wallet.progress.squad.filter((id) => ownedIds.has(id)).length : 0;
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
          <button className="home-menu-btn" onClick={() => navigate('/game/squad')}>
            <strong>编队</strong>
            <span>{squadCount ? `已选择 ${squadCount} / 12 个角色` : '选择出战的角色（最多 12 个）'}</span>
          </button>
          <button className={`home-menu-btn shop${buyable > 0 ? ' has-new' : ''}`} onClick={() => navigate('/game/shop')}>
            <strong>商店{buyable > 0 && <span className="home-menu-dot">{buyable}</span>}</strong>
            <span>{forSale ? `用${wallet?.cfg.name ?? '货币'}兑换角色 · ${buyable > 0 ? `${buyable} 个可以购买` : `${forSale} 个出售中`}` : `用${wallet?.cfg.name ?? '货币'}兑换角色`}</span>
          </button>
          <button className="home-menu-btn" onClick={() => navigate('/game/codex')}>
            <strong>图鉴</strong>
            <span>角色与敌人的数值和技能</span>
          </button>
          <button className="home-menu-btn" onClick={() => navigate('/game/characters')}>
            <strong>角色设定</strong>
            <span>用经验书升级 · 选择携带的技能</span>
          </button>
          {endless?.enabled && (
            <button className={`home-menu-btn endless${endlessLocked ? ' locked' : ''}`} onClick={() => navigate('/game/endless')}>
              <strong>∞ {endless.name}</strong>
              <span>
                {endlessLocked
                  ? `通关 ${endless.unlockAfter} 后解锁`
                  : wallet?.progress.endlessBest
                    ? `最好成绩 ${Math.round(wallet.progress.endlessBest.score)} 分`
                    : '一波一波，坚持越久分数越高'}
              </span>
            </button>
          )}
        </div>
        <div className="home-links">
          <MusicControl />
          <button
            className="btn btn-s btn-ghost"
            onClick={async () => {
              const name = wallet?.cfg.name ?? '货币';
              if (!window.confirm(`确定要重置全部进度吗？\n通关记录、${name}、经验书、获得的角色、角色等级和无尽模式成绩都会清空（携带的技能设定会保留）。`)) return;
              const p = await loadProgress();
              const next: ProgressData = { ...p, cleared: [], currency: 0, books: {}, levels: {}, endlessBest: null, owned: [] };
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
