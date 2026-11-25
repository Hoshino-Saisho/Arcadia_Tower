import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SELECT_SLOW_FACTOR, isSummonDef, retreatRefund } from '../../core/defaults';
import { describeSkill, describeSkillTrigger } from '../../core/describe';
import { levelCode } from '../../core/ids';
import { endlessRewards, grantRewards, levelMap, rollRewards, type RolledRewards } from '../../core/leveling';
import { ProgressView } from '../../core/progress';
import { battleRoster } from '../../core/squad';
import { DAMAGE_TYPE_LABEL, formatModifier, formatNumber } from '../../core/stats';
import { loadDatabase, loadLevel, loadProgress, saveProgress, type GameDatabase } from '../../core/storage/repository';
import type { CharacterDef, GridPos, LevelDef } from '../../core/types';
import { FIXED_DT, GameEngine } from '../../game/engine';
import type { Unit } from '../../game/entities';
import { preloadIcons } from '../../game/icons';
import { outlinedText } from '../../game/shapes';
import { music } from '../../game/music';
import { BattleRenderer, screenToTile, type Viewport } from '../../game/renderer';
import { clientToLocal } from '../common/stage';
import { toast } from '../common/toast';
import { UnitToken } from '../common/tokens';
import { RewardList } from '../common/wallet';
import { navigate } from '../router';
import { MusicControl } from './HomePage';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; db: GameDatabase; level: LevelDef };

/** 战斗页面：加载数据 → 创建引擎。endless = 无尽模式（地图在 data/endless.json 中） */
export function BattlePage({ code, test, endless = false }: { code: string; test: boolean; endless?: boolean }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [db, loaded] = await Promise.all([loadDatabase(), endless ? Promise.resolve(null) : loadLevel(code)]);
      if (cancelled) return;
      const level = endless ? db.endless.map : loaded;
      if (!level) return setState({ status: 'error', message: `关卡 ${code} 尚未制作` });
      const view = new ProgressView(db.chapters, db.progress, db.levelCodes);
      if (endless) {
        if (!test && !db.endless.enabled) return setState({ status: 'error', message: '无尽模式还没有开放' });
        if (!test && db.endless.unlockAfter && !view.isCleared(db.endless.unlockAfter)) {
          return setState({ status: 'error', message: `通关 ${db.endless.unlockAfter} 后解锁${db.endless.name}` });
        }
      } else if (!test && !view.isLevelUnlocked(level.chapterId, level.index)) {
        return setState({ status: 'error', message: `关卡 ${code} 尚未解锁` });
      }
      preloadIcons([...db.characters.map((c) => c.icon), ...db.enemies.map((e) => e.icon), ...db.summons.map((m) => m.icon)]);
      // 战斗音乐：关卡单独设置的优先，否则用章节的
      const chapter = db.chapters.find((c) => c.id === level.chapterId);
      music.set({ kind: 'battle', file: level.settings.battleMusic || chapter?.battleMusic || '' });
      setState({ status: 'ready', db, level });
    })().catch((err) => !cancelled && setState({ status: 'error', message: String(err) }));
    return () => {
      cancelled = true;
    };
  }, [code, test, endless]);

  if (state.status === 'loading') return <div className="page-msg">{endless ? '加载无尽模式…' : `加载关卡 ${code}…`}</div>;
  if (state.status === 'error') {
    return (
      <div className="page-msg">
        {state.message}
        <button className="btn" onClick={() => navigate(endless ? '/game' : '/game/chapters')}>
          {endless ? '返回主页' : '返回章节选择'}
        </button>
      </div>
    );
  }
  return <Battle key={attempt} db={state.db} level={state.level} test={test} endless={endless} onRestart={() => setAttempt((a) => a + 1)} />;
}

interface Ctrl {
  started: boolean;
  paused: boolean;
  speed: number;
  placing: string | null;
  pending: PendingDeploy | null;
  selectedUid: number | null;
  showRoutes: boolean;
}

/** 等待确认的部署：拖到方块上（或点卡片再点方块）后暂停，选择「部署」或「取消」 */
interface PendingDeploy {
  id: string;
  tile: GridPos;
}

/** 部署卡片上的一次按下：轻点 = 选中；拖动 = 拖到地图上部署；手机上横向滑动 = 滚动卡片栏 */
interface CardPress {
  id: string;
  pointerId: number;
  sx: number;
  sy: number;
  lastX: number;
  lastY: number;
  touch: boolean;
  /** 召唤物的卡片不在可以滚动的角色栏里，不用左右滑动 */
  summon: boolean;
  mode: 'press' | 'drag' | 'pan' | 'blocked';
}

/** 角色试用（训练场）：编辑器里打开，只有一个来回移动的敌人，试用的角色一开始就在场上 */
export interface BattleTraining {
  /** 试用的角色（一开始就部署在场上） */
  focusId: string;
  /** 来回移动的敌人和路线 */
  enemyId: string;
  path: GridPos[];
  /** 全部角色的等级 */
  level: number;
  /** HUD 中额外的控件（选择敌人 / 等级） */
  controls?: ReactNode;
  onExit: () => void;
}

