import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { FitBaseType, FitEncoder } from 'fit-file-parser/encoder';
import { parseFitRoute } from '../shared/fit-route.mjs';

/** @param {number} type FIT 文件类型，4 为活动、6 为路线。 @returns {FitEncoder} 含 File Id 的合成文件。 */
function fit(type = 4) {
  return new FitEncoder().writeMessage(0, [{ number: 0, size: 1, baseType: FitBaseType.Enum, value: type }]);
}

/**
 * @param {FitEncoder} encoder 写入目标。
 * @param {{lat?:number,alt?:number,enhanced?:number,time?:number}} fields 原始 FIT 值，允许使用无效哨兵。
 * @returns {FitEncoder} 追加含已知比例和偏移的轨迹记录。
 */
function record(encoder, { lat = 2 ** 28, alt = 2500, enhanced, time = 1000000000 } = {}) {
  const fields = [
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: lat },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: -(2 ** 29) },
    { number: 2, size: 2, baseType: FitBaseType.Uint16, value: alt },
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: time }
  ];
  if (enhanced !== undefined) fields.push({ number: 78, size: 4, baseType: FitBaseType.Uint32, value: enhanced });
  return encoder.writeMessage(20, fields);
}

test('坐标和高程单位换算正确，增强高程优先，缺失高程保留为空', () => {
  const encoder = fit(6);
  record(encoder, { alt: 2750, enhanced: 3001 });
  record(encoder, { alt: 2500, enhanced: 0xffffffff });
  record(encoder, { alt: 0xffff });
  record(encoder, { alt: 2450 });
  const route = parseFitRoute(encoder.close());
  assert.deepEqual(route.segmentStarts, [0]);
  assert.equal(route.points[0].lat, 22.5);
  assert.equal(route.points[0].lon, -45);
  assert.ok(Math.abs(route.points[0].ele - 100.2) < 1e-9);
  assert.deepEqual(route.points.slice(1).map(point => point.ele), [0, null, -10]);
});

test('计时暂停、无定位记录和后续会话均断开轨迹，有效点保序', () => {
  const encoder = fit();
  record(encoder); record(encoder, { alt: 2505 });
  encoder.writeMessage(21, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 0 },
    { number: 1, size: 1, baseType: FitBaseType.Enum, value: 4 }
  ]);
  record(encoder, { alt: 2510 }); record(encoder, { alt: 2515 });
  record(encoder, { lat: 0x7fffffff });
  record(encoder, { alt: 2520 }); record(encoder, { alt: 2525 });
  record(encoder, { alt: 2530, time: 1000000100 }); record(encoder, { alt: 2535, time: 1000000101 });
  for (const start of [1000000000, 1000000100]) {
    encoder.writeMessage(18, [{ number: 2, size: 4, baseType: FitBaseType.Uint32, value: start }]);
  }
  const result = parseFitRoute(encoder.close());
  assert.deepEqual(result.segmentStarts, [0, 2, 4, 6]);
  assert.deepEqual(result.points.map(point => point.ele), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('拒绝损坏文件、非轨迹类型和无连续有效定位的活动', () => {
  const encoder = fit();
  record(encoder); record(encoder, { lat: 0x7fffffff }); record(encoder);
  const bytes = encoder.close();
  assert.throws(() => parseFitRoute(bytes), /没有可用轨迹/);
  assert.throws(() => parseFitRoute(fit(5).close()), /仅支持/);
  assert.throws(() => parseFitRoute(bytes.slice(0, -1)), /校验失败/);
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => parseFitRoute(bytes), /校验失败/);
});

test('逐点缺海拔时仍使用 FIT 会话的四项指标，保留真实零值及两位坡度精度', () => {
  const encoder = fit();
  record(encoder, { alt: 0xffff });
  record(encoder, { alt: 0xffff });
  encoder.writeMessage(18, [
    { number: 22, size: 2, baseType: FitBaseType.Uint16, value: 421 },
    { number: 23, size: 2, baseType: FitBaseType.Uint16, value: 0 },
    { number: 53, size: 2, baseType: FitBaseType.Sint16, value: 342 },
    { number: 55, size: 2, baseType: FitBaseType.Sint16, value: 1475 }
  ]);
  assert.deepEqual(parseFitRoute(encoder.close()).stats, {
    source: 'fit-session', distanceKm: 0, elevationGainM: 421, elevationLossM: 0,
    avgSlope: 3.42, maxSlope: 14.75, minSlope: null
  });
});

test('多会话只合并完整的升降与最大坡度汇总，保留缺项且不拼接平均值', () => {
  const encoder = fit();
  record(encoder); record(encoder);
  for (const [gain, loss, steepest] of [[100, 10, 875], [50, 0xffff, 1325]]) {
    encoder.writeMessage(18, [
      { number: 22, size: 2, baseType: FitBaseType.Uint16, value: gain },
      { number: 23, size: 2, baseType: FitBaseType.Uint16, value: loss },
      { number: 53, size: 2, baseType: FitBaseType.Sint16, value: 235 },
      { number: 55, size: 2, baseType: FitBaseType.Sint16, value: steepest }
    ]);
  }
  const { stats } = parseFitRoute(encoder.close());
  assert.deepEqual([stats.elevationGainM, stats.elevationLossM, stats.avgSlope, stats.maxSlope], [150, null, null, 13.25]);
});

test('导入 FIT_example 全部 7 个码表文件，核对有效定位和缺失高程数量', async () => {
  const directory = new URL('../FIT_example/', import.meta.url);
  const samples = (await readdir(directory)).filter(file => file.endsWith('.fit')).sort();
  const expected = [[10049, 1, 15], [7084, 1, 21], [12086, 1, 0], [8919, 2, 21], [8165, 2, 21], [8944, 1, 21], [9235, 1, 0]];
  const recordedAscent = [741, 346, 270, 330, 387, 421, 311];
  assert.equal(samples.length, expected.length);
  for (const [index, file] of samples.entries()) {
    const parsed = parseFitRoute(await readFile(new URL(file, directory)));
    assert.deepEqual([parsed.points.length, parsed.segmentStarts.length, parsed.points.filter(point => point.ele === null).length], expected[index], file);
    assert.deepEqual([parsed.stats.elevationGainM, parsed.stats.elevationLossM, parsed.stats.avgSlope, parsed.stats.maxSlope],
      [recordedAscent[index], null, null, null], file);
  }
});
