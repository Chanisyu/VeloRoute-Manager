import type { LoadResult, SaveResult } from './storage-schema.mjs';
export const DATA_KEY: 'velo_data';
export const BACKUP_KEY: 'velo_data_backup';
/** 读取完整快照，或在新键不存在时校验历史三个键。 */
export function loadBrowserData(storage: Storage): LoadResult;
/** 校验后一次性替换完整快照；显式恢复允许保护原文后替换损坏内容。 */
export function saveBrowserData(storage: Storage, input: unknown, restore?: boolean): SaveResult;
