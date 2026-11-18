
const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { randomUUID } = require('crypto');

let win = null;

// 仅设置当前应用的 Chromium 语言，使原生网页提示和文件输入控件与中文界面一致。
app.commandLine.appendSwitch('lang', 'zh-CN');

/** @returns {void} 使用中文标注桌面菜单，编辑、缩放和窗口动作仍交由 Electron 标准角色处理。 */
function configureChineseMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '关闭窗口', role: 'close' }] },
    { label: '编辑', submenu: [
      { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
      { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }
    ] },
    { label: '视图', submenu: [
      { label: '刷新', role: 'reload' }, { label: '强制刷新', role: 'forceReload' },
      { label: '开发者工具', role: 'toggleDevTools' }, { type: 'separator' },
      { label: '实际大小', role: 'resetZoom' }, { label: '放大', role: 'zoomIn' },
      { label: '缩小', role: 'zoomOut' }, { label: '切换全屏', role: 'togglefullscreen' }
    ] },
    { label: '窗口', submenu: [{ label: '最小化', role: 'minimize' }, { label: '最大化或还原', role: 'zoom' }] },
    { label: '帮助', submenu: [{ label: '关于 VeloRoute Manager', click: showChineseAbout }] }
  ]));
}

/** @returns {void} 显示中文关于信息，版本读取应用元数据，避免与安装包版本不一致。 */
function showChineseAbout() {
  if (!win) return;
  void dialog.showMessageBox(win, {
    type: 'info', title: '关于 VeloRoute Manager', message: 'VeloRoute Manager',
    detail: `版本：${app.getVersion()}\n本地骑行路线管理与分析工具。`, buttons: ['确定']
  });
}
// 未打包运行始终使用独立数据目录；测试可指定临时目录，安装版忽略这些变量。
// 必须在 ready 事件前设置 userData，使 Chromium 缓存与 localStorage 一并隔离。
if (!app.isPackaged) {
  const developmentData = process.env.VELOROUTE_USER_DATA_DIR
    || path.join(app.getPath('appData'), 'veloroute-manager-development');
  fs.mkdirSync(developmentData, { recursive: true });
  app.setPath('userData', developmentData);
}

const useDevServer = !app.isPackaged && process.env.VELOROUTE_DEV_SERVER === '1';
const DATA_FILE = path.join(app.getPath('userData'), 'storage.json');
const AMAP_CREDENTIALS_FILE = path.join(app.getPath('userData'), 'amap-credentials.bin');
const storageReady = import('./storage/store.mjs').then(({ AtomicStore }) => new AtomicStore(DATA_FILE));
let rendererReady = false;
let allowClose = false;
let quitting = false;
let closeRequest = null;
let closeTimer;

/** @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} event IPC 来源。 @returns {boolean} 仅允许当前窗口的可信顶层页面。 */
function trustedSender(event) {
  const expected = useDevServer ? 'http://127.0.0.1:4200/'
    : pathToFileURL(path.join(__dirname, 'dist/veloroute-manager/browser/index.html')).href;
  return !!win && event.sender === win.webContents
    && event.senderFrame === win.webContents.mainFrame
    && event.senderFrame.url.split('#')[0] === expected;
}

/** @returns {Promise<void>} 保存失败或超时后返回应用，明确重试；不提供自动丢弃修改的分支。 */
async function closeFailed() {
  clearTimeout(closeTimer);
  closeRequest = null;
  if (!win || win.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', message: '尚未完成保存，应用保持打开。',
    detail: '请检查界面的保存提示，解决问题后重试。',
    buttons: ['返回应用', '重试保存并关闭'], defaultId: 0, cancelId: 0
  });
  if (response === 1 && win && !win.isDestroyed()) win.close();
}

/** @returns {void} 请求渲染进程提交防抖队列，使用请求 ID 忽略超时后的过期确认。 */
function prepareClose() {
  if (closeRequest) return;
  closeRequest = randomUUID();
  closeTimer = setTimeout(() => void closeFailed(), 15000);
  win.webContents.send('prepare-close', closeRequest);
}

/**
 * 创建桌面窗口，按运行模式加载界面，并挂接退出前保存握手。
 * @returns {void} 窗口引用保存在主进程，关闭时释放；不修改正式数据目录。
 */
