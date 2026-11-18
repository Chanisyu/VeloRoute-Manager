import type { RoutePoint } from './storage-schema.mjs';

/** 已转换为经纬度与米制高程的 FIT 原始轨迹，分段以首点索引表示。 */
export interface FitRoute { points: RoutePoint[]; segmentStarts: number[]; }

/** @param bytes 完整活动或路线文件。 @returns 保序轨迹及分段，损坏或无可绘制轨迹时抛错。 */
export function parseFitRoute(bytes: ArrayBuffer | Uint8Array): FitRoute;
