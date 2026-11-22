import { useEffect, useState } from 'react';
import { defaultConfig, loadGitHubConfig, parseRepoUrl, saveGitHubConfig, type GitHubConfig } from '../../core/github/config';
import { githubSync, type SyncStatus } from '../../core/github/sync';
import type { GitInfo } from '../../core/storage/backend';
import { music } from '../../game/music';
import { DEFAULT_GITHUB_REPO } from '../../version';
import { Checkbox, Field, Segmented } from '../common/fields';
import { toast } from '../common/toast';

export function useSyncStatus(): SyncStatus {
  const [st, setSt] = useState(githubSync.status);
  useEffect(() => {
    const off = githubSync.subscribe(() => setSt(githubSync.status));
    void githubSync.refresh();
    return off;
  }, []);
  return st;
}

/** 拉取（有冲突时询问是否用仓库版本覆盖），返回是否有文件变化 */
export async function pullWithPrompt(): Promise<boolean> {
  try {
    let res = await githubSync.pull();
    if (res.conflicts.length) {
      const list = res.conflicts.slice(0, 8).join('\n');
      const ok = window.confirm(
        `这些文件在本地和 GitHub 上都被修改了：\n${list}${res.conflicts.length > 8 ? '\n…' : ''}\n\n用 GitHub 上的版本覆盖本地吗？\n（选择“取消”则保留本地版本）`,
      );
      if (ok) {
        const again = await githubSync.pull(res.conflicts);
        res = { ...again, downloaded: [...res.downloaded, ...again.downloaded] };
      }
    }
    const changed = res.downloaded.length + res.deleted.length > 0;
    if (changed) music.refresh();
    toast(githubSync.status.message || '拉取完成', 'ok');
    return changed;
  } catch (err) {
    toast(`拉取失败：${err instanceof Error ? err.message : String(err)}`, 'error', 5000);
    return false;
  }
}

/** 编辑器顶部的 GitHub 同步状态 */
export function GitHubBar({ dirty, onPulled }: { dirty: boolean; onPulled: () => void }) {
  const st = useSyncStatus();
  const [open, setOpen] = useState(false);

  const label =
    st.mode === 'off'
      ? 'GitHub：未设置'
      : st.busy
        ? st.message || '同步中…'
        : st.error
          ? '✗ 同步出错'
          : st.pending
            ? `↑ ${st.pending} 个修改待上传`
            : '✓ 已与 GitHub 同步';

  return (
    <div className="gh-bar">
      <button
        className={`gh-chip${st.error ? ' error' : st.pending ? ' pending' : st.mode === 'off' ? ' off' : ' ok'}`}
        onClick={() => (st.error ? toast(st.error, 'error', 6000) : setOpen(true))}
        title={st.mode === 'off' ? '点击设置 GitHub 同步' : `${st.mode === 'git' ? '本机 Git' : 'GitHub API'}：${st.target}${st.error ? `\n${st.error}` : ''}`}
      >
        <span className="gh-logo">⑂</span>
        {label}
      </button>
      {st.mode !== 'off' && (
        <>
          <button
            className="btn btn-s btn-ghost"
            disabled={st.busy}
            title="把本地修改上传到 GitHub"
            onClick={() =>
              void githubSync
                .push('编辑器手动上传')
                .then((m) => toast(m, 'ok'))
                .catch((err) => toast(`上传失败：${err instanceof Error ? err.message : String(err)}`, 'error', 6000))
            }
          >
            上传
          </button>
          <button
            className="btn btn-s btn-ghost"
            disabled={st.busy}
            title="从 GitHub 拉取最新数据（包括别人上传的音乐）"
            onClick={async () => {
              if (dirty && !window.confirm('当前模块有未保存的修改，拉取后会重新加载数据，未保存的修改会丢失。继续吗？')) return;
              if (await pullWithPrompt()) onPulled();
            }}
          >
            拉取
          </button>
        </>
      )}
      <button className="icon-btn" title="GitHub 同步设置" onClick={() => setOpen(true)}>
        ⚙
      </button>
      {open && <GitHubSettings onClose={() => setOpen(false)} />}
    </div>
  );
}

