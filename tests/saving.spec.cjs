const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

/** @param {string} name 路线名。 @returns {object} 可供历史备份迁移的 v2 数据。 */
function fixture(name = '原有路线') {
  return {
    version: 2, timestamp: 1, folders: [{ id: '1', name: '已骑行', isExpanded: true }],
    routes: [{ id: 'r1', name, description: '', folderId: '1', color: '#ef4444', isVisible: true,
      points: [{ lat: 22, lon: 114, ele: 0 }, { lat: 22.01, lon: 114.01, ele: 1 }],
      stats: { distanceKm: 1, elevationGainM: 1, elevationLossM: 0, avgSlope: 1, maxSlope: 1, minSlope: 1 } }]
  };
}

/** @param {import('@playwright/test').Page} page 当前窗口。 @returns {Promise<void>} 进入可编辑的管理页。 */
async function openLibrary(page) {
  await page.getByRole('button', { name: '暂时跳过' }).click();
  await page.getByRole('button', { name: '路线管理与 GPX 导入' }).click();
  await expect(page.getByRole('heading', { name: '路线管理' })).toBeVisible();
}

/**
 * 为桌面故障测试创建独立目录，清理时仅销毁测试窗口，避免故障关闭握手阻塞测试回收。
 * @param {(context: object) => Promise<void>} run 测试操作。
 * @param {object} files 初始主文件和备份原文。 @returns {Promise<void>} 不访问开发或正式数据。
 */
async function withDesktop(run, files = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veloroute-saving-'));
  let desktop;
  let desktopProcess;
  try {
    for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, name), text);
    const env = { ...process.env, VELOROUTE_DEV_SERVER: '0', VELOROUTE_USER_DATA_DIR: dir };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await electron.launch({ args: [root], env });
    desktopProcess = desktop.process();
    await run({ desktop, page: await desktop.firstWindow(), dir });
  } finally {
    if (desktop && desktopProcess?.exitCode === null) {
      await desktop.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      }).catch(() => {});
      await desktop.close().catch(() => {});
    }
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir).startsWith('veloroute-saving-')).toBe(true);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

test('浏览器保存失败显示错误，重试后保存最新内容', async ({ page }) => {
  await page.addInitScript(() => {
    window.__failSaves = true;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'velo_data' && window.__failSaves) throw new DOMException('模拟容量不足', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  await openLibrary(page);
  await page.getByPlaceholder('请输入文件夹名称').fill('未保存文件夹');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('保存状态')).toContainText('保存失败');
  // 超过普通反馈的停留与渐隐时长后，失败原因和重试入口仍应可见。
  await page.waitForTimeout(3_500);
  await expect(page.getByRole('button', { name: '重试保存', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('velo_data'))).toBeNull();
  await page.evaluate(() => { window.__failSaves = false; });
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(page.getByLabel('保存状态')).toContainText('已保存');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('velo_data')).folders.at(-1).name)).toBe('未保存文件夹');
});

test('在途写入期间继续编辑，旧请求完成后只保存最新快照', async ({ page }) => {
  await page.addInitScript(() => {
    window.__writes = [];
    window.__releaseWrite = null;
    window.electronAPI = {
      loadData: async () => ({ status: 'missing' }),
      saveData: data => {
        const snapshot = JSON.parse(JSON.stringify(data));
        window.__writes.push(snapshot);
        if (window.__writes.length === 1) {
          return new Promise(resolve => { window.__releaseWrite = () => resolve({ success: true }); });
        }
        return Promise.resolve({ success: true });
      },
      onPrepareClose: () => {}, completeClose: () => {}
    };
  });
  await page.goto('/');
  await openLibrary(page);
  await page.getByPlaceholder('请输入文件夹名称').fill('第一次写入');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('保存状态')).toContainText('正在保存');
  // 真实写入尚未完成时，即使超过三秒也不能隐藏正在保存的反馈。
  await page.waitForTimeout(3_500);
  await expect(page.getByLabel('保存状态')).toBeVisible();
  await page.getByPlaceholder('请输入文件夹名称').fill('最新修改');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('保存状态')).toContainText('等待保存');
  await page.evaluate(() => window.__releaseWrite());
  await expect(page.getByLabel('保存状态')).toContainText('已保存');
  expect(await page.evaluate(() => window.__writes.length)).toBe(2);
  expect(await page.evaluate(() => window.__writes.at(-1).folders.at(-1).name)).toBe('最新修改');
});

