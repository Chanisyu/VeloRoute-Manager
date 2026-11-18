const { test, expect } = require('@playwright/test');

// 使用软件 WebGL，以便在无显卡的 CI 中运行真实 Mapbox 样式和图层逻辑。
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

/** @param {import('@playwright/test').Page} page 测试页面。 @returns {Promise<void>} 使用本地空底图和隔离的合成路线启动。 */
async function openMap(page) {
  await page.route('https://**/*', route => route.abort());
  await page.route('**/vendor/mapbox-gl.js', async route => {
    const response = await route.fetch();
    // 保持实际 Mapbox 实现，只替换底图并公开实例以核对真实图层属性。
    const body = (await response.text()) + `
      ;(() => {
        const OriginalMap = mapboxgl.Map;
        mapboxgl.Map = class extends OriginalMap {
          constructor(options) {
            super({ ...options, projection: 'mercator', style: { version: 8, sources: {}, layers: [] } });
            window.testRouteMap = this;
          }
        };
      })();`;
    await route.fulfill({ response, body });
  });
  await page.addInitScript(() => {
    localStorage.setItem('velo_data', JSON.stringify({
      version: 6,
      folders: [{ id: 'folder', name: '测试文件夹', isExpanded: true }],
      routes: [['first', '可见路线甲', true], ['second', '可见路线乙', true], ['hidden', '隐藏路线', false]]
        .map(([id, name, isVisible], i) => ({
          id, name, folderId: 'folder', isVisible, sourceFormat: 'GPX', color: '#ef4444',
          points: [{ lat: 22 + i / 100, lon: 114, ele: 0 }, { lat: 22 + i / 100, lon: 114.01, ele: 1 }],
          stats: { distanceKm: 1, elevationGainM: 1, elevationLossM: 0, avgSlope: 1, maxSlope: 1, minSlope: 0 }
        })),
      settings: { mapboxApiKey: 'pk.test', mapboxKeyValid: true }
    }));
  });
  await page.goto('/');
}

/** @param {import('@playwright/test').Page} page 地图页面。 @param {string} id 路线标识。 @returns {Promise<number[]|null>} 真实线宽与不透明度，隐藏图层返回 null。 */
function paint(page, id) {
  return page.evaluate(routeId => {
    const map = window.testRouteMap;
    const layer = `route-layer-${routeId}`;
    return map?.getLayer(layer) ? ['line-width', 'line-opacity'].map(prop => map.getPaintProperty(layer, prop)) : null;
  }, id);
}

test('列表悬停只高亮可见路线，底图重载后恢复联动，右键可打开隐藏路线详情', async ({ page }) => {
  await openMap(page);
  const first = page.getByText('可见路线甲', { exact: true });
  const second = page.getByText('可见路线乙', { exact: true });
  const hidden = page.getByText('隐藏路线', { exact: true });
  await expect.poll(() => paint(page, 'first')).toEqual([4, 0.85]);
  // 等待命中层真正绘制，核对从地图浮窗进入列表时的交接。
  const hitPoint = await page.waitForFunction(() => {
    const map = window.testRouteMap;
    // 选择靠上方的路线，避免地图底部的管理入口遮住命中位置。
    const point = map.project([114.005, 22.01]);
    if (!map.queryRenderedFeatures(point, { layers: ['route-hit-second'] }).length) return null;
    const bounds = map.getCanvas().getBoundingClientRect();
    return { x: bounds.left + point.x, y: bounds.top + point.y };
  });
  const { x, y } = await hitPoint.jsonValue();
  await page.mouse.move(x, y);
  await expect(page.locator('.route-popup')).toBeVisible();
  await expect.poll(() => paint(page, 'second')).toEqual([7, 1]);
  await first.hover();
  await expect.poll(() => paint(page, 'first')).toEqual([7, 1]);
  await expect.poll(() => paint(page, 'second')).toEqual([4, 0.85]);
  await expect(page.locator('.route-popup')).toHaveCount(0);
  await second.hover();
  await expect.poll(() => paint(page, 'first')).toEqual([4, 0.85]);
  await expect.poll(() => paint(page, 'second')).toEqual([7, 1]);

  // 在鼠标留在原行时切换样式，验证重建的图层也应用当前悬停。
  await page.evaluate(() => window.testRouteMap.setStyle({ version: 8, sources: {}, layers: [] }, { diff: false }));
  await expect.poll(() => paint(page, 'second')).toEqual([7, 1]);
  await hidden.hover();
  await expect.poll(() => paint(page, 'second')).toEqual([4, 0.85]);
  expect(await paint(page, 'hidden')).toBeNull();

  const hiddenCheckbox = page.getByRole('checkbox', { name: '隐藏路线', exact: true });
  await hiddenCheckbox.check();
  await expect.poll(() => paint(page, 'hidden')).toEqual([7, 1]);
  await hiddenCheckbox.uncheck();
  await expect.poll(() => paint(page, 'hidden')).toBeNull();
  await hidden.click({ button: 'right' });
  await expect(page.getByRole('heading', { name: '隐藏路线', exact: true })).toBeVisible();
});
