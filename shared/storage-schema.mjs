export const CURRENT_VERSION = 3;
// 仅翻译校验提示中的字段名称；JSON 键名与数据迁移规则保持原样。
const FIELD_LABELS = {
  "id": "标识符",
  "id 为空或重复": "标识符为空或重复",
  "version": "数据版本",
  "folders/routes": "文件夹和路线列表",
  "timestamp": "备份时间",
  "folder": "文件夹",
  "folder.name": "文件夹名称",
  "folder.isExpanded": "文件夹展开状态",
  "color": "路线或文件夹颜色",
  "route": "路线",
  "route.folderId 未关联有效文件夹": "路线所属文件夹不存在",
  "route.points 至少包含两个点": "路线轨迹至少需要两个点",
  "point": "轨迹点",
  "point.lat": "纬度",
  "point.lon": "经度",
  "point.ele": "海拔",
  "route.stats": "路线统计数据",
  "stats.distanceKm": "路线距离",
  "stats.elevationGainM": "累计爬升",
  "stats.elevationLossM": "累计下降",
  "stats.avgSlope": "平均坡度",
  "stats.maxSlope": "最大坡度",
  "stats.minSlope": "最小坡度",
  "route.name": "路线名称",
  "route.description": "路线简介",
  "route.isVisible": "路线显示状态",
  "settings": "应用设置",
  "settings.mapboxApiKey": "Mapbox 访问令牌",
  "settings.mapboxKeyValid": "访问令牌校验状态",
  "settings.dontRemindMapbox": "不再提醒设置",
  "settings.isComparisonMode": "文件夹对比模式"
};
const COLORS = ['#ef4444', '#8b5cf6', '#3b82f6'];

/** 标记数据校验错误；较新版本必须阻止自动回退，避免以旧格式覆盖新数据。 */
export class DataValidationError extends Error {
  /** @param {string} message 字段错误说明。 @param {string} code 可供恢复策略识别的错误码。 */
  constructor(message, code = 'INVALID_DATA') {
    super(message);
    this.code = code;
  }
}

/** @param {boolean} condition 字段是否有效。 @param {string} field 内部字段路径或业务错误。 @returns {void} 无效时抛错。 */
function requireValid(condition, field) {
  if (!condition) throw new DataValidationError(`数据无效：${FIELD_LABELS[field] ?? field}`);
}

/** @param {unknown} value 待校验对象。 @returns {boolean} 排除数组、空值及其他原始类型。 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value 字符串值。 @param {string} field 字段路径。 @returns {string} 校验后的原值。 */
function text(value, field) {
  requireValid(typeof value === 'string', field);
  return value;
}

/** @param {unknown} value 数值。 @param {string} field 字段路径。 @returns {number} 拒绝 NaN、无穷和隐式转换。 */
function finite(value, field) {
  requireValid(typeof value === 'number' && Number.isFinite(value), field);
  return value;
}

/** @param {unknown} value 布尔值。 @param {string} field 字段路径。 @returns {boolean} 校验后的原值。 */
function boolean(value, field) {
  requireValid(typeof value === 'boolean', field);
  return value;
}

/** @param {unknown} value 标识符。 @param {Set<string>} ids 同类对象已使用的 ID。 @returns {string} 非空且唯一的 ID。 */
function identifier(value, ids) {
  const id = text(value, 'id');
  requireValid(id.trim().length > 0 && !ids.has(id), 'id 为空或重复');
  ids.add(id);
  return id;
}

/** @param {unknown} value 颜色。 @param {string} fallback 历史数据缺省色。 @returns {string} 安全的十六进制颜色。 */
function color(value, fallback) {
  const result = value === undefined ? fallback : value;
  requireValid(typeof result === 'string' && /^#[0-9a-f]{6}$/i.test(result), 'color');
  return result;
}

/**
 * 将历史存储、备份或 IPC 输入规范化为 v3；完整校验后才返回全新的对象。
 * 旧数据缺少的界面字段使用兼容默认值；业务坐标、统计与关联错误不得静默修复。
 * @param {unknown} input 待读取或保存的数据，不信任其 TypeScript 类型。
 * @returns {import('./storage-schema.mjs').AppData} 可安全持久化的快照。
 */
export function normalizeData(input) {
  requireValid(isRecord(input), '根对象');
  const version = input.version === undefined ? 1 : input.version;
  if (typeof version === 'number' && version > CURRENT_VERSION) {
    throw new DataValidationError('数据版本较新，请使用兼容版本的软件读取。', 'UNSUPPORTED_VERSION');
  }
  requireValid([1, 2, 3].includes(version), 'version');
  requireValid(Array.isArray(input.folders) && Array.isArray(input.routes), 'folders/routes');
  if (input.timestamp !== undefined) requireValid(finite(input.timestamp, 'timestamp') >= 0, 'timestamp');
  const folderIds = new Set();
  const routeIds = new Set();
  const folders = input.folders.map((folder, i) => {
    requireValid(isRecord(folder), 'folder');
    return {
      id: identifier(folder.id, folderIds), name: text(folder.name, 'folder.name'),
      isExpanded: boolean(folder.isExpanded === undefined ? true : folder.isExpanded, 'folder.isExpanded'),
      color: color(folder.color, COLORS[i % COLORS.length])
    };
  });
  const routes = input.routes.map((route, i) => {
    requireValid(isRecord(route), 'route');
    requireValid(folderIds.has(route.folderId), 'route.folderId 未关联有效文件夹');
    requireValid(Array.isArray(route.points) && route.points.length >= 2, 'route.points 至少包含两个点');
    const points = route.points.map(point => {
      requireValid(isRecord(point), 'point');
      const lat = finite(point.lat, 'point.lat');
      const lon = finite(point.lon, 'point.lon');
      requireValid(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180, '坐标超出范围');
      return { lat, lon, ele: finite(point.ele === undefined && version < 3 ? 0 : point.ele, 'point.ele') };
    });
    requireValid(isRecord(route.stats), 'route.stats');
    const stats = {};
    for (const field of ['distanceKm', 'elevationGainM', 'elevationLossM', 'avgSlope', 'maxSlope', 'minSlope']) {
      stats[field] = finite(route.stats[field] === undefined && field === 'minSlope' && version < 3 ? 0 : route.stats[field], `stats.${field}`);
    }
    requireValid(stats.distanceKm >= 0 && stats.elevationGainM >= 0 && stats.elevationLossM >= 0, '距离与累计升降不能为负');
    return {
      id: identifier(route.id, routeIds), name: text(route.name, 'route.name'),
      description: text(route.description === undefined ? '' : route.description, 'route.description'), folderId: route.folderId,
      points, stats, color: color(route.color, COLORS[i % COLORS.length]),
      isVisible: boolean(route.isVisible === undefined ? true : route.isVisible, 'route.isVisible')
    };
  });
  const settings = input.settings === undefined ? {} : input.settings;
  requireValid(isRecord(settings), 'settings');
  return {
    version: CURRENT_VERSION, folders, routes,
    settings: {
      mapboxApiKey: text(settings.mapboxApiKey === undefined ? '' : settings.mapboxApiKey, 'settings.mapboxApiKey'),
      mapboxKeyValid: boolean(settings.mapboxKeyValid === undefined ? false : settings.mapboxKeyValid, 'settings.mapboxKeyValid'),
      dontRemindMapbox: boolean(settings.dontRemindMapbox === undefined ? false : settings.dontRemindMapbox, 'settings.dontRemindMapbox'),
      isComparisonMode: boolean(settings.isComparisonMode === undefined ? false : settings.isComparisonMode, 'settings.isComparisonMode')
    }
  };
}
