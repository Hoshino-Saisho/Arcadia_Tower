/**
 * Arcadia Tower —— Electron 主进程（启动器）
 *
 *  - 启动后显示「启动器」窗口，可以打开「游戏」窗口和「关卡编辑器」窗口
 *  - 所有数据（角色 / 敌人 / 章节 / 关卡 / 图标 / 进度）都保存在 data 目录中：
 *      开发运行（npm start）：项目里的 data/
 *      Windows 便携版 exe：exe 所在文件夹旁的 ArcadiaTower_Data/
 *      其他打包版本：系统用户数据目录下的 data/
 *    第一次运行时会把内置的示例数据复制过去。
 *  - 环境变量 ARCADIA_DATA_DIR 可以指定数据目录。
 */
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
// 本机 Git 同步（编辑器用）只保存在本机，公开仓库里没有这个文件时不提供
let gitSync = null;
try {
  gitSync = require('./git-sync.cjs');
} catch {
  gitSync = null;
}

// 背景音乐不需要用户先点击才能播放
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 开发运行（npm start）和打包版（exe / app）使用不同的身份：两者可以同时打开，互不抢占
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'arcadia-tower-dev'));

const DEV_URL = process.env.ARCADIA_DEV_URL || '';
const SMOKE_DIR = process.env.ARCADIA_SMOKE_DIR || '';

/* ---------------- 数据目录 ---------------- */

function bundledDataDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'default-data') : path.join(__dirname, '..', 'data');
}

function resolveDataDir() {
  if (process.env.ARCADIA_DATA_DIR) return path.resolve(process.env.ARCADIA_DATA_DIR);
  if (!app.isPackaged) return path.join(__dirname, '..', 'data');
  if (process.env.PORTABLE_EXECUTABLE_DIR) return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'ArcadiaTower_Data');
  return path.join(app.getPath('userData'), 'data');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}

let DATA_DIR = '';

function ensureDataDir() {
  DATA_DIR = resolveDataDir();
  const seed = bundledDataDir();
  if (path.resolve(seed) !== path.resolve(DATA_DIR) && fs.existsSync(seed)) {
    // 第一次运行：复制全部示例数据；升级到新版本：只补上缺少的新文件（例如新版的技能库、音乐），不覆盖已有文件
    const marker = path.join(DATA_DIR, '.seed-version');
    const seeded = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';
    if (seeded !== app.getVersion()) {
      copyDir(seed, DATA_DIR);
      fs.writeFileSync(marker, app.getVersion());
    }
  }
  for (const sub of ['levels', 'icons']) fs.mkdirSync(path.join(DATA_DIR, sub), { recursive: true });
}

/** 把相对路径解析到数据目录内，拒绝 .. 越界 */
function safePath(rel) {
  if (typeof rel !== 'string') throw new Error('bad path');
  const abs = path.resolve(DATA_DIR, rel.replace(/^[/\\]+/, ''));
  const root = path.resolve(DATA_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`路径越界：${rel}`);
  return abs;
}

function writeFileAtomic(abs, data) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, abs);
}

/* ---------------- IPC：数据读写 ---------------- */

ipcMain.handle('data:readText', (_e, rel) => {
  const abs = safePath(rel);
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? fs.readFileSync(abs, 'utf8') : null;
});
ipcMain.handle('data:writeText', (_e, rel, text) => {
  writeFileAtomic(safePath(rel), String(text));
});
ipcMain.handle('data:readBinary', (_e, rel) => {
  const abs = safePath(rel);
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? new Uint8Array(fs.readFileSync(abs)) : null;
});
ipcMain.handle('data:writeBinary', (_e, rel, bytes) => {
  writeFileAtomic(safePath(rel), Buffer.from(bytes));
});
ipcMain.handle('data:list', (_e, relDir) => {
  const abs = safePath(relDir || '.');
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith('.'))
    .map((d) => d.name);
});
ipcMain.handle('data:remove', (_e, rel) => {
  const abs = safePath(rel);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
});
ipcMain.handle('data:listAll', () => {
  const out = [];
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${d.name}` : d.name;
      if (d.isDirectory()) walk(path.join(dir, d.name), rel);
      else if (d.isFile()) out.push(rel);
    }
  };
  walk(DATA_DIR, '');
  return out;
});
ipcMain.handle('data:rename', (_e, from, to) => {
  const a = safePath(from);
  const b = safePath(to);
  if (fs.existsSync(a)) {
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.renameSync(a, b);
  }
});

/* ---------------- 本机设置（GitHub 访问令牌用系统钥匙串加密保存，不写入 data 目录） ---------------- */

const configFile = () => path.join(app.getPath('userData'), 'arcadia-config.json');

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

ipcMain.handle('config:get', (_e, name) => {
  const all = readConfigFile();
  const v = all[name];
  if (!v || typeof v !== 'object') return v ?? null;
  const out = { ...v };
  if (typeof out.tokenEnc === 'string') {
    try {
      out.token = safeStorage.decryptString(Buffer.from(out.tokenEnc, 'base64'));
    } catch {
      out.token = '';
    }
    delete out.tokenEnc;
  }
  return out;
});

ipcMain.handle('config:set', (_e, name, value) => {
  const all = readConfigFile();
  if (value == null) delete all[name];
  else {
    const v = { ...value };
    if (typeof v.token === 'string' && v.token && safeStorage.isEncryptionAvailable()) {
      v.tokenEnc = safeStorage.encryptString(v.token).toString('base64');
      delete v.token;
    }
    all[name] = v;
  }
  writeFileAtomic(configFile(), JSON.stringify(all, null, 2));
});

/* ---------------- 本机 Git 同步 ---------------- */

ipcMain.handle('git', (_e, cmd, message) =>
  gitSync ? gitSync.handle(DATA_DIR, cmd, message) : cmd === 'info' ? { available: false, error: '没有本机 Git 同步' } : { ok: false, output: '没有本机 Git 同步' },
);

/* ---------------- 窗口 ---------------- */

const windows = { launcher: null, game: null, editor: null };
const SIZES = {
  launcher: { width: 960, height: 640, minWidth: 820, minHeight: 560, title: 'Arcadia Tower 启动器' },
  game: { width: 1366, height: 820, minWidth: 960, minHeight: 600, title: 'Arcadia Tower' },
  editor: { width: 1520, height: 940, minWidth: 1200, minHeight: 700, title: 'Arcadia Tower · 关卡编辑器' },
};

function loadHash(win, hash) {
  const h = hash && hash.startsWith('/') ? hash : '/';
  if (DEV_URL) return win.loadURL(`${DEV_URL}/#${h}`);
  return win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: h });
}

