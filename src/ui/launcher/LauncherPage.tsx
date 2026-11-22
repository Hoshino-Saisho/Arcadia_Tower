import { useEffect, useRef, useState } from 'react';
import { loadGitHubConfig } from '../../core/github/config';
import { githubSync } from '../../core/github/sync';
import { getBackend, getBridge } from '../../core/storage/backend';
import { loadDatabase } from '../../core/storage/repository';
import { GAME_VERSION } from '../../version';
import { pullWithPrompt, useSyncStatus } from '../editor/GitHubBar';
import { openApp } from '../router';

/** 启动器：开始游戏 / 关卡编辑器 / GitHub 同步 */
export function LauncherPage() {
  const bridge = getBridge();
  const [info, setInfo] = useState<{ dataDir: string; version: string; platform: string } | null>(null);
  const [stats, setStats] = useState<string>('读取数据中…');
  const [backendKind, setBackendKind] = useState('');
  const sync = useSyncStatus();
  const autoPulled = useRef(false);

  const refreshStats = () =>
    loadDatabase()
      .then((db) =>
        setStats(
          `角色 ${db.characters.length} · 敌人 ${db.enemies.length} · 技能 ${db.skills.length} · 章节 ${db.chapters.length} · 已制作关卡 ${db.levelCodes.size}`,
        ),
      )
      .catch((err) => setStats(`数据读取失败：${String(err)}`));

  useEffect(() => {
    void bridge?.getInfo().then(setInfo);
    void getBackend().then((b) => setBackendKind(b.kind));
    void refreshStats();
    // 打开启动器时自动从 GitHub 拉取最新数据
    void (async () => {
      const cfg = await loadGitHubConfig();
      if (autoPulled.current || !cfg?.autoPull || !(await githubSync.config())) return;
      autoPulled.current = true;
      if (await pullWithPrompt()) void refreshStats();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  return (
    <div className="launcher">
      <div className="launcher-bg" />
      <div className="launcher-card">
        <div className="launcher-title">
          <div className="logo-mark">
            <span />
            <span />
            <span />
          </div>
          <div>
            <h1>ARCADIA TOWER</h1>
            <p>2D 塔防 · 启动器</p>
          </div>
          <span className="launcher-version">v{GAME_VERSION}</span>
        </div>

        <div className="launcher-buttons">
          <button className="launch-btn launch-play" onClick={() => openApp('game')}>
            <strong>开始游戏</strong>
            <span>进入游戏主页，点击 Play 选择章节</span>
          </button>
          <button className="launch-btn launch-editor" onClick={() => openApp('editor')}>
            <strong>关卡编辑器</strong>
            <span>角色 / 敌人 / 技能 / 章节 / 地图与敌人路线</span>
          </button>
        </div>

        <div className="launcher-sync">
          <span className="gh-logo">⑂</span>
          {sync.mode === 'off' ? (
            <span className="muted">GitHub 同步未设置（在关卡编辑器右上角的 ⚙ 中设置）</span>
          ) : (
            <>
              <span className="mono small">{sync.target}</span>
              <span className={sync.error ? 'field-error small' : 'muted small'}>
                {sync.busy ? sync.message : sync.error ? sync.error : sync.pending ? `${sync.pending} 个本地修改待上传` : '已同步'}
              </span>
              <span className="grow" />
              <button
                className="btn btn-s"
                disabled={sync.busy}
                onClick={async () => {
                  if (await pullWithPrompt()) void refreshStats();
                }}
              >
                从 GitHub 拉取
              </button>
            </>
          )}
        </div>

        <div className="launcher-foot">
          <div className="muted">{stats}</div>
          {info && (
            <div className="muted small mono" title={info.dataDir}>
              数据目录：{info.dataDir}
            </div>
          )}
          {!bridge && backendKind && (
            <div className="muted small">
              浏览器模式（{backendKind === 'devserver' ? '读写项目 data/ 目录' : '数据保存在浏览器 localStorage'}）
            </div>
          )}
          <div className="row gap-s">
            {bridge && (
              <>
                <button className="btn btn-s btn-ghost" onClick={() => void bridge.openDataFolder()}>
                  打开数据文件夹
                </button>
                <button className="btn btn-s btn-ghost" onClick={() => void bridge.quit()}>
                  退出
                </button>
              </>
            )}
            <span className="muted small">版本 {GAME_VERSION}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
