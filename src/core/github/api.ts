/**
 * 极简 GitHub REST 客户端（只用到同步数据需要的接口）。
 * 写入时用 Git Data API：一次保存 = 一个 commit（无论改了多少个文件）。
 */
export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RepoRef {
  owner: string;
  repo: string;
  token: string;
}

export interface TreeEntry {
  path: string;
  sha: string;
  type: 'blob' | 'tree' | 'commit';
  size?: number;
}

const API = 'https://api.github.com';

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** git 的 blob SHA-1：sha1("blob <长度>\0" + 内容)，用来判断本地文件和仓库里的是否相同 */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header, 0);
  buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class GitHubApi {
  constructor(private ref: RepoRef) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.ref.token) headers.Authorization = `Bearer ${this.ref.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(`${API}/repos/${encodeURIComponent(this.ref.owner)}/${encodeURIComponent(this.ref.repo)}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new GitHubError(0, '无法连接 GitHub，请检查网络');
    }
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        const j = await res.json();
        msg = j.message ?? msg;
      } catch {
        /* 忽略 */
      }
      throw new GitHubError(res.status, explain(res.status, msg));
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  getRepo() {
    return this.req<{ default_branch: string; private: boolean; full_name: string; permissions?: { push?: boolean } }>('GET', '');
  }

  /** 分支最新的 commit 和 tree；仓库为空时返回 null */
  async getHead(branch: string): Promise<{ commit: string; tree: string } | null> {
    try {
      const ref = await this.req<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
      const c = await this.req<{ tree: { sha: string } }>('GET', `/git/commits/${ref.object.sha}`);
      return { commit: ref.object.sha, tree: c.tree.sha };
    } catch (err) {
      if (err instanceof GitHubError && (err.status === 409 || err.status === 404)) {
        // 409 = 空仓库；404 = 分支不存在（仓库存在时）
        if (err.status === 404) {
          await this.getRepo(); // 仓库本身不存在会在这里抛出
          return null;
        }
        return null;
      }
      throw err;
    }
  }

  async getTree(treeSha: string): Promise<TreeEntry[]> {
    const t = await this.req<{ tree: TreeEntry[]; truncated: boolean }>('GET', `/git/trees/${treeSha}?recursive=1`);
    if (t.truncated) throw new GitHubError(0, '仓库文件太多，GitHub 返回的文件列表被截断');
    return t.tree;
  }

  async getBlob(sha: string): Promise<Uint8Array> {
    const b = await this.req<{ content: string; encoding: string }>('GET', `/git/blobs/${sha}`);
    return b.encoding === 'base64' ? fromBase64(b.content) : new TextEncoder().encode(b.content);
  }

  async createBlob(bytes: Uint8Array): Promise<string> {
    const r = await this.req<{ sha: string }>('POST', '/git/blobs', { content: toBase64(bytes), encoding: 'base64' });
    return r.sha;
  }

  async createTree(baseTree: string, entries: { path: string; sha: string | null }[]): Promise<string> {
    const r = await this.req<{ sha: string }>('POST', '/git/trees', {
      base_tree: baseTree,
      tree: entries.map((e) => ({ path: e.path, mode: '100644', type: 'blob', sha: e.sha })),
    });
    return r.sha;
  }

  async createCommit(message: string, tree: string, parents: string[]): Promise<string> {
    const r = await this.req<{ sha: string }>('POST', '/git/commits', { message, tree, parents });
    return r.sha;
  }

  async updateRef(branch: string, sha: string): Promise<void> {
    await this.req('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false });
  }

  async createRef(branch: string, sha: string): Promise<void> {
    await this.req('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha });
  }

  /** 空仓库不能直接用 Git Data API，先用 Contents API 创建第一个文件 */
  async initEmpty(branch: string, path: string, bytes: Uint8Array): Promise<void> {
    await this.req('PUT', `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      message: '初始化 Arcadia Tower 数据',
      content: toBase64(bytes),
      branch,
    });
  }
}

function explain(status: number, msg: string): string {
  if (status === 401) return '访问令牌无效或已过期（401）';
  if (status === 403) return msg.includes('rate limit') ? 'GitHub API 调用次数超限，请稍后再试或填写访问令牌' : `没有权限（403）：${msg}`;
  if (status === 404) return '找不到仓库或分支（404）：请检查仓库名，私有仓库需要有权限的访问令牌';
  if (status === 409) return `仓库冲突（409）：${msg}`;
  if (status === 422) return `请求被拒绝（422）：${msg}`;
  return `GitHub 错误 ${status}：${msg}`;
}
