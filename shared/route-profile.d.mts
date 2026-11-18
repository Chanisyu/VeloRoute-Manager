import type { RoutePoint } from './storage-schema.mjs';
export interface ProfileRun { x: number[]; h: number[]; }
export interface RouteProfile { runs: ProfileRun[]; distance: number; minimum: number; maximum: number; }
/** @param points 原始点。 @param starts 分段首点。 @returns 独立有效高程区间和总里程，不改变原始数据。 */
export function buildRouteProfile(points: RoutePoint[], starts?: number[]): RouteProfile;
/** @param profile 剖面。 @param at 米制里程。 @returns 高程及可选完整20米平均坡度，无有效高程时为null。 */
export function sampleRouteProfile(profile: RouteProfile, at: number): { distance: number; elevation: number; grade: number | null } | null;
/** @param run 有效区间。 @param start 视窗起点。 @param end 视窗终点。 @param pixels 像素宽度。 @returns 保留峰谷的视窗绘制点。 */
export function visibleProfilePoints(run: ProfileRun, start: number, end: number, pixels: number): [number, number][];
/** @param start 起点。 @param span 宽度。 @param total 总长。 @returns 限制在路线范围内的视窗。 */
export function clampProfileWindow(start: number, span: number, total: number): [number, number];
/** @param window 视窗。 @param anchor 光标比例。 @param factor 倍数。 @param total 总长。 @returns 锚定光标里程的缩放视窗。 */
export function zoomProfileWindow(window: [number, number], anchor: number, factor: number, total: number): [number, number];
