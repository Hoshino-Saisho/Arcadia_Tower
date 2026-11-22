/**
 * GitHub 同步逻辑测试（npm run test:sync）：用内存模拟 GitHub API，不会连接真实的 GitHub。
 * 覆盖：空仓库第一次上传、修改后上传、拉取别人的修改、冲突检测与覆盖、删除、玩家进度不上传。
 */
import { gitBlobSha } from '../src/core/github/api';

/* ---------- 浏览器环境的最小替身 ---------- */
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};
store.set('arcadia-data:__seeded', '1');

/* ---------- 模拟的 GitHub 仓库 ---------- */
const enc = new TextEncoder();
const blobs = new Map<string, Uint8Array>();
const trees = new Map<string, Map<string, string>>(); // tree sha → (path → blob sha)
const commits = new Map<string, { tree: string; parents: string[]; message: string }>();
let head: string | null = null;
let seq = 0;
const newSha = (p: string) => `${p}${(++seq).toString(16).padStart(39, '0')}`;
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function remoteCommit(files: Record<string, string | null>, message: string) {
  const base = head ? new Map(trees.get(commits.get(head)!.tree)!) : new Map<string, string>();
  for (const [p, text] of Object.entries(files)) {
    if (text == null) base.delete(p);
    else {
      const bytes = enc.encode(text);
      const sha = await gitBlobSha(bytes);
      blobs.set(sha, bytes);
      base.set(p, sha);
    }
  }
  const t = newSha('t');
  trees.set(t, base);
  const c = newSha('c');
  commits.set(c, { tree: t, parents: head ? [head] : [], message });
  head = c;
}

const remoteText = (p: string) => {
  const sha = trees.get(commits.get(head!)!.tree)!.get(p);
  return sha ? new TextDecoder().decode(blobs.get(sha)!) : undefined;
};

(globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  const m = /^https:\/\/api\.github\.com\/repos\/o\/r(.*)$/.exec(url);
  if (!m) throw new TypeError(`unexpected fetch ${url}`);
  const path = m[1];
  if (path === '' && method === 'GET') return json(200, { full_name: 'o/r', private: false, default_branch: 'main', permissions: { push: true } });
  if (path === '/git/ref/heads/main') return head ? json(200, { object: { sha: head } }) : json(409, { message: 'Git Repository is empty.' });
  let r: RegExpExecArray | null;
  if ((r = /^\/git\/commits\/(\w+)$/.exec(path))) return json(200, { tree: { sha: commits.get(r[1])!.tree } });
  if ((r = /^\/git\/trees\/(\w+)\?recursive=1$/.exec(path))) {
    const t = trees.get(r[1])!;
    return json(200, { truncated: false, tree: [...t].map(([p, sha]) => ({ path: p, sha, type: 'blob' })) });
  }
  if ((r = /^\/git\/blobs\/(\w+)$/.exec(path))) return json(200, { content: b64(blobs.get(r[1])!), encoding: 'base64' });
  if (path === '/git/blobs' && method === 'POST') {
    const bytes = new Uint8Array(Buffer.from(body.content, 'base64'));
    const sha = await gitBlobSha(bytes);
    blobs.set(sha, bytes);
    return json(201, { sha });
  }
  if (path === '/git/trees' && method === 'POST') {
    const base = new Map(trees.get(body.base_tree)!);
    for (const e of body.tree) e.sha == null ? base.delete(e.path) : base.set(e.path, e.sha);
    const t = newSha('t');
    trees.set(t, base);
    return json(201, { sha: t });
  }
  if (path === '/git/commits' && method === 'POST') {
    const c = newSha('c');
    commits.set(c, { tree: body.tree, parents: body.parents, message: body.message });
    return json(201, { sha: c });
  }
  if (path === '/git/refs/heads/main' && method === 'PATCH') {
    if (commits.get(body.sha)!.parents[0] !== head) return json(422, { message: 'Update is not a fast forward' });
    head = body.sha;
    return json(200, {});
  }
  if (path.startsWith('/contents/') && method === 'PUT') {
    const p = decodeURIComponent(path.slice('/contents/'.length));
    await remoteCommit({ [p]: Buffer.from(body.content, 'base64').toString('utf8') }, body.message);
    return json(201, {});
  }
  return json(404, { message: `not mocked: ${method} ${path}` });
};

