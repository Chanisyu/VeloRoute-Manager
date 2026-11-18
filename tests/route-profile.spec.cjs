const { test, expect } = require('@playwright/test');

/** @param {string} name 文件名。 @param {Array<{x:number[],h:Array<number|null>}>} segments 分段。 @returns {object} 内存GPX文件，坐标在赤道直线上对应指定米制距离。 */
function file(name, segments) {
  const xml = '<gpx><trk>' + segments.map(segment => '<trkseg>' + segment.x.map((x, i) =>
    `<trkpt lat="0" lon="${x / 6371008.8 * 180 / Math.PI}">${segment.h[i] === null ? '' : `<ele>${segment.h[i]}</ele>`}</trkpt>`
  ).join('') + '</trkseg>').join('') + '</trk></gpx>';
  return { name: name + '.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(xml) };
}

/** @param {import('@playwright/test').Page} page 页面。 @returns {Promise<void>} 不依赖Token的路线管理入口。 */
async function open(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '暂时跳过' }).click();
  await page.getByRole('button', { name: '路线管理与 GPX / FIT 导入' }).click();
}

/** @param {import('@playwright/test').Page} page 页面。 @param {number} fraction 图面内横坐标比例。 @returns {Promise<{x:number,y:number}>} 考虑SVG视口与边距的真实屏幕位置。 */
async function position(page, fraction) {
  const svg = page.locator('app-route-profile svg');
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  const width = await svg.evaluate(element => element.viewBox.baseVal.width);
  return { x: box.x + (56 + fraction * (width - 72)) / width * box.width, y: box.y + 120 };
}

test('剖面悬停、缩放、拖动及平滑恢复全程均不改写路线', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page);
  const x = Array.from({ length: 101 }, (_, i) => i * 10);
  await page.locator('input[accept=".gpx,.fit"]').first().setInputFiles(file('剖面验证', [{ x, h: x.map(d => d / 10) }]));
  await page.getByText('剖面验证', { exact: true }).click();
  await expect(page.getByLabel('保存状态')).toContainText('已保存');
  const saved = await page.evaluate(() => localStorage.getItem('velo_data'));
  const svg = page.locator('app-route-profile svg');
  const center = await position(page, 0.5);
  await page.mouse.move(center.x, center.y);
  await expect(page.getByTestId('profile-tooltip')).toContainText('里程：500.0 m');
  await expect(page.getByTestId('profile-tooltip')).toContainText('高程：50.0 m');
  await expect(page.getByTestId('profile-grade')).toHaveText('20米平均坡度：10.0%');
  await page.mouse.wheel(0, -350);
  await expect.poll(() => svg.evaluate(el => Number(el.getAttribute('data-end')) - Number(el.getAttribute('data-start')))).toBeLessThan(900);
  const before = await svg.evaluate(el => Number(el.getAttribute('data-start')));
  const at = await position(page, 0.5);
  await page.mouse.move(at.x, at.y); await page.mouse.down();
  await page.mouse.move(at.x - 70, at.y, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => svg.evaluate(el => Number(el.getAttribute('data-start')))).toBeGreaterThan(before);
  const localStart = Number(await svg.getAttribute('data-start'));
  const localEnd = Number(await svg.getAttribute('data-end'));
  // 在点击前记录横轴变化，检查动画实际经过中间视窗，避免只验证终点。
  await svg.evaluate(el => {
    el.resetFrames = [];
    const observer = new MutationObserver(() => {
      const start = Number(el.getAttribute('data-start'));
      el.resetFrames.push([start, Number(el.getAttribute('data-end'))]);
      if (start === 0) observer.disconnect();
    });
    observer.observe(el, { attributeFilter: ['data-start', 'data-end'] });
  });
  await page.getByRole('button', { name: '显示全程', exact: true }).click();
  await expect(svg).toHaveAttribute('data-start', '0');
  const fullEnd = Number(await svg.getAttribute('data-end'));
  expect(fullEnd).toBeCloseTo(1000, 5);
  const frames = await svg.evaluate(el => el.resetFrames);
  expect(frames.some(([start, end]) => start > 0 && start < localStart && end > localEnd && end < fullEnd)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('velo_data'))).toBe(saved);
});

test('分段和缺高程不连线，缺失提示不显示，端点不冒用短窗口坡度', async ({ page }) => {
  await open(page);
  await page.locator('input[accept=".gpx,.fit"]').first().setInputFiles(file('缺失剖面', [{ x: [0, 10, 20, 30, 40, 50, 60], h: [0, 1, 2, null, 4, 5, 6] }]));
  await page.getByText('缺失剖面', { exact: true }).click();
  await expect(page.getByTestId('profile-line')).toHaveCount(2);
  let at = await position(page, 0.5); await page.mouse.move(at.x, at.y);
  await expect(page.getByTestId('profile-tooltip')).toHaveCount(0);
  at = await position(page, 0.05); await page.mouse.move(at.x, at.y);
  await expect(page.getByTestId('profile-tooltip')).toBeVisible();
  await expect(page.getByTestId('profile-grade')).toHaveCount(0);
  await expect(page.locator('app-route-profile')).not.toContainText('数据不足');
  await page.locator('input[accept=".gpx,.fit"]').first().setInputFiles(file('独立分段', [{ x: [0, 20, 40], h: [0, 2, 4] }, { x: [1000, 1020, 1040], h: [100, 102, 104] }]));
  await page.getByText('独立分段', { exact: true }).click();
  await expect(page.getByTestId('profile-line')).toHaveCount(2);
  expect(Number(await page.locator('app-route-profile svg').getAttribute('data-end'))).toBeCloseTo(80, 5);
  await page.locator('input[accept=".gpx,.fit"]').first().setInputFiles(file('没有高程', [{ x: [0, 50, 100], h: [null, null, null] }]));
  await page.getByText('没有高程', { exact: true }).click();
  await expect(page.locator('app-route-profile')).toBeHidden();
});

test('路线切换重置视窗，名称编辑保留缩放', async ({ page }) => {
  await open(page);
  await page.locator('input[accept=".gpx,.fit"]').first().setInputFiles([
    file('路线甲', [{ x: [0, 500, 1000], h: [0, 10, 0] }]),
    file('路线乙', [{ x: [0, 100, 200], h: [20, 30, 20] }])
  ]);
  await page.getByText('路线甲', { exact: true }).click();
  const svg = page.locator('app-route-profile svg'); const at = await position(page, 0.5);
  await page.mouse.move(at.x, at.y); await page.mouse.wheel(0, -300);
  await expect.poll(() => svg.evaluate(el => Number(el.getAttribute('data-start')))).toBeGreaterThan(0);
  const start = await svg.getAttribute('data-start');
  await page.getByLabel('路线名称').fill('路线甲改名');
  await expect(svg).toHaveAttribute('data-start', start);
  await page.getByText('路线乙', { exact: true }).click();
  await expect(svg).toHaveAttribute('data-start', '0');
  expect(Number(await svg.getAttribute('data-end'))).toBeCloseTo(200, 5);
  await expect(page.getByTestId('profile-tooltip')).toHaveCount(0);
});
