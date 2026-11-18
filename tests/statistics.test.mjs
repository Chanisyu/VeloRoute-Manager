import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRouteStats, smoothElevation, horizontalDistance } from '../shared/route-statistics.mjs';
import { normalizeData } from '../shared/storage-schema.mjs';

/** @param {number[]} x 米制里程。 @param {Array<number|null>} h 高程。 @returns {object[]} 赤道直线轨迹，球面距离可独立精确求解。 */
function points(x, h) { return x.map((at, i) => ({ lat: 0, lon: at / 6371008.8 * 180 / Math.PI, ele: h[i] })); }
/** @param {number} length 轨迹长度。 @param {number} grade 坡度百分比。 @returns {object[]} 每10米采样的已知匀坡。 */
function ramp(length, grade) {
  const x = Array.from({ length: Math.round(length / 10) + 1 }, (_, i) => i * 10);
  return points(x, x.map(value => 20 + value * grade / 100));
}

test('平路、上下匀坡与超过50%的陡坡具有解析解，端点不产生虚假最大坡度', () => {
  for (const length of [10, 50, 100, 150, 200, 1000]) for (const grade of [0, 0.1, 5, 10, -10, 80, -80]) {
    const result = calculateRouteStats(ramp(length, grade), [0]);
    assert.equal(result.distanceKm, length / 1000);
    assert.equal(result.elevationGainM, Math.round(Math.max(0, grade * length / 100)));
    assert.equal(result.elevationLossM, Math.round(Math.max(0, -grade * length / 100)));
    assert.equal(result.avgSlope, Math.max(0, grade));
    assert.equal(result.maxSlope, length < 100 ? null : Math.max(0, grade));
    assert.equal(result.minSlope, length < 100 ? null : Math.min(0, grade));
  }
});

test('不均匀采样按距离加权，长缓坡的小高差不会逐点被丢弃', () => {
  const x = [0, 1, 2, 3, 30, 50, 400, 600, 1000];
  const result = calculateRouteStats(points(x, x.map(value => value / 100)), [0]);
  assert.equal(result.elevationGainM, 10);
  assert.equal(result.avgSlope, 1);
  assert.ok(result.warnings.includes('sparse-sampling'));
});

test('分段首尾不连接，两个不足100米的短段不能拼接为最大坡度窗口', () => {
  const result = calculateRouteStats([...ramp(50, 10), ...ramp(50, 10).map(p => ({ ...p, lat: 1, ele: p.ele + 1000 }))], [0, 6]);
  assert.equal(result.distanceKm, 0.1);
  assert.equal(result.elevationGainM, 10);
  assert.equal(result.elevationLossM, 0);
  assert.equal(result.maxSlope, null);
  assert.equal(result.minSlope, null);
});

test('缺失高程不补零，原始点和统计输入保持不变', () => {
  const source = ramp(200, 10); source[5].ele = null;
  const before = structuredClone(source);
  const result = calculateRouteStats(source, [0]);
  assert.deepEqual(source, before);
  assert.equal(result.distanceKm, 0.2);
  for (const key of ['elevationGainM', 'elevationLossM', 'avgSlope', 'maxSlope', 'minSlope']) assert.equal(result[key], null);
  assert.deepEqual(result.warnings, ['missing-elevation']);
});

test('重复位置不制造无限坡度，长采样缺口不参与100米最大坡度', () => {
  const source = [...ramp(100, 5), ...points([400, 450, 500], [2000, 2002.5, 2005])];
  source.splice(3, 0, { ...source[2] });
  const result = calculateRouteStats(source, [0]);
  assert.equal(result.maxSlope, 5);
  assert.ok(result.warnings.includes('duplicate-position'));
  assert.ok(result.warnings.includes('sparse-sampling'));
  const stationary = calculateRouteStats([{ lat: 0, lon: 0, ele: 0 }, { lat: 0, lon: 0, ele: 100 }], [0]);
  assert.equal(stationary.elevationGainM, 0);
  assert.equal(stationary.maxSlope, null);
});

test('低幅高程抖动得到平滑，原始高程仍保留', () => {
  const x = Array.from({ length: 201 }, (_, i) => i * 10);
  const h = x.map((_, i) => i % 2);
  const filtered = smoothElevation(x, h);
  const result = calculateRouteStats(points(x, h), [0]);
  assert.ok(result.elevationGainM < 10);
  assert.deepEqual(h, x.map((_, i) => i % 2));
  assert.equal(filtered[0], h[0]); assert.equal(filtered.at(-1), h.at(-1));
});

test('确定种子的200条起伏轨迹满足升降守恒、反向互换、窗口反向与高程平移不变', () => {
  let seed = 12345;
  /** @returns {number} 可复现伪随机数，不依赖系统随机状态。 */
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 200; trial++) {
    const x = [0]; const h = [100];
    for (let i = 1; i < 80; i++) { x.push(x.at(-1) + 5 + random() * 60); h.push(h.at(-1) + (random() - 0.5) * 25); }
    const source = points(x, h); const result = calculateRouteStats(source, [0]);
    const reverse = calculateRouteStats([...source].reverse(), [0]);
    const shifted = calculateRouteStats(source.map(p => ({ ...p, ele: p.ele + 1000 })), [0]);
    assert.ok(Math.abs(result.elevationGainM - result.elevationLossM - (h.at(-1) - h[0])) <= 1);
    assert.equal(result.elevationGainM, reverse.elevationLossM);
    assert.equal(result.elevationLossM, reverse.elevationGainM);
    assert.equal(result.maxSlope, -reverse.minSlope || 0);
    assert.equal(result.minSlope, -reverse.maxSlope || 0);
    assert.deepEqual(result, shifted);
  }
});

test('新版分段、缺高程及数据不足值可往返保存，非法元数据被拒绝', () => {
  const source = ramp(50, 5); source[1].ele = null;
  const route = { id: 'r', folderId: 'f', name: '测试', description: '', color: '#ff0000', isVisible: true,
    points: source, segmentStarts: [0], stats: calculateRouteStats(source, [0]) };
  const data = { version: 4, folders: [{ id: 'f', name: '测试', isExpanded: true }], routes: [route], settings: {} };
  assert.deepEqual(normalizeData(normalizeData(data)).routes[0], { ...route, sourceFormat: 'GPX' });
  for (const mutate of [d => { d.routes[0].segmentStarts = [1]; }, d => { d.routes[0].stats.algorithmVersion = 2; }, d => { d.routes[0].stats.warnings = []; }, d => { d.routes[0].stats.distanceKm = null; }]) {
    const invalid = structuredClone(data); mutate(invalid); assert.throws(() => normalizeData(invalid));
  }
  assert.throws(() => calculateRouteStats(source, []));
  assert.throws(() => calculateRouteStats([{ lat: 91, lon: 0, ele: 0 }], [0]));
  assert.ok(Number.isFinite(horizontalDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })));
});
