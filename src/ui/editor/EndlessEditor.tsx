import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newCurrencyConfig } from '../../core/defaults';
import { firstWaveOf, groupSize, planWave, seededRng, waveScale } from '../../core/endless';
import { notifySaved } from '../../core/github/sync';
import { levelCode } from '../../core/ids';
import { endlessRewards, formatCount } from '../../core/leveling';
import { resolveRoute } from '../../core/pathfinding';
import { loadChapters, loadCharacters, loadCurrency, loadEndless, loadEnemies, saveEndless } from '../../core/storage/repository';
import { TileGrid } from '../../core/tiles';
import type { BookScoreRate, ChapterDef, CharacterDef, CurrencyConfig, EndlessConfig, EnemyDef, LevelDef } from '../../core/types';
import { Checkbox, Field, NumberInput, TextInput } from '../common/fields';
import { toast } from '../common/toast';
import { UnitToken } from '../common/tokens';
import { RewardList } from '../common/wallet';
import { openApp } from '../router';
import type { EditorTabProps } from './EditorApp';
import type { ApplyFn } from './LevelEditor';
import { MapStep, mapProblems } from './MapStep';
import { RouteStep, type RouteHistory } from './RouteStep';
import { useSaveShortcut } from './useListDraft';

type Step = 'rules' | 'map' | 'route';

/**
 * 无尽模式编辑器（data/endless.json）：
 *  ① 规则：波次、难度、每组数量 / 间隔、敌人强化、分数兑换
 *  ② 地图搭建：和关卡一样的积木地图 + 初始血量 / 金钱 / 可用角色 / 音乐
 *  ③ 敌人路线：敌人从这些路线中随机选择；时间线里的积木是额外固定出现的敌人（可以不放）
 * 敌人的分数、难度、出现位列在「敌人编辑」中设置。
 */
