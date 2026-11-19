const { BrowserWindow, protocol, session } = require('electron');
const { randomUUID } = require('node:crypto');

const editorOrigin = 'https://gpx.studio';
const editorUrl = editorOrigin + '/zh/app';
const scheme = 'veloroute-gpx';
const partition = 'persist:veloroute-gpx-studio';
const timeoutMs = 25000;
const maxBytes = 64 * 1024 * 1024;
let editor = null;
let pending = null;
let opening = false;

// 允许官方编辑器通过公开的 files 参数读取一次性本机 GPX。不注册绕过 CSP 的权限。
protocol.registerSchemesAsPrivileged([{
  scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}]);

/** @param {Request} request 编辑器会话请求。 @returns {Response} 仅返回本次选择的内存副本，地址不能读取磁盘路径。 */
function readCopy(request) {
  const origin = request.headers.get('origin');
  // Electron 的协议回调有时不带 Origin；同时约束专用会话、随机地址和请求方法。
  if (request.method !== 'GET' || (origin !== null && origin !== editorOrigin) || !pending || request.url !== pending.url) {
    return new Response(null, { status: 404, headers: { 'access-control-allow-origin': editorOrigin } });
  }
  const copy = pending;
  pending = null;
  const response = new Response(copy.xml, {
    headers: { 'access-control-allow-origin': editorOrigin, 'content-type': 'application/gpx+xml; charset=utf-8', 'cache-control': 'no-store' }
  });
  copy.accept();
  return response;
}

/** @param {Electron.BrowserWindow} parent 路线管理主窗口。 @returns {Electron.BrowserWindow} 无 preload、独立会话的官方编辑器。 */
function createEditor(parent) {
  const isolated = session.fromPartition(partition);
  if (!isolated.protocol.isProtocolHandled(scheme)) {
    isolated.protocol.handle(scheme, readCopy);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  }
  const window = new BrowserWindow({
    parent, width: 1280, height: 800, show: false, autoHideMenuBar: true,
    title: 'GPX Studio',
    webPreferences: { session: isolated, sandbox: true, nodeIntegration: false, contextIsolation: true }
  });
  /** @param {Electron.Event} event 导航事件。 @param {string} url 跳转目标。 @returns {void} 将编辑器顶层限制在官方 HTTPS 站点。 */
  const keepOrigin = (event, url) => {
    if (new URL(url).origin !== editorOrigin) event.preventDefault();
  };
  window.webContents.on('will-navigate', keepOrigin);
  window.webContents.on('will-redirect', keepOrigin);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('closed', () => { if (editor === window) editor = null; });
  return window;
}

/**
 * 打开官方编辑工作区。选定路线以一次性本机 URL 交给编辑器；读取后立即失效。
 * @param {Electron.BrowserWindow} parent 主窗口。
 * @param {string | null} xml 路线副本的 XML；null 打开编辑器或聚焦现有窗口。
 * @returns {Promise<{success: true} | {success: false, error: string}>} 页面加载及 GPX 交接结果。
 */
async function openGpxStudio(parent, xml) {
  if (opening) return { success: false, error: 'GPX Studio 正在打开，请稍候。' };
  if (xml !== null && (typeof xml !== 'string' || !xml.startsWith('<?xml ') || Buffer.byteLength(xml) > maxBytes)) {
    return { success: false, error: '无法传递此 GPX 副本，可先导出 GPX 再手动打开。' };
  }
  if (xml === null && editor) {
    if (editor.isMinimized()) editor.restore();
    editor.show();
    editor.focus();
    return { success: true };
  }

  opening = true;
  let window;
  let timer;
  try {
    window = editor ?? (editor = createEditor(parent));
    const target = new URL(editorUrl);
    const received = xml ? new Promise(accept => {
      // 页面 URL 会请求官网，使用固定文件名与本地随机地址，真实路线名称只留在 XML 内。
      const local = scheme + '://route/' + randomUUID() + '/VeloRoute.gpx';
      pending = { url: local, xml, accept };
      target.searchParams.set('files', JSON.stringify([local]));
    }) : Promise.resolve();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('GPX Studio 加载超时')), timeoutMs);
    });
    await Promise.race([Promise.all([window.loadURL(target.href), received]), deadline]);
    if (window.isDestroyed()) return { success: false, error: 'GPX Studio 窗口已关闭。' };
    window.show();
    window.focus();
    return { success: true };
  } catch {
    if (window && !window.isDestroyed()) {
      if (window.isVisible()) window.webContents.stop();
      else window.destroy();
    }
    return { success: false, error: '无法加载 GPX Studio 或传入路线，请检查网络，也可导出 GPX 后手动打开。' };
  } finally {
    clearTimeout(timer);
    pending = null;
    opening = false;
  }
}

module.exports = { openGpxStudio };
