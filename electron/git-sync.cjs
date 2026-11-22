/**
 * 本机 Git 同步（数据目录位于 Git 仓库中时使用，例如在项目文件夹里 npm start）。
 * Electron 主进程和 Vite 开发服务器共用。使用电脑上已经配置好的 Git 账号，不需要访问令牌。
 */
const { execFile } = require('node:child_process');
const path = require('node:path');

function run(cwd, args) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }, timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout).trim(), stderr: String(stderr).trim() });
      },
    );
  });
}

async function info(dataDir) {
  const top = await run(dataDir, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return { available: false, error: '数据目录不在 Git 仓库中' };
  const root = top.stdout;
  const remote = await run(root, ['remote', 'get-url', 'origin']);
  // symbolic-ref 在还没有任何提交时也能拿到分支名
  const branch = await run(root, ['symbolic-ref', '--short', 'HEAD']);
  return {
    available: true,
    root,
    remote: remote.code === 0 ? remote.stdout : undefined,
    branch: branch.code === 0 ? branch.stdout : undefined,
    dataPath: path.relative(root, dataDir) || '.',
  };
}

async function status(dataDir) {
  const i = await info(dataDir);
  if (!i.available) return { ok: false, output: i.error, changes: 0 };
  const st = await run(i.root, ['status', '--porcelain', '--untracked-files=all', '--', i.dataPath]);
  const lines = st.stdout ? st.stdout.split('\n').filter(Boolean) : [];
  return { ok: st.code === 0, output: st.stderr, changes: lines.length };
}

function explain(r) {
  const text = `${r.stderr}\n${r.stdout}`;
  if (/Please tell me who you are|user\.email|user\.name/i.test(text)) {
    return '提交失败：还没有设置 Git 用户名和邮箱。请在终端运行 git config --global user.name "你的名字" 和 git config --global user.email "你的邮箱"';
  }
  if (/could not read Username|Authentication failed|terminal prompts disabled|Permission denied/i.test(text)) {
    return '推送失败：Git 还没有登录 GitHub。请先在终端里执行一次 git push（按提示登录），或改用 API 模式填写访问令牌';
  }
  if (/no upstream|has no upstream branch/i.test(text)) return '推送失败：当前分支还没有关联远程分支，请先在终端运行 git push -u origin 分支名';
  if (/'origin' does not appear|No such remote/i.test(text)) return '没有设置远程仓库 origin：请先运行 git remote add origin <仓库地址>';
  return text.trim() || 'git 执行失败';
}

async function pull(dataDir) {
  const i = await info(dataDir);
  if (!i.available) return { ok: false, output: i.error };
  if (!i.remote) return { ok: false, output: '没有设置远程仓库 origin' };
  const r = await run(i.root, ['pull', '--rebase', '--autostash']);
  return r.code === 0 ? { ok: true, output: r.stdout.split('\n').pop() || '已是最新' } : { ok: false, output: explain(r) };
}

async function push(dataDir, message) {
  const i = await info(dataDir);
  if (!i.available) return { ok: false, output: i.error };
  if (!i.remote) return { ok: false, output: '没有设置远程仓库 origin：请先运行 git remote add origin <仓库地址>' };
  await run(i.root, ['add', '-A', '--', i.dataPath]);
  const staged = await run(i.root, ['diff', '--cached', '--quiet', '--', i.dataPath]);
  let committed = false;
  if (staged.code !== 0) {
    const c = await run(i.root, ['commit', '-m', message || '编辑器更新数据', '--', i.dataPath]);
    if (c.code !== 0) return { ok: false, output: explain(c) };
    committed = true;
  }
  const up = await run(i.root, ['pull', '--rebase', '--autostash']);
  if (up.code !== 0 && !/no tracking information|There is no tracking/i.test(`${up.stderr}${up.stdout}`)) {
    return { ok: false, output: explain(up) };
  }
  // 第一次推送时自动关联远程分支
  const upstream = await run(i.root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const p = await run(i.root, upstream.code === 0 ? ['push'] : ['push', '-u', 'origin', 'HEAD']);
  if (p.code !== 0) return { ok: false, output: explain(p) };
  return { ok: true, output: committed ? '已提交并推送到 GitHub' : '没有新的修改，已与 GitHub 同步' };
}

async function handle(dataDir, cmd, message) {
  if (cmd === 'info') return info(dataDir);
  if (cmd === 'status') return status(dataDir);
  if (cmd === 'pull') return pull(dataDir);
  if (cmd === 'push') return push(dataDir, message);
  return { ok: false, output: `未知命令 ${cmd}` };
}

module.exports = { handle, info };