function openWindow(kind, hash) {
  const existing = windows[kind];
  if (existing && !existing.isDestroyed()) {
    if (hash) loadHash(existing, hash);
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return existing;
  }
  const s = SIZES[kind];
  const win = new BrowserWindow({
    ...s,
    show: false,
    backgroundColor: '#0b0f16',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windows[kind] = win;
  win.once('ready-to-show', () => {
    if (!SMOKE_DIR && (kind === 'editor' || kind === 'game')) win.maximize();
    win.show();
  });
  win.on('closed', () => {
    windows[kind] = null;
  });
  // 编辑器有未保存修改时，关闭前询问
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['仍然关闭', '取消'],
      defaultId: 1,
      cancelId: 1,
      title: '有未保存的修改',
      message: '当前有未保存的修改，关闭后将会丢失。确定要关闭吗？',
    });
    if (choice === 0) event.preventDefault();
  });
  // 外部链接用系统浏览器打开；游戏内试玩等 window.open 改为打开游戏窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    const m = /#(\/game[^]*)$/.exec(url);
    if (m) openWindow('game', m[1]);
    else if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  loadHash(win, hash || (kind === 'launcher' ? '/' : `/${kind}`));
  return win;
}

ipcMain.handle('app:openWindow', (_e, kind, hash) => {
  if (!['game', 'editor', 'launcher'].includes(kind)) return;
  openWindow(kind, hash);
});
ipcMain.handle('app:openDataFolder', () => shell.openPath(DATA_DIR));
ipcMain.handle('app:info', () => ({ dataDir: DATA_DIR, version: app.getVersion(), platform: process.platform }));
ipcMain.handle('app:quit', () => app.quit());

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        { label: '启动器', click: () => openWindow('launcher') },
        { label: '开始游戏', click: () => openWindow('game') },
        { label: '关卡编辑器', click: () => openWindow('editor') },
        { type: 'separator' },
        { label: '打开数据文件夹', click: () => shell.openPath(DATA_DIR) },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    { role: 'editMenu', label: '编辑' },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    { role: 'windowMenu', label: '窗口' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- 自动截图自检（ARCADIA_SMOKE_DIR=目录 时启用） ---------------- */

async function smokeTest() {
  fs.mkdirSync(SMOKE_DIR, { recursive: true });
  const shots = [
    ['launcher', '/'],
    ['game', '/game'],
    ['game', '/game/chapters'],
    ['game', '/game/chapter/ZH'],
    ['game', '/game/codex'],
    ['game', '/game/characters'],
    ['game', '/game/play/ZH_1?test=1'],
    ['editor', '/editor'],
    ['editor', '/editor?level=ZH_2'],
  ];
  const errors = [];
  for (const [kind, hash] of shots) {
    const win = openWindow(kind, hash);
    win.webContents.on('console-message', (...args) => {
      const ev = args[0];
      const level = ev && typeof ev === 'object' && 'level' in ev ? ev.level : args[1];
      const message = ev && typeof ev === 'object' && 'message' in ev ? ev.message : args[2];
      if (level === 'error' || level === 3) errors.push(`[${kind} ${hash}] ${message}`);
    });
    await new Promise((r) => setTimeout(r, kind === 'launcher' ? 3500 : 2500));
    // 页面是否真的渲染出了内容
    const probe = await win.webContents
      .executeJavaScript('JSON.stringify({ n: document.getElementById("root")?.children.length || 0, text: (document.body.innerText || "").slice(0, 60), visible: document.visibilityState })')
      .catch((e) => JSON.stringify({ n: -1, text: String(e) }));
    const info = JSON.parse(probe);
    if (!info.n) errors.push(`[${kind} ${hash}] 页面为空：${probe}`);
    console.log(`[smoke] ${kind} ${hash} → ${probe}`);
    const img = await win.webContents.capturePage();
    const name = `${kind}${hash.replace(/[^a-z0-9]+/gi, '_')}.png`;
    fs.writeFileSync(path.join(SMOKE_DIR, name), img.toPNG());
  }
  fs.writeFileSync(path.join(SMOKE_DIR, 'errors.txt'), errors.join('\n'));
  console.log(`[smoke] 截图已保存到 ${SMOKE_DIR}，错误 ${errors.length} 条`);
  app.exit(errors.length ? 1 : 0);
}

/* ---------------- 启动 ---------------- */

const gotLock = SMOKE_DIR ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('Arcadia Tower 已经在运行，已切换到已经打开的窗口。');
  app.quit();
} else {
  app.on('second-instance', () => openWindow('launcher'));
  app.whenReady().then(() => {
    ensureDataDir();
    buildMenu();
    if (SMOKE_DIR) {
      void smokeTest();
      return;
    }
    openWindow('launcher');
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow('launcher');
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
