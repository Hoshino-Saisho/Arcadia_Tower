import { useCallback, useEffect, useRef, useState } from 'react';
import { newCurrencyConfig, newLevel } from '../../core/defaults';
import { levelCode, parseLevelCode } from '../../core/ids';
import {
  deleteLevel,
  listLevelCodes,
  loadChapters,
  loadCharacters,
  loadCurrency,
  loadEnemies,
  loadLevel,
  saveLevel,
} from '../../core/storage/repository';
import type { ChapterDef, CharacterDef, CurrencyConfig, EnemyDef, LevelDef } from '../../core/types';
import { notifySaved } from '../../core/github/sync';
import { toast } from '../common/toast';
import { openApp } from '../router';
import type { EditorTabProps } from './EditorApp';
import { MapStep, mapProblems } from './MapStep';
import { RouteStep, type RouteHistory } from './RouteStep';
import { useSaveShortcut } from './useListDraft';

/** push = 记录撤销历史后修改；replace = 直接修改（用于拖动过程中的连续变化） */
export type ApplyFn = (fn: (lv: LevelDef) => LevelDef, mode: 'push' | 'replace') => void;

type Step = 'map' | 'route';

/** 地图规划：输入“章节编号_关卡编号”打开关卡 → ①地图搭建 → 确认 → ②敌人路线规划 */
export function LevelEditor({ onDirtyChange, initialLevel }: EditorTabProps & { initialLevel?: string }) {
  const [chapters, setChapters] = useState<ChapterDef[]>([]);
  const [built, setBuilt] = useState<Set<string>>(new Set());
  const [characters, setCharacters] = useState<CharacterDef[]>([]);
  const [enemies, setEnemies] = useState<EnemyDef[]>([]);
  const [currency, setCurrency] = useState<CurrencyConfig>(newCurrencyConfig);
  const [loaded, setLoaded] = useState(false);

  const [level, setLevel] = useState<LevelDef | null>(null);
  const levelRef = useRef<LevelDef | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  const [step, setStep] = useState<Step>('map');
  const [codeInput, setCodeInput] = useState('');
  const [saving, setSaving] = useState(false);
  const history = useRef<{ past: LevelDef[]; future: LevelDef[] }>({ past: [], future: [] });
  /** 每条敌人线的路线修改记录（路线规划中的「撤回 / 取消撤回」） */
  const routeHistory = useRef<RouteHistory>(new Map());
  const [, setHistoryTick] = useState(0);

  const setDirty = useCallback(
    (d: boolean) => {
      dirtyRef.current = d;
      setDirtyState(d);
      onDirtyChange(d);
    },
    [onDirtyChange],
  );

  const setCurrent = (lv: LevelDef | null) => {
    levelRef.current = lv;
    setLevel(lv);
  };

  const refreshLists = useCallback(async () => {
    const [chs, codes, chars, ens, cur] = await Promise.all([loadChapters(), listLevelCodes(), loadCharacters(), loadEnemies(), loadCurrency()]);
    setChapters(chs);
    setBuilt(new Set(codes));
    setCharacters(chars);
    setEnemies(ens);
    setCurrency(cur);
    return { chs, codes };
  }, []);

  const apply: ApplyFn = useCallback(
    (fn, mode) => {
      const cur = levelRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      if (mode === 'push') {
        history.current.past.push(cur);
        if (history.current.past.length > 300) history.current.past.shift();
        history.current.future = [];
        setHistoryTick((t) => t + 1);
      }
      setCurrent(next);
      if (!dirtyRef.current) setDirty(true);
    },
    [setDirty],
  );

  const undo = useCallback(() => {
    const cur = levelRef.current;
    const prev = history.current.past.pop();
    if (!cur || !prev) return;
    history.current.future.push(cur);
    setCurrent(prev);
    setDirty(true);
    setHistoryTick((t) => t + 1);
  }, [setDirty]);

  const redo = useCallback(() => {
    const cur = levelRef.current;
    const next = history.current.future.pop();
    if (!cur || !next) return;
    history.current.past.push(cur);
    setCurrent(next);
    setDirty(true);
    setHistoryTick((t) => t + 1);
  }, [setDirty]);

  /** 打开关卡：已存在则读取，否则新建 */
  const open = useCallback(
    async (code: string, chs: ChapterDef[] = chapters) => {
      code = code.trim();
      const p = parseLevelCode(code);
      if (!p) return toast('关卡编号格式应为「章节编号_关卡序号」，例如 ZH_1', 'error');
      const ch = chs.find((c) => c.id === p.chapterId);
      if (!ch) return toast(`章节「${p.chapterId}」不存在，请先在「章节规划」中创建`, 'error');
      if (p.index > ch.levelCount) return toast(`章节 ${ch.id} 只有 ${ch.levelCount} 个关卡（可在「章节规划」中修改数量）`, 'error');
      // 点击的就是当前打开的关卡：不重新读取，避免丢掉未保存的修改
      if (levelRef.current?.id === code) {
        setCodeInput(code);
        return;
      }
      if (dirtyRef.current && !window.confirm(`关卡 ${levelRef.current?.id} 有未保存的修改，确定打开 ${code} 吗？`)) return;
      try {
        const lv = await loadLevel(code);
        history.current = { past: [], future: [] };
        routeHistory.current = new Map();
        setCurrent(lv ?? newLevel(p.chapterId, p.index));
        setIsNew(!lv);
        setDirty(false);
        setStep('map');
        setCodeInput(code);
        if (!lv) toast(`新关卡 ${code}：先用积木搭建地图`, 'info');
      } catch (err) {
        toast(String(err), 'error');
      }
    },
    [chapters, setDirty],
  );

  const openedInitial = useRef(initialLevel);
  useEffect(() => {
    void refreshLists().then(({ chs }) => {
      setLoaded(true);
      if (initialLevel) void open(initialLevel, chs);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 已经打开编辑器时，地址中的 ?level= 改变 → 打开对应关卡
  useEffect(() => {
    if (!loaded || !initialLevel || initialLevel === openedInitial.current) return;
    openedInitial.current = initialLevel;
    void open(initialLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLevel, loaded]);

  const save = useCallback(async () => {
    const lv = levelRef.current;
    if (!lv || saving) return false;
    setSaving(true);
    try {
      await saveLevel(lv);
      setIsNew(false);
      setDirty(false);
      setBuilt((b) => new Set(b).add(lv.id));
      toast(`关卡 ${lv.id} 已保存`, 'ok');
      notifySaved(`关卡 ${lv.id}`);
      return true;
    } catch (err) {
      toast(`保存失败：${String(err)}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [saving, setDirty]);

  useSaveShortcut(() => void save());

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
      if (!(e.ctrlKey || e.metaKey)) return;
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

  const testPlay = async () => {
    if (!level) return;
    if ((dirty || isNew) && !(await save())) return;
    openApp('game', `/game/play/${encodeURIComponent(level.id)}?test=1`, true);
  };

  const goRoute = () => {
    if (!level) return;
    const p = mapProblems(level);
    if (p.errors.length) return toast(p.errors[0], 'error');
    setStep('route');
  };

  const allCodes = chapters.flatMap((c) => Array.from({ length: c.levelCount }, (_, i) => levelCode(c.id, i + 1)));
  const orphans = [...built].filter((c) => !allCodes.includes(c));

  return (
    <div className="level-editor">
      <aside className="level-list">
        <div className="panel-head">关卡</div>
        <form
          className="code-open"
          onSubmit={(e) => {
            e.preventDefault();
            void open(codeInput);
          }}
        >
          <input className="input mono" list="level-codes" placeholder="章节编号_关卡编号，如 ZH_1" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} />
          <datalist id="level-codes">
            {allCodes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button className="btn btn-s btn-primary" type="submit">
            打开
          </button>
        </form>
        <div className="level-tree">
          {loaded && chapters.length === 0 && <div className="empty-hint small">还没有章节，请先在「章节规划」中创建章节</div>}
          {chapters.map((ch) => (
            <div key={ch.id} className="level-group">
              <div className="level-group-head">
                <span className="mono accent">{ch.id}</span> {ch.name}
              </div>
              <div className="level-group-items">
                {Array.from({ length: ch.levelCount }, (_, i) => {
                  const code = levelCode(ch.id, i + 1);
                  const has = built.has(code);
                  return (
                    <button key={code} className={`level-item${level?.id === code ? ' active' : ''}${has ? ' built' : ''}`} onClick={() => void open(code)} title={has ? '已制作' : '未制作，点击新建'}>
                      <span className="mono">{code}</span>
                      <span className="level-item-state">{has ? '●' : '○'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {orphans.length > 0 && (
            <div className="level-group">
              <div className="level-group-head muted">未归属的关卡文件</div>
              <div className="level-group-items">
                {orphans.map((c) => (
                  <span key={c} className="level-item orphan mono" title="不属于任何章节（或超出章节关卡数量）">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="muted small help-text">● 已制作 ○ 未制作。关卡编号 = 章节编号_关卡序号。</div>
      </aside>

      <section className="level-work">
        {level ? (
          <>
            <div className="level-head">
              <div className="level-title">
                <span className="mono accent big">{level.id}</span>
                <span>{level.settings.name}</span>
                {isNew && <span className="badge badge-warn">新关卡 · 未保存</span>}
              </div>
              <div className="steps">
                <button className={step === 'map' ? 'active' : ''} onClick={() => setStep('map')}>
                  <span className="step-no">1</span> 地图搭建
                </button>
                <span className="step-arrow">→</span>
                <button className={step === 'route' ? 'active' : ''} onClick={goRoute}>
                  <span className="step-no">2</span> 敌人路线规划
                </button>
              </div>
              <div className="row gap-s">
                <button className="btn btn-s btn-ghost" disabled={!history.current.past.length} onClick={undo} title="撤销（Ctrl+Z）">
                  ↶
                </button>
                <button className="btn btn-s btn-ghost" disabled={!history.current.future.length} onClick={redo} title="重做（Ctrl+Shift+Z）">
                  ↷
                </button>
                <span className={dirty || isNew ? 'dirty-text small' : 'muted small'}>{dirty || isNew ? '● 未保存' : '✓ 已保存'}</span>
                <button className="btn btn-s" onClick={() => void testPlay()} title="保存并在游戏中试玩（不计入进度）">
                  ▶ 试玩
                </button>
                <button className="btn btn-s btn-primary" disabled={saving || (!dirty && !isNew)} onClick={() => void save()}>
                  保存（Ctrl+S）
                </button>
                {!isNew && (
                  <button
                    className="btn btn-s btn-danger"
                    onClick={async () => {
                      if (!window.confirm(`删除关卡文件 ${level.id}？此操作不可撤销。`)) return;
                      await deleteLevel(level.id);
                      notifySaved(`删除关卡 ${level.id}`);
                      setBuilt((b) => {
                        const n = new Set(b);
                        n.delete(level.id);
                        return n;
                      });
                      setCurrent(null);
                      setDirty(false);
                      toast(`已删除关卡 ${level.id}`, 'ok');
                    }}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
            {step === 'map' ? (
              <MapStep level={level} characters={characters} currency={currency} apply={apply} onConfirm={goRoute} />
            ) : (
              <RouteStep key={level.id} level={level} enemies={enemies} apply={apply} onBack={() => setStep('map')} routeHistory={routeHistory.current} />
            )}
          </>
        ) : (
          <div className="level-empty">
            <h2>地图规划</h2>
            <p className="muted">
              在左侧输入关卡编号（<span className="mono accent">章节编号_关卡编号</span>，例如 <span className="mono">ZH_1</span>）或直接点击列表中的关卡。
            </p>
            <ol className="help-list">
              <li>① 地图搭建：用积木（地面、高台、敌人出现点、基地、不可放置）拼出地图，并设置血量、金钱和通关奖励。</li>
              <li>② 点击「确认地图」进入敌人路线规划：新建敌人线，拖入敌人积木，安排出现时间与生成间隔。</li>
              <li>每条敌人线可以选择自动寻路，或在地图上逐个点击相连的方块手动设置路线（可以重复经过同一个方块，例如转圈）。</li>
              <li>「⏸ 停留点」：在路线上的方块设置停留时间，敌人走到那里会停下来等待。</li>
              <li>保存后点击「试玩」即可直接在游戏中测试（不计入进度）。</li>
            </ol>
          </div>
        )}
      </section>
    </div>
  );
}
