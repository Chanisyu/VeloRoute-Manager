const { test, expect } = require('@playwright/test');

// SDK 替身只记录官方接口调用；真正的隔离页、消息、坐标转换及设置仍走产品代码。
const sdk = `
  window.AMap = {
    Map: class {
      constructor() {
        window.testAmap = this;
        this.lines = [];
        setTimeout(() => this.complete(), 0);
      }
      on(name, callback) { this[name] = callback; }
      add(lines) { this.lines.push(...lines); }
      remove(lines) { this.lines = this.lines.filter(line => !lines.includes(line)); }
      setFitView(lines) { this.fitCount = lines.length; }
      setDefaultCursor(value) { this.cursor = value; }
    },
    Polyline: class {
      constructor(options) { this.options = options; this.events = {}; }
      on(name, callback) { this.events[name] = callback; }
      setOptions(options) { Object.assign(this.options, options); }
    },
    InfoWindow: class { close() {} setContent() {} open() {} },
    Pixel: class {}
  };
  window.startVeloRouteMap();
`;

test('高德配置、加载失败重试、分段路线和跨页交互', async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  let attempts = 0;
  await page.route('https://webapi.amap.com/maps?**', async route => {
    attempts++;
    if (attempts === 1) await route.abort();
    else await route.fulfill({ contentType: 'application/javascript', body: sdk });
  });
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const data = {
      version: 6,
      folders: [{ id: 'folder', name: '测试文件夹', isExpanded: true, color: '#10b981' }],
      routes: [{
        id: 'route', folderId: 'folder', name: '高德测试路线', sourceFormat: 'GPX',
        color: '#ef4444', isVisible: true, segmentStarts: [0, 2],
        points: [[116.404, 39.915], [116.41, 39.916], [116.43, 39.918], [116.435, 39.92]]
          .map(([lon, lat]) => ({ lon, lat, ele: 10 })),
        stats: { distanceKm: 1, elevationGainM: 0, elevationLossM: 0, avgSlope: 0, maxSlope: 0, minSlope: 0 }
      }],
      settings: {}
    };
    localStorage.setItem('velo_data', JSON.stringify(data));
  });
  await page.goto('/');
  await page.getByRole('button', { name: '前往设置配置高德地图' }).click();
  await page.getByLabel('高德地图 Key').fill('synthetic-js-key');
  await expect(page.getByLabel('高德地图安全密钥')).toHaveAttribute('type', 'password');
  await page.getByLabel('高德地图安全密钥').fill('synthetic-security-code');
  await page.getByRole('button', { name: '保存高德配置' }).click();
  await expect(page.getByText('高德配置已保存。')).toBeVisible();
  await page.getByRole('button', { name: '返回路线管理' }).click();
  await page.getByRole('button', { name: '返回地图', exact: true }).click();
  await expect(page.getByText(/^高德地图加载失败/)).toBeVisible();
  await page.getByRole('button', { name: '重试加载高德地图' }).click();

  const frame = page.frameLocator('iframe[title="高德地图"]');
  const body = frame.locator('body');
  await expect.poll(() => body.evaluate(() => window.testAmap?.lines.length)).toBe(2);
  const displayed = await body.evaluate(() => window.testAmap.lines[0].options.path[0]);
  // 核对已知 GPS 点转换到高德坐标，并保留路线原始坐标。
  expect(displayed[0]).toBeCloseTo(116.4102445, 6);
  expect(displayed[1]).toBeCloseTo(39.9164043, 6);
  const stored = await page.evaluate(() => localStorage.getItem('velo_data'));
  expect(JSON.parse(stored).routes[0].points[0]).toEqual({ lon: 116.404, lat: 39.915, ele: 10 });
  expect(stored).not.toContain('synthetic-security-code');
  expect(await body.evaluate(() => typeof window.electronAPI)).toBe('undefined');

  const row = page.getByText('高德测试路线', { exact: true });
  await row.hover();
  await expect.poll(() => body.evaluate(() => window.testAmap.lines[1].options.strokeWeight)).toBe(7);
  await page.getByRole('button', { name: '显示可见路线' }).click();
  await expect.poll(() => body.evaluate(() => window.testAmap.fitCount)).toBe(2);
  await page.getByLabel('文件夹对比模式').check();
  await expect.poll(() => body.evaluate(() => window.testAmap.lines[0].options.strokeColor)).toBe('#10b981');
  const checkbox = page.getByRole('checkbox', { name: '高德测试路线' });
  await checkbox.uncheck();
  await expect.poll(() => body.evaluate(() => window.testAmap.lines.length)).toBe(0);
  await checkbox.check();
  await expect.poll(() => body.evaluate(() => window.testAmap.lines.length)).toBe(2);
  await page.getByRole('button', { name: '显示可见路线' }).hover();
  await expect.poll(() => body.evaluate(() => window.testAmap.lines[0].options.strokeWeight)).toBe(4);
  await body.evaluate(() => window.testAmap.lines[0].events.mouseover({ lnglat: {} }));
  await expect(row.locator('..')).toHaveCSS('background-color', 'rgb(241, 245, 249)');
  await body.evaluate(() => window.testAmap.lines[0].events.click());
  await expect(page.getByRole('heading', { name: '高德测试路线', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回地图', exact: true }).click();
  await expect(row).toBeVisible();
  expect(attempts).toBe(2);
});
