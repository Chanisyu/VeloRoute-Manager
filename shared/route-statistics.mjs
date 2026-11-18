/** 统计口径版本；参数、边界或指标含义变化时递增，不自动改写历史结果。 */
export const STATISTICS_VERSION = 1;
const EARTH_RADIUS_M = 6371008.8;
const EPSILON = 1e-8;
const WINDOW_M = 100;

/** @param {object} a 起点。 @param {object} b 终点。 @returns {number} 球面水平距离（米），钳制舍入误差以避免反三角函数越界。 */
export function horizontalDistance(a, b) {
  const rad = Math.PI / 180;
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, Math.max(0, x))));
}

/** @param {number[]} values 有序数组。 @param {number} value 查询值。 @returns {number} 首个不小于查询值的位置，可等于数组长度。 */
function lowerBound(values, value) {
  let left = 0; let right = values.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (values[middle] < value) left = middle + 1; else right = middle;
  }
  return left;
}

/**
 * 在里程—高程平面提取 RDP 关键点；20m 为轮廓偏差容差，并非逐点爬升扣减阈值。
 * @param {number[]} x 严格递增的米制里程。 @param {number[]} h 对应原始高程。
 * @returns {number[]} 包含首尾的关键点索引；等距极值全部保留，避免反向轨迹的择点偏差。
 */
function elevationAnchors(x, h) {
  const kept = new Set([0, x.length - 1]);
  const ranges = [[0, x.length - 1]];
  while (ranges.length) {
    const [a, b] = ranges.pop();
    if (b - a < 2) continue;
    const dx = x[b] - x[a]; const dh = h[b] - h[a];
    let maximum = 0; let candidates = [];
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((x[i] - x[a]) * dx + (h[i] - h[a]) * dh) / (dx * dx + dh * dh)));
      const error = Math.hypot(x[i] - x[a] - t * dx, h[i] - h[a] - t * dh);
      if (error > maximum + EPSILON) { maximum = error; candidates = [i]; }
      else if (Math.abs(error - maximum) <= EPSILON) candidates.push(i);
    }
    if (maximum <= 20 + EPSILON) continue;
    let previous = a;
    for (const i of candidates) { kept.add(i); ranges.push([previous, i]); previous = i; }
    ranges.push([previous, b]);
  }
  return [...kept].sort((a, b) => a - b);
}

/**
 * 参照 GPXStudio 的关键轮廓与前后各 100m 平滑；对区间线性趋势的残差求均值，保持匀坡。
 * @param {number[]} x 严格递增的里程。 @param {number[]} h 原始高程。
 * @returns {number[]} 新的统计高程数组；窗口对称限制在关键区间内，不修改原始点。
 */
export function smoothElevation(x, h) {
  if (x.length < 3) return [...h];
  const anchors = elevationAnchors(x, h);
  const result = [...h];
  for (let k = 1; k < anchors.length; k++) {
    const a = anchors[k - 1]; const b = anchors[k];
    const trend = (h[b] - h[a]) / (x[b] - x[a]);
    const residuals = [0];
    for (let i = a; i <= b; i++) residuals.push(residuals.at(-1) + (h[i] - h[a] - trend * (x[i] - x[a])));
    for (let i = a + 1; i < b; i++) {
      // 至少纳入相邻点；关键区间边界两侧采用相同限制，保持反向升降对称性。
      const left = Math.max(a, Math.min(i - 1, lowerBound(x, x[i] - WINDOW_M - EPSILON)));
      let right = lowerBound(x, x[i] + WINDOW_M + EPSILON);
      if (right === x.length || x[right] > x[i] + WINDOW_M + EPSILON) right--;
      right = Math.min(b, Math.max(i + 1, right));
      // 直接平均高程会将不足一个窗口的匀坡拉成平台，进而错误缩短上坡里程。
      // 保留端点定义的线性趋势，只抑制其上的局部起伏；原始高程仍完全不变。
      result[i] = h[a] + trend * (x[i] - x[a]) + (residuals[right - a + 1] - residuals[left - a]) / (right - left + 1);
    }
  }
  return result;
}

