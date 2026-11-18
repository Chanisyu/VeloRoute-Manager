import type { RoutePoint, RouteStats } from './storage-schema.mjs';

/** FIT 轨迹、分段及以码表会话汇总为来源的高程统计。 */
export interface FitRoute { points: RoutePoint[]; segmentStarts: number[]; stats: RouteStats; }

/** @param bytes 完整活动或路线文件。 @returns 轨迹、分段和码表汇总，损坏或无可绘制轨迹时抛错。 */
export function parseFitRoute(bytes: ArrayBuffer | Uint8Array): FitRoute;
