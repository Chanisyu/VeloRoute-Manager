import type { RoutePoint, RouteStats } from './storage-schema.mjs';
export const STATISTICS_VERSION: 1;
/** @param a 起点。 @param b 终点。 @returns 球面水平距离，单位为米。 */
export function horizontalDistance(a: RoutePoint, b: RoutePoint): number;
/** @param x 严格递增的米制里程。 @param h 原始高程。 @returns 保留关键点的对称平滑高程，不修改输入。 */
export function smoothElevation(x: number[], h: number[]): number[];
/** @param x 有序里程。 @param h 原始高程。 @returns 保持匀坡的局部线性高程估计，供100米窗口使用。 */
export function smoothSlopeElevation(x: number[], h: number[]): number[];
/** @param points 原始点，缺高程为 null。 @param segmentStarts 含 0 的分段首点索引。 @returns 版本化统计；非法输入抛错，数据不足为 null。 */
export function calculateRouteStats(points: RoutePoint[], segmentStarts: number[]): RouteStats;