function createWindow() {
  rendererReady = false;
  allowClose = false;
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: app.isPackaged ? 'VeloRoute Manager' : 'VeloRoute Manager [开发]',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js') // 仅通过受限桥接访问本地能力。
    },
    autoHideMenuBar: true,
  });

  // HTML 标题更新不得覆盖开发标记，避免与同时打开的正式安装版混淆。
  win.on('page-title-updated', event => {
    if (!app.isPackaged) event.preventDefault();
  });

  // URL 固定为本机开发服务，不接受环境变量提供的任意远程地址。
  const loading = useDevServer
    ? win.loadURL('http://127.0.0.1:4200')
    : win.loadFile(path.join(__dirname, 'dist/veloroute-manager/browser/index.html'));
  loading.catch(error => {
    console.error('无法加载应用界面：', error);
    app.exit(1);
  });

  win.on('close', event => {
    if (allowClose) return;
    event.preventDefault();
    if (rendererReady) prepareClose();
    else {
      // 初始化前没有可编辑数据，仍需等待已接收的文件任务结束。
      void storageReady.then(store => store.drain()).then(() => {
        allowClose = true;
        if (quitting) app.quit();
        else if (win) win.close();
      });
    }
  });

  win.on('closed', () => {
    clearTimeout(closeTimer);
    closeRequest = null;
    win = null;
  });
}

// 路径由主进程固定；数据在 AtomicStore 中再次进行结构与关联校验。
for (const [channel, operation] of [
  ['save-data', async (store, data) => store.save(data)],
  ['restore-data', async (store, data) => store.save(data, true)],
  ['load-data', async store => store.load()]
]) {
  ipcMain.handle(channel, async (event, data) => {
    if (!trustedSender(event)) throw new Error('拒绝不可信页面的数据访问');
    return operation(await storageReady, data);
  });
}

/** @param {unknown} value 本地解密数据或渲染进程输入。 @returns {boolean} 两项字段均可安全作为 JS API 凭据。 */
function validAmapCredentials(value) {
  const validPart = part => typeof part === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(part);
  return !!value && validPart(value.key) && validPart(value.securityCode);
}

ipcMain.handle('load-amap-credentials', event => {
  if (!trustedSender(event)) throw new Error('拒绝不可信页面的凭据访问');
  try {
    const credentials = JSON.parse(safeStorage.decryptString(fs.readFileSync(AMAP_CREDENTIALS_FILE)));
    if (validAmapCredentials(credentials)) return credentials;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
  }
  throw new Error('无法读取本机高德地图凭据');
});

ipcMain.handle('save-amap-credentials', (event, credentials) => {
  if (!trustedSender(event)) throw new Error('拒绝不可信页面的凭据访问');
  if (credentials === null) {
    fs.rmSync(AMAP_CREDENTIALS_FILE, { force: true });
    return;
  }
  if (!validAmapCredentials(credentials) || !safeStorage.isEncryptionAvailable()) {
    throw new Error('高德地图凭据无效或系统加密不可用');
  }
  // 单独加密落盘，既不进入路线快照与备份，也不在写入失败时覆盖先前凭据。
  const { key, securityCode } = credentials;
  const temporary = `${AMAP_CREDENTIALS_FILE}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify({ key, securityCode })), { flag: 'wx', flush: true });
    fs.renameSync(temporary, AMAP_CREDENTIALS_FILE);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
});

ipcMain.on('storage-ready', event => {
  if (trustedSender(event)) rendererReady = true;
});

ipcMain.on('complete-close', async (event, requestId, success) => {
  if (!trustedSender(event) || !closeRequest || requestId !== closeRequest || typeof success !== 'boolean') return;
  clearTimeout(closeTimer);
  if (!success) { await closeFailed(); return; }
  await (await storageReady).drain();
  // 等待过程中可能已被取消；过期结果不能关闭用户继续编辑的窗口。
  if (closeRequest !== requestId) return;
  allowClose = true;
  if (quitting) app.quit();
  else win.close();
});

// --- App Lifecycle ---

// 单实例锁按 userData 隔离，避免两个本应用进程并发覆盖同一存储文件。
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('ready', () => { configureChineseMenu(); createWindow(); });
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (win === null) {
    createWindow();
  }
});
