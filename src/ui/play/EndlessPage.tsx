import { useEffect, useState } from 'react';
import { formatCount } from '../../core/leveling';
import { loadDatabase, type GameDatabase } from '../../core/storage/repository';
import { TileGrid } from '../../core/tiles';
import { BookChip, CurrencyBadge, Wallet } from '../common/wallet';
import { navigate } from '../router';

/** 无尽模式：规则说明、最好成绩、分数兑换，开始挑战 */
export function EndlessPage() {
  const [db, setDb] = useState<GameDatabase | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    loadDatabase().then(setDb, (e) => setError(String(e)));
  }, []);
  if (error) return <div className="page-msg">读取数据失败：{error}</div>;
  if (!db) return <div className="page-msg">加载中…</div>;

  const cfg = db.endless;
  const cur = db.currency;
  const best = db.progress.endlessBest;
  const locked = !!cfg.unlockAfter && !db.progress.cleared.includes(cfg.unlockAfter);
  const grid = TileGrid.fromLevel(cfg.map);
  const ready = grid.find('spawn').length > 0 && grid.find('base').length > 0;

  return (
    <div className="select-page">
      <header className="select-head">
        <button className="btn btn-ghost" onClick={() => navigate('/game')}>
          ← 返回
        </button>
        <h2>
          <span className="accent">∞</span> {cfg.name}
        </h2>
        <Wallet cfg={cur} currency={db.progress.currency} books={db.progress.books} />
      </header>
      {!cfg.enabled ? (
        <div className="page-msg">{cfg.name}还没有开放</div>
      ) : (
        <div className="endless-intro">
          <div className="endless-best">
            <span className="muted small">最好成绩</span>
            {best ? (
              <strong className="mono">
                {formatCount(best.score)} 分 · 第 {best.wave} 波 · {formatTime(best.time)}
              </strong>
            ) : (
              <strong className="muted">还没有记录</strong>
            )}
          </div>
          <ul className="endless-rule-list">
            <li>
              敌人一波一波不断出现（每 {cfg.waveInterval} 秒一波），越往后越多、越强（每波生命 {signed(cfg.hpGrowth)}%、攻击 {signed(cfg.atkGrowth)}%）。
            </li>
            <li>一开始只会出现难度低的敌人，难度高的敌人在后面的波次出现。</li>
            <li>击败敌人获得分数；基地血量归零或主动「结束挑战」时结算，分数兑换成奖励。</li>
          </ul>
          <div className="endless-rates">
            <span className="muted small">分数兑换</span>
            <span className="reward-chips">
              <span className="rate-chip">
                每 {formatCount(cfg.currencyRate.score)} 分 → <CurrencyBadge name={cur.name} color={cur.color} amount={cfg.currencyRate.amount} />
              </span>
              {cfg.bookRates.map((r, i) => {
                const b = cur.books.find((x) => x.id === r.bookId);
                return b ? (
                  <span key={i} className="rate-chip">
                    每 {formatCount(r.score)} 分 → <BookChip book={b} count={r.amount} />
                  </span>
                ) : null;
              })}
            </span>
          </div>
          <button className="play-btn" disabled={locked || !ready} onClick={() => navigate('/game/endless/play')}>
            开始挑战
          </button>
          {locked && <div className="muted">通关 {cfg.unlockAfter} 后解锁</div>}
          {!ready && <div className="field-error">无尽模式的地图还没有搭建好（需要敌人出现点和基地）</div>}
        </div>
      )}
    </div>
  );
}

function signed(v: number): string {
  return v >= 0 ? `+${v}` : `−${Math.abs(v)}`;
}

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
