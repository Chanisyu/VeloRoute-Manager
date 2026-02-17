
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');

let win;

// Ensure the User Data directory exists and define storage path
// Windows: %APPDATA%/veloroute-manager/storage.json
const DATA_FILE = path.join(app.getPath('userData'), 'storage.json');

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'dist/veloroute-manager/browser/favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js') // Load the bridge
    },
    autoHideMenuBar: true,
  });

  const distPath = path.join(__dirname, 'dist/veloroute-manager/browser/index.html');

  win.loadURL(
    url.format({
      pathname: distPath,
      protocol: 'file:',
      slashes: true,
    })
  );

  // win.webContents.openDevTools();

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