/** @param {number[]} x 有序里程。 @param {number[]} h 高程。 @param {number} at 段内位置。 @returns {number} 分段线性插值，不创建或保存虚构轨迹点。 */
function interpolate(x, h, at) {
  const right = lowerBound(x, at);
  if (right === 0) return h[0];
  if (right === x.length) return h.at(-1);
  const left = right - 1;
  return h[left] + (h[right] - h[left]) * (at - x[left]) / (x[right] - x[left]);
}

/**
 * 最大坡度使用前后各 50m 的局部线性回归高程，避免截断均值窗口把匀坡首尾人为变陡。
 * @param {number[]} x 无长采样缺口的里程。 @param {number[]} h 原始高程。
 * @returns {number[]} 回归在各原节点处的估计；至少采用相邻点，坐标相对中心化以控制消减误差。
 */
export function smoothSlopeElevation(x, h) {
  return x.map((center, i) => {
    const left = Math.min(i > 0 ? i - 1 : i, lowerBound(x, center - 50 - EPSILON));
    let right = lowerBound(x, center + 50 + EPSILON);
    if (right === x.length || x[right] > center + 50 + EPSILON) right--;
    right = Math.max(i < x.length - 1 ? i + 1 : i, right);
    const count = right - left + 1;
    let sx = 0; let sh = 0;
    for (let j = left; j <= right; j++) { sx += x[j] - center; sh += h[j]; }
    const mx = sx / count; const mh = sh / count;
    let variance = 0; let covariance = 0;
    for (let j = left; j <= right; j++) {
      const dx = x[j] - center - mx;
      variance += dx * dx; covariance += dx * (h[j] - mh);
    }
    return variance > EPSILON ? mh - covariance / variance * mx : h[i];
  });
}

/**
 * 求连续滑动 100m 窗口的坡度极值；差值曲线的拐点只在原节点及节点左移 100m 处。
 * @param {number[]} x 无采样缺口的里程。 @param {number[]} h 平滑高程。
 * @returns {[number, number]|null} 最大上坡及最小下坡百分比；不足完整窗口返回 null。
 */
function windowExtrema(x, h) {
  const start = x[0]; const end = x.at(-1) - WINDOW_M;
  if (end < start - EPSILON) return null;
  let maximum = 0; let minimum = 0;
  for (const at of [start, Math.max(start, end), ...x, ...x.map(value => value - WINDOW_M)]) {
    if (at < start - EPSILON || at > end + EPSILON) continue;
    const s = Math.max(start, Math.min(end, at));
    const grade = (interpolate(x, h, s + WINDOW_M) - interpolate(x, h, s)) * 100 / WINDOW_M;
    maximum = Math.max(maximum, grade); minimum = Math.min(minimum, grade);
  }
  return [maximum, minimum];
}

/**
 * 校验统计输入；历史路线缺少分段时须重新读取原始轨迹文件，不能猜测分段。
 * @param {object[]} points 原始点。 @param {number[]} segmentStarts 各段首点索引。
 * @returns {void} 坐标、高程或分段不合法时抛出中文异常，不产生部分结果。
 */
function validateInput(points, segmentStarts) {
  if (!Array.isArray(points) || !points.length || !Array.isArray(segmentStarts)
      || !segmentStarts.length || segmentStarts[0] !== 0
      || Array.from(segmentStarts).some((value, i) => !Number.isInteger(value) || value < 0 || value >= points.length || (i > 0 && value <= segmentStarts[i - 1]))) {
    throw new Error('轨迹分段信息无效，请重新导入原始轨迹文件。');
  }
  for (const point of points) {
    if (!point || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90
        || !Number.isFinite(point.lon) || Math.abs(point.lon) > 180
        || (point.ele !== null && !Number.isFinite(point.ele))) throw new Error('轨迹坐标或高程无效。');
  }
}

