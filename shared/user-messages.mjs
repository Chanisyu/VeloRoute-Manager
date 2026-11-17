/**
 * 将平台错误转换为用户可读的中文，不改变错误类型、存储分支或重试策略。
 * @param {unknown} error 原始异常。 @param {string} fallback 未知异常的中文说明。
 * @returns {string} 已有中文业务错误原样保留；系统错误按错误码给出可执行提示。
 */
export function describeError(error, fallback = '操作未完成，请稍后重试。') {
  const messages = {
    EACCES: '没有读写权限，请检查数据目录的访问权限。',
    EPERM: '文件操作被拒绝，请检查权限或文件占用情况。',
    EBUSY: '文件正被其他程序占用，请解除占用后重试。',
    ENOSPC: '磁盘空间不足，请释放空间后重试。',
    EDQUOT: '存储配额不足，请释放空间后重试。',
    EIO: '读写存储设备失败，请检查设备状态后重试。',
    ENOENT: '所需文件或目录不存在，请检查后重试。',
    QuotaExceededError: '浏览器存储空间不足，请导出备份并释放空间后重试。',
    SecurityError: '浏览器不允许访问本地存储，请检查站点存储权限。',
    SyntaxError: '文件不是有效的 JSON 格式，请选择正确的备份文件。'
  };
  // DOMException 还带有历史数字 code，不能让它遮蔽 QuotaExceededError 等有效名称。
  for (const code of [error?.code, error?.name]) {
    if (Object.hasOwn(messages, code)) return messages[code];
  }
  if (typeof error?.message === 'string' && /^[\u3400-\u9fff]/.test(error.message)) return error.message;
  return fallback;
}
