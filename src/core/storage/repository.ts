import {
  normalizeChapter,
  normalizeCharacter,
  normalizeEnemy,
  normalizeLevel,
  normalizeProgress,
  normalizeSettings,
  normalizeSkill,
} from '../defaults';
import { parseLevelCode } from '../ids';
import type { ChapterDef, CharacterDef, EnemyDef, GameSettings, LevelDef, ProgressData, SkillDef } from '../types';
import { getBackend } from './backend';

/**
 * 数据仓库：游戏与编辑器读写数据的唯一入口。
 * 负责 JSON 的格式化、字段补全，以及 ID 改名时同步更新关卡中的引用。
 */

export const FILES = {
  characters: 'characters.json',
  enemies: 'enemies.json',
  skills: 'skills.json',
  chapters: 'chapters.json',
  settings: 'settings.json',
  progress: 'progress.json',
  levelsDir: 'levels',
  iconsDir: 'icons',
  musicDir: 'music',
};

/** 只保存在本机、不同步到 GitHub 的文件 */
export const LOCAL_ONLY_FILES = new Set([FILES.progress]);

export const levelPath = (code: string) => `${FILES.levelsDir}/${code}.json`;

/** 便于阅读和手动修改的 JSON：短小的对象/数组写在同一行 */
export function prettyJson(value: unknown, indent = ''): string {
  const compact = JSON.stringify(value);
  if (compact === undefined) return 'null';
  if (value === null || typeof value !== 'object') return compact;
  if (compact.length + indent.length <= 100) return compact;
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => inner + prettyJson(v, inner)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${prettyJson(v, inner)}`).join(',\n')}\n${indent}}`;
}

async function readJson(rel: string): Promise<any | null> {
  const b = await getBackend();
  const text = await b.readText(rel);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`JSON 解析失败：${rel}`, err);
    throw new Error(`数据文件格式错误：${rel}`);
  }
}

async function writeJson(rel: string, value: unknown): Promise<void> {
  const b = await getBackend();
  await b.writeText(rel, prettyJson(value) + '\n');
}

/* ---------- 角色 ---------- */

export async function loadCharacters(): Promise<CharacterDef[]> {
  const raw = await readJson(FILES.characters);
  const list = Array.isArray(raw?.characters) ? raw.characters : Array.isArray(raw) ? raw : [];
  return list.map(normalizeCharacter);
}

export async function saveCharacters(list: CharacterDef[], renames: Map<string, string> = new Map()) {
  await writeJson(FILES.characters, { characters: list });
  if (renames.size) {
    // 玩家的角色设定也跟着改名
    const prog = await loadProgress();
    const loadouts: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(prog.loadouts)) loadouts[renames.get(k) ?? k] = v;
    await saveProgress({ ...prog, loadouts });
    await updateAllLevels((lv) => {
      let changed = false;
      lv.settings.availableCharacters = lv.settings.availableCharacters.map((id) => {
        const n = renames.get(id);
        if (n) changed = true;
        return n ?? id;
      });
      return changed;
    });
  }
}

/* ---------- 敌人 ---------- */

export async function loadEnemies(): Promise<EnemyDef[]> {
  const raw = await readJson(FILES.enemies);
  const list = Array.isArray(raw?.enemies) ? raw.enemies : Array.isArray(raw) ? raw : [];
  return list.map(normalizeEnemy);
}

export async function saveEnemies(list: EnemyDef[], renames: Map<string, string> = new Map()) {
  await writeJson(FILES.enemies, { enemies: list });
  if (renames.size) {
    await updateAllLevels((lv) => {
      let changed = false;
      for (const line of lv.lines) {
        for (const b of line.blocks) {
          const n = renames.get(b.enemyId);
          if (n) {
            b.enemyId = n;
            changed = true;
          }
        }
      }
      return changed;
    });
  }
}

/* ---------- 技能 ---------- */

export async function loadSkills(): Promise<SkillDef[]> {
  const raw = await readJson(FILES.skills);
  const list = Array.isArray(raw?.skills) ? raw.skills : Array.isArray(raw) ? raw : [];
  return list.map(normalizeSkill);
}

/** 保存技能库；renames 为 旧 ID → 新 ID，会同步更新角色 / 敌人的技能列表和玩家的角色设定 */
export async function saveSkills(list: SkillDef[], renames: Map<string, string> = new Map()) {
  await writeJson(FILES.skills, { skills: list });
  if (!renames.size) return;
  const swap = (ids: string[]) => ids.map((id) => renames.get(id) ?? id);
  const chars = await loadCharacters();
  await writeJson(FILES.characters, { characters: chars.map((c) => ({ ...c, skills: swap(c.skills) })) });
  const ens = await loadEnemies();
  await writeJson(FILES.enemies, { enemies: ens.map((e) => ({ ...e, skills: swap(e.skills) })) });
  const prog = await loadProgress();
  const loadouts: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(prog.loadouts)) loadouts[k] = swap(v);
  await saveProgress({ ...prog, loadouts });
}

/* ---------- 全局设置 ---------- */

export async function loadSettings(): Promise<GameSettings> {
  try {
    return normalizeSettings(await readJson(FILES.settings));
  } catch {
    return normalizeSettings(null);
  }
}

export async function saveSettings(s: GameSettings): Promise<void> {
  await writeJson(FILES.settings, s);
}

/* ---------- 音乐 ---------- */

export type MusicKind = 'home' | 'battle';
export const MUSIC_EXT = /\.(mp3|ogg|oga|wav|m4a|aac|flac|webm)$/i;

