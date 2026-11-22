/**
 * 游戏版本号（显示在启动器、游戏主页和编辑器中）。
 * 发布新版本时同时修改这里和 package.json 的 version（0.02 → "0.0.2"），并在 CHANGELOG.md 中记录。
 */
export const GAME_VERSION = '0.02';

/** 游戏的 GitHub 仓库（编辑器「GitHub 同步设置」的默认值） */
export const DEFAULT_GITHUB_REPO = 'Hoshino-Saisho/Arcadia_Tower';

/** 是否是网页游玩版（GitHub Pages 上的版本，只有游戏，没有启动器和编辑器） */
export const IS_WEB_PLAY = (import.meta as { env?: { MODE?: string } }).env?.MODE === 'pages';
