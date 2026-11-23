import { useEffect, useState } from 'react';
import { levelCode } from '../../core/ids';
import { levelRewardInfo, type LevelRewardInfo } from '../../core/leveling';
import { ProgressView } from '../../core/progress';
import { loadDatabase, loadLevel, type GameDatabase } from '../../core/storage/repository';
import { RewardPreview } from '../common/wallet';
import { navigate } from '../router';

/**
 * 关卡选择：细长的关卡按钮，不显示箭头和锁。
 *  - 上一关没有通关时，这一关不显示
 *  - 已解锁但尚未制作的关卡显示为暗淡
 */
export function LevelSelectPage({ chapterId }: { chapterId: string }) {
  const [db, setDb] = useState<GameDatabase | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [rewards, setRewards] = useState<Record<string, LevelRewardInfo>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    loadDatabase().then(async (d) => {
      setDb(d);
      const ch = d.chapters.find((c) => c.id === chapterId);
      if (!ch) return;
      const out: Record<string, string> = {};
      const rw: Record<string, LevelRewardInfo> = {};
      await Promise.all(
        Array.from({ length: ch.levelCount }, (_, i) => levelCode(ch.id, i + 1))
          .filter((c) => d.levelCodes.has(c))
          .map(async (c) => {
            const lv = await loadLevel(c).catch(() => null);
            if (lv && lv.settings.name !== c) out[c] = lv.settings.name;
            if (lv) rw[c] = levelRewardInfo(d.currency, lv.settings);
          }),
      );
      setNames(out);
      setRewards(rw);
    }, (e) => setError(String(e)));
  }, [chapterId]);

  if (error) return <div className="page-msg">读取数据失败：{error}</div>;
  if (!db) return <div className="page-msg">加载中…</div>;
  const view = new ProgressView(db.chapters, db.progress, db.levelCodes);
  const ci = view.chapterIndex(chapterId);
  const ch = db.chapters[ci];
  if (!ch) return <div className="page-msg">章节 {chapterId} 不存在</div>;
  if (!view.isChapterUnlocked(ci)) {
    return (
      <div className="page-msg">
        章节未解锁
        <button className="btn" onClick={() => navigate('/game/chapters')}>
          返回
        </button>
      </div>
    );
  }

  const visible = Array.from({ length: ch.levelCount }, (_, i) => i + 1).filter((i) => view.isLevelUnlocked(ch.id, i));
  const hidden = ch.levelCount - visible.length;
  return (
    <div className="select-page">
      <header className="select-head">
        <button className="btn btn-ghost" onClick={() => navigate('/game/chapters')}>
          ← 章节
        </button>
        <h2>
          <span className="mono accent">{ch.id}</span> {ch.name}
        </h2>
        <span className="muted">
          已通关 {view.clearedCount(ch)}/{ch.levelCount}
        </span>
      </header>
      <div className="level-list-slim">
        {visible.map((i) => {
          const code = levelCode(ch.id, i);
          const built = view.isBuilt(code);
          const cleared = view.isCleared(code);
          return (
            <button
              key={code}
              className={`level-slim${cleared ? ' cleared' : ' current'}${built ? '' : ' dim'}`}
              disabled={!built}
              onClick={() => navigate(`/game/play/${encodeURIComponent(code)}`)}
            >
              <span className="level-slim-code mono">{code}</span>
              <span className="level-slim-name">{built ? names[code] ?? '' : '尚未制作'}</span>
              {built && rewards[code] && (
                <span className="level-slim-rewards" title="通关奖励（每次通关都会获得）">
                  <RewardPreview cfg={db.currency} info={rewards[code]} />
                </span>
              )}
              <span className="level-slim-state">{cleared ? '已通关' : built ? '' : ''}</span>
            </button>
          );
        })}
        {hidden > 0 && <div className="level-slim-hint muted small">通关上一关后显示下一关</div>}
      </div>
    </div>
  );
}