test('保存反馈自动渐隐，连续保存重新计时，隐藏后再次修改可重新显示', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '暂时跳过' }).click();
  const status = page.getByLabel('保存状态');
  await expect(status).toBeVisible();
  await expect(status).toBeHidden({ timeout: 5_000 });

  await page.getByRole('button', { name: '路线管理与 GPX 导入' }).click();
  const input = page.getByPlaceholder('请输入文件夹名称');
  const add = page.getByRole('button', { name: '新建', exact: true });
  await input.fill('首次保存');
  await add.click();
  await expect(status).toContainText('已保存');

  // 接近上一轮消失时间时再保存；旧计时到期后，新反馈仍须完整显示。
  await page.waitForTimeout(2_400);
  await expect(status).toHaveCSS('opacity', '1');
  await input.fill('连续保存');
  await add.click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('velo_data')).folders.at(-1).name)).toBe('连续保存');
  await page.waitForTimeout(1_200);
  await expect(status).toHaveCSS('opacity', '1');
  await expect(status).toBeHidden({ timeout: 4_000 });
  // 节点已移除，而非只变透明，避免继续遮挡地图或保留隐藏的可聚焦内容。
  await expect(status).toHaveCount(0);

  await input.fill('隐藏后再次保存');
  await add.click();
  await expect(status).toContainText('已保存');
  await expect(status).toBeVisible();
  await expect(status).toBeHidden({ timeout: 5_000 });
});

test('桌面旧数据迁移及非法备份拒绝，当前路线与文件不变', async () => {
  await withDesktop(async ({ page, dir }) => {
    await openLibrary(page);
    const file = path.join(dir, 'storage.json');
    await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).version).toBe(3);
    expect(JSON.parse(await fs.readFile(file + '.bak', 'utf8')).version).toBe(2);
    const before = await fs.readFile(file, 'utf8');
    page.on('dialog', dialog => dialog.accept());
    const invalid = fixture('不应出现的路线');
    invalid.routes[0].folderId = 'missing';
    await page.locator('input[accept=".json"]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await expect(page.getByLabel('保存状态')).toContainText('路线所属文件夹');
    await expect(page.getByText('原有路线', { exact: true })).toBeVisible();
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  }, { 'storage.json': JSON.stringify(fixture()) });
});

test('主文件损坏时读取备份，首次编辑保存保护损坏原文', async () => {
  await withDesktop(async ({ page, dir }) => {
    await openLibrary(page);
    await expect(page.getByText('备份中的路线', { exact: true })).toBeVisible();
    await expect(page.getByLabel('保存状态')).toContainText('已读取上一份有效备份');
    expect(await fs.readFile(path.join(dir, 'storage.json'), 'utf8')).toBe('{broken');
    await page.getByPlaceholder('请输入文件夹名称').fill('恢复后新增');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await expect(page.getByLabel('保存状态')).toContainText('已保存');
    await expect.poll(async () => (await fs.readdir(dir)).some(name => name.includes('.preserved-'))).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'storage.json.bak'), 'utf8')).routes[0].name).toBe('备份中的路线');
  }, { 'storage.json': '{broken', 'storage.json.bak': JSON.stringify(fixture('备份中的路线')) });
});

test('读取失败阻止编辑，用户导入有效备份后解除保护', async () => {
  await withDesktop(async ({ page, dir }) => {
    await expect(page.getByRole('heading', { name: '数据读取失败' })).toBeVisible();
    await expect(page.getByRole('button', { name: '路线管理与 GPX 导入' })).toHaveCount(0);
    expect(await fs.readFile(path.join(dir, 'storage.json'), 'utf8')).toBe('{broken');
    await page.getByTestId('recovery-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture('手动恢复路线'))) });
    await openLibrary(page);
    await expect(page.getByText('手动恢复路线', { exact: true })).toBeVisible();
    await expect(page.getByLabel('保存状态')).toContainText('备份已恢复并保存');
    expect(JSON.parse(await fs.readFile(path.join(dir, 'storage.json'), 'utf8')).routes[0].name).toBe('手动恢复路线');
  }, { 'storage.json': '{broken' });
});

test('快速编辑后立即关闭，防抖队列先保存最后一次修改', async () => {
  await withDesktop(async ({ desktop, page, dir }) => {
    await openLibrary(page);
    await expect(page.getByLabel('保存状态')).toContainText('已保存');
    await page.getByText('原有路线', { exact: true }).click();
    const input = page.locator('app-management-view input[type="text"]').last();
    await input.fill('快速编辑-一');
    await input.fill('快速编辑-二');
    await input.fill('快速编辑-最终');
    const closed = desktop.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    expect(JSON.parse(await fs.readFile(path.join(dir, 'storage.json'), 'utf8')).routes[0].name).toBe('快速编辑-最终');
  }, { 'storage.json': JSON.stringify(fixture()) });
});

test('桌面保存失败不关闭窗口，解除占用后可重试保存', async () => {
  await withDesktop(async ({ desktop, page, dir }) => {
    await openLibrary(page);
    await expect(page.getByLabel('保存状态')).toContainText('已保存');
    const file = path.join(dir, 'storage.json');
    const held = path.join(dir, 'original-held.json');
    await fs.rename(file, held);
    await fs.mkdir(file);
    // 对话框仅在此隔离应用实例内替换为“返回应用”，验证失败关闭不会丢弃窗口。
    await desktop.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.getByPlaceholder('请输入文件夹名称').fill('失败后重试');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await expect(page.getByLabel('保存状态')).toContainText('保存失败');
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect(page.getByRole('heading', { name: '路线管理' })).toBeVisible();
    expect(JSON.parse(await fs.readFile(held, 'utf8')).routes[0].name).toBe('原有路线');
    // 只移除本测试创建的空目录，不涉及任何用户文件或递归清理。
    await fs.rmdir(file);
    await fs.rename(held, file);
    await page.getByRole('button', { name: '重试保存', exact: true }).click();
    await expect(page.getByLabel('保存状态')).toContainText('已保存');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).folders.at(-1).name).toBe('失败后重试');
  }, { 'storage.json': JSON.stringify(fixture()) });
});

