/**
 * 根据平台错误码生成中文说明；已有中文业务错误保留原意。
 * @param error 原始异常。
 * @param fallback 未知异常的中文说明，省略时使用通用操作失败提示。
 * @returns 可显示给用户的中文错误说明。
 */
export function describeError(error: unknown, fallback?: string): string;
