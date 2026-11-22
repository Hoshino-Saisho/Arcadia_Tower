/**
 * 打包进前端的默认数据（data/ 下的全部 json），只在没有 Electron、也没有开发服务器时
 * （纯静态网页）用来初始化 localStorage。单独成文件并动态加载，避免开发模式下保存数据触发热更新。
 */
export const BUNDLED_DATA = import.meta.glob('../../../data/**/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>;