test('读取 GPX 期间关闭窗口，先完成导入再保存退出', async () => {
  await withDesktop(async ({ desktop, page, dir }) => {
    await openLibrary(page);
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = async function () {
        await new Promise(resolve => { window.__releaseFile = resolve; });
        return original.call(this);
      };
    });
    await page.locator('input[accept=".gpx"]').first().setInputFiles(path.join(root, 'GPX_Eample', '待骑行路线', '金碧路.gpx'));
    await expect.poll(() => page.evaluate(() => typeof window.__releaseFile)).toBe('function');
    const closed = desktop.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.evaluate(() => window.__releaseFile());
    await closed;
    expect(JSON.parse(await fs.readFile(path.join(dir, 'storage.json'), 'utf8')).routes[0].name).toBe('金碧路');
  });
});

test('读取备份期间关闭窗口，先完成恢复事务再退出', async () => {
  await withDesktop(async ({ desktop, page, dir }) => {
    await openLibrary(page);
    await expect(page.getByLabel('保存状态')).toContainText('已保存');
    page.on('dialog', dialog => dialog.accept());
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = async function () {
        await new Promise(resolve => { window.__releaseFile = resolve; });
        return original.call(this);
      };
    });
    await page.locator('input[accept=".json"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture('退出前恢复'))) });
    await expect.poll(() => page.evaluate(() => typeof window.__releaseFile)).toBe('function');
    const closed = desktop.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.evaluate(() => window.__releaseFile());
    await closed;
    expect(JSON.parse(await fs.readFile(path.join(dir, 'storage.json'), 'utf8')).routes[0].name).toBe('退出前恢复');
  }, { 'storage.json': JSON.stringify(fixture()) });
});

test('中文界面保留历史英文名称与简介，编辑后仍按原数据格式保存', async ({}, testInfo) => {
  const legacy = fixture('Evening Ride');
  legacy.folders[0].name = 'To Ride';
  legacy.routes[0].description = 'Imported from GPX';
  await withDesktop(async ({ desktop, page, dir }) => {
    await page.screenshot({ path: testInfo.outputPath('中文地图启用.png') });
    await openLibrary(page);
    await page.getByText('Evening Ride', { exact: true }).click();
    await expect(page.getByLabel('路线名称')).toHaveValue('Evening Ride');
    await expect(page.getByLabel('路线简介')).toHaveValue('Imported from GPX');
    await page.getByPlaceholder('请输入文件夹名称').fill('新增中文目录');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await expect(page.getByLabel('保存状态')).toContainText('已保存');
    const saved = JSON.parse(await fs.readFile(path.join(dir, 'storage.json'), 'utf8'));
    expect(saved.folders[0].name).toBe('To Ride');
    expect(saved.routes[0].name).toBe('Evening Ride');
    expect(saved.routes[0].description).toBe('Imported from GPX');
    expect(saved.routes[0].points).toEqual(legacy.routes[0].points);
    expect(saved.routes[0].stats).toEqual(legacy.routes[0].stats);
    await page.screenshot({ path: testInfo.outputPath('中文路线管理.png') });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await expect(page.getByLabel('Mapbox 访问令牌')).toHaveValue('');
    await page.screenshot({ path: testInfo.outputPath('中文设置页.png') });
    const menuLabels = await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(item => item.label));
    expect(menuLabels).toEqual(['文件', '编辑', '视图', '窗口', '帮助']);
  }, { 'storage.json': JSON.stringify(legacy) });
});
