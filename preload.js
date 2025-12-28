const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 你原来的 SSO 能力（保持不变）
  getCallbackUrl: () => ipcRenderer.invoke('auth:getCallbackUrl'),
  openExternal: (url) => ipcRenderer.invoke('auth:openExternal', url),
  onAuthCallback: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('auth:callback', handler);
    // ✅ 返回取消监听函数（不影响旧用法，旧代码不接返回值也没事）
    return () => ipcRenderer.removeListener('auth:callback', handler);
  },

  // ✅ 全局“开关麦克风”快捷键触发事件
  onMicToggle: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('mic:toggle', handler);
    return () => ipcRenderer.removeListener('mic:toggle', handler);
  },
});

contextBridge.exposeInMainWorld('hotkey', {
  // 你原来的快捷键设置接口（保持不变）
  get: () => ipcRenderer.invoke('shortcuts:get'),
  set: (key, accelerator) => ipcRenderer.invoke('shortcuts:set', key, accelerator),
});
