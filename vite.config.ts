import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const gitSync = createRequire(import.meta.url)('./electron/git-sync.cjs') as {
  handle(dataDir: string, cmd: string, message?: string): Promise<unknown>;
};

/**
 * 开发模式下的数据接口：浏览器版本（npm run dev）通过 /__data/* 直接读写项目内的 data/ 目录，
 * 与 Electron 版本使用同一份数据文件。
 *   GET    /__data/<rel>        读取文件
 *   PUT    /__data/<rel>        写入文件（请求体为原始内容）
 *   DELETE /__data/<rel>        删除文件
 *   GET    /__data-list/<dir>   列出目录下的文件名（JSON 数组）
 *   POST   /__data-rename       {"from": rel, "to": rel}
 */
function dataApiPlugin(): Plugin {
  const dataRoot = path.resolve(__dirname, 'data');

  const safePath = (rel: string): string | null => {
    const clean = decodeURIComponent(rel).replace(/^\/+/, '');
    const abs = path.resolve(dataRoot, clean);
    if (abs !== dataRoot && !abs.startsWith(dataRoot + path.sep)) return null;
    return abs;
  };

  const readBody = (req: import('node:http').IncomingMessage) =>
    new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  const install = (middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void }) => {
    middlewares.use(async (req, res, next) => {
      const url: string = (req.url || '').split('?')[0];
      try {
        if (url.startsWith('/__data-list/') || url === '/__data-list') {
          const abs = safePath(url.slice('/__data-list'.length));
          if (!abs) return void res.writeHead(400).end('bad path');
          const names = fs.existsSync(abs) ? fs.readdirSync(abs).filter((n) => !n.startsWith('.')) : [];
          res.setHeader('Content-Type', 'application/json');
          return void res.end(JSON.stringify(names));
        }
        if (url === '/__data-list-all') {
          const out: string[] = [];
          const walk = (dir: string, prefix: string) => {
            if (!fs.existsSync(dir)) return;
            for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
              if (d.name.startsWith('.')) continue;
              const rel = prefix ? `${prefix}/${d.name}` : d.name;
              if (d.isDirectory()) walk(path.join(dir, d.name), rel);
              else if (d.isFile()) out.push(rel);
            }
          };
          walk(dataRoot, '');
          res.setHeader('Content-Type', 'application/json');
          return void res.end(JSON.stringify(out));
        }
        if (url.startsWith('/__git/') && req.method === 'POST') {
          const cmd = url.slice('/__git/'.length);
          const body = (await readBody(req)).toString('utf8');
          const message = body ? JSON.parse(body).message : undefined;
          const result = await gitSync.handle(dataRoot, cmd, message);
          res.setHeader('Content-Type', 'application/json');
          return void res.end(JSON.stringify(result));
        }
        if (url === '/__data-rename' && req.method === 'POST') {
          const { from, to } = JSON.parse((await readBody(req)).toString('utf8'));
          const a = safePath(from);
          const b = safePath(to);
          if (!a || !b) return void res.writeHead(400).end('bad path');
          if (fs.existsSync(a)) {
            fs.mkdirSync(path.dirname(b), { recursive: true });
            fs.renameSync(a, b);
          }
          return void res.end('ok');
        }
        if (url.startsWith('/__data/')) {
          const abs = safePath(url.slice('/__data'.length));
          if (!abs) return void res.writeHead(400).end('bad path');
          if (req.method === 'GET') {
            // 文件不存在时返回 204（而不是 404），避免浏览器控制台出现大量“错误”
            if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return void res.writeHead(204).end();
            res.setHeader('Cache-Control', 'no-store');
            return void res.end(fs.readFileSync(abs));
          }
          if (req.method === 'PUT') {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, await readBody(req));
            return void res.end('ok');
          }
          if (req.method === 'DELETE') {
            if (fs.existsSync(abs)) fs.unlinkSync(abs);
            return void res.end('ok');
          }
        }
      } catch (err) {
        res.writeHead(500);
        return void res.end(String(err));
      }
      next();
    });
  };

  return {
    name: 'arcadia-data-api',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

/** 打包版本加上内容安全策略（开发模式下 React 热更新需要内联脚本，所以只在 build 时注入） */
function cspPlugin(): Plugin {
  return {
    name: 'arcadia-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const csp =
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.github.com";
      return html.replace('<title>', `<meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <title>`);
    },
  };
}

/**
 * 网页游玩版（GitHub Pages）：把 data/ 复制到输出目录，并生成 data/manifest.json（文件列表），
 * 网页版通过它读取关卡、音乐等数据。玩家进度保存在浏览器里。
 */
function staticDataPlugin(): Plugin {
  let outDir = '';
  return {
    name: 'arcadia-static-data',
    apply: 'build',
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const src = path.resolve(__dirname, 'data');
      const dst = path.join(outDir, 'data');
      const files: string[] = [];
      const walk = (dir: string, prefix: string) => {
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
          if (d.name.startsWith('.')) continue;
          const rel = prefix ? `${prefix}/${d.name}` : d.name;
          if (d.isDirectory()) walk(path.join(dir, d.name), rel);
          else if (d.isFile() && rel !== 'progress.json' && !/\.tmp-\d+$/.test(rel)) {
            fs.mkdirSync(path.dirname(path.join(dst, rel)), { recursive: true });
            fs.copyFileSync(path.join(dir, d.name), path.join(dst, rel));
            files.push(rel);
          }
        }
      };
      walk(src, '');
      fs.writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify(files.sort()));
      console.log(`[arcadia] 网页版数据：${files.length} 个文件 → ${path.relative(__dirname, dst)}`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const web = mode === 'pages';
  return {
    base: './',
    // 网页游玩版没有读写 data/ 的接口（和 GitHub Pages 上一样，只读网站上的数据）
    plugins: [react(), cspPlugin(), ...(web ? [staticDataPlugin()] : [dataApiPlugin()])],
    // data/ 由编辑器读写，不需要触发热更新（否则每次保存都会刷新页面）
    server: { port: 5199, strictPort: true, watch: { ignored: ['**/data/**', '**/release/**'] } },
    preview: { port: 5198, strictPort: true },
    // 网页游玩版输出到 dist-web/（GitHub Pages 部署这个目录），桌面版输出到 dist/
    build: { outDir: web ? 'dist-web' : 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  };
});
