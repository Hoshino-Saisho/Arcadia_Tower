import { useCallback, useEffect, useRef, useState } from 'react';
import { RETREAT_REFUND_RATIO, SELECT_SLOW_FACTOR } from '../../core/defaults';
import { describeSkill, describeSkillTrigger } from '../../core/describe';
import { levelCode } from '../../core/ids';
import { ProgressView } from '../../core/progress';
import { DAMAGE_TYPE_LABEL, formatModifier, formatNumber } from '../../core/stats';
import { loadDatabase, loadLevel, loadProgress, saveProgress, type GameDatabase } from '../../core/storage/repository';
import type { GridPos, LevelDef } from '../../core/types';
import { FIXED_DT, GameEngine } from '../../game/engine';
import type { Unit } from '../../game/entities';
import { preloadIcons } from '../../game/icons';
import { music } from '../../game/music';
import { BattleRenderer, screenToTile, type Viewport } from '../../game/renderer';
import { toast } from '../common/toast';
import { UnitToken } from '../common/tokens';
import { navigate } from '../router';
import { MusicControl } from './HomePage';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; db: GameDatabase; level: LevelDef };

/** 战斗页面：加载数据 → 创建引擎 */
export function BattlePage({ code, test }: { code: string; test: boolean }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [db, level] = await Promise.all([loadDatabase(), loadLevel(code)]);
      if (cancelled) return;
      if (!level) return setState({ status: 'error', message: `关卡 ${code} 尚未制作` });
      if (!test) {
        const view = new ProgressView(db.chapters, db.progress, db.levelCodes);
        if (!view.isLevelUnlocked(level.chapterId, level.index)) {
          return setState({ status: 'error', message: `关卡 ${code} 尚未解锁` });
        }
      }
      preloadIcons([...db.characters.map((c) => c.icon), ...db.enemies.map((e) => e.icon)]);
      // 战斗音乐：关卡单独设置的优先，否则用章节的
      const chapter = db.chapters.find((c) => c.id === level.chapterId);
      music.set({ kind: 'battle', file: level.settings.battleMusic || chapter?.battleMusic || '' });
      setState({ status: 'ready', db, level });
    })().catch((err) => !cancelled && setState({ status: 'error', message: String(err) }));
    return () => {
      cancelled = true;
    };
  }, [code, test]);

  if (state.status === 'loading') return <div className="page-msg">加载关卡 {code}…</div>;
  if (state.status === 'error') {
    return (
      <div className="page-msg">
        {state.message}
        <button className="btn" onClick={() => navigate('/game/chapters')}>
          返回章节选择
        </button>
      </div>
    );
  }
  return <Battle key={attempt} db={state.db} level={state.level} test={test} onRestart={() => setAttempt((a) => a + 1)} />;
}

interface Ctrl {
  started: boolean;
  paused: boolean;
  speed: number;
  placing: string | null;
  selectedUid: number | null;
  showRoutes: boolean;
}

