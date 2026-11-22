import { levelCode } from './ids';
import type { ChapterDef, ProgressData } from './types';

/**
 * 解锁规则：
 *  - 第一个章节默认解锁；上一个章节的全部关卡通关后，才解锁下一个章节
 *  - 章节内第 1 关默认解锁；上一关通关后才解锁下一关
 */
export class ProgressView {
  private cleared: Set<string>;
  constructor(
    private chapters: ChapterDef[],
    progress: ProgressData,
    private builtLevels: Set<string>,
  ) {
    this.cleared = new Set(progress.cleared);
  }

  isCleared(code: string): boolean {
    return this.cleared.has(code);
  }

  isBuilt(code: string): boolean {
    return this.builtLevels.has(code);
  }

  clearedCount(ch: ChapterDef): number {
    let n = 0;
    for (let i = 1; i <= ch.levelCount; i++) if (this.cleared.has(levelCode(ch.id, i))) n++;
    return n;
  }

  isChapterCompleted(ch: ChapterDef): boolean {
    return this.clearedCount(ch) >= ch.levelCount;
  }

  isChapterUnlocked(index: number): boolean {
    if (index <= 0) return index === 0 && this.chapters.length > 0;
    for (let i = 0; i < index; i++) if (!this.isChapterCompleted(this.chapters[i])) return false;
    return true;
  }

  chapterIndex(chapterId: string): number {
    return this.chapters.findIndex((c) => c.id === chapterId);
  }

  isLevelUnlocked(chapterId: string, index: number): boolean {
    const ci = this.chapterIndex(chapterId);
    if (ci < 0 || !this.isChapterUnlocked(ci)) return false;
    if (index <= 1) return true;
    return this.cleared.has(levelCode(chapterId, index - 1));
  }

  /** 通关后的下一关（同章节下一关，或下一章节第一关） */
  nextLevel(chapterId: string, index: number): { chapterId: string; index: number } | null {
    const ci = this.chapterIndex(chapterId);
    if (ci < 0) return null;
    if (index < this.chapters[ci].levelCount) return { chapterId, index: index + 1 };
    const next = this.chapters[ci + 1];
    return next ? { chapterId: next.id, index: 1 } : null;
  }
}
