import { useCallback, useEffect, useRef, useState } from 'react';
import { getBridge } from '../../core/storage/backend';
import { GAME_VERSION } from '../../version';
import { navigate, openApp } from '../router';
import { ChapterEditor } from './ChapterEditor';
import { CharacterEditor } from './CharacterEditor';
import { CurrencyEditor } from './CurrencyEditor';
import { EndlessEditor } from './EndlessEditor';
import { EnemyEditor } from './EnemyEditor';
import { GitHubBar } from './GitHubBar';
import { LevelEditor } from './LevelEditor';
import { SkillEditor } from './SkillEditor';

type Tab = 'characters' | 'enemies' | 'skills' | 'chapters' | 'levels' | 'currency' | 'endless';

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: 'characters', label: '角色编辑', desc: '数值 · 攻击方式 · 技能' },
  { id: 'enemies', label: '敌人编辑', desc: '外形 · 数值 · 技能' },
  { id: 'skills', label: '技能编辑', desc: 'SP · 增益减益 · 伤害治疗' },
  { id: 'chapters', label: '章节规划', desc: '顺序 · 关卡数 · 音乐' },
  { id: 'levels', label: '地图规划', desc: '地图积木 · 敌人路线' },
  { id: 'currency', label: '货币编辑', desc: '货币 · 经验书 · 升级' },
  { id: 'endless', label: '无尽模式', desc: '波次 · 地图 · 分数兑换' },
];

export interface EditorTabProps {
  onDirtyChange: (dirty: boolean) => void;
}

/** 关卡编辑器外壳：七个模块，切换时检查未保存的修改 */
export function EditorApp({ initialLevel }: { initialLevel?: string }) {
  const [tab, setTab] = useState<Tab>(initialLevel ? 'levels' : 'characters');
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  /** 从 GitHub 拉取后 +1，让当前模块重新读取数据 */
  const [dataVersion, setDataVersion] = useState(0);
  const bridge = getBridge();

  const onDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d;
    setDirty(d);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const switchTab = (t: Tab) => {
    if (t === tab) return;
    if (dirtyRef.current && !window.confirm('当前模块有未保存的修改，切换后将丢失。确定切换吗？')) return;
    onDirtyChange(false);
    setTab(t);
  };

  // 地址中的 ?level= 变化时（例如从别处跳转过来）切换到地图规划
  const lastInitial = useRef(initialLevel);
  useEffect(() => {
    if (!initialLevel || initialLevel === lastInitial.current) return;
    lastInitial.current = initialLevel;
    switchTab('levels');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLevel]);

  const key = `${tab}-${dataVersion}`;
  return (
    <div className="editor">
      <header className="editor-top">
        <div className="editor-brand">
          <div className="logo-mark small">
            <span />
            <span />
            <span />
          </div>
          <div>
            <div className="brand-name">ARCADIA TOWER</div>
            <div className="brand-sub">关卡编辑器 · v{GAME_VERSION}</div>
          </div>
        </div>
        <nav className="editor-tabs">
          {TABS.map((t, i) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => switchTab(t.id)}>
              <span className="tab-no">{i + 1}</span>
              <span className="tab-text">
                <strong>{t.label}</strong>
                <small>{t.desc}</small>
              </span>
              {tab === t.id && dirty && <span className="dirty-dot" title="有未保存的修改" />}
            </button>
          ))}
        </nav>
        <div className="row gap-s">
          <GitHubBar
            dirty={dirty}
            onPulled={() => {
              onDirtyChange(false);
              setDataVersion((v) => v + 1);
            }}
          />
          <button className="btn btn-s btn-ghost" onClick={() => openApp('game', undefined, true)}>
            打开游戏
          </button>
          {!bridge && (
            <button
              className="btn btn-s btn-ghost"
              onClick={() => {
                if (dirtyRef.current && !window.confirm('有未保存的修改，确定离开吗？')) return;
                navigate('/');
              }}
            >
              启动器
            </button>
          )}
        </div>
      </header>
      <main className="editor-main">
        {tab === 'characters' && <CharacterEditor key={key} onDirtyChange={onDirtyChange} />}
        {tab === 'enemies' && <EnemyEditor key={key} onDirtyChange={onDirtyChange} />}
        {tab === 'skills' && <SkillEditor key={key} onDirtyChange={onDirtyChange} />}
        {tab === 'chapters' && <ChapterEditor key={key} onDirtyChange={onDirtyChange} />}
        {tab === 'levels' && <LevelEditor key={key} onDirtyChange={onDirtyChange} initialLevel={initialLevel} />}
        {tab === 'currency' && <CurrencyEditor key={key} onDirtyChange={onDirtyChange} />}
        {tab === 'endless' && <EndlessEditor key={key} onDirtyChange={onDirtyChange} />}
      </main>
    </div>
  );
}