function Battle({ db, level, test, onRestart }: { db: GameDatabase; level: LevelDef; test: boolean; onRestart: () => void }) {
  const engineRef = useRef<GameEngine>(null as unknown as GameEngine);
  if (!engineRef.current) {
    engineRef.current = new GameEngine(level, db.characters, db.enemies, { skills: db.skills, loadouts: db.progress.loadouts });
  }
  const engine = engineRef.current;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<Viewport>({ scale: 1, ox: 0, oy: 0 });
  const hoverRef = useRef<GridPos | null>(null);
  const sizeRef = useRef({ w: 800, h: 500, dpr: 1 });

  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [placing, setPlacing] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [showRoutes, setShowRoutes] = useState(true);
  const [, setTick] = useState(0);
  const [next, setNext] = useState<{ code: string; built: boolean } | null>(null);

  const ctrl = useRef<Ctrl>({ started, paused, speed, placing, selectedUid, showRoutes });
  ctrl.current = { started, paused, speed, placing, selectedUid, showRoutes };
  /** 选中角色（部署卡片或场上的角色）时时间变慢 */
  const slowed = started && !paused && engine.status === 'running' && (placing != null || selectedUid != null);

  // 画布尺寸
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
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
      if (c.started && !c.paused) {
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
      const placingDef = c.placing ? engine.roster.find((r) => r.id === c.placing) ?? null : null;
      vpRef.current = renderer.render(ctx, w, h, dpr, { hoverTile: hoverRef.current, placing: placingDef, selectedUid: c.selectedUid, showRoutes: c.showRoutes }, now / 1000);
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
    if (status !== 'won' || savedRef.current) return;
    savedRef.current = true;
    (async () => {
      const progress = await loadProgress();
      if (!test && !progress.cleared.includes(level.id)) {
        progress.cleared.push(level.id);
        await saveProgress(progress);
      }
      const view = new ProgressView(db.chapters, progress, db.levelCodes);
      const n = view.nextLevel(level.chapterId, level.index);
      if (n) {
        const nc = levelCode(n.chapterId, n.index);
        setNext({ code: nc, built: db.levelCodes.has(nc) });
      }
    })().catch((err) => toast(`保存进度失败：${String(err)}`, 'error'));
  }, [status, test, level, db]);

  // 选中的角色被击倒时取消选择
  useEffect(() => {
    if (selectedUid != null && !engine.unitByUid(selectedUid)) setSelectedUid(null);
  });

  const exit = useCallback(() => {
    if (test) {
      window.close();
      window.setTimeout(() => navigate('/game'), 150);
    } else {
      navigate(`/game/chapter/${encodeURIComponent(level.chapterId)}`);
    }
  }, [test, level.chapterId]);

  const selectCard = useCallback(
    (id: string) => {
      const def = engine.roster.find((c) => c.id === id);
      if (!def) return;
      if (ctrl.current.placing === id) return setPlacing(null);
      const st = engine.cardState(def);
      if (!st.ok) return toast(st.reason!, 'error', 1500);
      setSelectedUid(null);
      setPlacing(id);
    },
    [engine],
  );

  // 键盘：Esc 取消、空格暂停、数字键选卡
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') {
        setPlacing(null);
        setSelectedUid(null);
      } else if (e.key === ' ') {
        e.preventDefault();
        if (ctrl.current.started) setPaused((p) => !p);
        else setStarted(true);
      } else if (/^[1-9]$/.test(e.key)) {
        const def = engine.roster[Number(e.key) - 1];
        if (def) selectCard(def.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, selectCard]);

  const tileFromEvent = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return screenToTile(vpRef.current, e.clientX - r.left, e.clientY - r.top);
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    const tile = tileFromEvent(e);
    if (placing) {
      const err = engine.deploy(placing, tile);
      if (err) toast(err, 'error', 1500);
      else setPlacing(null);
      return;
    }
    const u = engine.unitAt(tile.x, tile.y);
    setSelectedUid(u ? u.uid : null);
  };

  const selected = selectedUid != null ? engine.unitByUid(selectedUid) : undefined;
  const rate = engine.moneyPerSecond * 60;
  const done = engine.killed + engine.leaked;
  const settings = level.settings;

  return (
    <div className="battle">
      <header className="battle-hud">
        <div className="row gap-s">
          <button className="btn btn-ghost" onClick={exit}>
            ← 退出
          </button>
          <div className="hud-level">
            <span className="mono accent">{level.id}</span>
            <span>{settings.name}</span>
            {test && <span className="badge badge-warn">试玩模式 · 不计进度</span>}
          </div>
        </div>
        <div className="hud-stats">
          <div className={`hud-stat hp${engine.hp <= Math.ceil(engine.maxHp * 0.3) ? ' danger' : ''}`} title="血量：敌人进入基地扣 1 点">
            <span className="hud-icon">❤</span>
            {engine.hp}/{engine.maxHp}
          </div>
          <div className="hud-stat money" title={settings.autoMoney ? `每分钟自动回复 ${rate}` : '不自动回复'}>
            <span className="hud-icon">◆</span>
            {Math.floor(engine.money)}
            {settings.autoMoney && <small>+{Number(rate.toFixed(1))}/分</small>}
          </div>
          <div className="hud-stat" title="已处理敌人 / 敌人总数">
            <span className="hud-icon">☠</span>
            {done}/{engine.totalEnemies}
          </div>
          <div className="hud-stat mono" title="战斗时间">
            {formatTime(engine.time)}
          </div>
        </div>
        <div className="row gap-s">
          <MusicControl compact />
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
        </div>
      </header>

      <div className="battle-field" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={placing ? 'placing' : ''}
          onMouseMove={(e) => (hoverRef.current = tileFromEvent(e))}
          onMouseLeave={() => (hoverRef.current = null)}
          onClick={onCanvasClick}
          onContextMenu={(e) => {
            e.preventDefault();
            setPlacing(null);
            setSelectedUid(null);
          }}
        />

        {!started && engine.status === 'running' && (
          <div className="battle-banner">
            <div>
              <strong>准备阶段</strong>：可以先部署角色。敌人共 {engine.totalEnemies} 个，基地血量 {engine.maxHp}。
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

        {selected && (
          <UnitPanel
            unit={selected}
            onRetreat={() => {
              const refund = engine.retreat(selected.uid);
              toast(`已撤退，返还 ${refund}`, 'info', 1500);
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
                <dt>用时</dt>
                <dd>{formatTime(engine.time)}</dd>
              </dl>
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
          </div>
        )}
      </div>

      <footer className="deploy-bar">
        {engine.roster.length === 0 && <div className="muted">本关没有可用角色</div>}
        {engine.roster.map((def, i) => {
          const st = engine.cardState(def);
          const count = engine.deployedCount(def.id);
          const skills = engine.loadoutOf(def);
          return (
            <button
              key={def.id}
              className={`deploy-card${placing === def.id ? ' selected' : ''}${st.ok ? '' : ' disabled'}`}
              onClick={() => selectCard(def.id)}
              title={`${def.name}（${def.id}）\n${placementText(def.placement)} · ${def.attackTarget === 'ally' && def.atk < 0 ? `治疗 ${-def.atk}` : `攻击 ${def.atk}（${DAMAGE_TYPE_LABEL[def.damageType]}）`} · 物抗 ${def.def} · 法抗 ${def.res}% · 范围 ${def.range}${skills.length ? `\n技能：${skills.map((s) => s.name).join('、')}` : ''}${st.ok ? '' : '\n' + st.reason}`}
            >
              <span className="card-key">{i + 1}</span>
              <span className="card-cost">{def.cost}</span>
              <UnitToken kind="character" def={def} size={44} dim={!st.ok} />
              <span className="card-name">{def.name}</span>
              <span className="card-meta">
                {placementText(def.placement)}
                {def.maxDeploy > 0 ? ` · ${count}/${def.maxDeploy}` : count > 0 ? ` · ×${count}` : ''}
              </span>
            </button>
          );
        })}
        <div className="deploy-help muted small">
          选中角色时时间变慢（×{SELECT_SLOW_FACTOR}）· 点击绿色方块部署 · 右键/Esc 取消 · 点击场上角色释放技能或撤退
        </div>
      </footer>
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
        <UnitToken kind="character" def={unit.def} size={40} />
        <div className="grow">
          <div className="unit-name">{unit.def.name}</div>
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
      {unit.statuses.length > 0 && (
        <div className="status-list">
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
                  <strong style={{ color: sk.def.color }}>{sk.def.name}</strong>
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
        撤退（返还 {Math.floor(unit.def.cost * RETREAT_REFUND_RATIO)}）
      </button>
    </div>
  );
}

function placementText(p: string) {
  return p === 'ground' ? '地面' : p === 'high' ? '高台' : '均可';
}

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
