import { getBackend, getBridge, type GitInfo } from '../storage/backend';
import { LOCAL_ONLY_FILES } from '../storage/repository';
import { GitHubApi, GitHubError, gitBlobSha, type TreeEntry } from './api';
import { loadGitHubConfig, type GitHubConfig } from './config';

/**
 * 编辑器数据 ↔ GitHub 仓库同步。
 *
 *  API 模式：记录上一次同步时每个文件的 SHA，比较得出本地修改 / 仓库修改：
 *    - 上传：只上传本地改过的文件，一次上传 = 一个 commit；如果仓库里同一个文件也被别人改了，会提示先拉取
 *    - 拉取：只下载仓库里改过、而本地没改过的文件；两边都改过的文件列为冲突，由用户决定
 *  Git 模式：项目文件夹本身是 Git 仓库时，直接调用本机的 git add / commit / pull --rebase / push。
 */

export interface SyncStatus {
  mode: 'off' | 'api' | 'git';
  /** 显示用：owner/repo@branch 或 git 远程地址 */
  target: string;
  busy: boolean;
  /** 本地待上传的修改数量（null = 未知） */
  pending: number | null;
  message: string;
  error: string | null;
  lastSync: number | null;
}

export interface PullResult {
  downloaded: string[];
  deleted: string[];
  conflicts: string[];
}

interface SyncState {
  key: string;
  head: string | null;
  files: Record<string, string>;
  lastSync: number | null;
}

const STATE_KEY = 'arcadia-sync-state';
const IGNORE = (rel: string) =>
  LOCAL_ONLY_FILES.has(rel) || rel.split('/').some((p) => p.startsWith('.')) || /\.tmp-\d+$/.test(rel) || rel.startsWith('__tmp__');

function loadState(key: string): SyncState {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (s && s.key === key) return s;
  } catch {
    /* 忽略 */
  }
  return { key, head: null, files: {}, lastSync: null };
}

function saveState(s: SyncState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* 忽略 */
  }
}

const stateKey = (c: GitHubConfig) => `${c.owner}/${c.repo}@${c.branch}:${c.dataDir}`;

