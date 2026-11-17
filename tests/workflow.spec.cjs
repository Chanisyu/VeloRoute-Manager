const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sample = path.join(root, 'GPX_Eample', '待骑行路线', '金碧路.gpx');

/**
 * 跳过 Token 弹窗并进入管理界面，使非地图测试不依赖外网或个人 Token。
 * @param {import('@playwright/test').Page} page 当前浏览器或 Electron 页面。
 * @returns {Promise<void>} 等待 Angular 完成视图切换。
 */
async function openLibrary(page) {
  await page.getByRole('button', { name: '暂时跳过' }).click();
  await page.getByRole('button', { name: '路线管理与 GPX 导入' }).click();
  await expect(page.getByRole('heading', { name: '路线管理' })).toBeVisible();
}

test('浏览器预览加载本地资源并完成 GPX 导入', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await openLibrary(page);
  // 验证 Tailwind 已在构建时生成，避免 HTML 存在但界面样式缺失。
  await expect(page.locator('app-management-view > div')).toHaveCSS('display', 'flex');
  await expect.poll(() => page.evaluate(() => typeof window.mapboxgl?.Map)).toBe('function');
  await page.locator('input[type=file][accept=".gpx"]').first().setInputFiles(sample);
  await page.getByText('金碧路', { exact: true }).click();
  await expect(page.getByRole('heading', { name: '金碧路', exact: true })).toBeVisible();
  await expect(page.getByLabel('路线简介')).toHaveValue('从 GPX 导入');
  await page.reload();
  await openLibrary(page);
  await expect(page.getByText('金碧路', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('桌面静态构建隔离数据并在重启后恢复路线', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veloroute-smoke-'));
  let desktop;
  /**
   * 启动实际 Electron 主进程；临时目录避免触及开发与正式数据。
   * @returns {Promise<import('@playwright/test').ElectronApplication>} 桌面应用句柄。
   */
  async function launch() {
    const env = { ...process.env, VELOROUTE_DEV_SERVER: '0', VELOROUTE_USER_DATA_DIR: dataDir };
    // 外层终端可能注入该变量；Electron 测试必须以桌面应用模式启动。
    delete env.ELECTRON_RUN_AS_NODE;
    return electron.launch({ args: [root], env });
  }
  try {
    desktop = await launch();
    const page = await desktop.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    expect(await desktop.evaluate(({ app }) => app.getPath('userData'))).toBe(dataDir);
    expect(await desktop.evaluate(({ app }) => app.isPackaged)).toBe(false);
    expect(page.url()).toMatch(/^file:/);
    await openLibrary(page);
    await expect(page.locator('app-management-view > div')).toHaveCSS('display', 'flex');
    await expect.poll(() => page.evaluate(() => typeof window.mapboxgl?.Map)).toBe('function');
    await page.locator('input[type=file][accept=".gpx"]').first().setInputFiles(sample);
    // 直接观察持久化文件，确认桥接与主进程写入均已完成后再退出。
    await expect.poll(async () => {
      try { return JSON.parse(await fs.readFile(path.join(dataDir, 'storage.json'), 'utf8')).routes.length; }
      catch { return 0; }
    }).toBe(1);
    expect(errors).toEqual([]);
    await desktop.close();
    desktop = await launch();
    const restored = await desktop.firstWindow();
    await openLibrary(restored);
    await expect(restored.getByText('金碧路', { exact: true })).toBeVisible();
  } finally {
    if (desktop) await desktop.close();
    // 清理前校验绝对路径及目录前缀，保证递归删除只作用于本测试创建的临时目录。
    if (path.dirname(dataDir) !== path.resolve(os.tmpdir())
        || !path.basename(dataDir).startsWith('veloroute-smoke-')) {
      throw new Error('拒绝清理非测试临时目录');
    }
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