function GitHubSettings({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<GitHubConfig | null>(null);
  const [repoText, setRepoText] = useState('');
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const [c, info] = await Promise.all([loadGitHubConfig(), githubSync.getGitInfo()]);
      setGitInfo(info);
      const init = c ?? { ...defaultConfig(), mode: info?.remote ? ('git' as const) : ('api' as const) };
      if (!c) {
        // 没有设置过：优先用本机 Git 的远程仓库，否则用游戏默认的仓库
        const r = (info?.remote && parseRepoUrl(info.remote)) || parseRepoUrl(DEFAULT_GITHUB_REPO);
        if (r) Object.assign(init, r);
      }
      setCfg(init);
      setRepoText(init.owner ? `${init.owner}/${init.repo}` : '');
    })();
  }, []);

  if (!cfg) return null;
  const set = (p: Partial<GitHubConfig>) => setCfg({ ...cfg, ...p });

  const current = (): GitHubConfig | null => {
    if (cfg.mode === 'git') return cfg;
    const r = parseRepoUrl(repoText);
    if (!r) {
      setResult({ ok: false, text: '仓库格式不对：请填写 https://github.com/用户名/仓库名 或 用户名/仓库名' });
      return null;
    }
    return { ...cfg, ...r };
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <strong>GitHub 同步设置</strong>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="muted small">
            设置后，编辑器保存的角色、敌人、技能、章节、关卡、图标和音乐都会保存到 GitHub 仓库的 <span className="mono">{cfg.dataDir}/</span> 文件夹；
            玩家进度只保存在本机。
          </p>
          <Field label="同步方式">
            <Segmented
              value={cfg.mode}
              options={[
                { value: 'api', label: 'GitHub API（访问令牌）' },
                { value: 'git', label: '本机 Git', title: gitInfo ? '使用电脑上的 Git 提交并推送' : '数据文件夹不在 Git 仓库中，无法使用' },
              ]}
              onChange={(mode) => (mode === 'git' && !gitInfo ? toast('数据文件夹不在 Git 仓库中（打包版请使用 GitHub API）', 'error') : set({ mode }))}
            />
          </Field>
          {cfg.mode === 'git' ? (
            <div className="gh-git-info">
              {gitInfo ? (
                <>
                  <div>
                    仓库目录：<span className="mono">{gitInfo.root}</span>
                  </div>
                  <div>
                    远程仓库：<span className="mono">{gitInfo.remote ?? '（未设置 origin）'}</span>
                  </div>
                  <div>
                    当前分支：<span className="mono">{gitInfo.branch}</span>
                  </div>
                  <div className="muted small">保存时会执行 git add / commit / pull --rebase / push，使用电脑上已登录的 Git 账号。</div>
                </>
              ) : (
                <div className="field-error">数据文件夹不在 Git 仓库中</div>
              )}
            </div>
          ) : (
            <>
              <Field label="仓库" hint="例如 https://github.com/用户名/Arcadia_Tower">
                <input className="input mono" value={repoText} placeholder="用户名/仓库名" onChange={(e) => setRepoText(e.target.value)} />
              </Field>
              <div className="form-grid">
                <Field label="分支">
                  <input className="input mono" value={cfg.branch} onChange={(e) => set({ branch: e.target.value })} />
                </Field>
                <Field label="仓库中的数据文件夹">
                  <input className="input mono" value={cfg.dataDir} onChange={(e) => set({ dataDir: e.target.value })} />
                </Field>
              </div>
              <Field label="访问令牌（Personal access token）" hint="只保存在本机">
                <input className="input mono" type="password" autoComplete="off" value={cfg.token} placeholder="github_pat_…" onChange={(e) => set({ token: e.target.value })} />
              </Field>
              <div className="help-box small">
                在 GitHub 网页：头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token；
                Repository access 选择这个仓库，Permissions 中把 <strong>Contents</strong> 设为 <strong>Read and write</strong>，生成后复制到上面。
                公开仓库不填令牌也可以拉取，但不能上传。
              </div>
            </>
          )}
          <div className="row gap-s wrap">
            <Checkbox checked={cfg.autoPush} onChange={(v) => set({ autoPush: v })} label="编辑器保存后自动上传" />
            <Checkbox checked={cfg.autoPull} onChange={(v) => set({ autoPull: v })} label="打开启动器时自动拉取" />
          </div>
          {result && <pre className={`gh-result ${result.ok ? 'ok' : 'bad'}`}>{result.text}</pre>}
        </div>
        <div className="modal-foot">
          <button
            className="btn btn-s btn-danger"
            onClick={async () => {
              await saveGitHubConfig(null);
              await githubSync.refresh();
              toast('已关闭 GitHub 同步', 'info');
              onClose();
            }}
          >
            关闭同步
          </button>
          <span className="grow" />
          <button
            className="btn btn-s"
            disabled={testing}
            onClick={async () => {
              const c = current();
              if (!c) return;
              setTesting(true);
              setResult(null);
              try {
                setResult({ ok: true, text: await githubSync.test(c) });
              } catch (err) {
                setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button
            className="btn btn-s btn-primary"
            onClick={async () => {
              const c = current();
              if (!c) return;
              await saveGitHubConfig(c);
              await githubSync.refresh();
              toast('GitHub 同步设置已保存', 'ok');
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
