import { useEffect, useState } from 'react';
import { characterProgress } from '../../core/leveling';
import { SQUAD_SIZE, resolveSquad } from '../../core/squad';
import { loadDatabase, loadProgress, saveProgress, type GameDatabase } from '../../core/storage/repository';
import type { CharacterDef } from '../../core/types';
import { describeUnlock, isOwned, ownedCharacters, unlockOf } from '../../core/unlock';
import { toast } from '../common/toast';
import { UnitToken } from '../common/tokens';
import { navigate } from '../router';

/**
 * 编队：选择出战的角色（最多 12 个，按顺序显示在战斗的部署栏里）。只有已获得的角色可以出战，
 * 没有获得的角色显示在最后（灰色），点击查看获得方式。关卡只允许部分角色时，出战的是编队里本关可用的角色。
 */
export function SquadPage() {
  const [db, setDb] = useState<GameDatabase | null>(null);
  const [squad, setSquad] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    loadDatabase().then((d) => {
      setDb(d);
      setSquad(resolveSquad(ownedCharacters(d.characters, d.progress), d.progress.squad).map((c) => c.id));
    }, (e) => setError(String(e)));
  }, []);
  if (error) return <div className="page-msg">读取数据失败：{error}</div>;
  if (!db) return <div className="page-msg">加载中…</div>;

  const byId = new Map(db.characters.map((c) => [c.id, c]));
  const owned = ownedCharacters(db.characters, db.progress);
  const locked = db.characters.filter((c) => !isOwned(c, db.progress));
  const persist = (next: string[]) => {
    setSquad(next);
    void (async () => {
      try {
        const p = await loadProgress();
        await saveProgress({ ...p, squad: next });
      } catch (err) {
        toast(`保存失败：${String(err)}`, 'error');
      }
    })();
  };
  const toggle = (id: string) => {
    if (squad.includes(id)) return persist(squad.filter((x) => x !== id));
    const c = byId.get(id);
    if (c && !isOwned(c, db.progress)) return toast(`还没有获得${c.name}：${describeUnlock(unlockOf(c), db.currency.name)}`, 'info', 2600);
    if (squad.length >= SQUAD_SIZE) return toast(`编队最多 ${SQUAD_SIZE} 个角色，请先移除一个`, 'error', 1800);
    persist([...squad, id]);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= squad.length) return;
    const next = squad.slice();
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };
  const lv = (c: CharacterDef) => characterProgress(db.currency, db.progress, c.id).level;

  return (
    <div className="select-page codex squad-page">
      <header className="select-head">
        <button className="btn btn-ghost" onClick={() => navigate('/game')}>
          ← 返回
        </button>
        <h2>
          编队{' '}
          <span className={`squad-count${squad.length >= SQUAD_SIZE ? ' full' : ''}`}>
            {squad.length}/{SQUAD_SIZE}
          </span>
        </h2>
        <div className="row gap-s">
          <button className="btn btn-s btn-ghost" onClick={() => persist(owned.slice(0, SQUAD_SIZE).map((c) => c.id))} title={`使用前 ${SQUAD_SIZE} 个已拥有的角色`}>
            默认编队
          </button>
          <button className="btn btn-s btn-ghost" disabled={!squad.length} onClick={() => persist([])}>
            清空
          </button>
        </div>
      </header>

      <div className="squad-slots">
        {Array.from({ length: SQUAD_SIZE }, (_, i) => {
          const c = byId.get(squad[i] ?? '');
          return c ? (
            <div key={i} className="squad-slot filled">
              <span className="squad-slot-no mono">{i + 1}</span>
              <button className="squad-slot-body" onClick={() => toggle(c.id)} title="点击移出编队">
                <UnitToken kind="character" def={c} size={44} />
                <span className="squad-slot-name">{c.name}</span>
                <span className="muted small mono">Lv.{lv(c)} · {c.cost}</span>
              </button>
              <div className="squad-slot-move">
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="往前移" aria-label="往前移">
                  ‹
                </button>
                <button className="icon-btn" disabled={i === squad.length - 1} onClick={() => move(i, 1)} title="往后移" aria-label="往后移">
                  ›
                </button>
              </div>
            </div>
          ) : (
            <div key={i} className="squad-slot empty">
              <span className="squad-slot-no mono">{i + 1}</span>
              <span className="muted small">空位</span>
            </div>
          );
        })}
      </div>
      <div className="muted small squad-hint">
        点击下方的角色加入 / 移出编队；顺序就是战斗中部署栏的顺序（数字键 1~9、0 选择）。关卡只允许部分角色时，出战的是编队里本关可用的角色。
        {!squad.length && ` 编队为空时使用前 ${SQUAD_SIZE} 个已拥有的角色。`}
        {locked.length > 0 && ' 灰色的角色还没有获得，可以在商店购买或达成条件后获得。'}
      </div>

      <div className="codex-grid squad-grid">
        {owned.map((c) => {
          const at = squad.indexOf(c.id);
          return (
            <button key={c.id} className={`codex-entry${at >= 0 ? ' active' : ''}`} onClick={() => toggle(c.id)}>
              {at >= 0 && <span className="squad-mark mono">{at + 1}</span>}
              <span className="lv-badge">Lv.{lv(c)}</span>
              <UnitToken kind="character" def={c} size={48} />
              <span className="codex-entry-name">{c.name}</span>
              <span className="muted small">
                费用 {c.cost} · {c.placement === 'ground' ? '地面' : c.placement === 'high' ? '高台' : '均可'}
                {c.attackType === 'summon' ? ' · 召唤' : ''}
              </span>
            </button>
          );
        })}
        {locked.map((c) => (
          <button key={c.id} className="codex-entry locked" onClick={() => toggle(c.id)} title={describeUnlock(unlockOf(c), db.currency.name)}>
            <span className="lock-badge">未获得</span>
            <UnitToken kind="character" def={c} size={48} dim />
            <span className="codex-entry-name">{c.name}</span>
            <span className="muted small">{unlockOf(c).mode === 'shop' ? '在商店购买' : '达成条件后获得'}</span>
          </button>
        ))}
      </div>
      {locked.some((c) => unlockOf(c).mode === 'shop') && (
        <div className="row center squad-shop-link">
          <button className="btn btn-s" onClick={() => navigate('/game/shop')}>
            去商店看看 →
          </button>
        </div>
      )}
    </div>
  );
}
