import { useEffect, useState } from 'react';
import { newChapter } from '../../core/defaults';
import { notifySaved } from '../../core/github/sync';
import { levelCode, validateChapterId } from '../../core/ids';
import { deleteLevel, listLevelCodes, loadChapters, loadSettings, saveChapters, saveSettings } from '../../core/storage/repository';
import type { ChapterDef, GameSettings } from '../../core/types';
import { Field, NumberInput, TextInput } from '../common/fields';
import { toast } from '../common/toast';
import { SaveBar } from './DefListPanel';
import type { EditorTabProps } from './EditorApp';
import { MusicImportButton, MusicSelect, useMusicTracks } from './effectEditors';
import { useListDraft, useSaveShortcut } from './useListDraft';

/** 章节规划：拖动或上下移动来安排章节顺序，设置每章的关卡数量 */
export function ChapterEditor({ onDirtyChange }: EditorTabProps) {
  const draft = useListDraft<ChapterDef>({
    load: loadChapters,
    save: async (list, renames) => {
      await saveChapters(list, renames);
      notifySaved('章节');
    },
    validateId: validateChapterId,
    onDirtyChange,
    label: '章节',
  });
  const [built, setBuilt] = useState<Set<string>>(new Set());
  const [dragKey, setDragKey] = useState<string | null>(null);
  const tracks = useMusicTracks();
  const [settings, setSettings] = useState<GameSettings | null>(null);
  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);
  const updateSettings = async (patch: Partial<GameSettings>) => {
    const next = { ...(settings ?? { homeMusic: '' }), ...patch };
    setSettings(next);
    try {
      await saveSettings(next);
      notifySaved('全局设置');
      toast('全局设置已保存', 'ok', 1500);
    } catch (err) {
      toast(`保存失败：${String(err)}`, 'error');
    }
  };
  const [overIndex, setOverIndex] = useState<number | null>(null);
  useSaveShortcut(() => void save());

  const refreshBuilt = () => listLevelCodes().then((c) => setBuilt(new Set(c)));
  useEffect(() => {
    void refreshBuilt();
  }, []);

  const save = async () => {
    if (await draft.saveAll()) await refreshBuilt();
  };

  if (draft.loadError) return <div className="page-msg">读取章节失败：{draft.loadError}</div>;
  if (!draft.items) return <div className="page-msg">加载中…</div>;
  const items = draft.items;
  const ids = items.map((d) => d.value.id);
  const knownChapters = new Set(items.map((d) => d.origId ?? d.value.id));
  const orphans = [...built].filter((code) => {
    const i = code.lastIndexOf('_');
    const ch = items.find((d) => (d.origId ?? d.value.id) === code.slice(0, i));
    return !ch || Number(code.slice(i + 1)) > ch.value.levelCount;
  });

  return (
    <div className="chapter-editor">
      <div className="chapter-editor-main">
        <div className="panel-head">
          <span>
            章节顺序 <span className="muted">（从上到下 = 游戏中的解锁顺序；拖动左侧把手调整）</span>
          </span>
          <button className="btn btn-s btn-primary" onClick={() => draft.add(newChapter(nextChapterId(ids)))}>
            + 新建章节
          </button>
        </div>
        <div className="chapter-rows">
          {items.map((d, i) => {
            const ch = d.value;
            const err = draft.errors.get(d.key);
            const lookupId = d.origId ?? ch.id;
            return (
              <div
                key={d.key}
                className={`chapter-row${dragKey === d.key ? ' dragging' : ''}${overIndex === i && dragKey && dragKey !== d.key ? ' drop-target' : ''}`}
                onDragOver={(e) => {
                  if (!dragKey) return;
                  e.preventDefault();
                  setOverIndex(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragKey) draft.move(dragKey, i);
                  setDragKey(null);
                  setOverIndex(null);
                }}
              >
                <div
                  className="drag-handle"
                  draggable
                  onDragStart={(e) => {
                    setDragKey(d.key);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', d.key);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverIndex(null);
                  }}
                  title="拖动调整顺序"
                >
                  ⋮⋮
                </div>
                <div className="chapter-order">{String(i + 1).padStart(2, '0')}</div>
                <div className="chapter-fields">
                  <Field label="章节编号" hint="如 ZH">
                    <TextInput value={ch.id} invalid={!!err} maxLength={16} onChange={(v) => draft.update(d.key, { id: v.trim() })} />
                  </Field>
                  <Field label="章节名称">
                    <TextInput value={ch.name} maxLength={30} onChange={(v) => draft.update(d.key, { name: v })} />
                  </Field>
                  <Field label="关卡数量">
                    <NumberInput value={ch.levelCount} min={1} max={99} integer onChange={(v) => draft.update(d.key, { levelCount: v })} />
                  </Field>
                  <Field label="简介">
                    <TextInput value={ch.description ?? ''} maxLength={60} onChange={(v) => draft.update(d.key, { description: v || undefined })} />
                  </Field>
                  <Field label="战斗音乐" hint="music/battle/">
                    <MusicSelect kind="battle" value={ch.battleMusic} tracks={tracks.battle} emptyLabel="无（静音）" onChange={(v) => draft.update(d.key, { battleMusic: v })} />
                  </Field>
                </div>
                <div className="chapter-levels">
                  {Array.from({ length: ch.levelCount }, (_, k) => {
                    const code = levelCode(lookupId, k + 1);
                    const has = built.has(code);
                    return (
                      <span key={k} className={`level-chip${has ? ' built' : ''}`} title={has ? '已制作地图' : '尚未制作'}>
                        {levelCode(ch.id, k + 1)}
                      </span>
                    );
                  })}
                </div>
                <div className="chapter-actions">
                  <button className="btn btn-s" disabled={i === 0} onClick={() => draft.move(d.key, i - 1)}>
                    ↑
                  </button>
                  <button className="btn btn-s" disabled={i === items.length - 1} onClick={() => draft.move(d.key, i + 1)}>
                    ↓
                  </button>
                  <button
                    className="btn btn-s btn-danger"
                    onClick={() => {
                      const codes = [...built].filter((c) => c.startsWith(`${lookupId}_`));
                      if (!window.confirm(`删除章节「${ch.name}」（${ch.id}）？`)) return;
                      draft.remove(d.key);
                      if (codes.length && d.origId && window.confirm(`同时删除该章节已制作的 ${codes.length} 个关卡文件（${codes.join('、')}）吗？\n选择“取消”则保留关卡文件。`)) {
                        void Promise.all(codes.map(deleteLevel)).then(() => {
                          toast(`已删除 ${codes.length} 个关卡文件`, 'ok');
                          void refreshBuilt();
                        });
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
                {err && <div className="field-error row-error">{err}</div>}
              </div>
            );
          })}
          {items.length === 0 && <div className="empty-hint">还没有章节</div>}
        </div>
        <SaveBar dirty={draft.dirty} saving={draft.saving} onSave={() => void save()} />
      </div>
      <aside className="chapter-side">
        <div className="panel-head">全局设置 · 音乐</div>
        <div className="form-grid single">
          <Field label="主页音乐" hint="未进入战斗时播放（music/home/）">
            <MusicSelect
              kind="home"
              value={settings?.homeMusic ?? ''}
              tracks={tracks.home}
              emptyLabel="全部主页音乐按顺序循环"
              onChange={(v) => void updateSettings({ homeMusic: v })}
            />
          </Field>
          <div className="music-files">
            <div className="muted small">
              主页音乐 {tracks.home.length} 首 · 战斗音乐 {tracks.battle.length} 首
            </div>
            <div className="row gap-s wrap">
              <MusicImportButton
                kind="home"
                onDone={() => {
                  tracks.reload();
                  notifySaved('音乐');
                }}
              />
              <MusicImportButton
                kind="battle"
                onDone={() => {
                  tracks.reload();
                  notifySaved('音乐');
                }}
              />
            </div>
            <div className="muted small">也可以直接把音乐上传到 GitHub 仓库的 data/music/home 和 data/music/battle 文件夹，然后点顶部的「拉取」。</div>
          </div>
        </div>
        <div className="panel-head">说明</div>
        <ul className="help-list">
          <li>章节按列表顺序解锁：上一章节的全部关卡通关后，下一章节才会解锁。</li>
          <li>
            关卡编号为 <span className="mono accent">章节编号_关卡序号</span>，例如 <span className="mono">ZH_1</span>。
          </li>
          <li>修改章节编号并保存后，已制作的关卡文件会自动改名（ZH_1 → 新编号_1），玩家进度也会同步。</li>
          <li>绿色编号表示该关卡已经在「地图规划」中制作；灰色表示尚未制作（游戏中显示为“未制作”）。</li>
        </ul>
        {orphans.length > 0 && (
          <>
            <div className="panel-head">未归属的关卡文件</div>
            <div className="muted small">这些关卡文件不属于任何章节（或超出章节的关卡数量），游戏中不会出现：</div>
            <div className="chapter-levels">
              {orphans.map((c) => (
                <span key={c} className="level-chip orphan">
                  {c}
                </span>
              ))}
            </div>
          </>
        )}
        {knownChapters.size === 0 && <div className="muted small">提示：先新建一个章节，再去「地图规划」制作关卡。</div>}
      </aside>
    </div>
  );
}

function nextChapterId(ids: string[]): string {
  const used = new Set(ids);
  for (let n = 1; ; n++) if (!used.has(`CH${n}`)) return `CH${n}`;
}
