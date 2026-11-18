
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 返回实际保存结果，渲染进程必须检查 success，不能只依赖 Promise 是否拒绝。
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  restoreData: (data) => ipcRenderer.invoke('restore-data', data),
  loadData: () => ipcRenderer.invoke('load-data'),
  // 高德凭据使用独立固定通道，不通过路线存储或备份读写。
  loadAmapCredentials: () => ipcRenderer.invoke('load-amap-credentials'),
  saveAmapCredentials: (credentials) => ipcRenderer.invoke('save-amap-credentials', credentials),
  /**
   * 注册退出前保存回调，不暴露原始 IPC event，亦不允许指定任意通道。
   * @param {(requestId: string) => void} callback 负责完成当前防抖与在途写入。
   * @returns {void} 注册后通知主进程已具备安全关闭能力。
   */
  onPrepareClose: (callback) => {
    ipcRenderer.on('prepare-close', (_event, requestId) => callback(requestId));
    ipcRenderer.send('storage-ready');
  },
  completeClose: (requestId, success) => ipcRenderer.send('complete-close', requestId, success)
});
