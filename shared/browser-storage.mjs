import { describeError } from './user-messages.mjs';
import { normalizeData, CURRENT_VERSION } from './storage-schema.mjs';

export const DATA_KEY = 'velo_data';
export const BACKUP_KEY = 'velo_data_backup';

/** @param {string|null} raw 单个存储值。 @returns {object} 解析结果，保留未知版本错误以阻止回退。 */
function parse(raw) {
  if (raw === null) return { status: 'missing' };
  try {
    const value = JSON.parse(raw);
    return { status: 'ok', data: normalizeData(value), needsMigration: value.version !== CURRENT_VERSION };
  } catch (error) { return { status: 'error', error }; }
}

/**
 * 优先读取完整快照；仅在新键与备份均不存在时迁移历史三个键，损坏时不读过期镜像。
 * @param {Storage} storage 浏览器 Storage 适配器。 @returns {import('./storage-schema.mjs').LoadResult} 无写入副作用。
 */
export function loadBrowserData(storage) {
  try {
    const primary = parse(storage.getItem(DATA_KEY));
    if (primary.status === 'ok') return primary;
    if (primary.error?.code === 'UNSUPPORTED_VERSION') return { status: 'error', error: primary.error.message };
    const backup = parse(storage.getItem(BACKUP_KEY));
    if (backup.status === 'ok') return { status: 'recovered', data: backup.data, message: '主数据不可用，已读取浏览器中的上一份有效备份。' };
    if (primary.status !== 'missing' || backup.status !== 'missing') throw new Error('主数据和备份均不可用');
    const folders = storage.getItem('velo_folders');
    const routes = storage.getItem('velo_routes');
    const settings = storage.getItem('velo_settings');
    if ([folders, routes, settings].every(value => value === null)) return { status: 'missing' };
    return {
      status: 'ok', needsMigration: true,
      data: normalizeData({ folders: JSON.parse(folders ?? '[]'), routes: JSON.parse(routes ?? '[]'), settings: JSON.parse(settings ?? '{}') })
    };
  } catch (error) {
    return { status: 'error', error: `无法读取浏览器数据：${describeError(error).replace(/。$/, '')}。已暂停自动保存，请重试或导入有效备份。` };
  }
}

/**
 * 以单次 setItem 替换完整快照，避免三个键写入一半；保留上一份有效数据及损坏原文。
 * @param {Storage} storage 浏览器适配器。 @param {unknown} input 待保存数据。
 * @param {boolean} restore 是否为用户显式恢复。 @returns {import('./storage-schema.mjs').SaveResult} 包括容量、权限与格式错误。
 */
export function saveBrowserData(storage, input, restore = false) {
  try {
    const data = normalizeData(input);
    const previous = storage.getItem(DATA_KEY);
    const parsed = parse(previous);
    if (parsed.status === 'ok') storage.setItem(BACKUP_KEY, previous);
    else if (previous !== null) {
      if (!restore && loadBrowserData(storage).status !== 'recovered') throw new Error('现有数据不可用，禁止自动覆盖');
      storage.setItem(`velo_data_preserved_${crypto.randomUUID()}`, previous);
    }
    storage.setItem(DATA_KEY, JSON.stringify(data));
    return { success: true };
  } catch (error) { return { success: false, error: `保存失败：${describeError(error)}` }; }
}
