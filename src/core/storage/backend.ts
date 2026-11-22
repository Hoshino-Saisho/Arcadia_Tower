/**
 * 数据后端抽象：所有读写都走相对 data/ 目录的路径。
 *  - Electron：通过 preload 暴露的 window.arcadia 读写磁盘上的 data 目录
 *  - 浏览器开发模式（npm run dev）：通过 Vite 中间件 /__data 读写项目里的 data 目录
 *  - 纯静态网页：退回到 localStorage（以打包进来的默认数据为初始内容）
 */
export interface DataBackend {
  readonly kind: 'electron' | 'devserver' | 'static' | 'local';
  /** 递归列出 data 目录下的全部文件（相对路径，用于 GitHub 同步） */
  listAll(): Promise<string[]>;
  readText(rel: string): Promise<string | null>;
  writeText(rel: string, text: string): Promise<void>;
  readBinary(rel: string): Promise<Uint8Array | null>;
  writeBinary(rel: string, bytes: Uint8Array): Promise<void>;
  list(relDir: string): Promise<string[]>;
  remove(rel: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

/** 本机 Git 仓库信息（数据目录位于 Git 仓库中时） */
export interface GitInfo {
  available: boolean;
  root?: string;
  remote?: string;
  branch?: string;
  dataPath?: string;
  error?: string;
}

/** Electron preload 暴露的接口 */
export interface ArcadiaBridge {
  isElectron: true;
  listAll(): Promise<string[]>;
  getConfig(name: string): Promise<unknown>;
  setConfig(name: string, value: unknown): Promise<void>;
  git(cmd: 'info'): Promise<GitInfo>;
  git(cmd: 'status' | 'pull' | 'push', message?: string): Promise<{ ok: boolean; output: string; changes?: number }>;
  readText(rel: string): Promise<string | null>;
  writeText(rel: string, text: string): Promise<void>;
  readBinary(rel: string): Promise<Uint8Array | null>;
  writeBinary(rel: string, bytes: Uint8Array): Promise<void>;
  list(relDir: string): Promise<string[]>;
  remove(rel: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  openWindow(kind: 'game' | 'editor' | 'launcher', hash?: string): Promise<void>;
  openDataFolder(): Promise<void>;
  getInfo(): Promise<{ dataDir: string; version: string; platform: string }>;
  quit(): Promise<void>;
}

declare global {
  interface Window {
    arcadia?: ArcadiaBridge;
  }
}

export function getBridge(): ArcadiaBridge | null {
  return typeof window !== 'undefined' && window.arcadia?.isElectron ? window.arcadia : null;
}

class ElectronBackend implements DataBackend {
  readonly kind = 'electron' as const;
  constructor(private b: ArcadiaBridge) {}
  listAll() {
    return this.b.listAll();
  }
  readText(rel: string) {
    return this.b.readText(rel);
  }
  writeText(rel: string, text: string) {
    return this.b.writeText(rel, text);
  }
  async readBinary(rel: string) {
    const r = await this.b.readBinary(rel);
    return r ? new Uint8Array(r) : null;
  }
  writeBinary(rel: string, bytes: Uint8Array) {
    return this.b.writeBinary(rel, bytes);
  }
  list(relDir: string) {
    return this.b.list(relDir);
  }
  remove(rel: string) {
    return this.b.remove(rel);
  }
  rename(from: string, to: string) {
    return this.b.rename(from, to);
  }
}

const enc = (rel: string) => rel.split('/').map(encodeURIComponent).join('/');

class DevServerBackend implements DataBackend {
  readonly kind = 'devserver' as const;
  async listAll() {
    const r = await fetch('./__data-list-all', { cache: 'no-store' });
    return r.ok ? ((await r.json()) as string[]) : [];
  }
  async readText(rel: string) {
    const r = await fetch(`./__data/${enc(rel)}`, { cache: 'no-store' });
    return r.ok && r.status !== 204 ? r.text() : null;
  }
  async writeText(rel: string, text: string) {
    const r = await fetch(`./__data/${enc(rel)}`, { method: 'PUT', body: text });
    if (!r.ok) throw new Error(`写入失败：${rel}`);
  }
  async readBinary(rel: string) {
    const r = await fetch(`./__data/${enc(rel)}`, { cache: 'no-store' });
    return r.ok && r.status !== 204 ? new Uint8Array(await r.arrayBuffer()) : null;
  }
  async writeBinary(rel: string, bytes: Uint8Array) {
    const r = await fetch(`./__data/${enc(rel)}`, { method: 'PUT', body: bytes as unknown as BodyInit });
    if (!r.ok) throw new Error(`写入失败：${rel}`);
  }
  async list(relDir: string) {
    const r = await fetch(`./__data-list/${enc(relDir)}`, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as string[]) : [];
  }
  async remove(rel: string) {
    await fetch(`./__data/${enc(rel)}`, { method: 'DELETE' });
  }
  async rename(from: string, to: string) {
    await fetch('./__data-rename', { method: 'POST', body: JSON.stringify({ from, to }) });
  }
}

class LocalBackend implements DataBackend {
  readonly kind = 'local' as const;
  private prefix = 'arcadia-data:';

  /** 第一次使用时，用打包进来的默认数据（data/ 下的 json）初始化 localStorage */
  async seed() {
    if (localStorage.getItem(this.prefix + '__seeded') === '1') return;
    const { BUNDLED_DATA } = await import('./bundledData');
    for (const [file, text] of Object.entries(BUNDLED_DATA)) {
      const rel = file.replace(/^.*\/data\//, '');
      if (rel === 'progress.json') continue;
      localStorage.setItem(this.prefix + rel, text);
    }
    localStorage.setItem(this.prefix + '__seeded', '1');
  }
  async listAll() {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(this.prefix) && k !== this.prefix + '__seeded') out.push(k.slice(this.prefix.length));
    }
    return out;
  }
  /** 二进制内容以 "b64:" 前缀保存，文本原样保存；两种读法都兼容 */
  async readText(rel: string) {
    const v = localStorage.getItem(this.prefix + rel);
    if (v == null) return null;
    return v.startsWith('b64:') ? new TextDecoder().decode(decodeB64(v.slice(4))) : v;
  }
  async writeText(rel: string, text: string) {
    localStorage.setItem(this.prefix + rel, text);
  }
  async readBinary(rel: string) {
    const v = localStorage.getItem(this.prefix + rel);
    if (v == null) return null;
    return v.startsWith('b64:') ? decodeB64(v.slice(4)) : new TextEncoder().encode(v);
  }
  async writeBinary(rel: string, bytes: Uint8Array) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    localStorage.setItem(this.prefix + rel, 'b64:' + btoa(s));
  }
  async list(relDir: string) {
    const p = this.prefix + (relDir ? relDir.replace(/\/$/, '') + '/' : '');
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(p)) {
        const rest = k.slice(p.length);
        if (rest && !rest.includes('/') && rest !== '__seeded') out.push(rest);
      }
    }
    return out;
  }
  async remove(rel: string) {
    localStorage.removeItem(this.prefix + rel);
  }
  async rename(from: string, to: string) {
    const v = localStorage.getItem(this.prefix + from);
    if (v != null) {
      localStorage.setItem(this.prefix + to, v);
      localStorage.removeItem(this.prefix + from);
    }
  }
}

