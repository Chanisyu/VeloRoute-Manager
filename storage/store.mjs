import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeData, CURRENT_VERSION } from '../shared/storage-schema.mjs';

/**
 * 单进程串行 JSON 存储：同目录临时文件写入并同步后替换，保留上一份有效快照。
 * 所有读写走同一队列；读取失败默认禁止保存，显式恢复才允许替换损坏数据。
 */
export class AtomicStore {
  /** @param {string} file 正式文件绝对路径。 @param {typeof fs} io 文件系统适配器，故障测试可注入。 */
  constructor(file, io = fs) {
    this.file = file;
    this.backup = `${file}.bak`;
    this.io = io;
    this.queue = Promise.resolve();
    this.writable = false;
    this.repairAllowed = false;
  }

  /** @param {() => Promise<any>} operation 排队任务。 @returns {Promise<any>} 失败不会阻塞后续任务。 */
  enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  /** @param {string} file 文件路径。 @returns {Promise<object>} 区分不存在、解析错误和较新版本。 */
  async read(file) {
    try {
      const raw = await this.io.readFile(file, 'utf8');
      try {
        const parsed = JSON.parse(raw);
        return { status: 'ok', data: normalizeData(parsed), raw, needsMigration: parsed.version !== CURRENT_VERSION };
      } catch (error) {
        return { status: 'error', raw, error };
      }
    } catch (error) {
      return { status: error.code === 'ENOENT' ? 'missing' : 'error', error };
    }
  }

  /** @returns {Promise<import('../shared/storage-schema.mjs').LoadResult>} 只读加载，不以默认值覆盖任何文件。 */
  load() {
    return this.enqueue(async () => {
      this.writable = false;
      this.repairAllowed = false;
      const primary = await this.read(this.file);
      if (primary.status === 'ok') {
        this.writable = true;
        return { status: 'ok', data: primary.data, needsMigration: primary.needsMigration };
      }
      // 较新版本不是损坏；不能用旧备份悄悄回退，也不能随后自动保存旧格式。
      if (primary.error?.code === 'UNSUPPORTED_VERSION') return { status: 'error', error: primary.error.message };
      const backup = await this.read(this.backup);
      if (backup.status === 'ok') {
        this.writable = true;
        this.repairAllowed = true;
        return { status: 'recovered', data: backup.data, message: '主数据不可用，已读取上一份有效备份。原文件保留，后续保存前将另存保护副本。' };
      }
      if (primary.status === 'missing' && backup.status === 'missing') {
        this.writable = true;
        return { status: 'missing' };
      }
      return { status: 'error', error: '无法读取有效数据或备份。已暂停自动保存；请重试读取或导入有效备份，原文件保持不变。' };
    });
  }

  /**
   * 将字符串写入独占临时文件，flush 后在同目录替换目标；失败只清理本次临时文件。
   * @param {string} target 已确定的存储或备份路径。 @param {string} text 已校验的 JSON。
   * @returns {Promise<void>} 替换失败时保持原目标不变并向调用者抛错。
   */
  async replace(target, text) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await this.io.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      await this.io.rename(temporary, target);
    } finally {
      // 路径由本方法生成，只删除单个临时文件，不递归清理用户目录。
      await this.io.unlink(temporary).catch(() => {});
    }
  }

  /**
   * 排队保存完整快照；备份只接收已验证的正式数据，损坏文件另存而不污染有效备份。
   * @param {unknown} input 不可信的 IPC 数据。 @param {boolean} restore 是否由用户显式导入恢复。
   * @returns {Promise<import('../shared/storage-schema.mjs').SaveResult>} 文件失败转成可显示的结果。
   */
  save(input, restore = false) {
    let data;
    try { data = normalizeData(input); }
    catch (error) { return Promise.resolve({ success: false, error: error.message }); }
    return this.enqueue(async () => {
      try {
        if (!restore && !this.writable) throw new Error('数据尚未正确加载，禁止自动覆盖。');
        await this.io.mkdir(path.dirname(this.file), { recursive: true });
        const previous = await this.read(this.file);
        if (previous.status === 'ok') {
          await this.replace(this.backup, previous.raw);
        } else if (previous.status === 'error') {
          // 即使本次启动曾从备份恢复，也不能自动覆盖随后由其他工具写入的较新版本。
          if (!restore && previous.error?.code === 'UNSUPPORTED_VERSION') throw previous.error;
          if (!restore && !this.repairAllowed) throw new Error('正式数据发生读取错误，请重新读取或导入备份。');
          // 无法读取原字节（例如权限问题）时拒绝覆盖；保护副本必须先落盘成功。
          if (previous.raw === undefined) throw previous.error;
          await this.replace(`${this.file}.preserved-${Date.now()}-${randomUUID()}.json`, previous.raw);
        }
        await this.replace(this.file, JSON.stringify(data));
        this.writable = true;
        this.repairAllowed = false;
        return { success: true };
      } catch (error) {
        return { success: false, error: `保存失败：${error.message}` };
      }
    });
  }

  /** @returns {Promise<void>} 等待已接收写入完成，供正常退出流程调用。 */
  async drain() { await this.queue; }
}
