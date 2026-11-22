/**
 * 预加载脚本：把有限的数据读写接口暴露给网页（window.arcadia），网页本身不能直接访问 Node。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arcadia', {
  isElectron: true,
  readText: (rel) => ipcRenderer.invoke('data:readText', rel),
  writeText: (rel, text) => ipcRenderer.invoke('data:writeText', rel, text),
  readBinary: (rel) => ipcRenderer.invoke('data:readBinary', rel),
  writeBinary: (rel, bytes) => ipcRenderer.invoke('data:writeBinary', rel, bytes),
  list: (relDir) => ipcRenderer.invoke('data:list', relDir),
  listAll: () => ipcRenderer.invoke('data:listAll'),
  getConfig: (name) => ipcRenderer.invoke('config:get', name),
  setConfig: (name, value) => ipcRenderer.invoke('config:set', name, value),
  git: (cmd, message) => ipcRenderer.invoke('git', cmd, message),
  remove: (rel) => ipcRenderer.invoke('data:remove', rel),
  rename: (from, to) => ipcRenderer.invoke('data:rename', from, to),
  openWindow: (kind, hash) => ipcRenderer.invoke('app:openWindow', kind, hash),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  getInfo: () => ipcRenderer.invoke('app:info'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
