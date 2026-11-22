import { useEffect, useRef, useState } from 'react';
import { STATS, formatModifier, isBuff } from '../../core/stats';
import { importMusic, listMusic, type MusicKind } from '../../core/storage/repository';
import type { OnHitEffect, SkillDef, StatKey, StatModifier } from '../../core/types';
import { invalidateMusic, musicUrl } from '../../game/music';
import { NumberInput } from '../common/fields';
import { toast } from '../common/toast';

/**
 * 属性修改列表编辑器：可以添加任意数量的修改，正数 / 负数自由组合
 * （例如同时降低物抗和法抗，再提升攻击力）。
 */
export function ModifierListEditor({
  value,
  onChange,
  enemyContext,
}: {
  value: StatModifier[];
  onChange: (v: StatModifier[]) => void;
  /** 只在说明里提示「移动速度只对敌人有效」等 */
  enemyContext?: boolean;
}) {
  const set = (i: number, patch: Partial<StatModifier>) => onChange(value.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  return (
    <div className="mod-list">
      {value.map((m, i) => (
        <div key={i} className={`mod-row ${m.value === 0 ? '' : isBuff(m) ? 'buff' : 'debuff'}`}>
          <select className="input" value={m.stat} onChange={(e) => set(i, { stat: e.target.value as StatKey })}>
            {STATS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <select className="input" value={m.mode} onChange={(e) => set(i, { mode: e.target.value as StatModifier['mode'] })}>
            <option value="percent">百分比 %</option>
            <option value="add">固定值</option>
          </select>
          <NumberInput value={m.value} min={-100000} max={100000} step={m.mode === 'percent' ? 5 : 1} onChange={(v) => set(i, { value: v })} />
          <span className="mod-tag">{m.value === 0 ? '—' : isBuff(m) ? '增益' : '减益'}</span>
          <button type="button" className="icon-btn danger" onClick={() => onChange(value.filter((_, k) => k !== i))} title="删除">
            ×
          </button>
        </div>
      ))}
      <div className="row gap-s">
        <button type="button" className="btn btn-s" onClick={() => onChange([...value, { stat: 'atk', mode: 'percent', value: 20 }])}>
          + 增益
        </button>
        <button type="button" className="btn btn-s" onClick={() => onChange([...value, { stat: 'def', mode: 'add', value: -30 }])}>
          + 减益
        </button>
        {value.length > 0 && <span className="muted small">{value.map(formatModifier).join('，')}</span>}
      </div>
      {enemyContext === false && value.some((m) => m.stat === 'speed') && <div className="field-note">移动速度只对敌人有效</div>}
    </div>
  );
}

/** 普通攻击命中时附带的效果 */
export function OnHitEditor({ value, onChange }: { value: OnHitEffect | null; onChange: (v: OnHitEffect | null) => void }) {
  if (!value) {
    return (
      <button type="button" className="btn btn-s" onClick={() => onChange({ modifiers: [{ stat: 'speed', mode: 'percent', value: -30 }], duration: 2 })}>
        + 添加命中效果
      </button>
    );
  }
  return (
    <div className="onhit-box">
      <div className="row gap-s">
        <span className="muted small">持续</span>
        <NumberInput value={value.duration} min={0.1} max={3600} step={0.5} width={80} onChange={(v) => onChange({ ...value, duration: v })} />
        <span className="muted small">秒（作用于被命中的目标）</span>
        <span className="grow" />
        <button type="button" className="btn btn-s btn-ghost" onClick={() => onChange(null)}>
          移除
        </button>
      </div>
      <ModifierListEditor value={value.modifiers} onChange={(modifiers) => onChange(modifiers.length ? { ...value, modifiers } : null)} />
    </div>
  );
}

/** 从技能库中选择技能（有顺序：默认携带前 N 个） */
export function SkillPicker({
  value,
  library,
  slots,
  onChange,
}: {
  value: string[];
  library: SkillDef[];
  slots: number;
  onChange: (v: string[]) => void;
}) {
  const map = new Map(library.map((s) => [s.id, s]));
  const rest = library.filter((s) => !value.includes(s.id));
  return (
    <div className="skill-picker">
      {value.length === 0 && <div className="muted small">还没有技能。从下方选择技能库中的技能添加（技能在「技能编辑」中制作）。</div>}
      {value.map((id, i) => {
        const s = map.get(id);
        return (
          <div key={id} className={`skill-pick-row${i < slots ? ' default' : ''}`}>
            <span className="skill-dot" style={{ background: s?.color ?? '#666' }} />
            <span className="mono small">{id}</span>
            <span className="grow">{s ? s.name : <span className="field-error">技能不存在</span>}</span>
            {i < slots && <span className="badge">默认携带</span>}
            <button type="button" className="icon-btn" disabled={i === 0} onClick={() => onChange(swap(value, i, i - 1))} title="上移">
              ↑
            </button>
            <button type="button" className="icon-btn" disabled={i === value.length - 1} onClick={() => onChange(swap(value, i, i + 1))} title="下移">
              ↓
            </button>
            <button type="button" className="icon-btn danger" onClick={() => onChange(value.filter((x) => x !== id))} title="移除">
              ×
            </button>
          </div>
        );
      })}
      {rest.length > 0 && (
        <select
          className="input"
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...value, e.target.value]);
          }}
        >
          <option value="">+ 添加技能…</option>
          {rest.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id} · {s.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const out = arr.slice();
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

/** 音乐选择 + 试听 */
export function MusicSelect({
  kind,
  value,
  onChange,
  emptyLabel,
  tracks,
}: {
  kind: MusicKind;
  value: string;
  onChange: (v: string) => void;
  emptyLabel: string;
  tracks: string[];
}) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  useEffect(() => {
    audio.current?.pause();
    setPlaying(false);
  }, [value]);
  const missing = value && !tracks.includes(value);
  return (
    <div className="music-select">
      <select className={`input${missing ? ' invalid' : ''}`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {missing && <option value={value}>{value}（文件不存在）</option>}
        {tracks.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-s"
        disabled={!value || !!missing}
        title="试听"
        onClick={async () => {
          if (playing) {
            audio.current?.pause();
            setPlaying(false);
            return;
          }
          const url = await musicUrl(kind, value);
          if (!url) return toast('音乐文件读取失败', 'error');
          audio.current?.pause();
          const a = new Audio(url);
          a.volume = 0.6;
          a.onended = () => setPlaying(false);
          audio.current = a;
          await a.play().catch(() => toast('无法播放这个音乐文件', 'error'));
          setPlaying(true);
        }}
      >
        {playing ? '■ 停止' : '▶ 试听'}
      </button>
    </div>
  );
}

/** 读取音乐列表（主页 / 战斗） */
export function useMusicTracks(): { home: string[]; battle: string[]; reload: () => void } {
  const [home, setHome] = useState<string[]>([]);
  const [battle, setBattle] = useState<string[]>([]);
  const [n, setN] = useState(0);
  useEffect(() => {
    void listMusic('home').then(setHome);
    void listMusic('battle').then(setBattle);
  }, [n]);
  return { home, battle, reload: () => setN((x) => x + 1) };
}

/** 导入音乐文件到 data/music/<kind>/ */
export function MusicImportButton({ kind, onDone }: { kind: MusicKind; onDone: (name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn btn-s" onClick={() => ref.current?.click()}>
        导入{kind === 'home' ? '主页' : '战斗'}音乐…
      </button>
      <input
        ref={ref}
        type="file"
        accept="audio/*,.mp3,.ogg,.wav,.m4a,.flac"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const name = await importMusic(f, kind);
            invalidateMusic();
            toast(`已导入 music/${kind}/${name}`, 'ok');
            onDone(name);
          } catch (err) {
            toast(`导入失败：${String(err)}`, 'error');
          }
        }}
      />
    </>
  );
}
