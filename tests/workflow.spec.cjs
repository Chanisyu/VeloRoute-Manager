const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sample = path.join(root, 'GPX_example', '待骑行路线', '金碧路.gpx');
const fitName = 'MAGENE_C406_2026-11-13_151817_263140';
const fitSample = path.join(root, 'FIT_example', fitName + '.fit');

/**
 * 跳过 Token 弹窗并进入管理界面，使非地图测试不依赖外网或个人 Token。
 * @param {import('@playwright/test').Page} page 当前浏览器或 Electron 页面。
 * @returns {Promise<void>} 等待 Angular 完成视图切换。
 */
async function openLibrary(page) {
  await page.getByRole('button', { name: '暂时跳过' }).click();
  await page.getByRole('button', { name: '路线管理与 GPX / FIT 导入' }).click();
  await expect(page.getByRole('heading', { name: '路线管理' })).toBeVisible();
}

test('浏览器混选 GPX 和 FIT，坏文件不阻止有效路线与高程导入', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await openLibrary(page);
  // 验证 Tailwind 已在构建时生成，避免 HTML 存在但界面样式缺失。
  await expect(page.locator('app-management-view > div')).toHaveCSS('display', 'flex');
  await expect.poll(() => page.evaluate(() => typeof window.mapboxgl?.Map)).toBe('function');
  await page.locator('input[type=file][accept=".gpx,.fit"]').first().setInputFiles([
    { name: '损坏.FIT', mimeType: 'application/octet-stream', buffer: Buffer.from('.FIT') },
    { name: fitName + '.FIT', mimeType: 'application/octet-stream', buffer: await fs.readFile(fitSample) },
    { name: '金碧路.gpx', mimeType: 'application/gpx+xml', buffer: await fs.readFile(sample) }
  ]);
  await expect(page.getByLabel('保存状态')).toContainText('损坏.FIT：所选 FIT 文件校验失败');
  await expect(page.getByText('损坏', { exact: true })).toHaveCount(0);
  await expect(page.getByText('GPX', { exact: true })).toBeVisible();
  await expect(page.getByText(fitName, { exact: true }).locator('..')).toContainText(/57\.89km\s*·\s*307m\s*·\s*FIT/);
  await page.getByText('金碧路', { exact: true }).click();
  await expect(page.getByRole('heading', { name: '金碧路', exact: true })).toBeVisible();
  await expect(page.getByLabel('路线简介')).toHaveValue('从 GPX 导入');
  await page.getByText(fitName, { exact: true }).click();
  await expect(page.getByLabel('路线简介')).toHaveValue('从 FIT 导入');
  await expect(page.getByRole('region', { name: '路线剖面图' })).toBeVisible();
  // 首次写入经过保存防抖，未生成快照时让轮询继续，确保重载发生在落盘之后。
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('velo_data') ?? 'null')?.routes.map(route => route.sourceFormat))).toEqual(['FIT', 'GPX']);
  await page.reload();
  await openLibrary(page);
  await expect(page.getByText('金碧路', { exact: true })).toBeVisible();
  await expect(page.getByText(fitName, { exact: true }).locator('..').getByText('FIT', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('桌面静态构建导入 GPX 和 FIT 并在重启后恢复路线来源', async () => {
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
    await page.locator('input[type=file][accept=".gpx,.fit"]').first().setInputFiles([sample, fitSample]);
    // 直接观察持久化文件，确认桥接与主进程写入均已完成后再退出。
    await expect.poll(async () => {
      try {
        const data = JSON.parse(await fs.readFile(path.join(dataDir, 'storage.json'), 'utf8'));
        return data.routes.map(route => route.sourceFormat);
      } catch { return []; }
    }).toEqual(['GPX', 'FIT']);
    expect(errors).toEqual([]);
    await desktop.close();
    desktop = await launch();
    const restored = await desktop.firstWindow();
    await openLibrary(restored);
    await expect(restored.getByText('金碧路', { exact: true })).toBeVisible();
    await expect(restored.getByText(fitName, { exact: true }).locator('..').getByText('FIT', { exact: true })).toBeVisible();
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
