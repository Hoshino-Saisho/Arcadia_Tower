import { getBridge } from '../storage/backend';

/**
 * GitHub 同步设置。
 * 访问令牌只保存在本机（Electron 中用系统钥匙串加密保存），绝不会写进 data/ 或上传到仓库。
 */
export interface GitHubConfig {
  /** api = 通过 GitHub API 直接读写仓库（需要访问令牌，打包版 exe 用这个）；git = 使用本机 Git 提交并推送（项目文件夹是 Git 仓库时） */
  mode: 'api' | 'git';
  owner: string;
  repo: string;
  branch: string;
  token: string;
  /** 数据文件夹在仓库中的路径 */
  dataDir: string;
  /** 编辑器保存后自动上传 */
  autoPush: boolean;
  /** 启动器打开时自动拉取 */
  autoPull: boolean;
}

const LS_KEY = 'arcadia-github-config';

export function defaultConfig(): GitHubConfig {
  return { mode: 'api', owner: '', repo: '', branch: 'main', token: '', dataDir: 'data', autoPush: true, autoPull: true };
}

function normalize(raw: any): GitHubConfig {
  const d = defaultConfig();
  const s = (v: unknown, def: string) => (typeof v === 'string' ? v.trim() : def);
  return {
    mode: raw?.mode === 'git' ? 'git' : 'api',
    owner: s(raw?.owner, ''),
    repo: s(raw?.repo, '').replace(/\.git$/, ''),
    branch: s(raw?.branch, d.branch) || d.branch,
    token: s(raw?.token, ''),
    dataDir: s(raw?.dataDir, d.dataDir).replace(/^\/+|\/+$/g, '') || d.dataDir,
    autoPush: typeof raw?.autoPush === 'boolean' ? raw.autoPush : d.autoPush,
    autoPull: typeof raw?.autoPull === 'boolean' ? raw.autoPull : d.autoPull,
  };
}

export async function loadGitHubConfig(): Promise<GitHubConfig | null> {
  const bridge = getBridge();
  try {
    const raw = bridge ? await bridge.getConfig('github') : JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
    return raw ? normalize(raw) : null;
  } catch {
    return null;
  }
}

export async function saveGitHubConfig(c: GitHubConfig | null): Promise<void> {
  const bridge = getBridge();
  if (bridge) await bridge.setConfig('github', c);
  else if (c) localStorage.setItem(LS_KEY, JSON.stringify(c));
  else localStorage.removeItem(LS_KEY);
}

/** 从 https://github.com/owner/repo(.git) 或 owner/repo 解析出仓库 */
export function parseRepoUrl(text: string): { owner: string; repo: string } | null {
  const t = text.trim();
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?(?:[#?].*)?$/.exec(t) ?? /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(t);
  return m ? { owner: m[1], repo: m[2] } : null;
}
