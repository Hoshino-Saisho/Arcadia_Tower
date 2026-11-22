import { useEffect, useState } from 'react';
import { ProgressView } from '../../core/progress';
import { loadDatabase, type GameDatabase } from '../../core/storage/repository';
import { navigate } from '../router';

/** 章节选择：上一个章节全部通关后才解锁下一个章节（未解锁的章节显示为暗淡） */
export function ChapterSelectPage() {
  const [db, setDb] = useState<GameDatabase | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    loadDatabase().then(setDb, (e) => setError(String(e)));
  }, []);

  if (error) return <div className="page-msg">读取数据失败：{error}</div>;
  if (!db) return <div className="page-msg">加载中…</div>;
  const view = new ProgressView(db.chapters, db.progress, db.levelCodes);

  return (
    <div className="select-page">
      <header className="select-head">
        <button className="btn btn-ghost" onClick={() => navigate('/game')}>
          ← 返回
        </button>
        <h2>选择章节</h2>
        <span />
      </header>
      {db.chapters.length === 0 && <div className="page-msg">还没有章节，请先在关卡编辑器的「章节规划」中创建。</div>}
      <div className="chapter-list">
        {db.chapters.map((ch, i) => {
          const unlocked = view.isChapterUnlocked(i);
          const done = view.clearedCount(ch);
          const complete = view.isChapterCompleted(ch);
          return (
            <button
              key={ch.id}
              className={`chapter-card${unlocked ? '' : ' locked'}${complete ? ' complete' : ''}`}
              disabled={!unlocked}
              onClick={() => navigate(`/game/chapter/${encodeURIComponent(ch.id)}`)}
            >
              <div className="chapter-no">{String(i + 1).padStart(2, '0')}</div>
              <div className="chapter-body">
                <div className="chapter-id mono">{ch.id}</div>
                <div className="chapter-name">{ch.name}</div>
                {ch.description && <div className="chapter-desc">{ch.description}</div>}
                <div className="chapter-progress">
                  <div className="bar">
                    <div style={{ width: `${(done / Math.max(1, ch.levelCount)) * 100}%` }} />
                  </div>
                  <span>
                    {done}/{ch.levelCount}
                  </span>
                </div>
              </div>
              <div className="chapter-state">{!unlocked ? '未解锁' : complete ? '已完成' : '进行中'}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
