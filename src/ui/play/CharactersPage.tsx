import { useEffect, useMemo, useState } from 'react';
import { resolveLoadout } from '../../core/defaults';
import { describeAttack } from '../../core/describe';
import { formatNumber } from '../../core/stats';
import { addExp, applyBooks, characterProgress, expTable, expToNext, formatCount, leveledCharacter, usefulBooks } from '../../core/leveling';
import { loadDatabase, loadProgress, saveProgress, type GameDatabase } from '../../core/storage/repository';
import type { CharacterDef, CurrencyConfig, ProgressData, SkillDef } from '../../core/types';
import { SkillCard } from '../common/skillCard';
import { toast } from '../common/toast';
import { UnitToken } from '../common/tokens';
import { CurrencyBadge, Wallet } from '../common/wallet';
import { navigate } from '../router';

/**
 * 角色设定：用经验书给角色升级，选择每个角色在战斗中携带的技能。
 * 例如角色只能携带 1 个技能但拥有 3 个技能时，在 3 个技能中选择 1 个。
 */
export function CharactersPage() {
  const [db, setDb] = useState<GameDatabase | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  useEffect(() => {
    void loadDatabase().then((d) => {
      setDb(d);
      setProgress(d.progress);
    });
  }, []);
  if (!db || !progress) return <div className="page-msg">加载中…</div>;

  const cfg = db.currency;
  const def = db.characters.find((c) => c.id === sel) ?? db.characters[0];
  const skillMap = new Map(db.skills.map((s) => [s.id, s]));
  const loadouts = progress.loadouts;

  /** 读取最新的进度再修改后保存（避免覆盖其他页面的修改） */
  const persist = async (fn: (p: ProgressData) => ProgressData | null): Promise<ProgressData | null> => {
    try {
      const next = fn(await loadProgress());
      if (!next) return null;
      await saveProgress(next);
      setProgress(next);
      return next;
    } catch (err) {
      toast(`保存失败：${String(err)}`, 'error');
      return null;
    }
  };

  const setLoadout = (id: string, skills: string[] | null) =>
    void persist((p) => {
      const next = { ...p.loadouts };
      if (skills) next[id] = skills;
      else delete next[id];
      return { ...p, loadouts: next };
    });

  const toggle = (skillId: string) => {
    if (!def) return;
    const cur = resolveLoadout(def, loadouts[def.id]);
    let next: string[];
    if (cur.includes(skillId)) {
      if (cur.length <= 1) return toast('至少携带 1 个技能；点击其他技能即可替换', 'info', 1800);
      next = cur.filter((id) => id !== skillId);
    } else if (cur.length < def.skillSlots) {
      next = [...cur, skillId];
    } else if (def.skillSlots === 1) {
      next = [skillId];
    } else {
      return toast(`最多携带 ${def.skillSlots} 个技能，请先取消一个`, 'error', 1800);
    }
    // 按角色技能列表的顺序保存
    setLoadout(def.id, def.skills.filter((id) => next.includes(id)));
  };

  return (
    <div className="select-page codex">
      <header className="select-head">
        <button className="btn btn-ghost" onClick={() => navigate('/game')}>
          ← 返回
        </button>
        <h2>
          角色设定 <span className="muted small">升级 · 携带技能</span>
        </h2>
        <Wallet cfg={cfg} currency={progress.currency} books={progress.books} />
      </header>
      <div className="codex-body">
        <div className="codex-grid">
          {db.characters.map((c) => {
            const eq = resolveLoadout(c, loadouts[c.id]);
            const lv = characterProgress(cfg, progress, c.id).level;
            return (
              <button key={c.id} className={`codex-entry${def?.id === c.id ? ' active' : ''}`} onClick={() => setSel(c.id)}>
                <span className="lv-badge">Lv.{lv}</span>
                <UnitToken kind="character" def={c} size={48} />
                <span className="codex-entry-name">{c.name}</span>
                <span className="muted small">
                  技能 {eq.length}/{c.skillSlots}
                </span>
              </button>
            );
          })}
        </div>
        {def && (
          <section className="codex-detail">
            <LevelPanel
              key={def.id}
              def={def}
              cfg={cfg}
              progress={progress}
              onUse={async (bookId, count) => {
                const r = applyBooks(cfg, progress, def.id, bookId, count);
                if (!r.ok) return toast(r.error, 'error', 2000);
                // 保存时用最新的进度重新计算一次
                let result = r;
                const saved = await persist((p) => {
                  const again = applyBooks(cfg, p, def.id, bookId, count);
                  if (!again.ok) {
                    toast(again.error, 'error', 2000);
                    return null;
                  }
                  result = again;
                  return again.progress;
                });
                if (!saved || !result.ok) return;
                toast(
                  result.levels > 0
                    ? `「${def.name}」升到 Lv.${result.result.level}（+${formatCount(result.exp)} 经验，消耗 ${formatCount(result.cost)} ${cfg.name}）`
                    : `「${def.name}」+${formatCount(result.exp)} 经验（消耗 ${formatCount(result.cost)} ${cfg.name}）`,
                  'ok',
                  2200,
                );
              }}
            />

            <h3 className="codex-sub">
              携带技能 <span className="muted small">（战斗中可携带 {def.skillSlots} 个，共有 {def.skills.length} 个技能可选）</span>
            </h3>
            {def.skills.length === 0 && <div className="muted">这个角色没有技能</div>}
            {def.skillSlots === 0 && def.skills.length > 0 && <div className="muted">这个角色不能携带技能</div>}
            <div className="skill-list">
              {def.skills
                .map((id) => skillMap.get(id))
                .filter((s): s is SkillDef => !!s)
                .map((s) => {
                  const equipped = resolveLoadout(def, loadouts[def.id]).includes(s.id);
                  return (
                    <SkillCard
                      key={s.id}
                      skill={s}
                      selected={equipped}
                      badge={equipped ? '已携带' : undefined}
                      disabled={def.skillSlots === 0}
                      onClick={() => toggle(s.id)}
                    />
                  );
                })}
            </div>
            {loadouts[def.id] && (
              <button className="btn btn-s btn-ghost" onClick={() => setLoadout(def.id, null)}>
                恢复默认（携带前 {def.skillSlots} 个技能）
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** 等级、经验、当前数值和使用经验书 */
function LevelPanel({
  def,
  cfg,
  progress,
  onUse,
}: {
  def: CharacterDef;
  cfg: CurrencyConfig;
  progress: ProgressData;
  onUse: (bookId: string, count: number) => void;
}) {
  const table = useMemo(() => expTable(cfg), [cfg]);
  const cur = characterProgress(cfg, progress, def.id);
  const need = expToNext(cfg, cur.level, table);
  const maxed = cur.level >= cfg.maxLevel;
  const firstOwned = cfg.books.find((b) => (progress.books[b.id] ?? 0) > 0) ?? cfg.books[0];
  const [bookId, setBookId] = useState<string | null>(firstOwned?.id ?? null);
  const [count, setCount] = useState(1);
  const book = cfg.books.find((b) => b.id === bookId) ?? null;

  const owned = book ? progress.books[book.id] ?? 0 : 0;
  const affordable = book ? (book.cost > 0 ? Math.floor(progress.currency / book.cost) : Infinity) : 0;
  const useful = book ? usefulBooks(cfg, cur, book) : 0;
  const maxCount = Math.max(0, Math.min(owned, affordable, useful));
  const n = Math.max(1, Math.min(count, Math.max(1, maxCount)));
  const after = book ? addExp(cfg, cur, book.exp * n, table) : null;
  const cost = book ? book.cost * n : 0;
  const reason = !book
    ? '还没有经验书（在「货币编辑」中添加）'
    : maxed
      ? '已经满级'
      : owned < 1
        ? `没有${book.name}，通关关卡可以获得`
        : progress.currency < book.cost
          ? `${cfg.name}不足`
          : null;

  const healer = def.attackTarget === 'ally' && def.atk < 0;
  const now = leveledCharacter(def, cur.level);
  const next = after ? leveledCharacter(def, after.result.level) : now;
  /** 当前数值；选好经验书后显示升级后的数值 */
  const stat = (label: string, a: number, b: number, unit = '') => (
    <>
      <dt>{label}</dt>
      <dd>
        {formatNumber(Math.abs(a))}
        {unit}
        {after && !reason && b !== a && (
          <span className="stat-val up">
            {' '}
            → {formatNumber(Math.abs(b))}
            {unit}
          </span>
        )}
      </dd>
    </>
  );

  return (
    <div className="level-panel">
      <div className="codex-head">
        <UnitToken kind="character" def={def} size={72} />
        <div className="grow">
          <div className="codex-name">
            {def.name} <span className="lv-text">Lv.{cur.level}</span>
            <span className="muted small"> / {cfg.maxLevel}</span>
          </div>
          <div className="muted">{describeAttack(def)}</div>
          <div className="exp-bar" title={maxed ? '已满级' : `${cur.exp} / ${need}`}>
            <div style={{ width: `${maxed ? 100 : Math.min(100, (cur.exp / Math.max(1, need)) * 100)}%` }} />
            <span className="mono">{maxed ? '已满级' : `经验 ${formatCount(cur.exp)} / ${formatCount(need)}`}</span>
          </div>
        </div>
      </div>
      <dl className="stat-grid codex-stats">
        {stat('生命值', now.maxHp, next.maxHp)}
        {stat(healer ? '治疗量' : '攻击力', now.atk, next.atk)}
        {stat('物抗', now.def, next.def)}
        {stat('法抗', now.res, next.res, '%')}
      </dl>
      <div className="muted small">
        每升 1 级：生命 +{def.growth.maxHp} · {healer ? '治疗' : '攻击'} +{def.growth.atk} · 物抗 +{def.growth.def} · 法抗 +{def.growth.res}%
      </div>

      <div className="levelup-box">
        <div className="levelup-head">使用经验书</div>
        {cfg.books.length === 0 && <div className="muted small">还没有经验书</div>}
        <div className="book-picks">
          {cfg.books.map((b) => {
            const have = progress.books[b.id] ?? 0;
            return (
              <button
                key={b.id}
                className={`book-pick${b.id === bookId ? ' active' : ''}${have ? '' : ' empty'}`}
                style={{ borderColor: b.id === bookId ? b.color : undefined }}
                onClick={() => {
                  setBookId(b.id);
                  setCount(1);
                }}
              >
                <span className="book-icon big" style={{ background: b.color }} />
                <span className="book-pick-text">
                  <strong>{b.name}</strong>
                  <small>
                    +{formatCount(b.exp)} 经验 · 每本 {formatCount(b.cost)} {cfg.name}
                  </small>
                </span>
                <span className="book-pick-count mono">×{formatCount(have)}</span>
              </button>
            );
          })}
        </div>
        {book && (
          <div className="levelup-row">
            <div className="stepper">
              <button className="btn btn-s" disabled={!!reason || n <= 1} onClick={() => setCount(n - 1)} aria-label="减少">
                −
              </button>
              <span className="mono stepper-value">{n}</span>
              <button className="btn btn-s" disabled={!!reason || n >= maxCount} onClick={() => setCount(n + 1)} aria-label="增加">
                +
              </button>
              <button className="btn btn-s btn-ghost" disabled={!!reason || n >= maxCount} onClick={() => setCount(maxCount)} title="用到满级、库存或货币允许的最大数量">
                最大
              </button>
            </div>
            <CurrencyBadge name={cfg.name} color={cfg.color} amount={cost} prefix="消耗 " />
            <span className="grow" />
            <button className="btn btn-primary" disabled={!!reason} onClick={() => onUse(book.id, n)}>
              使用 {n} 本
            </button>
          </div>
        )}
        {book && (
          <div className={`levelup-preview small${reason ? ' muted' : ''}`}>
            {reason ??
              (after &&
                `+${formatCount(book.exp * n)} 经验 → ${after.levels > 0 ? `Lv.${after.result.level}` : `Lv.${cur.level}`}${
                  after.result.level >= cfg.maxLevel ? '（满级）' : `（${formatCount(after.result.exp)} / ${formatCount(expToNext(cfg, after.result.level, table))}）`
                }${after.wasted > 0 ? `，满级后浪费 ${formatCount(after.wasted)} 经验` : ''}`)}
          </div>
        )}
      </div>
    </div>
  );
}