/* ---------- 测试 ---------- */
let failures = 0;
const check = (cond: unknown, msg: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

const { getBackend } = await import('../src/core/storage/backend');
const { githubSync } = await import('../src/core/github/sync');
const b = await getBackend();
check(b.kind === 'local', `使用本地存储后端（${b.kind}）`);
store.set('arcadia-github-config', JSON.stringify({ mode: 'api', owner: 'o', repo: 'r', branch: 'main', token: 'test-token', dataDir: 'data', autoPush: false, autoPull: false }));

console.log('\n[1] 空仓库第一次上传');
await b.writeText('characters.json', '{"characters":[1]}');
await b.writeText('levels/ZH_1.json', '{"id":"ZH_1"}');
await b.writeText('progress.json', '{"cleared":["ZH_1"]}');
await githubSync.refresh();
check(githubSync.status.pending === 2, `待上传 2 个文件（progress.json 不算）：${githubSync.status.pending}`);
const msg1 = await githubSync.push('第一次上传');
check(remoteText('data/characters.json') === '{"characters":[1]}' && remoteText('data/levels/ZH_1.json') === '{"id":"ZH_1"}', `仓库中有两个文件（${msg1}）`);
check(remoteText('data/progress.json') === undefined, '玩家进度没有被上传');
await githubSync.refresh();
check(githubSync.status.pending === 0, '上传后没有待上传的修改');

console.log('\n[2] 修改后上传 = 一个新的 commit');
const before = commits.size;
await b.writeText('characters.json', '{"characters":[1,2]}');
await githubSync.push('修改角色');
check(remoteText('data/characters.json') === '{"characters":[1,2]}' && commits.size === before + 1, '只新增了 1 个 commit');
check(commits.get(head!)!.message === '修改角色', 'commit 信息正确');

console.log('\n[3] 拉取别人的修改');
await remoteCommit({ 'data/levels/ZH_1.json': '{"id":"ZH_1","v":2}', 'data/music/battle/a.wav': 'RIFF' }, '别人改了关卡并上传了音乐');
const p1 = await githubSync.pull();
check((await b.readText('levels/ZH_1.json')) === '{"id":"ZH_1","v":2}' && (await b.readText('music/battle/a.wav')) === 'RIFF', `下载了 ${p1.downloaded.length} 个文件：${p1.downloaded.join('、')}`);
check((await b.readText('characters.json')) === '{"characters":[1,2]}', '没有改动的文件保持不变');

console.log('\n[4] 冲突：本地和仓库同时修改同一个文件');
await remoteCommit({ 'data/characters.json': '{"characters":["remote"]}' }, '别人改了角色');
await b.writeText('characters.json', '{"characters":["local"]}');
let pushError = '';
try {
  await githubSync.push('我也改了角色');
} catch (err) {
  pushError = String(err);
}
check(pushError.includes('先「拉取」'), `上传被拒绝并提示先拉取：${pushError.slice(0, 40)}…`);
const p2 = await githubSync.pull();
check(p2.conflicts.join() === 'characters.json' && (await b.readText('characters.json')) === '{"characters":["local"]}', '拉取时列出冲突，默认保留本地版本');
await githubSync.pull(['characters.json']);
check((await b.readText('characters.json')) === '{"characters":["remote"]}', '选择覆盖后使用仓库版本');

console.log('\n[5] 删除文件');
await b.remove('music/battle/a.wav');
await githubSync.push('删除音乐');
check(remoteText('data/music/battle/a.wav') === undefined, '仓库中的文件也被删除');
await remoteCommit({ 'data/levels/ZH_1.json': null }, '别人删除了关卡');
const p3 = await githubSync.pull();
check(p3.deleted.join() === 'levels/ZH_1.json' && (await b.readText('levels/ZH_1.json')) === null, '仓库删除的文件，本地没改过时也会删除');

console.log(failures ? `\n失败 ${failures} 项` : '\n全部通过');
process.exit(failures ? 1 : 0);
