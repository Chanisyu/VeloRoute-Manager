import { getFitBaseTypeId, readFitMessages, readFitUnsignedField } from 'fit-file-parser/raw';
import { horizontalDistance } from './route-statistics.mjs';

const MESSAGE = { FILE_ID: 0, SESSION: 18, RECORD: 20, EVENT: 21 };
const TYPE = { ENUM: 0, SINT16: 3, SINT32: 5, UINT16: 4, UINT32: 6 };
const SESSION_FIELD = { TOTAL_ASCENT: 22, TOTAL_DESCENT: 23, AVG_POS_GRADE: 53, MAX_POS_GRADE: 55 };
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
 * 读取可选的码表汇总字段。按 FIT Profile 将坡度从百分之一百分点转换为百分比。
 * @param {import('fit-file-parser/raw').FitRawMessage} session 活动会话汇总。
 * @param {number} fieldNumber 会话中的累计升降或正坡度字段编号。
 * @param {number} baseType 累计升降为 UINT16，坡度为 SINT16。
 * @returns {number|undefined} 缺失、无效哨兵或类型不合规的字段不可用；真实的零值保留。
 */
function sessionValue(session, fieldNumber, baseType) {
  const field = session.fields.find(item => item.fieldNumber === fieldNumber);
  if (!field || field.size !== 2 || getFitBaseTypeId(field.baseType) !== baseType) return undefined;

  if (baseType === TYPE.UINT16) return readFitUnsignedField(field, baseType, 2, session.littleEndian);
  const raw = new DataView(field.bytes.buffer, field.bytes.byteOffset, 2).getInt16(0, session.littleEndian);
  return raw === 0x7fff || raw < 0 ? undefined : raw / 100;
}

/**
 * 合并可覆盖全活动的会话汇总，单项缺失时不以部分会话冒充全程结果。
 * @param {import('fit-file-parser/raw').FitRawMessage[]} sessions 文件内的所有会话汇总。
 * @param {number} fieldNumber 要读取的会话字段。
 * @param {number} baseType 字段基本类型。
 * @param {(previous: number, value: number) => number} combine 总量相加，极值取最大。
 * @returns {number|null} 各会话均有有效字段时返回合并值，其他情况返回 null。
 */
function combineSessionValues(sessions, fieldNumber, baseType, combine) {
  if (!sessions.length) return null;
  let result = 0;
  for (const session of sessions) {
    const value = sessionValue(session, fieldNumber, baseType);
    if (value === undefined) return null;
    result = combine(result, value);
  }
  return result;
}

/**
 * 严格校验并导入单个 FIT 活动或路线文件，保留定位、高程、分段及码表汇总。
 * @param {ArrayBuffer|Uint8Array} bytes 文件完整内容，须含有效 CRC。
 * @returns {import('./fit-route.mjs').FitRoute} 可绘制轨迹和统计；未提供的海拔或设备指标为 null。
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
  const sessions = messages.filter(message => message.globalMessageNumber === MESSAGE.SESSION);
  const sessionTimes = new Set();
  for (const message of sessions) {
    const start = unsigned(message, 2, TYPE.UINT32, 4);
    if (start !== undefined) sessionTimes.add(start);
  }
  const laterSessions = [...sessionTimes].sort((a, b) => a - b).slice(1);
  let nextSession = 0;
  let startsSegment = true;
  let distanceM = 0;
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

    // 优先采用增强高程；两种原始字段均使用 FIT 的比例 5、偏移 500 和米制单位。
    const altitude = unsigned(message, 78, TYPE.UINT32, 4) ?? unsigned(message, 2, TYPE.UINT16, 2);
    const point = { lat, lon, ele: altitude === undefined ? null : altitude / 5 - 500 };
    if (startsSegment) {
      segmentStarts.push(points.length);
      startsSegment = false;
    } else {
      // 横向里程仍与绘制的轨迹对应，只累计段内距离。
      distanceM += horizontalDistance(points.at(-1), point);
    }
    points.push(point);
  }

  if (!segmentStarts.some((start, index) => (segmentStarts[index + 1] ?? points.length) - start >= 2)) {
    throw new Error('文件没有可用轨迹，请选择包含至少两个连续有效定位点的 FIT 文件。');
  }
  return {
    points, segmentStarts,
    stats: {
      source: 'fit-session',
      distanceKm: Math.round(distanceM / 10) / 100,
      elevationGainM: combineSessionValues(sessions, SESSION_FIELD.TOTAL_ASCENT, TYPE.UINT16, (a, b) => a + b),
      elevationLossM: combineSessionValues(sessions, SESSION_FIELD.TOTAL_DESCENT, TYPE.UINT16, (a, b) => a + b),
      // 设备未提供各会话的上坡里程权重，多个会话的平均上坡坡度无法直接合并。
      avgSlope: sessions.length === 1 ? sessionValue(sessions[0], SESSION_FIELD.AVG_POS_GRADE, TYPE.SINT16) ?? null : null,
      maxSlope: combineSessionValues(sessions, SESSION_FIELD.MAX_POS_GRADE, TYPE.SINT16, Math.max),
      minSlope: null
    }
  };
}