/**
 * 网页游玩版（GitHub Pages）：游戏数据从网站上的 data/ 读取（文件列表见 data/manifest.json），
 * 写入的内容（玩家进度、角色设定）保存在浏览器 localStorage 里，覆盖在网站数据之上。
 */
class StaticBackend implements DataBackend {
  readonly kind = 'static' as const;
  private prefix = 'arcadia-web:';
  private static DELETED = '\u0000deleted';
  constructor(private files: string[]) {}
  private local(rel: string) {
    return localStorage.getItem(this.prefix + rel);
  }
  async listAll() {
    const set = new Set(this.files);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!k.startsWith(this.prefix)) continue;
      const rel = k.slice(this.prefix.length);
      if (localStorage.getItem(k) === StaticBackend.DELETED) set.delete(rel);
      else set.add(rel);
    }
    return [...set];
  }
  async list(relDir: string) {
    const p = relDir ? relDir.replace(/\/$/, '') + '/' : '';
    return (await this.listAll()).filter((f) => f.startsWith(p) && !f.slice(p.length).includes('/')).map((f) => f.slice(p.length));
  }
  private async fetchFile(rel: string): Promise<Response | null> {
    if (!this.files.includes(rel)) return null;
    const r = await fetch(`./data/${enc(rel)}`, { cache: 'no-cache' });
    return r.ok ? r : null;
  }
  async readText(rel: string) {
    const v = this.local(rel);
    if (v === StaticBackend.DELETED) return null;
    if (v != null) return v.startsWith('b64:') ? new TextDecoder().decode(decodeB64(v.slice(4))) : v;
    const r = await this.fetchFile(rel);
    return r ? r.text() : null;
  }
  async readBinary(rel: string) {
    const v = this.local(rel);
    if (v === StaticBackend.DELETED) return null;
    if (v != null) return v.startsWith('b64:') ? decodeB64(v.slice(4)) : new TextEncoder().encode(v);
    const r = await this.fetchFile(rel);
    return r ? new Uint8Array(await r.arrayBuffer()) : null;
  }
  async writeText(rel: string, text: string) {
    localStorage.setItem(this.prefix + rel, text);
  }
  async writeBinary(rel: string, bytes: Uint8Array) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    localStorage.setItem(this.prefix + rel, 'b64:' + btoa(s));
  }
  async remove(rel: string) {
    if (this.files.includes(rel)) localStorage.setItem(this.prefix + rel, StaticBackend.DELETED);
    else localStorage.removeItem(this.prefix + rel);
  }
  async rename(from: string, to: string) {
    const bytes = await this.readBinary(from);
    if (!bytes) return;
    await this.writeBinary(to, bytes);
    await this.remove(from);
  }
}

function decodeB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let backendPromise: Promise<DataBackend> | null = null;

export function getBackend(): Promise<DataBackend> {
  if (!backendPromise) {
    backendPromise = (async () => {
      const bridge = getBridge();
      if (bridge) return new ElectronBackend(bridge);
      try {
        const r = await fetch('./__data-list/', { cache: 'no-store' });
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) return new DevServerBackend();
      } catch {
        /* 没有开发服务器 */
      }
      // 网页游玩版：网站上有 data/manifest.json
      try {
        const r = await fetch('./data/manifest.json', { cache: 'no-cache' });
        if (r.ok) {
          const files = await r.json();
          if (Array.isArray(files)) return new StaticBackend(files.filter((f): f is string => typeof f === 'string'));
        }
      } catch {
        /* 不是网页游玩版 */
      }
      const local = new LocalBackend();
      await local.seed();
      return local;
    })();
  }
  return backendPromise;
}
