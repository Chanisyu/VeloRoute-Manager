import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRouteProfile, sampleRouteProfile, visibleProfilePoints, clampProfileWindow, zoomProfileWindow } from '../shared/route-profile.mjs';

/** @param {number[]} x 米制里程。 @param {(number|null)[]} h 高程。 @returns {object[]} 赤道直线路线，水平距离可独立求解。 */
function points(x, h) { return x.map((value, i) => ({ lat: 0, lon: value / 6371008.8 * 180 / Math.PI, ele: h[i] })); }
/** @param {number} actual 实测结果。 @param {number} expected 解析解。 @returns {void} 在浮点距离误差内核对，不放宽到显示舍入精度。 */
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`); }

test('原始高程插值及20米匀坡解析解正确，端点只隐藏不足的坡度字段', () => {
  const profile = buildRouteProfile(points([0, 50, 100], [20, 25, 30]), [0]);
  near(profile.distance, 100);
  for (const at of [10, 20, 50, 90]) { const result = sampleRouteProfile(profile, at); near(result.elevation, 20 + at / 10); near(result.grade, 10); }
  assert.equal(sampleRouteProfile(profile, 0).grade, null);
  assert.equal(sampleRouteProfile(profile, 9.9).grade, null);
  assert.equal(sampleRouteProfile(profile, 100).grade, null);
  assert.equal(sampleRouteProfile(profile, 101), null);
});

test('20米完整窗口使用实际插值高差，不以点间坡度或单侧短窗口冒充', () => {
  const profile = buildRouteProfile(points([0, 10, 20, 30, 40], [0, 0, 10, 10, 10]), [0]);
  near(sampleRouteProfile(profile, 20).grade, 50);
  near(sampleRouteProfile(profile, 30).grade, 0);
  const sparse = buildRouteProfile(points([0, 1000], [0, 100]), [0]);
  near(sampleRouteProfile(sparse, 500).grade, 10);
  near(sampleRouteProfile(sparse, 500).elevation, 50);
});

test('高程缺失处断开，不跨缺失点或轨迹分段求坡度，也不增加段间里程', () => {
  const profile = buildRouteProfile(points([0, 10, 20, 30, 40], [0, 1, null, 3, 4]), [0]);
  assert.equal(profile.runs.length, 2); near(profile.distance, 40);
  assert.equal(sampleRouteProfile(profile, 20), null);
  assert.equal(sampleRouteProfile(profile, 10).grade, null);
  const segments = buildRouteProfile([...points([0, 10], [0, 1]), ...points([1000, 1010], [100, 101])], [0, 2]);
  near(segments.distance, 20); assert.equal(segments.runs.length, 2);
  near(sampleRouteProfile(segments, 10).elevation, 100);
  assert.equal(sampleRouteProfile(segments, 10).grade, null);
});

test('无高程、孤立点和重复位置安全处理，输入及旧数据保持不变', () => {
  assert.equal(buildRouteProfile([], undefined).runs.length, 0);
  assert.equal(buildRouteProfile(points([0, 10, 20], [null, 2, null]), [0]).runs.length, 0);
  const original = points([0, 0, 100], [10, 30, 40]); const before = structuredClone(original);
  const profile = buildRouteProfile(original, undefined);
  near(sampleRouteProfile(profile, 0).elevation, 20);
  assert.deepEqual(original, before);
});

test('像素抽稀保留窄峰、谷及边缘点，悬停继续读取完整高程', () => {
  const x = Array.from({ length: 10001 }, (_, i) => i);
  const h = x.map(i => i === 5001 ? 1000 : i === 5002 ? -100 : 0);
  const profile = buildRouteProfile(points(x, h), [0]);
  const drawn = visibleProfilePoints(profile.runs[0], 0, 10000, 100);
  assert.ok(drawn.length < 500); assert.ok(drawn.some(p => p[1] === 1000)); assert.ok(drawn.some(p => p[1] === -100));
  near(sampleRouteProfile(profile, profile.runs[0].x[5001]).elevation, 1000);
  assert.deepEqual(visibleProfilePoints(profile.runs[0], 20000, 21000, 100), []);
});

test('缩放锚点不漂移、平移限制在全程内，极短路线和极限缩放不产生无效坐标', () => {
  const next = zoomProfileWindow([0, 1000], 0.3, 0.5, 1000);
  near(next[0] + (next[1] - next[0]) * 0.3, 300);
  assert.deepEqual(clampProfileWindow(-100, 100, 1000), [0, 100]);
  assert.deepEqual(clampProfileWindow(950, 100, 1000), [900, 1000]);
  assert.deepEqual(zoomProfileWindow([0, 5], 0.5, 0.001, 5), [0, 5]);
  assert.deepEqual(zoomProfileWindow([0, 0], 0.5, 2, 0), [0, 0]);
  let window = [0, 1000];
  for (let i = 0; i < 1000; i++) window = zoomProfileWindow(window, 0.5, 0.5, 1000);
  near(window[1] - window[0], 10);
  assert.ok(window.every(Number.isFinite));
});
