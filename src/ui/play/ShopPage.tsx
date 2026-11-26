import { useEffect, useState } from 'react';
import { formatCount } from '../../core/leveling';
import { loadDatabase, loadProgress, saveProgress, type GameDatabase } from '../../core/storage/repository';
import type { CharacterDef, CurrencyConfig, ProgressData } from '../../core/types';
import { resolveSquad } from '../../core/squad';
import { buyCharacter, conditionText, isOwned, missingConditions, ownedCharacters, unlockOf } from '../../core/unlock';
import { toast } from '../common/toast';
import { UnitToken } from '../common/tokens';
import { CurrencyBadge, Wallet } from '../common/wallet';
import { navigate } from '../router';
import { CharacterDetail } from './CodexPage';

/**
 * 商店：用游戏外货币（战斗外的货币）兑换角色。
 * 出售的是获得方式为「商店购买」的角色（有条件的要先达成条件）；也列出满足条件后自动获得、还没有获得的角色。
 */
export function ShopPage() {
  const [db, setDb] = useState<GameDatabase | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  /** 正在确认购买的角色 */
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    loadDatabase().then(
      (d) => {
        setDb(d);
        setProgress(d.progress);
      },
      (e) => setError(String(e)),
    );
  }, []);
  if (error) return <div className="page-msg">读取数据失败：{error}</div>;
  if (!db || !progress) return <div className="page-msg">加载中…</div>;

  const cur = db.currency;
  const shop = db.characters.filter((c) => unlockOf(c).mode === 'shop');
  const forSale = shop.filter((c) => !isOwned(c, progress));
  const bought = shop.filter((c) => isOwned(c, progress));
  const autos = db.characters.filter((c) => unlockOf(c).mode === 'auto' && !isOwned(c, progress));
  const current = db.characters.find((c) => c.id === sel) ?? forSale[0] ?? autos[0] ?? bought[0] ?? null;
  const skillMap = new Map(db.skills.map((s) => [s.id, s]));
  const summonMap = new Map(db.summons.map((s) => [s.id, s]));

  const buy = async (def: CharacterDef) => {
    if (busy) return;
    setBusy(true);
    try {
      // 用最新的进度购买（避免覆盖其他页面的修改）
      const latest = await loadProgress();
      const r = buyCharacter(def, latest, db.characters, cur.name);
      if (!r.ok) {
        toast(r.error, 'error', 2200);
        return;
      }
      await saveProgress(r.progress);
      setProgress(r.progress);
      setConfirm(null);
      // 继续显示刚买到的角色（已拥有）
      setSel(def.id);
      // 实际出战的编队里多了这个角色（编队有空位、以前就记着它，或者编队是默认的前 12 个）
      const team = (p: ProgressData) => resolveSquad(ownedCharacters(db.characters, p), p.squad).map((c) => c.id);
      const joined = team(r.progress).includes(def.id) && !team(latest).includes(def.id);
      toast(`获得新角色：${def.name}${joined ? '（已加入编队）' : ''}`, 'ok', 2400);
    } catch (err) {
      toast(`购买失败：${String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const entry = (c: CharacterDef) => {
    const u = unlockOf(c);
    const owned = isOwned(c, progress);
    const miss = missingConditions(u, progress);
    let state: string;
    let cls = '';
    if (owned) {
      state = '已拥有';
      cls = ' owned';
    } else if (miss.length) {
      state = `🔒 ${u.mode === 'auto' ? '' : '需要'}${conditionText(u)}`;
      cls = ' locked';
    } else if (u.mode === 'auto') {
      state = '即将获得';
    } else if (progress.currency < u.price) {
      state = `还差 ${formatCount(u.price - progress.currency)}`;
      cls = ' poor';
    } else {
      state = '可以购买';
      cls = ' ready';
    }
    return (
      <button
        key={c.id}
        className={`codex-entry shop-entry${current?.id === c.id ? ' active' : ''}${cls}`}
        onClick={() => {
          setSel(c.id);
          setConfirm(null);
        }}
      >
        <UnitToken kind="character" def={c} size={48} dim={!owned && miss.length > 0} />
        <span className="codex-entry-name">{c.name}</span>
        {u.mode === 'shop' && !owned && <CurrencyBadge name={cur.name} color={cur.color} amount={u.price} />}
        <span className="shop-state small">{state}</span>
      </button>
    );
  };

  return (
    <div className="select-page codex shop-page">
      <header className="select-head">
        <button className="btn btn-ghost" onClick={() => navigate('/game')}>
          ← 返回
        </button>
        <h2>
          商店 <span className="muted small">用{cur.name}兑换角色</span>
        </h2>
        <Wallet cfg={cur} currency={progress.currency} books={progress.books} />
      </header>
      <div className="codex-body">
        <div className="shop-list">
          <h3 className="shop-section">
            出售中 <span className="muted small">{forSale.length} 个角色</span>
          </h3>
          <div className="codex-grid">
            {forSale.map(entry)}
            {forSale.length === 0 && <div className="empty-hint">{shop.length ? '商店里的角色都已经买到了' : '商店里还没有角色'}</div>}
          </div>
          {autos.length > 0 && (
            <>
              <h3 className="shop-section">
                达成条件后自动获得 <span className="muted small">不用购买</span>
              </h3>
              <div className="codex-grid">{autos.map(entry)}</div>
            </>
          )}
          {bought.length > 0 && (
            <>
              <h3 className="shop-section">已购买</h3>
              <div className="codex-grid">{bought.map(entry)}</div>
            </>
          )}
        </div>
        {current ? (
          <section className="codex-detail">
            <CharacterDetail
              def={current}
              skills={skillMap}
              summons={summonMap}
              choice={progress.summonChoice}
              extra={<BuyPanel def={current} progress={progress} cur={cur} confirming={confirm === current.id} busy={busy} onAsk={() => setConfirm(current.id)} onCancel={() => setConfirm(null)} onBuy={() => void buy(current)} />}
            />
          </section>
        ) : (
          <section className="codex-detail empty-hint">商店里还没有角色</section>
        )}
      </div>
    </div>
  );
}

/** 选中角色的购买面板：价格、条件、购买按钮（点一次后再确认） */
function BuyPanel({
  def,
  progress,
  cur,
  confirming,
  busy,
  onAsk,
  onCancel,
  onBuy,
}: {
  def: CharacterDef;
  progress: ProgressData;
  cur: CurrencyConfig;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onBuy: () => void;
}) {
  const u = unlockOf(def);
  const owned = isOwned(def, progress);
  const miss = missingConditions(u, progress);
  if (owned) {
    return (
      <div className="shop-buy owned">
        <strong>已拥有</strong>
        <span className="muted small">可以在「编队」中让它出战，在「角色设定」中升级</span>
      </div>
    );
  }
  if (u.mode !== 'shop') {
    return (
      <div className="shop-buy">
        <strong>达成条件后自动获得</strong>
        {miss.length ? (
          <ul className="shop-missing">
            {miss.map((m) => (
              <li key={m}>🔒 {m}</li>
            ))}
          </ul>
        ) : (
          <span className="muted small">条件已经达成，下一次战斗结算时获得</span>
        )}
      </div>
    );
  }
  const short = Math.max(0, u.price - progress.currency);
  const can = !miss.length && short === 0;
  return (
    <div className="shop-buy">
      <div className="shop-price-line">
        <span className="muted small">价格</span>
        {u.price > 0 ? <CurrencyBadge name={cur.name} color={cur.color} amount={u.price} /> : <strong>免费</strong>}
        <span className="muted small">· 现在有</span>
        <CurrencyBadge name={cur.name} color={cur.color} amount={progress.currency} />
      </div>
      {miss.length > 0 && (
        <ul className="shop-missing">
          {miss.map((m) => (
            <li key={m}>🔒 需要先{m}</li>
          ))}
        </ul>
      )}
      {confirming ? (
        <div className="row gap-s">
          <button className="btn btn-primary" disabled={busy} onClick={onBuy}>
            确认{u.price > 0 ? `花 ${formatCount(u.price)} ${cur.name}购买` : '领取'}
          </button>
          <button className="btn" onClick={onCancel}>
            取消
          </button>
        </div>
      ) : (
        <button className="btn btn-primary" disabled={!can} onClick={onAsk}>
          {u.price > 0 ? `购买 ${def.name}` : `免费领取 ${def.name}`}
        </button>
      )}
      {!miss.length && short > 0 && (
        <span className="muted small">
          还差 {formatCount(short)} {cur.name}：通关关卡或在无尽模式中获得
        </span>
      )}
    </div>
  );
}
