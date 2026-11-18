import { getFitBaseTypeId, readFitMessages, readFitUnsignedField } from 'fit-file-parser/raw';

const MESSAGE = { FILE_ID: 0, SESSION: 18, RECORD: 20, EVENT: 21 };
const TYPE = { ENUM: 0, SINT32: 5, UINT16: 4, UINT32: 6 };
const TIMER_BOUNDARY_TYPES = new Set([0, 1, 4, 8, 9]); // 开始、停止、全部停止、停止并禁用、全部停止并禁用。
const DEGREES_PER_SEMICIRCLE = 180 / 2 ** 31;

/**
 * 按消息声明的字节序读取 FIT 有符号坐标，将 semicircles 换算为十进制度。
 * @param {import('fit-file-parser/raw').FitRawMessage} message 轨迹记录。
 * @param {number} fieldNumber 纬度字段 0 或经度字段 1。
 * @param {number} limit 对应坐标允许的绝对角度上限。
 * @returns {number|undefined} 缺失、FIT 无效哨兵或越界时视为无有效定位。
 */
function position(message, fieldNumber, limit) {
  const field = message.fields.find(item => item.fieldNumber === fieldNumber);
  if (!field || field.size !== 4 || getFitBaseTypeId(field.baseType) !== TYPE.SINT32) return undefined;

  const raw = new DataView(field.bytes.buffer, field.bytes.byteOffset, field.size).getInt32(0, message.littleEndian);
  const degrees = raw * DEGREES_PER_SEMICIRCLE;
  return raw === 0x7fffffff || Math.abs(degrees) > limit ? undefined : degrees;
}

/**
 * 按 FIT 字段类型与字节序读取无符号值，交由解码库处理该类型的无效哨兵。
 * @param {import('fit-file-parser/raw').FitRawMessage} message 解码后的原始消息。
 * @param {number} fieldNumber FIT 字段编号。
 * @param {number} baseType FIT 基本类型编号。
 * @param {1|2|4} size 字段宽度（字节）。
 * @returns {number|undefined} 未缩放的值；缺失返回 undefined，定义与预期不符时抛错。
 */
function unsigned(message, fieldNumber, baseType, size) {
  const field = message.fields.find(item => item.fieldNumber === fieldNumber);
  return readFitUnsignedField(field, baseType, size, message.littleEndian);
}

/**
 * 严格校验并导入单个 FIT 活动或路线文件。仅投影定位及高程，按原始记录顺序保留轨迹点。
 * @param {ArrayBuffer|Uint8Array} bytes 文件完整内容，须含有效 CRC。
 * @returns {import('./fit-route.mjs').FitRoute} 至少有一段含两个有效定位点的轨迹；高程缺失为 null。
 * @throws {Error} 文件损坏、格式不受支持或没有可绘制的路线时拒绝导入。
 */
export function parseFitRoute(bytes) {
  let messages;
  try {
    ({ messages } = readFitMessages(bytes, { messageNumbers: Object.values(MESSAGE) }));
  } catch (error) {
    throw new Error('所选 FIT 文件校验失败，请检查文件是否完整。', { cause: error });
  }

  const fileId = messages.find(message => message.globalMessageNumber === MESSAGE.FILE_ID);
  const fileType = fileId && unsigned(fileId, 0, TYPE.ENUM, 1);
  if (fileType !== 4 && fileType !== 6) throw new Error('仅支持导入包含轨迹的 FIT 活动或路线文件。');

  // Session 汇总消息可能排在文件尾，预先收集其开始时间；首个会话不会产生额外边界。
  const sessionTimes = new Set();
  for (const message of messages) {
    if (message.globalMessageNumber !== MESSAGE.SESSION) continue;
    const start = unsigned(message, 2, TYPE.UINT32, 4);
    if (start !== undefined) sessionTimes.add(start);
  }
  const laterSessions = [...sessionTimes].sort((a, b) => a - b).slice(1);
  let nextSession = 0;
  let startsSegment = true;
  const points = [];
  const segmentStarts = [];

  for (const message of messages) {
    if (message.globalMessageNumber === MESSAGE.EVENT && unsigned(message, 0, TYPE.ENUM, 1) === 0
        && TIMER_BOUNDARY_TYPES.has(unsigned(message, 1, TYPE.ENUM, 1))) {
      startsSegment = true;
    }
    if (message.globalMessageNumber !== MESSAGE.RECORD) continue;

    // 使用可确认的会话、计时事件与缺定位边界，不按采样时间差猜测暂停。
    const timestamp = message.compressedTimestamp ?? message.timestamp;
    while (nextSession < laterSessions.length && timestamp !== undefined && timestamp >= laterSessions[nextSession]) {
      startsSegment = true;
      nextSession++;
    }
    const lat = position(message, 0, 90);
    const lon = position(message, 1, 180);
    if (lat === undefined || lon === undefined) {
      startsSegment = true;
      continue;
    }

    if (startsSegment) {
      segmentStarts.push(points.length);
      startsSegment = false;
    }
    // 优先采用增强高程；两种原始字段均使用 FIT 的比例 5、偏移 500 和米制单位。
    const altitude = unsigned(message, 78, TYPE.UINT32, 4) ?? unsigned(message, 2, TYPE.UINT16, 2);
    points.push({ lat, lon, ele: altitude === undefined ? null : altitude / 5 - 500 });
  }

  if (!segmentStarts.some((start, index) => (segmentStarts[index + 1] ?? points.length) - start >= 2)) {
    throw new Error('文件没有可用轨迹，请选择包含至少两个连续有效定位点的 FIT 文件。');
  }
  return { points, segmentStarts };
}