class GitHubSync {
  status: SyncStatus = { mode: 'off', target: '', busy: false, pending: null, message: '', error: null, lastSync: null };
  private listeners = new Set<() => void>();
  private pendingSummaries: string[] = [];
  private pushTimer: number | null = null;
  private gitInfo: GitInfo | null | undefined;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** 本机 Git 仓库信息（只有 Electron 开发运行 / 浏览器开发模式才可能有） */
  async getGitInfo(): Promise<GitInfo | null> {
    if (this.gitInfo !== undefined) return this.gitInfo;
    const bridge = getBridge();
    try {
      if (bridge) this.gitInfo = await bridge.git('info');
      else {
        const r = await fetch('./__git/info', { method: 'POST', cache: 'no-store' });
        this.gitInfo = r.ok && (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : null;
      }
    } catch {
      this.gitInfo = null;
    }
    if (this.gitInfo && !this.gitInfo.available) this.gitInfo = null;
    return this.gitInfo ?? null;
  }

  private async git(cmd: 'status' | 'pull' | 'push', message?: string): Promise<{ ok: boolean; output: string; changes?: number }> {
    const bridge = getBridge();
    if (bridge) return bridge.git(cmd, message) as Promise<{ ok: boolean; output: string; changes?: number }>;
    const r = await fetch(`./__git/${cmd}`, { method: 'POST', body: JSON.stringify({ message }), cache: 'no-store' });
    return r.json();
  }

  async config(): Promise<GitHubConfig | null> {
    const c = await loadGitHubConfig();
    if (!c) return null;
    if (c.mode === 'git') return (await this.getGitInfo()) ? c : null;
    return c.owner && c.repo ? c : null;
  }

  /** 重新计算状态（待上传数量等） */
  async refresh(): Promise<void> {
    const c = await this.config();
    if (!c) return this.set({ mode: 'off', target: '', pending: null, error: null, message: '' });
    if (c.mode === 'git') {
      const info = (await this.getGitInfo())!;
      const st = await this.git('status').catch(() => null);
      return this.set({ mode: 'git', target: `${info.remote ?? '（无远程仓库）'} · ${info.branch ?? ''}`, pending: st?.changes ?? null });
    }
    const state = loadState(stateKey(c));
    const local = await this.localFiles();
    let pending = 0;
    for (const [rel, sha] of local) if (state.files[rel] !== sha) pending++;
    for (const rel of Object.keys(state.files)) if (!local.has(rel)) pending++;
    this.set({ mode: 'api', target: `${c.owner}/${c.repo}@${c.branch}`, pending, lastSync: state.lastSync });
  }

  /** 本地数据文件 → git blob SHA */
  private async localFiles(): Promise<Map<string, string>> {
    const b = await getBackend();
    const out = new Map<string, string>();
    for (const rel of await b.listAll()) {
      if (IGNORE(rel)) continue;
      const bytes = await b.readBinary(rel);
      if (bytes) out.set(rel, await gitBlobSha(bytes));
    }
    return out;
  }

  /** 编辑器保存后调用：开启自动上传时，稍等片刻合并多次保存为一个 commit */
  notifySaved(summary: string) {
    this.pendingSummaries.push(summary);
    void (async () => {
      const c = await this.config();
      if (!c) return;
      if (!c.autoPush) return this.refresh();
      if (this.pushTimer != null) window.clearTimeout(this.pushTimer);
      this.pushTimer = window.setTimeout(() => {
        this.pushTimer = null;
        const msg = `编辑器更新：${[...new Set(this.pendingSummaries)].join('、')}`;
        this.pendingSummaries = [];
        void this.push(msg).catch(() => undefined);
      }, 1500);
    })();
  }

  /** 上传本地修改到 GitHub */
  async push(message = '编辑器更新数据'): Promise<string> {
    const c = await this.config();
    if (!c) throw new Error('还没有设置 GitHub 同步');
    if (this.status.busy) throw new Error('正在同步，请稍候');
    this.set({ busy: true, error: null, message: '正在上传…' });
    try {
      let result: string;
      if (c.mode === 'git') {
        const r = await this.git('push', message);
        if (!r.ok) throw new Error(r.output || 'git 推送失败');
        result = r.output || '已推送';
      } else {
        result = await this.apiPush(c, message);
      }
      this.set({ busy: false, message: result, lastSync: Date.now() });
      await this.refresh();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.set({ busy: false, error: msg, message: '' });
      throw err;
    }
  }

  /** 从 GitHub 拉取；overwrite 中的文件即使本地也改过，也用仓库的版本覆盖 */
  async pull(overwrite: string[] = []): Promise<PullResult> {
    const c = await this.config();
    if (!c) throw new Error('还没有设置 GitHub 同步');
    if (this.status.busy) throw new Error('正在同步，请稍候');
    this.set({ busy: true, error: null, message: '正在拉取…' });
    try {
      let res: PullResult;
      if (c.mode === 'git') {
        const r = await this.git('pull');
        if (!r.ok) throw new Error(r.output || 'git 拉取失败');
        res = { downloaded: [r.output || '已拉取'], deleted: [], conflicts: [] };
      } else {
        res = await this.apiPull(c, new Set(overwrite));
      }
      const parts = [`下载 ${res.downloaded.length} 个文件`];
      if (res.deleted.length) parts.push(`删除 ${res.deleted.length} 个`);
      if (res.conflicts.length) parts.push(`${res.conflicts.length} 个冲突`);
      this.set({ busy: false, message: c.mode === 'git' ? res.downloaded[0] : parts.join('，'), lastSync: Date.now() });
      await this.refresh();
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.set({ busy: false, error: msg, message: '' });
      throw err;
    }
  }

  private async remoteFiles(api: GitHubApi, c: GitHubConfig, treeSha: string): Promise<Map<string, TreeEntry>> {
    const prefix = `${c.dataDir}/`;
    const out = new Map<string, TreeEntry>();
    for (const e of await api.getTree(treeSha)) {
      if (e.type !== 'blob' || !e.path.startsWith(prefix)) continue;
      const rel = e.path.slice(prefix.length);
      if (!IGNORE(rel)) out.set(rel, e);
    }
    return out;
  }

  private async apiPull(c: GitHubConfig, overwrite: Set<string>): Promise<PullResult> {
    const api = new GitHubApi(c);
    const head = await api.getHead(c.branch);
    const state = loadState(stateKey(c));
    const res: PullResult = { downloaded: [], deleted: [], conflicts: [] };
    if (!head) return res; // 空仓库：没有可以拉取的
    const remote = await this.remoteFiles(api, c, head.tree);
    const local = await this.localFiles();
    const b = await getBackend();
    for (const [rel, entry] of remote) {
      const l = local.get(rel);
      if (l === entry.sha) {
        state.files[rel] = entry.sha;
        continue;
      }
      const base = state.files[rel];
      if (l === undefined && base !== undefined && !overwrite.has(rel)) {
        // 本地删除了、还没上传：仓库里没变就保持删除，仓库也改过则算冲突
        if (entry.sha !== base) res.conflicts.push(rel);
        continue;
      }
      const localChanged = l !== undefined && l !== base;
      if (localChanged && !overwrite.has(rel)) {
        res.conflicts.push(rel);
        continue;
      }
      const bytes = await api.getBlob(entry.sha);
      await b.writeBinary(rel, bytes);
      state.files[rel] = entry.sha;
      res.downloaded.push(rel);
    }
    for (const rel of Object.keys(state.files)) {
      if (remote.has(rel)) continue;
      // 仓库里删除了：本地没改过才删除，改过的保留（下次上传时会重新加入仓库）
      if (local.get(rel) === state.files[rel]) {
        await b.remove(rel);
        res.deleted.push(rel);
      }
      delete state.files[rel];
    }
    state.head = head.commit;
    state.lastSync = Date.now();
    saveState(state);
    return res;
  }

  private async apiPush(c: GitHubConfig, message: string): Promise<string> {
    const api = new GitHubApi(c);
    if (!c.token) throw new Error('上传需要访问令牌（在 GitHub 设置中填写）');
    const state = loadState(stateKey(c));
    const local = await this.localFiles();
    const changed = [...local].filter(([rel, sha]) => state.files[rel] !== sha).map(([rel]) => rel);
    const deleted = Object.keys(state.files).filter((rel) => !local.has(rel));
    if (!changed.length && !deleted.length) return '没有需要上传的修改';

    const b = await getBackend();
    let initCount = 0;
    let head = await api.getHead(c.branch);
    if (!head) {
      // 空仓库 / 分支不存在：先用第一个文件初始化
      const first = changed.shift()!;
      const bytes = (await b.readBinary(first))!;
      await api.initEmpty(c.branch, `${c.dataDir}/${first}`, bytes);
      state.files[first] = local.get(first)!;
      initCount = 1;
      head = await api.getHead(c.branch);
      if (!head) throw new GitHubError(0, '初始化仓库失败');
      if (!changed.length && !deleted.length) {
        state.head = head.commit;
        state.lastSync = Date.now();
        saveState(state);
        return '已上传 1 个文件（初始化仓库）';
      }
    }
    if (head.commit !== state.head) {
      // 仓库在上次同步后有新的提交：检查有没有和本地修改冲突的文件
      const remote = await this.remoteFiles(api, c, head.tree);
      const conflicts = [...changed, ...deleted].filter((rel) => {
        const r = remote.get(rel)?.sha;
        return r !== state.files[rel] && r !== local.get(rel);
      });
      if (conflicts.length) {
        throw new Error(`仓库中这些文件也被修改了，请先「拉取」再上传：${conflicts.slice(0, 5).join('、')}${conflicts.length > 5 ? ' 等' : ''}`);
      }
    }
    const entries: { path: string; sha: string | null }[] = [];
    const uploaded: Record<string, string> = {};
    for (const rel of changed) {
      const bytes = (await b.readBinary(rel))!;
      const sha = await api.createBlob(bytes);
      uploaded[rel] = sha;
      entries.push({ path: `${c.dataDir}/${rel}`, sha });
    }
    for (const rel of deleted) entries.push({ path: `${c.dataDir}/${rel}`, sha: null });
    const tree = await api.createTree(head.tree, entries);
    const commit = await api.createCommit(message, tree, [head.commit]);
    try {
      await api.updateRef(c.branch, commit);
    } catch (err) {
      if (err instanceof GitHubError && err.status === 422) throw new Error('上传时仓库刚好有新的提交，请先「拉取」再上传');
      throw err;
    }
    for (const [rel, sha] of Object.entries(uploaded)) state.files[rel] = sha;
    for (const rel of deleted) delete state.files[rel];
    state.head = commit;
    state.lastSync = Date.now();
    saveState(state);
    return `已上传 ${changed.length + initCount} 个文件${deleted.length ? `，删除 ${deleted.length} 个` : ''}`;
  }

  /** 测试连接：返回仓库信息或抛出错误 */
  async test(c: GitHubConfig): Promise<string> {
    if (c.mode === 'git') {
      const info = await this.getGitInfo();
      if (!info) throw new Error('数据文件夹不在 Git 仓库中（打包版请使用 API 模式）');
      return `本机 Git 仓库：${info.root}\n远程：${info.remote ?? '未设置 origin'}\n分支：${info.branch}`;
    }
    if (!c.owner || !c.repo) throw new Error('请填写仓库');
    const api = new GitHubApi(c);
    const repo = await api.getRepo();
    const head = await api.getHead(c.branch);
    const canPush = repo.permissions?.push;
    return `仓库：${repo.full_name}（${repo.private ? '私有' : '公开'}）\n分支 ${c.branch}：${head ? '存在' : '不存在 / 空仓库（第一次上传时会自动创建）'}\n权限：${c.token ? (canPush ? '可以上传' : '只读（令牌没有写入权限）') : '未填写令牌，只能拉取公开仓库'}`;
  }
}

export const githubSync = new GitHubSync();

/** 编辑器保存数据后调用 */
export function notifySaved(summary: string) {
  githubSync.notifySaved(summary);
}
