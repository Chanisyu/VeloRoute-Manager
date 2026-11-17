const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

/** @param {number} count 分段数。 @param {boolean} missing 是否缺少中间高程。 @returns {string} 带命名空间前缀、每段100米且10%匀坡的 GPX；段间高差不应被累计。 */
function gpx(count = 1, missing = false) {
  const segments = Array.from({ length: count }, (_, segment) => '<g:trkseg>' + Array.from({ length: 11 }, (_, i) => {
    const lon = i * 10 / 6371008.8 * 180 / Math.PI;
    return `<g:trkpt lat="0" lon="${lon}">${missing && i === 5 ? '' : `<g:ele>${segment * 1000 + i}</g:ele>`}</g:trkpt>`;
  }).join('') + '</g:trkseg>');
  return `<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1" version="1.1"><g:trk>${segments.join('')}</g:trk></g:gpx>`;
}

/** @param {string} text GPX 原文。 @returns {object} Playwright 内存文件，不写入项目样例或用户目录。 */
function file(text) { return { name: '统计验证.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(text) }; }

/** @param {import('@playwright/test').Page} page 预览页面。 @returns {Promise<void>} 进入管理页，所有数据在隔离浏览器上下文中。 */
async function open(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '暂时跳过' }).click();
  await page.getByRole('button', { name: '路线管理与 GPX 导入' }).click();
}

test('分段统计导入、显式重算、原始GPX更新与备份恢复保持元数据和原始点', async ({ page }) => {
  await open(page);
  await page.locator('input[accept=".gpx"]').first().setInputFiles(file(gpx()));
  await page.getByText('统计验证', { exact: true }).click();
  await expect(page.getByTestId('stat-gain')).toHaveText('10 m');
  await expect(page.getByTestId('stat-average')).toHaveText('10%');
  await expect(page.getByTestId('stat-maximum')).toHaveText('10%');
  await page.getByLabel('路线简介').fill('保留的用户简介');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('velo_data') ?? 'null')?.routes[0]?.description)).toBe('保留的用户简介');
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('velo_data')).routes[0]);
  await page.getByRole('button', { name: '重新计算统计', exact: true }).click();
  await expect(page.getByTestId('stat-gain')).toHaveText('10 m');
  page.on('dialog', dialog => dialog.accept());
  await page.getByTestId('stats-gpx-file').setInputFiles(file(gpx(2)));
  await expect(page.getByTestId('stat-gain')).toHaveText('20 m');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('velo_data')).routes[0].points.length)).toBe(22);
  const updated = await page.evaluate(() => JSON.parse(localStorage.getItem('velo_data')).routes[0]);
  for (const key of ['id', 'name', 'description', 'folderId', 'color', 'isVisible']) expect(updated[key]).toEqual(original[key]);
  expect(updated.segmentStarts).toEqual([0, 11]);
  expect(updated.stats.algorithmVersion).toBe(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const backup = await download;
  const bytes = await fs.readFile(await backup.path());
  expect(JSON.parse(bytes.toString('utf8')).version).toBe(4);
  await page.locator('input[accept=".json"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByLabel('保存状态')).toContainText('备份已恢复并保存');
  await page.reload();
  await page.getByRole('button', { name: '暂时跳过' }).click();
  await page.getByRole('button', { name: '路线管理与 GPX 导入' }).click();
  await page.getByText('统计验证', { exact: true }).click();
  await expect(page.getByTestId('stat-gain')).toHaveText('20 m');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('velo_data')).routes[0])).toEqual(updated);
  await page.getByTestId('stats-gpx-file').setInputFiles(file(gpx().replace('lat="0"', 'lat="错误"')));
  await expect(page.getByLabel('保存状态')).toContainText('无效');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('velo_data')).routes[0])).toEqual(updated);
});

test('缺高程显示数据不足，旧统计不静默重算或冒用新口径名称', async ({ page }) => {
  await open(page);
  await page.locator('input[accept=".gpx"]').first().setInputFiles(file(gpx(1, true)));
  await page.getByText('统计验证', { exact: true }).click();
  for (const key of ['gain', 'loss', 'average', 'maximum']) await expect(page.getByTestId('stat-' + key)).toHaveText('数据不足');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('velo_data') ?? 'null')?.routes[0]?.points[5]?.ele)).toBeNull();
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('velo_data'));
    data.version = 3;
    const route = data.routes[0]; route.points[5].ele = 5; delete route.segmentStarts;
    route.stats = { distanceKm: 0.1, elevationGainM: 999, elevationLossM: 1, avgSlope: -2, maxSlope: 42, minSlope: -10 };
    localStorage.setItem('velo_data', JSON.stringify(data));
  });
  await page.reload();
  await page.getByRole('button', { name: '暂时跳过' }).click();
  await page.getByRole('button', { name: '路线管理与 GPX 导入' }).click();
  await page.getByText('统计验证', { exact: true }).click();
  await expect(page.getByTestId('stat-gain')).toHaveText('999 m');
  await expect(page.getByText('平均坡度（旧）', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新计算统计', exact: true })).toHaveCount(0);
});