/**
 * 计算版本化路线统计；各段独立，保留原始点，升降按平滑高差累计，上坡均值按距离加权。
 * @param {import('./storage-schema.mjs').RoutePoint[]} points 原始坐标与高程，缺失高程为 null。
 * @param {number[]} segmentStarts 分段起点，必须显式给出且包含 0。
 * @returns {import('./storage-schema.mjs').RouteStats} 米、公里和百分比；缺高程或缺窗口返回 null，而非伪造零值。
 */
export function calculateRouteStats(points, segmentStarts) {
  validateInput(points, segmentStarts);
  const warnings = new Set();
  const missing = points.some(point => point.ele === null);
  if (missing) warnings.add('missing-elevation');
  let distance = 0; let gain = 0; let loss = 0; let uphillDistance = 0;
  let maximum = null; let minimum = null;
  for (let s = 0; s < segmentStarts.length; s++) {
    const start = segmentStarts[s]; const end = segmentStarts[s + 1] ?? points.length;
    const x = []; const h = []; let position = 0; let group = [];
    // 重复位置按组的中位高程参与统计，避免零水平距离的海拔抖动产生无限坡度。
    // 原始点仍逐个保留；正反向遍历采用同一代表值，不通过覆写首点引入方向偏差。
    /** @returns {void} 将当前重复位置组写入统计剖面；空组直接跳过。 */
    const flushGroup = () => {
      if (!group.length) return;
      group.sort((a, b) => a - b);
      const mid = group.length >>> 1;
      x.push(position); h.push(group.length % 2 ? group[mid] : (group[mid - 1] + group[mid]) / 2);
      group = [];
    };
    for (let i = start; i < end; i++) {
      const d = i === start ? 0 : horizontalDistance(points[i - 1], points[i]);
      if (i > start && d > EPSILON) { flushGroup(); position += d; }
      else if (i > start) warnings.add('duplicate-position');
      distance += d;
      if (d > WINDOW_M + EPSILON) warnings.add('sparse-sampling');
      if (!missing) group.push(points[i].ele);
    }
    flushGroup();
    if (missing) continue;
    const smoothed = smoothElevation(x, h);
    for (let i = 1; i < x.length; i++) {
      const delta = smoothed[i] - smoothed[i - 1];
      if (delta > EPSILON) { gain += delta; uphillDistance += x[i] - x[i - 1]; }
      else if (delta < -EPSILON) loss -= delta;
    }
    // 最大坡度只在原始点间距不超过 100m 的连续覆盖区间求取；长缺口不能靠插值补成实测。
    let a = 0;
    for (let b = 1; b <= x.length; b++) {
      if (b < x.length && x[b] - x[b - 1] <= WINDOW_M + EPSILON) continue;
      const runX = x.slice(a, b); const runH = smoothSlopeElevation(runX, h.slice(a, b));
      const extremes = runX.length > 1 ? windowExtrema(runX, runH) : null;
      if (extremes) {
        maximum = Math.max(maximum ?? 0, extremes[0]); minimum = Math.min(minimum ?? 0, extremes[1]);
      }
      a = b;
    }
  }
  if (![distance, gain, loss, uphillDistance, maximum ?? 0, minimum ?? 0].every(Number.isFinite)) {
    throw new Error('轨迹数值超出可计算范围，请检查原始高程。');
  }
  /** @param {number} value 百分比。 @returns {number} 一位小数，消除负零。 */
  const round = value => {
    const rounded = Math.round(value * 10) / 10;
    if (!Number.isFinite(rounded)) throw new Error('轨迹数值超出可计算范围，请检查原始高程。');
    return rounded || 0;
  };
  return {
    distanceKm: Math.round(distance / 10) / 100,
    elevationGainM: missing ? null : Math.round(gain), elevationLossM: missing ? null : Math.round(loss),
    avgSlope: missing ? null : round(uphillDistance ? 100 * gain / uphillDistance : 0),
    maxSlope: missing || maximum === null ? null : round(maximum),
    minSlope: missing || minimum === null ? null : round(minimum),
    algorithmVersion: STATISTICS_VERSION, warnings: [...warnings].sort()
  };
}
