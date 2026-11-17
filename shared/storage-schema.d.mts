/** 持久化数据契约；运行时仍需 normalizeData 校验，不能仅依赖静态类型。 */
export interface RouteStats {
  distanceKm: number; elevationGainM: number | null; elevationLossM: number | null;
  avgSlope: number | null; maxSlope: number | null; minSlope: number | null;
  algorithmVersion?: 1;
  warnings?: ('missing-elevation' | 'sparse-sampling' | 'duplicate-position')[];
}
export interface RoutePoint { lat: number; lon: number; ele: number | null; }
export interface RouteData {
  id: string; name: string; description: string; folderId: string;
  points: RoutePoint[]; stats: RouteStats; color: string; isVisible: boolean;
  /** 原始轨迹分段首点索引；历史缺省表示分段未知，不能猜测补齐。 */
  segmentStarts?: number[];
}
export interface Folder { id: string; name: string; isExpanded: boolean; color?: string; }
export interface AppSettings {
  mapboxApiKey: string; mapboxKeyValid: boolean; dontRemindMapbox: boolean; isComparisonMode: boolean;
}
export interface AppData { version: number; folders: Folder[]; routes: RouteData[]; settings: AppSettings; }
export interface AppDataBackup extends AppData { timestamp: number; }
export type LoadResult =
  | { status: 'ok' | 'recovered'; data: AppData; message?: string; needsMigration?: boolean }
  | { status: 'missing' }
  | { status: 'error'; error: string };
export type SaveResult = { success: true } | { success: false; error: string };
export const CURRENT_VERSION: 4;
export class DataValidationError extends Error { code: string; constructor(message: string, code?: string); }
/** 完整校验并迁移旧格式；未知版本及非法业务字段抛出 DataValidationError。 */
export function normalizeData(input: unknown): AppData;
