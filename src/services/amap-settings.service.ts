import { Injectable, signal } from '@angular/core';

/** 高德 JS API 的访问凭据，独立于可导出或恢复的路线设置。 */
export interface AmapCredentials {
  key: string;
  securityCode: string;
}

const SESSION_KEY = 'velo_amap_credentials';

/** 统一暴露高德设置。桌面使用系统加密，网页预览只在当前标签页保存。 */
@Injectable({ providedIn: 'root' })
export class AmapSettingsService {
  private readonly current = signal<AmapCredentials | null>(null);
  readonly credentials = this.current.asReadonly();
  readonly error = signal('');
  readonly busy = signal(true);

  /** 在地图与设置页共用服务时只读取一次本机凭据。 */
  constructor() {
    void this.load();
  }

  /** @returns 读取结束；凭据损坏时保留错误反馈与重新配置入口。 */
  private async load(): Promise<void> {
    try {
      const bridge = window.electronAPI;
      const stored = bridge?.loadAmapCredentials
        ? await bridge.loadAmapCredentials()
        : JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
      if (stored !== null && !this.isValid(stored)) throw new Error('高德配置格式无效');
      this.current.set(stored);
    } catch {
      this.error.set('无法读取高德地图配置，可重新输入并保存。');
    } finally {
      this.busy.set(false);
    }
  }

  /** @param credentials 输入的两项凭据，传 null 表示清除。 @returns 本机保存或清除成功时为 true。 */
  async save(credentials: AmapCredentials | null): Promise<boolean> {
    if (this.busy()) return false;
    this.error.set('');
    if (credentials && !this.isValid(credentials)) {
      this.error.set('请输入高德 Web 端 Key 和安全密钥。');
      return false;
    }
    this.busy.set(true);
    try {
      if (window.electronAPI?.saveAmapCredentials) await window.electronAPI.saveAmapCredentials(credentials);
      else if (credentials) sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials));
      else sessionStorage.removeItem(SESSION_KEY);
      this.current.set(credentials);
      return true;
    } catch {
      this.error.set('无法保存高德地图配置，请重试。');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** @param credentials 待读取或写入的配置。 @returns 两项凭据格式是否有效，联网授权在地图加载时验证。 */
  private isValid(credentials: AmapCredentials): boolean {
    return [credentials.key, credentials.securityCode].every(value =>
      typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value));
  }
}