export function EndlessEditor({ onDirtyChange }: EditorTabProps) {
  const [cfg, setCfgState] = useState<EndlessConfig | null>(null);
  const cfgRef = useRef<EndlessConfig | null>(null);
  const [characters, setCharacters] = useState<CharacterDef[]>([]);
  const [enemies, setEnemies] = useState<EnemyDef[]>([]);
  const [currency, setCurrency] = useState<CurrencyConfig>(newCurrencyConfig);
  const [chapters, setChapters] = useState<ChapterDef[]>([]);
  const [error, setError] = useState('');
  const [step, setStep] = useState<Step>('rules');
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const history = useRef<{ past: EndlessConfig[]; future: EndlessConfig[] }>({ past: [], future: [] });
  const routeHistory = useRef<RouteHistory>(new Map());
  const [, setTick] = useState(0);
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;

  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
    setDirtyState(d);
    onDirtyRef.current(d);
  }, []);

  const setCurrent = (c: EndlessConfig) => {
    cfgRef.current = c;
    setCfgState(c);
  };

  useEffect(() => {
    Promise.all([loadEndless(), loadCharacters(), loadEnemies(), loadCurrency(), loadChapters()]).then(([c, chars, ens, cur, chs]) => {
      setCurrent(c);
      setCharacters(chars);
      setEnemies(ens);
      setCurrency(cur);
      setChapters(chs);
    }, (e) => setError(String(e)));
  }, []);

  /** 修改设置：push = 记录撤销历史；replace = 拖动过程中的连续修改 */
  const apply = useCallback(
    (fn: (c: EndlessConfig) => EndlessConfig, mode: 'push' | 'replace') => {
      const cur = cfgRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      if (mode === 'push') {
        history.current.past.push(cur);
        if (history.current.past.length > 300) history.current.past.shift();
        history.current.future = [];
        setTick((t) => t + 1);
      }
      setCurrent(next);
      if (!dirtyRef.current) setDirty(true);
    },
    [setDirty],
  );
  const applyMap: ApplyFn = useCallback(
    (fn, mode) =>
      apply((c) => {
        const map = fn(c.map);
        return map === c.map ? c : { ...c, map };
      }, mode),
    [apply],
  );
  const set = (patch: Partial<EndlessConfig>) => apply((c) => ({ ...c, ...patch }), 'push');

  const undo = useCallback(() => {
    const cur = cfgRef.current;
    const prev = history.current.past.pop();
    if (!cur || !prev) return;
    history.current.future.push(cur);
    setCurrent(prev);
    setDirty(true);
    setTick((t) => t + 1);
  }, [setDirty]);
  const redo = useCallback(() => {
    const cur = cfgRef.current;
    const next = history.current.future.pop();
    if (!cur || !next) return;
    history.current.past.push(cur);
    setCurrent(next);
    setDirty(true);
    setTick((t) => t + 1);
  }, [setDirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const save = async (): Promise<boolean> => {
    const c = cfgRef.current;
    if (!c || saving) return false;
    setSaving(true);
    try {
      await saveEndless({ ...c, name: c.name.trim() || '无尽模式' });
      setDirty(false);
      const p = mapProblems(c.map);
      if (c.enabled && p.errors.length) toast(`已保存，但地图还不能用：${p.errors[0]}`, 'info', 3000);
      else toast('无尽模式已保存', 'ok');
      notifySaved('无尽模式');
      return true;
    } catch (err) {
      toast(`保存失败：${String(err)}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };
  useSaveShortcut(() => void save());

  if (error) return <div className="page-msg">读取无尽模式失败：{error}</div>;
  if (!cfg) return <div className="page-msg">加载中…</div>;

  const goRoute = () => {
    const p = mapProblems(cfg.map);
    if (p.errors.length) return toast(p.errors[0], 'error');
    setStep('route');
  };
  const testPlay = async () => {
    if (mapProblems(cfg.map).errors.length) return toast('请先在「地图搭建」中完成地图（出现点和基地）', 'error');
    if (dirty && !(await save())) return;
    openApp('game', '/game/endless/play?test=1', true);
  };

  const codes = chapters.flatMap((ch) => Array.from({ length: ch.levelCount }, (_, i) => levelCode(ch.id, i + 1)));

  return (
    <div className="level-editor endless-editor">
      <section className="level-work">
        <div className="level-head">
          <div className="level-title">
            <span className="mono accent big">∞</span>
            <span>{cfg.name}</span>
            {!cfg.enabled && <span className="badge badge-warn">未启用 · 游戏中不显示</span>}
          </div>
          <div className="steps">
            <button className={step === 'rules' ? 'active' : ''} onClick={() => setStep('rules')}>
              <span className="step-no">1</span> 规则设置
            </button>
            <span className="step-arrow">→</span>
            <button className={step === 'map' ? 'active' : ''} onClick={() => setStep('map')}>
              <span className="step-no">2</span> 地图搭建
            </button>
            <span className="step-arrow">→</span>
            <button className={step === 'route' ? 'active' : ''} onClick={goRoute}>
              <span className="step-no">3</span> 敌人路线
            </button>
          </div>
          <div className="row gap-s">
            <button className="btn btn-s btn-ghost" disabled={!history.current.past.length} onClick={undo} title="撤销（Ctrl+Z）">
              ↶
            </button>
            <button className="btn btn-s btn-ghost" disabled={!history.current.future.length} onClick={redo} title="重做（Ctrl+Shift+Z）">
              ↷
            </button>
            <span className={dirty ? 'dirty-text small' : 'muted small'}>{dirty ? '● 未保存' : '✓ 已保存'}</span>
            <button className="btn btn-s" onClick={() => void testPlay()} title="保存并在游戏中试玩（不计成绩，没有奖励）">
              ▶ 试玩
            </button>
            <button className="btn btn-s btn-primary" disabled={saving || !dirty} onClick={() => void save()}>
              保存（Ctrl+S）
            </button>
          </div>
        </div>
        {step === 'rules' && <RulesStep cfg={cfg} set={set} enemies={enemies} currency={currency} codes={codes} />}
        {step === 'map' && <MapStep level={cfg.map} characters={characters} currency={currency} apply={applyMap} onConfirm={goRoute} variant="endless" />}
        {step === 'route' && (
          <RouteStep
            level={cfg.map}
            enemies={enemies}
            apply={applyMap}
            onBack={() => setStep('map')}
            routeHistory={routeHistory.current}
            timelineNote="无尽模式：敌人按规则自动一波一波出现，每组随机选择上面的一条路线（至少需要 1 条有效路线）。下面时间线里的积木是额外「固定出现」的敌人，可以不放。"
          />
        )}
      </section>
    </div>
  );
}

/** ① 规则设置：表单 + 右侧预览（前 10 波、敌人一览、分数兑换示例） */
function RulesStep({
  cfg,
  set,
  enemies,
  currency,
  codes,
}: {
  cfg: EndlessConfig;
  set: (p: Partial<EndlessConfig>) => void;
  enemies: EnemyDef[];
  currency: CurrencyConfig;
  codes: string[];
}) {
  const setBookRate = (i: number, patch: Partial<BookScoreRate>) => set({ bookRates: cfg.bookRates.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="endless-rules">
      <div className="form-scroll">
        <h3 className="form-title">基本</h3>
        <div className="form-grid">
          <Field label="名称">
            <TextInput value={cfg.name} maxLength={16} onChange={(v) => set({ name: v })} />
          </Field>
          <Field label="解锁条件">
            <select className="input" value={cfg.unlockAfter} onChange={(e) => set({ unlockAfter: e.target.value })}>
              <option value="">一开始就可以玩</option>
              {cfg.unlockAfter && !codes.includes(cfg.unlockAfter) && <option value={cfg.unlockAfter}>通关 {cfg.unlockAfter} 后（关卡不存在）</option>}
              {codes.map((c) => (
                <option key={c} value={c}>
                  通关 {c} 后解锁
                </option>
              ))}
            </select>
          </Field>
          <Field label="启用" wide>
            <Checkbox checked={cfg.enabled} onChange={(v) => set({ enabled: v })} label="在游戏主页显示无尽模式" />
          </Field>
        </div>

        <h3 className="form-title">波次</h3>
        <div className="form-grid cols-4">
          <Field label="第 1 波开始" hint="秒（开始作战后）">
            <NumberInput value={cfg.firstWave} min={0} max={3600} step={1} onChange={(v) => set({ firstWave: v })} />
          </Field>
          <Field label="每波间隔" hint="秒">
            <NumberInput value={cfg.waveInterval} min={1} max={3600} step={1} onChange={(v) => set({ waveInterval: v })} />
          </Field>
          <Field label="第 1 波组数" hint="每组 = 一种敌人">
            <NumberInput value={cfg.groupsPerWave} min={1} max={50} step={1} onChange={(v) => set({ groupsPerWave: v })} />
          </Field>
          <Field label="每波增加组数" hint="0.5 = 每 2 波多 1 组">
            <NumberInput value={cfg.groupsGrowth} min={-50} max={50} step={0.1} onChange={(v) => set({ groupsGrowth: v })} />
          </Field>
        </div>

        <h3 className="form-title">难度</h3>
        <div className="form-grid cols-4">
          <Field label="起始难度" hint="第 1 波">
            <NumberInput value={cfg.startDifficulty} min={-99999} max={99999} step={0.5} onChange={(v) => set({ startDifficulty: v })} />
          </Field>
          <Field label="每波难度增加">
            <NumberInput value={cfg.difficultyPerWave} min={-1000} max={1000} step={0.1} onChange={(v) => set({ difficultyPerWave: v })} />
          </Field>
          <Field label="规则" wide>
            <div className="static-value small">敌人难度 ≤ 当前难度才会出现，越接近当前难度出现得越多</div>
          </Field>
        </div>

        <h3 className="form-title">每组敌人（由敌人的出现位列决定）</h3>
        <div className="form-grid cols-4">
          <Field label="每位列数量" hint="每组数量 = 位列 × 该值">
            <NumberInput value={cfg.countPerRank} min={0.1} max={50} step={0.5} onChange={(v) => set({ countPerRank: v })} />
          </Field>
          <Field label="每位列间隔" hint="组内间隔 = 位列 × 该值（秒）">
            <NumberInput value={cfg.intervalPerRank} min={0.05} max={60} step={0.1} onChange={(v) => set({ intervalPerRank: v })} />
          </Field>
          <Field label="每波数量增加" hint="%，每组的数量">
            <NumberInput value={cfg.countGrowth} min={-100} max={1000} step={1} onChange={(v) => set({ countGrowth: v })} />
          </Field>
        </div>

        <h3 className="form-title">敌人强化</h3>
        <div className="form-grid cols-4">
          <Field label="每波生命增加" hint="%，负数 = 减少">
            <NumberInput value={cfg.hpGrowth} min={-100} max={1000} step={1} onChange={(v) => set({ hpGrowth: v })} />
          </Field>
          <Field label="每波攻击增加" hint="%，负数 = 减少">
            <NumberInput value={cfg.atkGrowth} min={-100} max={1000} step={1} onChange={(v) => set({ atkGrowth: v })} />
          </Field>
        </div>

        <h3 className="form-title">分数兑换（挑战结束时）</h3>
        <div className="rate-list">
          <div className="rate-row">
            <span className="muted small">每</span>
            <NumberInput value={cfg.currencyRate.score} min={1} max={1e9} step={1} width={90} onChange={(v) => set({ currencyRate: { ...cfg.currencyRate, score: v } })} />
            <span className="muted small">分换</span>
            <NumberInput value={cfg.currencyRate.amount} min={0} max={1e9} step={1} width={90} onChange={(v) => set({ currencyRate: { ...cfg.currencyRate, amount: v } })} />
            <span>{currency.name}</span>
          </div>
          {cfg.bookRates.map((r, i) => {
            const book = currency.books.find((b) => b.id === r.bookId);
            return (
              <div key={i} className={`rate-row${book ? '' : ' invalid'}`}>
                <span className="muted small">每</span>
                <NumberInput value={r.score} min={1} max={1e9} step={1} width={90} onChange={(v) => setBookRate(i, { score: v })} />
                <span className="muted small">分换</span>
                <NumberInput value={r.amount} min={0} max={1e9} step={1} width={70} onChange={(v) => setBookRate(i, { amount: v })} />
                <span className="muted small">本</span>
                <select className={`input${book ? '' : ' invalid'}`} value={r.bookId} onChange={(e) => setBookRate(i, { bookId: e.target.value })}>
                  {!book && <option value={r.bookId}>未知经验书 {r.bookId}</option>}
                  {currency.books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <button className="icon-btn" onClick={() => set({ bookRates: cfg.bookRates.filter((_, j) => j !== i) })} aria-label="删除" title="删除这一项">
                  ×
                </button>
              </div>
            );
          })}
          <button
            className="btn btn-s"
            disabled={!currency.books.length}
            onClick={() => set({ bookRates: [...cfg.bookRates, { bookId: currency.books[0].id, score: 100, amount: 1 }] })}
          >
            + 添加经验书兑换
          </button>
        </div>
        <div className="muted small help-text">击败敌人获得「敌人编辑」中设置的分数；挑战结束（基地血量归零或主动结束）时，分数每满上面的数量就换成对应的货币和经验书。</div>
      </div>
      <EndlessPreview cfg={cfg} enemies={enemies} currency={currency} />
    </div>
  );
}

/** 右侧预览：前 10 波（固定随机种子）、敌人一览、兑换示例 */
function EndlessPreview({ cfg, enemies, currency }: { cfg: EndlessConfig; enemies: EnemyDef[]; currency: CurrencyConfig }) {
  const routeCount = useMemo(() => routeCountOf(cfg.map), [cfg.map]);
  const waves = useMemo(() => {
    const rng = seededRng(7);
    return Array.from({ length: 10 }, (_, i) => planWave(cfg, enemies, Math.max(1, routeCount), i + 1, rng));
  }, [cfg, enemies, routeCount]);
  const byId = new Map(enemies.map((e) => [e.id, e]));
  const sorted = [...enemies].sort((a, b) => a.endlessDifficulty - b.endlessDifficulty);
  const sample = 500;
  return (
    <aside className="def-preview endless-preview">
      {routeCount === 0 && <div className="field-error small">地图还没有有效的敌人路线（在「地图搭建」和「敌人路线」中设置）</div>}
      <div className="panel-head">前 10 波预览</div>
      <div className="wave-list">
        {waves.map((w) => {
          const counts = new Map<string, number>();
          for (const g of w.groups) counts.set(g.enemyId, (counts.get(g.enemyId) ?? 0) + g.count);
          return (
            <div key={w.wave} className="wave-row">
              <span className="wave-no mono">第 {w.wave} 波</span>
              <span className="wave-meta muted small mono">
                难度 {Math.round(w.difficulty * 100) / 100} · 生命 ×{Math.round(w.hpScale * 100) / 100}
              </span>
              <span className="wave-enemies">
                {[...counts].map(([id, n]) => {
                  const e = byId.get(id);
                  return (
                    <span key={id} className="wave-enemy" title={e?.name}>
                      {e && <UnitToken kind="enemy" def={e} size={18} label={false} />}
                      {e?.name ?? id}×{n}
                    </span>
                  );
                })}
                {!w.groups.length && <span className="muted small">没有敌人</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="muted small">预览使用固定的随机种子，实际战斗中每次都不一样。</div>

      <div className="panel-head">敌人一览（在「敌人编辑」中修改）</div>
      <div className="endless-enemy-table">
        <div className="endless-enemy-row head">
          <span>敌人</span>
          <span>难度</span>
          <span>位列</span>
          <span>分数</span>
          <span>首次出现</span>
        </div>
        {sorted.map((e) => {
          const first = firstWaveOf(cfg, e.endlessDifficulty, enemies);
          const g = groupSize(cfg, e.endlessRank, first ?? 1);
          return (
            <div key={e.id} className="endless-enemy-row">
              <span className="row gap-s">
                <UnitToken kind="enemy" def={e} size={20} label={false} />
                {e.name}
              </span>
              <span className="mono">{e.endlessDifficulty}</span>
              <span className="mono" title={`每组 ${g.count} 个，间隔 ${g.interval} 秒`}>
                {e.endlessRank}
              </span>
              <span className="mono">{e.endlessScore}</span>
              <span className="mono">{first == null ? '—' : `第 ${first} 波`}</span>
            </div>
          );
        })}
      </div>

      <div className="panel-head">兑换示例</div>
      <div className="small">
        {sample} 分 → <RewardList cfg={currency} rewards={endlessRewards(cfg, currency, sample)} />
      </div>
      <div className="muted small">第 10 波的敌人：生命 ×{Math.round(waveScale(cfg, 10).hp * 100) / 100}，攻击 ×{Math.round(waveScale(cfg, 10).atk * 100) / 100}</div>
      <div className="muted small">敌人一共 {formatCount(enemies.length)} 种</div>
    </aside>
  );
}

function routeCountOf(map: LevelDef): number {
  const grid = TileGrid.fromLevel(map);
  return map.lines.filter((l) => resolveRoute(grid, l.route).path).length;
}