/** 列出 data/music/home 或 data/music/battle 下的音乐文件名（按名称排序） */
export async function listMusic(kind: MusicKind): Promise<string[]> {
  const b = await getBackend();
  const names = await b.list(`${FILES.musicDir}/${kind}`);
  return names.filter((n) => MUSIC_EXT.test(n)).sort((a, c) => a.localeCompare(c));
}

export const musicPath = (kind: MusicKind, name: string) => `${FILES.musicDir}/${kind}/${name}`;

/** 把选择的音乐文件复制到 data/music/<kind>/，返回文件名 */
export async function importMusic(file: File, kind: MusicKind): Promise<string> {
  const b = await getBackend();
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : '.mp3';
  const stem = (dot > 0 ? file.name.slice(0, dot) : file.name).replace(/[\\/:*?"<>|#%]/g, '_').trim() || 'music';
  const name = `${stem}${ext}`;
  await b.writeBinary(musicPath(kind, name), new Uint8Array(await file.arrayBuffer()));
  return name;
}

/* ---------- 章节 ---------- */

export async function loadChapters(): Promise<ChapterDef[]> {
  const raw = await readJson(FILES.chapters);
  const list = Array.isArray(raw?.chapters) ? raw.chapters : Array.isArray(raw) ? raw : [];
  return list.map(normalizeChapter);
}

/** 保存章节顺序；renames 为 旧编号 → 新编号，会同步重命名关卡文件与玩家进度 */
export async function saveChapters(list: ChapterDef[], renames: Map<string, string> = new Map()) {
  if (renames.size) {
    const b = await getBackend();
    const codes = await listLevelCodes();
    // 先改到临时名，避免 A→B、B→A 互换时相互覆盖
    const moves: { code: string; tmp: string; next: string }[] = [];
    for (const code of codes) {
      const p = parseLevelCode(code);
      if (!p) continue;
      const to = renames.get(p.chapterId);
      if (!to) continue;
      moves.push({ code, tmp: `__tmp__${code}`, next: `${to}_${p.index}` });
    }
    for (const m of moves) await b.rename(levelPath(m.code), levelPath(m.tmp));
    for (const m of moves) {
      const lv = await loadLevel(m.tmp);
      if (!lv) continue;
      const p = parseLevelCode(m.next)!;
      lv.id = m.next;
      lv.chapterId = p.chapterId;
      lv.index = p.index;
      if (lv.settings.name === m.code) lv.settings.name = m.next;
      await writeJson(levelPath(m.next), lv);
      await b.remove(levelPath(m.tmp));
    }
    const prog = await loadProgress();
    prog.cleared = prog.cleared.map((code) => {
      const p = parseLevelCode(code);
      const to = p && renames.get(p.chapterId);
      return to ? `${to}_${p!.index}` : code;
    });
    await saveProgress(prog);
  }
  await writeJson(FILES.chapters, { chapters: list });
}

/* ---------- 关卡 ---------- */

export async function listLevelCodes(): Promise<string[]> {
  const b = await getBackend();
  const names = await b.list(FILES.levelsDir);
  return names.filter((n) => n.endsWith('.json') && !n.startsWith('__tmp__')).map((n) => n.slice(0, -5));
}

export async function loadLevel(code: string): Promise<LevelDef | null> {
  const raw = await readJson(levelPath(code));
  return raw ? normalizeLevel(raw, code) : null;
}

export async function saveLevel(level: LevelDef): Promise<void> {
  await writeJson(levelPath(level.id), level);
}

export async function deleteLevel(code: string): Promise<void> {
  const b = await getBackend();
  await b.remove(levelPath(code));
}

async function updateAllLevels(fn: (lv: LevelDef) => boolean) {
  for (const code of await listLevelCodes()) {
    const lv = await loadLevel(code);
    if (lv && fn(lv)) await saveLevel(lv);
  }
}

/* ---------- 进度 ---------- */

export async function loadProgress(): Promise<ProgressData> {
  try {
    return normalizeProgress(await readJson(FILES.progress));
  } catch {
    return { cleared: [], loadouts: {} };
  }
}

export async function saveProgress(p: ProgressData): Promise<void> {
  await writeJson(FILES.progress, p);
}

/* ---------- 图标 ---------- */

/** 把用户选择的图片复制到 data/icons/ 下，返回相对路径，供角色/敌人的 icon 字段使用 */
export async function importIcon(file: File, baseName: string): Promise<string> {
  const b = await getBackend();
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const safe = baseName.replace(/[^A-Za-z0-9_-]/g, '_') || 'icon';
  const rel = `${FILES.iconsDir}/${safe}_${Date.now().toString(36)}.${ext}`;
  await b.writeBinary(rel, new Uint8Array(await file.arrayBuffer()));
  return rel;
}

export async function listIcons(): Promise<string[]> {
  const b = await getBackend();
  const names = await b.list(FILES.iconsDir);
  return names.filter((n) => /\.(png|jpe?g|webp|gif|svg)$/i.test(n)).map((n) => `${FILES.iconsDir}/${n}`);
}

/* ---------- 一次性读取游戏需要的全部数据 ---------- */

export interface GameDatabase {
  characters: CharacterDef[];
  enemies: EnemyDef[];
  skills: SkillDef[];
  chapters: ChapterDef[];
  settings: GameSettings;
  levelCodes: Set<string>;
  progress: ProgressData;
}

export async function loadDatabase(): Promise<GameDatabase> {
  const [characters, enemies, skills, chapters, settings, codes, progress] = await Promise.all([
    loadCharacters(),
    loadEnemies(),
    loadSkills(),
    loadChapters(),
    loadSettings(),
    listLevelCodes(),
    loadProgress(),
  ]);
  return { characters, enemies, skills, chapters, settings, levelCodes: new Set(codes), progress };
}