export function Battle({
  db,
  level,
  test,
  endless = false,
  training,
  onRestart,
}: {
  db: GameDatabase;
  level: LevelDef;
  test: boolean;
  endless?: boolean;
  training?: BattleTraining;
  onRestart: () => void;
}) {
  const engineRef = useRef<GameEngine>(null as unknown as GameEngine);
  if (!engineRef.current) {
    // 出战的角色 = 玩家的编队（最多 12 个）∩ 本关可用角色；角色试用时是全部角色
    const team = training ? { roster: db.characters, fallback: false } : battleRoster(db.characters, db.progress.squad, level.settings.availableCharacters);
    engineRef.current = new GameEngine(level, team.roster, db.enemies, {
      skills: db.skills,
      loadouts: training ? {} : db.progress.loadouts,
      // 角色等级（玩家用经验书升级）提高基础数值；试用时全部角色使用选择的等级
      levels: training ? Object.fromEntries(db.characters.map((c) => [c.id, training.level])) : levelMap(db.currency, db.progress),
      endless: endless ? db.endless : undefined,
      training: training ? { enemyId: training.enemyId, path: training.path } : undefined,
      summons: db.summons,
      summonChoice: training ? {} : db.progress.summonChoice,
    });
    if (training) deployFocus(engineRef.current, training.focusId);
    if (team.fallback) engineRef.current.warnings.push('编队里没有本关可用的角色，这一关使用关卡指定的角色');
  }
  const engine = engineRef.current;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<Viewport>({ scale: 1, ox: 0, oy: 0 });
  const hoverRef = useRef<GridPos | null>(null);
  const sizeRef = useRef({ w: 800, h: 500, dpr: 1 });

  // 角色试用：直接开始
  const [started, setStarted] = useState(!!training);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [placing, setPlacing] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDeploy | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [showRoutes, setShowRoutes] = useState(true);
  const [, setTick] = useState(0);
  const [next, setNext] = useState<{ code: string; built: boolean } | null>(null);
  /** 这次通关（无尽模式：这次挑战）获得的奖励（试玩模式没有） */
  const [rewards, setRewards] = useState<RolledRewards | null>(null);
  /** 无尽模式：这次是否刷新了最好成绩 */
  const [newBest, setNewBest] = useState(false);

  const ctrl = useRef<Ctrl>({ started, paused, speed, placing, pending, selectedUid, showRoutes });
  ctrl.current = { started, paused, speed, placing, pending, selectedUid, showRoutes };
  /** 选中角色（部署卡片或场上的角色）或拖动卡片时时间变慢；等待确认部署时暂停 */
  const slowed = started && !paused && !pending && engine.status === 'running' && (placing != null || selectedUid != null);

  const battleRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<CardPress | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const ghostPos = useRef({ x: -999, y: -999 });

  // 画布尺寸
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      // 用布局尺寸（不受手机版舞台的缩放 / 旋转影响）
      const r = { width: wrap.clientWidth, height: wrap.clientHeight };
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // 主循环：固定步长更新 + 每帧渲染
  useEffect(() => {
    const renderer = new BattleRenderer(engine);
    const ctx = canvasRef.current!.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hud = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const c = ctrl.current;
      if (c.started && !c.paused && !c.pending) {
        const slow = c.placing != null || c.selectedUid != null ? SELECT_SLOW_FACTOR : 1;
        acc += dt * c.speed * slow;
        let guard = 0;
        while (acc >= FIXED_DT && guard++ < 40) {
          engine.step(FIXED_DT);
          acc -= FIXED_DT;
        }
      }
      const { w, h, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const placingDef = c.placing ? engine.deployable(c.placing) ?? null : null;
      const hoverTile = c.pending ? c.pending.tile : hoverRef.current;
      vpRef.current = renderer.render(ctx, w, h, dpr, { hoverTile, placing: placingDef, selectedUid: c.selectedUid, showRoutes: c.showRoutes }, now / 1000);
      hud += dt;
      if (hud > 0.1) {
        hud = 0;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // 胜利后保存进度
  const status = engine.status;
  const savedRef = useRef(false);
  useEffect(() => {
    // 无尽模式：结束时把分数换成奖励，并记录最好成绩
    if (endless) {
      if (status === 'running' || savedRef.current) return;
      savedRef.current = true;
      if (test) return;
      (async () => {
        let progress = await loadProgress();
        const r = endlessRewards(db.endless, db.currency, engine.score);
        progress = grantRewards(progress, r);
        const best = progress.endlessBest;
        if (!best || engine.score > best.score) {
          progress = { ...progress, endlessBest: { score: engine.score, wave: engine.wave, time: Math.round(engine.time * 10) / 10 } };
          setNewBest(true);
        }
        await saveProgress(progress);
        setRewards(r);
      })().catch((err) => toast(`保存失败：${String(err)}`, 'error'));
      return;
    }
    if (status !== 'won' || savedRef.current) return;
    savedRef.current = true;
    (async () => {
      let progress = await loadProgress();
      if (!test) {
        // 通关奖励：每次通关都获得固定的货币，经验书按概率掉落
        const r = rollRewards(db.currency, level.settings);
        progress = grantRewards(progress, r);
        if (!progress.cleared.includes(level.id)) progress.cleared = [...progress.cleared, level.id];
        await saveProgress(progress);
        setRewards(r);
      }
      const view = new ProgressView(db.chapters, progress, db.levelCodes);
      const n = view.nextLevel(level.chapterId, level.index);
      if (n) {
        const nc = levelCode(n.chapterId, n.index);
        setNext({ code: nc, built: db.levelCodes.has(nc) });
      }
    })().catch((err) => toast(`保存进度失败：${String(err)}`, 'error'));
  }, [status, test, level, db, endless, engine]);

  // 选中的角色被击倒时取消选择；召唤者离场后，正在部署的召唤物也取消
  useEffect(() => {
    if (selectedUid != null && !engine.unitByUid(selectedUid)) setSelectedUid(null);
    if (placing && !engine.deployable(placing)) {
      setPlacing(null);
      setPending(null);
      setDragging(null);
    }
  });

  const exit = useCallback(() => {
    if (training) {
      training.onExit();
    } else if (test) {
      window.close();
      window.setTimeout(() => navigate('/game'), 150);
    } else if (endless) {
      navigate('/game/endless');
    } else {
      navigate(`/game/chapter/${encodeURIComponent(level.chapterId)}`);
    }
  }, [test, endless, training, level.chapterId]);

  const selectCard = useCallback(
    (id: string) => {
      const def = engine.deployable(id);
      if (!def) return;
      setPending(null);
      if (ctrl.current.placing === id) return setPlacing(null);
      const st = engine.cardState(def);
      if (!st.ok) return toast(st.reason!, 'error', 1500);
      setSelectedUid(null);
      setPlacing(id);
    },
    [engine],
  );

  /** 选好方块后：检查能否部署 → 暂停并显示「部署 / 取消」 */
  const requestDeploy = useCallback(
    (id: string, tile: GridPos, cancelOnError: boolean) => {
      const def = engine.deployable(id);
      const err = def ? engine.checkDeploy(def, tile) : '本关不能使用该角色';
      if (err) {
        toast(err, 'error', 1500);
        if (cancelOnError) {
          setPlacing(null);
          setPending(null);
          hoverRef.current = null;
        }
        return;
      }
      setSelectedUid(null);
      setPlacing(id);
      setPending({ id, tile: { ...tile } });
    },
    [engine],
  );

  const confirmPending = useCallback(() => {
    const p = ctrl.current.pending;
    if (!p) return;
    ctrl.current.pending = null; // 防止同一帧内重复确认
    const err = engine.deploy(p.id, p.tile);
    if (err) toast(err, 'error', 1500);
    setPending(null);
    setPlacing(null);
    hoverRef.current = null;
  }, [engine]);

  const cancelPending = useCallback(() => {
    setPending(null);
    setPlacing(null);
    hoverRef.current = null;
  }, []);

  // 键盘：Esc 取消、空格暂停、数字键选卡
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (ctrl.current.pending) {
        // 等待确认部署：Enter = 部署，Esc = 取消
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmPending();
        } else if (e.key === 'Escape') cancelPending();
        else if (e.key === ' ') e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        setPlacing(null);
        setSelectedUid(null);
      } else if (e.key === ' ') {
        e.preventDefault();
        if (ctrl.current.started) setPaused((p) => !p);
        else setStarted(true);
      } else if (/^[0-9]$/.test(e.key)) {
        // 1~9 = 第 1~9 个角色，0 = 第 10 个
        const def = engine.roster[e.key === '0' ? 9 : Number(e.key) - 1];
        if (def) selectCard(def.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, selectCard, confirmPending, cancelPending]);

  /** 屏幕坐标 → 方块（手机版舞台缩放 / 旋转时也正确） */
  const tileFromClient = (cx: number, cy: number) => {
    const p = clientToLocal(canvasRef.current!, cx, cy);
    return screenToTile(vpRef.current, p.x, p.y);
  };
  /** 指针在地图画布上时返回方块，否则返回 null */
  const tileOnCanvas = (cx: number, cy: number): GridPos | null => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const p = clientToLocal(cv, cx, cy);
    if (p.x < 0 || p.y < 0 || p.x >= cv.clientWidth || p.y >= cv.clientHeight) return null;
    return screenToTile(vpRef.current, p.x, p.y);
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    const tile = tileFromClient(e.clientX, e.clientY);
    if (pending) {
      // 等待确认时点击其他方块 = 换一个位置
      if (tile.x !== pending.tile.x || tile.y !== pending.tile.y) requestDeploy(pending.id, tile, false);
      return;
    }
    if (placing) {
      requestDeploy(placing, tile, false);
      return;
    }
    const u = engine.unitAt(tile.x, tile.y);
    setSelectedUid(u ? u.uid : null);
  };

  /* ---------- 拖动部署 ---------- */
  const placeGhost = (cx: number, cy: number) => {
    const root = battleRef.current;
    if (!root) return;
    ghostPos.current = clientToLocal(root, cx, cy);
    const g = ghostRef.current;
    if (g) g.style.transform = `translate(${ghostPos.current.x}px, ${ghostPos.current.y}px) translate(-50%, -50%)`;
  };
  const endDrag = () => {
    setDragging(null);
    ghostPos.current = { x: -999, y: -999 };
  };

  const onCardPointerDown = (e: React.PointerEvent<HTMLButtonElement>, id: string, summon = false) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 指针已经失效时忽略 */
    }
    pressRef.current = { id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, lastX: e.clientX, lastY: e.clientY, touch: e.pointerType !== 'mouse', summon, mode: 'press' };
  };
  const onCardPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = pressRef.current;
    if (!d || d.pointerId !== e.pointerId || d.mode === 'blocked') return;
    const bar = barRef.current;
    if (d.mode === 'press') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return;
      const a = bar ? clientToLocal(bar, d.sx, d.sy) : { x: d.sx, y: d.sy };
      const b = bar ? clientToLocal(bar, e.clientX, e.clientY) : { x: e.clientX, y: e.clientY };
      if (d.touch && !d.summon && bar && bar.scrollWidth > bar.clientWidth + 1 && Math.abs(b.x - a.x) > Math.abs(b.y - a.y)) {
        d.mode = 'pan';
      } else {
        const def = engine.deployable(d.id);
        const st = def ? engine.cardState(def) : { ok: false, reason: '本关不能使用该角色' };
        if (!st.ok) {
          toast(st.reason!, 'error', 1500);
          d.mode = 'blocked';
          return;
        }
        d.mode = 'drag';
        setPending(null);
        setSelectedUid(null);
        setPlacing(d.id);
        setDragging(d.id);
      }
    }
    if (d.mode === 'pan' && bar) {
      const a = clientToLocal(bar, d.lastX, d.lastY);
      const b = clientToLocal(bar, e.clientX, e.clientY);
      bar.scrollLeft -= b.x - a.x;
    } else if (d.mode === 'drag') {
      placeGhost(e.clientX, e.clientY);
      hoverRef.current = tileOnCanvas(e.clientX, e.clientY);
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  };
  const onCardPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = pressRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    pressRef.current = null;
    if (d.mode === 'press') {
      selectCard(d.id);
    } else if (d.mode === 'drag') {
      endDrag();
      const tile = tileOnCanvas(e.clientX, e.clientY);
      if (tile) requestDeploy(d.id, tile, true);
      else {
        // 拖到地图外面 = 取消
        setPlacing(null);
        hoverRef.current = null;
      }
    }
  };
  const onCardPointerCancel = () => {
    const d = pressRef.current;
    pressRef.current = null;
    if (d?.mode === 'drag') {
      endDrag();
      setPlacing(null);
      hoverRef.current = null;
    }
  };

  const selected = selectedUid != null ? engine.unitByUid(selectedUid) : undefined;
  const rate = engine.moneyPerSecond * 60;
  const done = engine.killed + engine.leaked;
  const settings = level.settings;

  /** 部署栏里的一张卡片（角色或召唤物） */
  const renderCard = (def: CharacterDef, i: number) => {
    // 召唤物：召唤者在场时才出现在部署栏
    const summon = isSummonDef(def);
    const st = engine.cardState(def);
    const count = engine.deployedCount(def.id);
    const skills = engine.loadoutOf(def);
    const lv = summon ? 1 : engine.levelOf(def.id);
    const cooling = st.cooldown > 0 && def.deployCooldown > 0;
    return (
      <button
        key={(summon ? 'summon:' : '') + def.id}
        className={`deploy-card${summon ? ' summon-card' : ''}${placing === def.id ? ' selected' : ''}${dragging === def.id ? ' dragging' : ''}${st.ok ? '' : ' disabled'}${cooling ? ' cooling' : ''}`}
        onPointerDown={(e) => onCardPointerDown(e, def.id, summon)}
        onPointerMove={onCardPointerMove}
        onPointerUp={onCardPointerUp}
        onPointerCancel={onCardPointerCancel}
        onLostPointerCapture={() => pressRef.current && onCardPointerCancel()}
        // 鼠标 / 触摸由上面的指针事件处理；这里只处理键盘（Enter / 空格）触发的点击
        onClick={(e) => e.detail === 0 && selectCard(def.id)}
        onContextMenu={(e) => e.preventDefault()}
        title={`${summon ? '召唤物 · ' : ''}${def.name}（${def.id}）${summon ? '' : `Lv.${lv}`}\n${placementText(def.placement)} · ${def.attackTarget === 'ally' && def.atk < 0 ? `治疗 ${-def.atk}` : `攻击 ${def.atk}（${DAMAGE_TYPE_LABEL[def.damageType]}）`} · 物抗 ${def.def} · 法抗 ${def.res}% · 范围 ${def.range}${def.deployCooldown > 0 ? ` · 部署冷却 ${def.deployCooldown} 秒` : ''}${skills.length ? `\n技能：${skills.map((s) => s.name).join('、')}` : ''}${summon ? '\n数值会继承召唤者的一部分' : ''}${st.ok ? '' : '\n' + st.reason}`}
      >
        {summon ? <span className="card-key summon-tag">召唤</span> : <span className="card-key">{i < 9 ? i + 1 : i === 9 ? 0 : ''}</span>}
        <span className="card-cost">{def.cost}</span>
        {lv > 1 && <span className="card-lv">Lv.{lv}</span>}
        <UnitToken kind={summon ? 'summon' : 'character'} def={def} size={44} dim={!st.ok} />
        <span className="card-name">{def.name}</span>
        <span className="card-meta">
          {placementText(def.placement)}
          {def.maxDeploy > 0 ? ` · ${count}/${def.maxDeploy}` : count > 0 ? ` · ×${count}` : ''}
        </span>
        {cooling && (
          // 部署冷却：遮罩从上往下退去，中间显示剩余秒数
          <span className="card-cooldown" style={{ ['--cd' as string]: `${Math.min(1, st.cooldown / def.deployCooldown) * 100}%` }}>
            <span className="mono">{st.cooldown.toFixed(st.cooldown < 10 ? 1 : 0)}</span>
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="battle" ref={battleRef}>
      <header className="battle-hud">
        <div className="row gap-s">
          <button className="btn btn-ghost" onClick={exit}>
            {training ? '← 退出试用' : '← 退出'}
          </button>
          <div className="hud-level">
            <span className="mono accent">{training ? '试用' : endless ? '∞' : level.id}</span>
            <span>{training ? engine.roster.find((c) => c.id === training.focusId)?.name ?? '' : endless ? db.endless.name : settings.name}</span>
            {test && <span className="badge badge-warn">试玩模式 · 不计进度</span>}
          </div>
        </div>
        {training ? (
          <TrainingHud engine={engine} />
        ) : (
        <div className="hud-stats">
          <div className={`hud-stat hp${engine.hp <= Math.ceil(engine.maxHp * 0.3) ? ' danger' : ''}`} title="血量：敌人进入基地扣 1 点">
            <span className="hud-icon">❤</span>
            {engine.hp}/{engine.maxHp}
          </div>
          <div className="hud-stat money" title={settings.autoMoney && rate ? `每分钟${rate > 0 ? '自动回复' : '减少'} ${Math.abs(rate)}` : '不自动回复'}>
            <span className="hud-icon">◆</span>
            {Math.floor(engine.money)}
            {settings.autoMoney && rate !== 0 && (
              <small>
                {rate > 0 ? '+' : '−'}
                {Number(Math.abs(rate).toFixed(1))}/分
              </small>
            )}
          </div>
          {endless ? (
            <>
              <div className="hud-stat" title="当前波次（下一波的倒计时）">
                <span className="hud-icon">≋</span>第 {engine.wave} 波
                {engine.status === 'running' && Number.isFinite(engine.nextWaveAt) && <small>{Math.max(0, Math.ceil(engine.nextWaveAt - engine.time))}s</small>}
              </div>
              <div className="hud-stat score" title="分数（击败敌人获得）">
                <span className="hud-icon">★</span>
                {formatNumber(Math.round(engine.score * 100) / 100)}
              </div>
            </>
          ) : (
            <div className="hud-stat" title="已处理敌人 / 敌人总数">
              <span className="hud-icon">☠</span>
              {done}/{engine.totalEnemies}
            </div>
          )}
          <div className="hud-stat mono" title="战斗时间">
            {formatTime(engine.time)}
          </div>
        </div>
        )}
        <div className="row gap-s">
          {!training && <MusicControl compact />}
          <button className={`btn btn-s${showRoutes ? ' active' : ''}`} onClick={() => setShowRoutes((v) => !v)} title="显示敌人路线">
            路线
          </button>
          <div className="segmented">
            {[1, 2, 3].map((s) => (
              <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>
                {s}x
              </button>
            ))}
          </div>
          <button className="btn btn-s" disabled={!started} onClick={() => setPaused((p) => !p)}>
            {paused ? '▶ 继续' : '❚❚ 暂停'}
          </button>
          {endless && (
            <button
              className="btn btn-s btn-danger"
              disabled={engine.status !== 'running'}
              onClick={() => window.confirm('结束这次挑战？会按当前分数结算奖励。') && engine.finish()}
              title="结束挑战，按当前分数结算"
            >
              结束挑战
            </button>
          )}
        </div>
      </header>
      {training && (
        <div className="trial-bar">
          {training.controls}
          <span className="grow" />
          <button className="btn btn-s" onClick={() => engine.refillEnemies()} title="敌人回满生命（已被击败时立即重新出现）">
            ♻ 刷新血量
          </button>
          <button className={`btn btn-s${engine.frozen ? ' active' : ''}`} onClick={() => (engine.frozen = !engine.frozen)} title="让敌人停在原地 / 继续来回移动">
            {engine.frozen ? '▶ 继续移动' : '■ 停止移动'}
          </button>
          <button className="btn btn-s btn-ghost" onClick={() => engine.resetMeter()} title="伤害 / 治疗统计从现在重新开始">
            重置统计
          </button>
        </div>
      )}

      <div className="battle-field" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={placing ? 'placing' : ''}
          onMouseMove={(e) => (hoverRef.current = tileFromClient(e.clientX, e.clientY))}
          onMouseLeave={() => (hoverRef.current = null)}
          onClick={onCanvasClick}
          onContextMenu={(e) => {
            e.preventDefault();
            setPlacing(null);
            setPending(null);
            setSelectedUid(null);
          }}
        />

        {!started && engine.status === 'running' && (
          <div className="battle-banner">
            <div>
              {endless ? (
                <>
                  <strong>{db.endless.name}</strong>：敌人会一波一波不断出现，越来越多、越来越强。击败敌人得分，基地血量 {engine.maxHp}，血量归零时按分数结算奖励。
                </>
              ) : (
                <>
                  <strong>准备阶段</strong>：可以先部署角色。敌人共 {engine.totalEnemies} 个，基地血量 {engine.maxHp}。
                </>
              )}
            </div>
            {engine.warnings.length > 0 && (
              <ul className="warn-list">
                {engine.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
            <button className="btn btn-primary" onClick={() => setStarted(true)}>
              开始作战（空格）
            </button>
          </div>
        )}
        {started && paused && engine.status === 'running' && <div className="battle-paused">已暂停</div>}
        {slowed && (
          <div className="battle-slow">
            缓速 ×{formatNumber(speed * SELECT_SLOW_FACTOR)}
          </div>
        )}
        {pending && engine.status === 'running' && (
          <DeployConfirm
            def={engine.deployable(pending.id) ?? engine.roster[0]}
            tile={pending.tile}
            vp={vpRef.current}
            fieldW={wrapRef.current?.clientWidth ?? 800}
            onConfirm={confirmPending}
            onCancel={cancelPending}
          />
        )}

        {selected && (
          <UnitPanel
            unit={selected}
            onRetreat={() => {
              const change = engine.retreat(selected.uid);
              toast(change >= 0 ? `已撤退，返还 ${change}` : `已撤退，扣除 ${-change}`, 'info', 1500);
              setSelectedUid(null);
            }}
            onSkill={(i) => {
              const err = engine.activateSkill(selected.uid, i);
              if (err) toast(err, 'error', 1400);
            }}
            onClose={() => setSelectedUid(null)}
          />
        )}

        {engine.status !== 'running' && (
          <div className="result-overlay">
            {endless ? (
              <div className="result-card endless">
                <div className="result-title">挑战结束</div>
                <div className="result-sub">
                  {db.endless.name}
                  {engine.finishedByPlayer ? ' · 主动结束' : ' · 基地被突破'}
                </div>
                <div className="result-score">
                  <span className="muted small">分数</span>
                  <strong className="mono">{formatNumber(Math.round(engine.score * 100) / 100)}</strong>
                  {newBest && <span className="badge new-best">新纪录！</span>}
                </div>
                <dl className="stat-grid result-stats">
                  <dt>坚持到</dt>
                  <dd>第 {engine.wave} 波</dd>
                  <dt>击败敌人</dt>
                  <dd>{engine.killed}</dd>
                  {engine.summonsKilled > 0 && (
                    <>
                      <dt>击败召唤物</dt>
                      <dd>{engine.summonsKilled}</dd>
                    </>
                  )}
                  <dt>用时</dt>
                  <dd>{formatTime(engine.time)}</dd>
                  {!test && db.progress.endlessBest && !newBest && (
                    <>
                      <dt>最好成绩</dt>
                      <dd>
                        {formatNumber(db.progress.endlessBest.score)} 分（第 {db.progress.endlessBest.wave} 波）
                      </dd>
                    </>
                  )}
                </dl>
                {test ? (
                  <div className="muted small">试玩模式：不记录成绩，没有奖励</div>
                ) : (
                  <div className="result-rewards">
                    <div className="result-rewards-title">分数兑换</div>
                    {rewards ? <RewardList cfg={db.currency} rewards={rewards} /> : <span className="muted small">结算中…</span>}
                  </div>
                )}
                <div className="row gap-s center">
                  <button className="btn btn-primary" onClick={onRestart}>
                    再来一次
                  </button>
                  <button className="btn btn-ghost" onClick={exit}>
                    {test ? '关闭' : '返回'}
                  </button>
                </div>
              </div>
            ) : (
            <div className={`result-card ${engine.status}`}>
              <div className="result-title">{engine.status === 'won' ? '作战胜利' : '作战失败'}</div>
              <div className="result-sub">
                {level.id} · {settings.name}
              </div>
              <dl className="stat-grid result-stats">
                <dt>剩余血量</dt>
                <dd>
                  {engine.hp}/{engine.maxHp}
                </dd>
                <dt>击败敌人</dt>
                <dd>{engine.killed}</dd>
                <dt>进入基地</dt>
                <dd>{engine.leaked}</dd>
                {engine.summonsKilled + engine.summonsLeaked > 0 && (
                  <>
                    <dt>敌人的召唤物</dt>
                    <dd>
                      击败 {engine.summonsKilled}
                      {engine.summonsLeaked > 0 ? ` · 进入基地 ${engine.summonsLeaked}` : ''}
                    </dd>
                  </>
                )}
                <dt>用时</dt>
                <dd>{formatTime(engine.time)}</dd>
              </dl>
              {engine.status === 'won' && !test && (
                <div className="result-rewards">
                  <div className="result-rewards-title">通关奖励</div>
                  {rewards ? <RewardList cfg={db.currency} rewards={rewards} /> : <span className="muted small">结算中…</span>}
                </div>
              )}
              {engine.status === 'won' && test && <div className="muted small">试玩模式：不计进度，没有通关奖励</div>}
              {engine.status === 'won' && !test && <div className="muted small">进度已保存</div>}
              <div className="row gap-s center">
                {engine.status === 'won' && next && !test && (
                  <button
                    className="btn btn-primary"
                    disabled={!next.built}
                    title={next.built ? '' : '下一关尚未制作'}
                    onClick={() => navigate(`/game/play/${encodeURIComponent(next.code)}`)}
                  >
                    下一关 {next.code}
                    {next.built ? '' : '（未制作）'}
                  </button>
                )}
                <button className="btn" onClick={onRestart}>
                  重新挑战
                </button>
                <button className="btn btn-ghost" onClick={exit}>
                  {test ? '关闭' : '返回关卡选择'}
                </button>
              </div>
            </div>
            )}
          </div>
        )}
      </div>

      <footer className="deploy-bar">
        {/* 召唤物固定显示在最左边，不会被角色挤到看不见的地方 */}
        {engine.activeSummons.length > 0 && (
          <div className="deploy-zone summons">
            <span className="deploy-zone-label">召唤物</span>
            {engine.activeSummons.map((def, i) => renderCard(def, i))}
          </div>
        )}
        <div className="deploy-zone chars" ref={barRef}>
          {engine.roster.length === 0 && <div className="muted">本关没有可用角色</div>}
          {engine.roster.map((def, i) => renderCard(def, i))}
        </div>
        <button
          className="deploy-help-btn"
          title={DEPLOY_HELP}
          onClick={() => toast(DEPLOY_HELP, 'info', 4000)}
          aria-label="操作说明"
        >
          ?
        </button>
      </footer>
      {dragging && (
        <div
          className="drag-ghost"
          ref={(el) => {
            ghostRef.current = el;
            if (el) el.style.transform = `translate(${ghostPos.current.x}px, ${ghostPos.current.y}px) translate(-50%, -50%)`;
          }}
        >
          <UnitToken kind={isSummonDef(engine.deployable(dragging)) ? 'summon' : 'character'} def={engine.deployable(dragging) ?? engine.roster[0]} size={56} />
        </div>
      )}
    </div>
  );
}

/** 部署确认：显示在目标方块旁边，此时战斗暂停 */
function DeployConfirm({
  def,
  tile,
  vp,
  fieldW,
  onConfirm,
  onCancel,
}: {
  def: CharacterDef;
  tile: GridPos;
  vp: Viewport;
  fieldW: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const half = 105;
  const cx = Math.min(fieldW - half - 6, Math.max(half + 6, vp.ox + (tile.x + 0.5) * vp.scale));
  const top = vp.oy + tile.y * vp.scale;
  const above = top > 112;
  const style: React.CSSProperties = above
    ? { left: cx, top: top - 6, transform: 'translate(-50%, -100%)' }
    : { left: cx, top: top + vp.scale + 6, transform: 'translate(-50%, 0)' };
  return (
    <div className={`deploy-confirm${above ? ' above' : ' below'}`} style={style} onPointerDown={(e) => e.stopPropagation()}>
      <div className="deploy-confirm-head">
        <UnitToken kind="character" def={def} size={30} />
        <div className="grow">
          <div className="deploy-confirm-name">部署「{def.name}」？</div>
          <div className="muted small">
            {def.cost >= 0 ? `费用 ${def.cost}` : `部署获得 ${-def.cost} 金钱`} · 已暂停
          </div>
        </div>
      </div>
      <div className="deploy-confirm-actions">
        <button className="btn btn-primary" onClick={onConfirm}>
          部署
        </button>
        <button className="btn" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

/** 场上角色的信息面板：属性（含增益减益）、技能（SP 与手动释放）、撤退 */
function UnitPanel({ unit, onRetreat, onSkill, onClose }: { unit: Unit; onRetreat: () => void; onSkill: (i: number) => void; onClose: () => void }) {
  const s = unit.stats;
  const b = unit.base;
  const healer = unit.def.attackTarget === 'ally' && s.atk < 0;
  const stat = (v: number, base: number, unit2 = '', lowerBetter = false) => {
    const diff = v - base;
    const cls = Math.abs(diff) < 1e-6 ? '' : (diff > 0) !== lowerBetter ? 'up' : 'down';
    return (
      <span className={`stat-val ${cls}`}>
        {formatNumber(Math.round(v * 100) / 100)}
        {unit2}
      </span>
    );
  };
  return (
    <div className="unit-panel">
      <div className="row gap-s">
        <UnitToken kind={isSummonDef(unit.def) ? 'summon' : 'character'} def={unit.def} size={40} />
        <div className="grow">
          <div className="unit-name">
            {unit.def.name}{' '}
            {isSummonDef(unit.def) ? (
              <span className="badge summon-badge">召唤物{unit.def.invincible ? ' · 无敌' : ''}</span>
            ) : (
              <span className="lv-text small">Lv.{unit.level}</span>
            )}
          </div>
          <div className="muted small mono">{unit.def.id}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className="unit-hp">
        <div className="bar">
          <div style={{ width: `${(unit.hp / s.maxHp) * 100}%` }} />
        </div>
        <span className="mono">
          {Math.ceil(unit.hp)}/{Math.round(s.maxHp)}
        </span>
      </div>
      <dl className="stat-grid">
        <dt>{healer ? '治疗量' : '攻击'}</dt>
        <dd>{healer ? stat(-s.atk, -b.atk) : stat(s.atk, b.atk)}</dd>
        {!healer && (
          <>
            <dt>伤害类型</dt>
            <dd>{DAMAGE_TYPE_LABEL[unit.def.damageType]}</dd>
          </>
        )}
        <dt>物抗 / 法抗</dt>
        <dd>
          {stat(s.def, b.def)} / {stat(s.res, b.res, '%')}
        </dd>
        <dt>攻击间隔</dt>
        <dd>{stat(s.attackInterval, b.attackInterval, 's', true)}</dd>
        <dt>范围 / 目标</dt>
        <dd>
          {stat(s.range, b.range, ' 格')} / {s.targetCount < 0 ? '全部' : stat(s.targetCount, b.targetCount)}
        </dd>
        <dt>阻挡</dt>
        <dd>{unit.canBlock ? `${unit.blocked.length}/${s.blockCount}` : '—（高台）'}</dd>
      </dl>
      {(unit.statuses.length > 0 || unit.regens.length > 0) && (
        <div className="status-list">
          {unit.regens.map((r) => (
            <div key={`regen:${r.key}`} className="status-item" title={r.perSecond > 0 ? '持续治疗' : `持续伤害（${DAMAGE_TYPE_LABEL[r.damageType]}）`}>
              <span className={r.perSecond > 0 ? 'pos' : 'neg'}>{r.perSecond > 0 ? '✚' : '✖'}</span>
              <span className="grow">
                {r.name} {r.perSecond > 0 ? '+' : '−'}
                {formatNumber(Math.round(Math.abs(r.perSecond) * 10) / 10)}/秒
              </span>
              <span className="mono muted">{Math.max(0, r.remaining).toFixed(1)}s</span>
            </div>
          ))}
          {unit.statuses.map((st) => (
            <div key={st.key} className="status-item" title={st.modifiers.map(formatModifier).join('，')}>
              <span className={st.hasDebuff && !st.hasBuff ? 'neg' : st.hasBuff && !st.hasDebuff ? 'pos' : 'mix'}>
                {st.hasBuff && !st.hasDebuff ? '▲' : st.hasDebuff && !st.hasBuff ? '▼' : '◆'}
              </span>
              <span className="grow">{st.name}</span>
              <span className="mono muted">{st.remaining.toFixed(1)}s</span>
            </div>
          ))}
        </div>
      )}
      {unit.skills.length > 0 && (
        <div className="skill-buttons">
          {unit.skills.map((sk, i) => {
            const ready = !sk.active && sk.sp >= sk.def.spMax - 1e-9;
            const ratio = sk.active ? sk.remaining / Math.max(0.01, sk.def.duration) : sk.sp / Math.max(0.01, sk.def.spMax);
            return (
              <div key={sk.def.id} className={`skill-btn${ready ? ' ready' : ''}${sk.active ? ' active' : ''}`} style={{ borderColor: sk.def.color }}>
                <div className="row gap-s">
                  <strong style={outlinedText(sk.def.color)}>{sk.def.name}</strong>
                  <span className="grow" />
                  <span className="mono small">{sk.active ? `持续 ${sk.remaining.toFixed(1)}s` : `SP ${Math.floor(sk.sp)}/${sk.def.spMax}`}</span>
                </div>
                <div className="sp-bar">
                  <div style={{ width: `${Math.min(1, ratio) * 100}%`, background: sk.active ? '#ff9f43' : sk.def.color }} />
                </div>
                <div className="skill-btn-desc small muted" title={describeSkill(sk.def).join('\n')}>
                  {describeSkill(sk.def)[0]}
                </div>
                {sk.def.trigger === 'manual' ? (
                  <button className="btn btn-s btn-primary" disabled={!ready} onClick={() => onSkill(i)}>
                    {sk.active ? '持续中' : ready ? '释放技能' : 'SP 积累中'}
                  </button>
                ) : (
                  <div className="small muted" title={describeSkillTrigger(sk.def)}>
                    SP 满后自动释放
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <button className="btn btn-danger" onClick={onRetreat}>
        撤退（{retreatRefund(unit.def.cost) >= 0 ? `返还 ${retreatRefund(unit.def.cost)}` : `扣除 ${-retreatRefund(unit.def.cost)}`}）
      </button>
    </div>
  );
}

const DEPLOY_HELP = `拖动角色到绿色方块 → 暂停后选择部署 / 取消；拿起时时间 ×${SELECT_SLOW_FACTOR}。也可以点卡片再点方块。点击场上的角色放技能或撤退；右键 / Esc 取消。召唤者在场时，召唤物出现在部署栏最左边。数字键 1~9、0 选择角色。`;

function placementText(p: string) {
  return p === 'ground' ? '地面' : p === 'high' ? '高台' : '均可';
}

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 角色试用：把试用的角色部署到路线中间（地面角色放在路上，高台角色放在路旁），放不下时找第一个能放的方块 */
function deployFocus(engine: GameEngine, id: string) {
  const def = engine.roster.find((c) => c.id === id);
  if (!def) return;
  const g = engine.grid;
  const midX = Math.floor(g.width / 2);
  const midY = Math.floor(g.height / 2);
  const prefer = def.placement === 'ground' ? [{ x: midX, y: midY }] : [{ x: midX, y: midY - 1 }, { x: midX, y: midY + 1 }, { x: midX, y: midY }];
  for (const t of prefer) if (!engine.deploy(id, t)) return;
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) if (!engine.deploy(id, { x, y })) return;
}

/** 角色试用的 HUD：伤害 / 治疗统计 */
function TrainingHud({ engine }: { engine: GameEngine }) {
  const secs = Math.max(1, engine.time - engine.meterStart);
  // 试用的敌人（不算它召唤的召唤物）
  const enemy = engine.enemies.find((e) => e.hp > 0 && !e.summon);
  return (
    <div className="hud-stats">
      <div className="hud-stat" title="试用中可以随意部署">
        <span className="hud-icon">◆</span>
        {Math.floor(engine.money)}
      </div>
      <div className="hud-stat" title="对敌人造成的伤害（从开始或上次「重置统计」算起）">
        <span className="hud-icon">⚔</span>
        {formatNumber(Math.round(engine.damageDealt))}
        <small>{formatNumber(Math.round((engine.damageDealt / secs) * 10) / 10)}/秒</small>
      </div>
      {engine.healingDone > 0 && (
        <div className="hud-stat" title="对队友的治疗量">
          <span className="hud-icon">✚</span>
          {formatNumber(Math.round(engine.healingDone))}
          <small>{formatNumber(Math.round((engine.healingDone / secs) * 10) / 10)}/秒</small>
        </div>
      )}
      <div className="hud-stat" title="敌人的生命">
        <span className="hud-icon">☠</span>
        {enemy ? `${Math.ceil(enemy.hp)}/${Math.round(enemy.stats.maxHp)}` : '重新出现中…'}
      </div>
    </div>
  );
}
