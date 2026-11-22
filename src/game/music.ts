import { useEffect, useState } from 'react';
import { getBackend } from '../core/storage/backend';
import { listMusic, loadSettings, musicPath, type MusicKind } from '../core/storage/repository';

/**
 * 背景音乐：
 *  - 主页音乐（未进入战斗时）：settings.homeMusic 指定的一首，或 data/music/home/ 下全部音乐按顺序循环
 *  - 战斗音乐：关卡设置 / 章节设置中选择的 data/music/battle/ 下的音乐，循环播放
 * 切换时淡入淡出；浏览器不允许自动播放时，等到玩家第一次点击再开始。
 */
export type MusicWant = { kind: 'none' } | { kind: 'home' } | { kind: 'battle'; file: string };

const VOLUME_KEY = 'arcadia-music-volume';
const MUTED_KEY = 'arcadia-music-muted';
const FADE_MS = 700;

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  webm: 'audio/webm',
};

const urlCache = new Map<string, Promise<string | null>>();

/** 读取音乐文件，返回可以播放的 blob URL（编辑器试听也用这个） */
export function musicUrl(kind: MusicKind, name: string): Promise<string | null> {
  const key = `${kind}/${name}`;
  let p = urlCache.get(key);
  if (!p) {
    p = (async () => {
      const b = await getBackend();
      const bytes = await b.readBinary(musicPath(kind, name));
      if (!bytes) return null;
      const ext = name.split('.').pop()?.toLowerCase() ?? 'mp3';
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[ext] ?? 'audio/mpeg' }));
    })().catch(() => null);
    urlCache.set(key, p);
    p.then((u) => !u && urlCache.delete(key));
  }
  return p;
}

/** 音乐文件被替换后清除缓存 */
export function invalidateMusic() {
  urlCache.clear();
}

function readNumber(key: string, d: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return localStorage.getItem(key) != null && Number.isFinite(v) ? v : d;
  } catch {
    return d;
  }
}

class MusicManager {
  private audio: HTMLAudioElement | null = null;
  private key = '';
  private want: MusicWant = { kind: 'none' };
  private wantKey = 'none';
  private token = 0;
  private playlist: string[] = [];
  private index = 0;
  private waitingGesture = false;
  private listeners = new Set<() => void>();
  volume = readNumber(VOLUME_KEY, 0.6);
  muted = readNumber(MUTED_KEY, 0) === 1;
  /** 当前播放的曲目（显示用） */
  nowPlaying = '';

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private target(): number {
    return this.muted ? 0 : this.volume;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {
      /* 忽略 */
    }
    if (this.audio) this.audio.volume = this.target();
    this.emit();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(MUTED_KEY, m ? '1' : '0');
    } catch {
      /* 忽略 */
    }
    if (this.audio) this.audio.volume = this.target();
    this.emit();
  }

  set(want: MusicWant) {
    const k = want.kind === 'battle' ? `battle:${want.file}` : want.kind;
    if (k === this.wantKey) return;
    this.want = want;
    this.wantKey = k;
    void this.apply();
  }

  /** 重新读取音乐列表（例如从 GitHub 拉取了新音乐之后） */
  refresh() {
    invalidateMusic();
    this.key = '';
    void this.apply();
  }

  private async apply() {
    const token = ++this.token;
    const want = this.want;
    if (want.kind === 'none') return this.stop();
    if (want.kind === 'battle') {
      if (!want.file) return this.stop();
      if (this.key === `battle:${want.file}`) return;
      return this.playFile('battle', want.file, true, token);
    }
    // 主页音乐在各个菜单页面之间切换时不重新开始
    if (this.key.startsWith('home:') && this.audio) return;
    try {
      const [settings, files] = await Promise.all([loadSettings(), listMusic('home')]);
      if (token !== this.token) return;
      const list = settings.homeMusic && files.includes(settings.homeMusic) ? [settings.homeMusic] : files;
      if (!list.length) return this.stop();
      this.playlist = list;
      this.index = 0;
      await this.playFile('home', list[0], list.length === 1, token);
    } catch {
      this.stop();
    }
  }

  private async playFile(kind: MusicKind, name: string, loop: boolean, token: number) {
    const url = await musicUrl(kind, name);
    if (token !== this.token) return;
    if (!url) return this.stop();
    const next = new Audio(url);
    next.loop = loop;
    next.volume = 0;
    next.onended = () => {
      if (kind !== 'home' || this.audio !== next || !this.playlist.length) return;
      this.index = (this.index + 1) % this.playlist.length;
      this.key = '';
      void this.playFile('home', this.playlist[this.index], false, this.token);
    };
    const prev = this.audio;
    this.audio = next;
    this.key = `${kind}:${name}`;
    this.nowPlaying = name;
    this.emit();
    if (prev) fade(prev, prev.volume, 0, () => prev.pause());
    try {
      await next.play();
      fade(next, 0, this.target());
    } catch {
      // 浏览器的自动播放限制：等玩家第一次点击 / 按键后再播放
      this.waitForGesture(() => {
        if (this.audio !== next) return;
        void next.play().then(() => fade(next, 0, this.target())).catch(() => undefined);
      });
    }
  }

  private waitForGesture(fn: () => void) {
    if (this.waitingGesture) return;
    this.waitingGesture = true;
    const go = () => {
      window.removeEventListener('pointerdown', go, true);
      window.removeEventListener('keydown', go, true);
      this.waitingGesture = false;
      fn();
    };
    window.addEventListener('pointerdown', go, true);
    window.addEventListener('keydown', go, true);
  }

  stop() {
    const prev = this.audio;
    this.audio = null;
    this.key = '';
    this.nowPlaying = '';
    this.emit();
    if (prev) fade(prev, prev.volume, 0, () => prev.pause());
  }
}

function fade(a: HTMLAudioElement, from: number, to: number, done?: () => void) {
  const start = performance.now();
  const tick = () => {
    const k = Math.min(1, (performance.now() - start) / FADE_MS);
    a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) window.setTimeout(tick, 30);
    else done?.();
  };
  tick();
}

export const music = new MusicManager();

/** 页面声明自己需要的背景音乐 */
export function useMusic(want: MusicWant) {
  const key = want.kind === 'battle' ? `battle:${want.file}` : want.kind;
  useEffect(() => {
    music.set(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** 音量 / 静音状态（用于界面显示） */
export function useMusicState() {
  const [, force] = useState(0);
  useEffect(() => music.subscribe(() => force((n) => n + 1)), []);
  return { volume: music.volume, muted: music.muted, nowPlaying: music.nowPlaying };
}
