import { horizontalDistance } from './route-statistics.mjs';

const EPSILON = 1e-8;

/** @param {number[]} values 有序数列。 @param {number} value 目标。 @returns {number} 首个大于等于目标的位置，允许返回长度。 */
function lowerBound(values, value) {
  let a = 0; let b = values.length;
  while (a < b) { const m = (a + b) >>> 1; if (values[m] < value) a = m + 1; else b = m; }
  return a;
}

/**
 * 参照GPXStudio，以累计水平里程及原始高程生成剖面；不更改路线统计或持久化数据。
 * @param {import('./storage-schema.mjs').RoutePoint[]} points 原始点，缺高程为null。
 * @param {number[]|undefined} starts 原始分段；旧数据未知时仅沿用已有点序。
 * @returns {import('./route-profile.mjs').RouteProfile} 可绘制的独立有效区间；缺高程处断开，段间不增加虚构里程。
 */
export function buildRouteProfile(points, starts) {
  const runs = []; let distance = 0; let minimum = Infinity; let maximum = -Infinity;
  const boundaries = starts ?? (points.length ? [0] : []);
  for (let s = 0; s < boundaries.length; s++) {
    let x = []; let h = []; let group = [];
    /** @returns {void} 结束有效剖面区间；孤立点和零长度区间不绘制。 */
    const finishRun = () => {
      if (x.length >= 2 && x.at(-1) - x[0] > EPSILON) {
        runs.push({ x, h });
        for (const value of h) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
      }
      x = []; h = [];
    };
    /** @returns {void} 相同里程的连续位置用中位高程表示，避免生成垂直尖峰；不改变原始点。 */
    const flush = () => {
      if (!group.length) return;
      group.sort((a, b) => a - b); const m = group.length >>> 1;
      x.push(distance); h.push(group.length % 2 ? group[m] : (group[m - 1] + group[m]) / 2);
      group = [];
    };
    for (let i = boundaries[s]; i < (boundaries[s + 1] ?? points.length); i++) {
      const point = points[i];
      const delta = i === boundaries[s] ? 0 : horizontalDistance(points[i - 1], point);
      if (delta > EPSILON) { flush(); distance += delta; }
      if (point.ele === null || !Number.isFinite(point.ele)) { flush(); finishRun(); }
      else group.push(point.ele);
    }
    flush(); finishRun();
  }
  return { runs, distance, minimum: Number.isFinite(minimum) ? minimum : 0, maximum: Number.isFinite(maximum) ? maximum : 0 };
}

/** @param {import('./route-profile.mjs').ProfileRun} run 有效区间。 @param {number} at 区间内里程。 @returns {number} 分段线性插值，不外推、不生成保存点。 */
function elevationAt(run, at) {
  const right = lowerBound(run.x, at);
  if (right === 0) return run.h[0];
  if (right >= run.x.length) return run.h.at(-1);
  const left = right - 1;
  return run.h[left] + (run.h[right] - run.h[left]) * (at - run.x[left]) / (run.x[right] - run.x[left]);
}

/**
 * 读取光标位置的高程及完整20米平均坡度；与顶部100米最大坡度统计相互独立。
 * @param {import('./route-profile.mjs').RouteProfile} profile 剖面数据。
 * @param {number} at 累计米制里程。
 * @returns {{distance:number,elevation:number,grade:number|null}|null} 缺高程处不提供提示；不足前后各10米时省略坡度。
 */
export function sampleRouteProfile(profile, at) {
  // 各有效区间按里程排序；同里程的分段边界优先选择后一段，始终不跨段插值。
  let a = 0; let b = profile.runs.length;
  while (a < b) { const m = (a + b) >>> 1; if (profile.runs[m].x[0] <= at + EPSILON) a = m + 1; else b = m; }
  const run = profile.runs[a - 1];
  if (!run || at > run.x.at(-1) + EPSILON || at < run.x[0] - EPSILON) return null;
  const distance = Math.min(run.x.at(-1), Math.max(run.x[0], at));
  const grade = distance - 10 >= run.x[0] - EPSILON && distance + 10 <= run.x.at(-1) + EPSILON
    ? (elevationAt(run, distance + 10) - elevationAt(run, distance - 10)) / 20 * 100 : null;
  return { distance, elevation: elevationAt(run, distance), grade };
}

/**
 * 只抽取视窗内数据及边缘相邻点，按像素桶保留首尾和极值；悬停始终读取完整数据。
 * @param {import('./route-profile.mjs').ProfileRun} run 原始有效区间。
 * @param {number} start 视窗起点。 @param {number} end 视窗终点。 @param {number} pixels 图面宽度。
 * @returns {Array<[number,number]>} 保持原始先后顺序的绘制点，避免大文件每次输出全部节点。
 */
export function visibleProfilePoints(run, start, end, pixels) {
  if (end <= start || run.x.at(-1) < start || run.x[0] > end) return [];
  const first = Math.max(0, lowerBound(run.x, start) - 1);
  const last = Math.min(run.x.length - 1, lowerBound(run.x, end));
  const result = []; let bucket = null; let indices = [];
  /** @returns {void} 顺序输出桶内首点、最低点、最高点及末点，保留峰谷。 */
  const flush = () => {
    if (!indices.length) return;
    const selected = new Set([indices[0], indices.at(-1)]);
    let low = indices[0]; let high = low;
    for (const i of indices) { if (run.h[i] < run.h[low]) low = i; if (run.h[i] > run.h[high]) high = i; }
    selected.add(low); selected.add(high);
    for (const i of [...selected].sort((a, b) => a - b)) result.push([run.x[i], run.h[i]]);
    indices = [];
  };
  for (let i = first; i <= last; i++) {
    const next = Math.floor((run.x[i] - start) / (end - start) * Math.max(1, pixels));
    if (next !== bucket) { flush(); bucket = next; }
    indices.push(i);
  }
  flush(); return result;
}

/** @param {number} start 期望起点。 @param {number} span 期望宽度。 @param {number} total 全程长度。 @returns {[number,number]} 受路线边界约束的视窗，最小宽度10米或全程长度。 */
export function clampProfileWindow(start, span, total) {
  const width = Math.min(total, Math.max(Math.min(10, total), span));
  const left = Math.max(0, Math.min(total - width, start));
  return [left, left + width];
}

/** @param {[number,number]} window 当前视窗。 @param {number} anchor 光标比例0—1。 @param {number} factor 缩放倍数。 @param {number} total 总长度。 @returns {[number,number]} 以光标下的里程为锚点缩放。 */
export function zoomProfileWindow(window, anchor, factor, total) {
  const ratio = Math.max(0, Math.min(1, anchor));
  const span = Math.min(total, Math.max(Math.min(10, total), (window[1] - window[0]) * factor));
  return clampProfileWindow(window[0] + ratio * (window[1] - window[0]) - ratio * span, span, total);
}
