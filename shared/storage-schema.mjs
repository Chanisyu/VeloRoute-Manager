export const CURRENT_VERSION = 5;
// 校验提示使用界面上的中文字段名称，JSON 键名保留英文。
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
  "route.sourceFormat": "路线来源格式",
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
 * 将历史存储、备份或 IPC 输入规范化为 v5；保留旧统计，不在迁移时重新计算。
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
  requireValid(Number.isInteger(version) && version >= 1 && version <= CURRENT_VERSION, 'version');
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
    // v1 到 v4 只支持 GPX；v5 必须提供来源，避免丢失 FIT 来源后静默误标为 GPX。
    const sourceFormat = version < 5 && route.sourceFormat === undefined ? 'GPX' : route.sourceFormat;
    requireValid(sourceFormat === 'GPX' || sourceFormat === 'FIT', 'route.sourceFormat');
    requireValid(Array.isArray(route.points) && route.points.length >= 2, 'route.points 至少包含两个点');
    const points = Array.from(route.points).map(point => {
      requireValid(isRecord(point), 'point');
      const lat = finite(point.lat, 'point.lat');
      const lon = finite(point.lon, 'point.lon');
      requireValid(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180, '坐标超出范围');
      return { lat, lon, ele: version >= 4 && point.ele === null ? null : finite(point.ele === undefined && version < 3 ? 0 : point.ele, 'point.ele') };
    });
    // 旧格式已丢失分段，不能用 [0] 假装恢复；只有明确提供的分段才保留。
    let segmentStarts;
    if (route.segmentStarts !== undefined) {
      const starts = route.segmentStarts;
      requireValid(version >= 4 && Array.isArray(starts) && starts.length > 0 && starts[0] === 0
        && Array.from(starts).every((value, i) => Number.isInteger(value) && value >= 0 && value < points.length && (i === 0 || value > starts[i - 1])), '轨迹分段索引');
      segmentStarts = [...starts];
    }
    requireValid(isRecord(route.stats), 'route.stats');
    const currentStats = route.stats.algorithmVersion !== undefined;
    if (currentStats) requireValid(version >= 4 && route.stats.algorithmVersion === 1 && segmentStarts !== undefined, '统计算法版本或分段信息');
    const stats = {};
    for (const field of ['distanceKm', 'elevationGainM', 'elevationLossM', 'avgSlope', 'maxSlope', 'minSlope']) {
      const value = route.stats[field] === undefined && field === 'minSlope' && version < 3 ? 0 : route.stats[field];
      stats[field] = currentStats && field !== 'distanceKm' && value === null ? null : finite(value, `stats.${field}`);
    }
    requireValid(stats.distanceKm >= 0 && (stats.elevationGainM === null || stats.elevationGainM >= 0)
      && (stats.elevationLossM === null || stats.elevationLossM >= 0), '距离与累计升降不能为负');
    if (currentStats) {
      const warnings = route.stats.warnings;
      const allowed = ['missing-elevation', 'sparse-sampling', 'duplicate-position'];
      requireValid(Array.isArray(warnings) && Array.from(warnings).every(value => allowed.includes(value)) && new Set(warnings).size === warnings.length, '统计质量提示');
      const missing = points.some(point => point.ele === null);
      requireValid(warnings.includes('missing-elevation') === missing, '高程缺失提示');
      requireValid(missing ? ['elevationGainM', 'elevationLossM', 'avgSlope', 'maxSlope', 'minSlope'].every(key => stats[key] === null)
        : stats.elevationGainM !== null && stats.elevationLossM !== null && stats.avgSlope !== null, '高程统计可用性');
      requireValid((stats.avgSlope === null || stats.avgSlope >= 0) && (stats.maxSlope === null || stats.maxSlope >= 0)
        && (stats.minSlope === null || stats.minSlope <= 0) && (stats.maxSlope === null) === (stats.minSlope === null), '坡度统计范围');
      stats.algorithmVersion = 1; stats.warnings = [...warnings];
    } else requireValid(points.every(point => point.ele !== null), '旧版统计不支持缺失高程');
    return {
      id: identifier(route.id, routeIds), name: text(route.name, 'route.name'),
      description: text(route.description === undefined ? '' : route.description, 'route.description'), folderId: route.folderId,
      points, stats, sourceFormat, color: color(route.color, COLORS[i % COLORS.length]),
      isVisible: boolean(route.isVisible === undefined ? true : route.isVisible, 'route.isVisible'),
      ...(segmentStarts ? { segmentStarts } : {})
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
