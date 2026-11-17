
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;

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

/**
 * 创建桌面窗口，并按运行模式加载开发服务器或本地构建产物。
 * @returns {void} 窗口引用保存在主进程，关闭时释放；不修改正式数据目录。
 */
function createWindow() {
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

  win.on('closed', () => {
    win = null;
  });
}

// --- IPC Handlers for File System Operations ---

ipcMain.handle('save-data', async (event, data) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
    return { success: true };
  } catch (error) {
    console.error('Failed to save data:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-data', async () => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(data);
    }
    return null; // File doesn't exist yet (first run)
  } catch (error) {
    console.error('Failed to load data:', error);
    return null;
  }
});

// --- App Lifecycle ---

app.on('ready', createWindow);

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
