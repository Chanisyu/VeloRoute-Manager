import { Injectable, signal, effect, NgZone, inject } from '@angular/core';
import {
  normalizeData, CURRENT_VERSION,
  type RouteStats, type RoutePoint, type RouteData, type Folder, type AppSettings,
  type AppData, type AppDataBackup, type LoadResult, type SaveResult
} from '../../shared/storage-schema.mjs';
import { loadBrowserData, saveBrowserData } from '../../shared/browser-storage.mjs';
export type { RouteData, Folder, RouteStats } from '../../shared/storage-schema.mjs';

export interface MapState {
  center: { lng: number; lat: number }; zoom: number; pitch: number; bearing: number;
}

/** 仅暴露固定数据操作与退出握手，不允许渲染进程传入文件路径或任意 IPC 通道。 */
interface ElectronAPI {
  saveData: (data: AppData) => Promise<SaveResult>;
  restoreData: (data: AppData) => Promise<SaveResult>;
  loadData: () => Promise<LoadResult>;
  onPrepareClose: (callback: (requestId: string) => void) => void;
  completeClose: (requestId: string, success: boolean) => void;
}

declare global {
  interface Window { electronAPI?: ElectronAPI; }
}

/** 管理全局路线状态及前端保存队列；读取、校验和持久化失败均通过独立状态反馈。 */
@Injectable({
  providedIn: 'root'
})
export class RouteService {
  // State
  folders = signal<Folder[]>([
    { id: '1', name: 'To Ride', isExpanded: true, color: '#ef4444' },
    { id: '2', name: 'Completed', isExpanded: true, color: '#8b5cf6' }, // Changed from green to violet for better contrast
    { id: '3', name: 'Hiking Plans', isExpanded: true, color: '#3b82f6' }
  ]);

  routes = signal<RouteData[]>([]);

  appSettings = signal<AppSettings>({
    mapboxApiKey: '',
    mapboxKeyValid: false,
    dontRemindMapbox: false,
    isComparisonMode: false
  });
  
  // Temporary state for map view persistence
  mapState = signal<MapState | null>(null);

  // Expose initialization state to components
  initialized = signal(false);

  saveStatus = signal<'loading' | 'saved' | 'pending' | 'saving' | 'error'>('loading');
  loadError = signal('');
  saveError = signal('');
  notice = signal('');
  operationError = signal('');
  restoring = signal(false);
  private zone = inject(NgZone);
  private loading: Promise<void>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: AppData | null = null;
  private saving: Promise<boolean> | null = null;
  private observed = '';
  private persisted = '';
  private closing = false;
  private restoreTask: Promise<boolean> | null = null;
  private imports = new Set<Promise<void>>();

  // A curated palette of high-contrast colors that stand out against 
  // Mapbox Outdoors (greens/creams) and Water (blues).
  // Excludes: Greens, Light Blues, Yellows, Beiges.
  private readonly SAFE_COLORS = [
    '#ef4444', // Red-500
    '#f97316', // Orange-500
    '#ec4899', // Pink-500
    '#a855f7', // Purple-500
    '#6366f1', // Indigo-500
    '#d946ef', // Fuchsia-500
    '#f43f5e', // Rose-500
    '#8b5cf6', // Violet-500
    '#be185d', // Pink-700
    '#4338ca', // Indigo-700
    '#1e40af', // Blue-800 (Dark enough to contrast with water)
    '#b91c1c', // Red-700
    '#c2410c', // Orange-700
    '#7e22ce', // Purple-700
    '#be123c', // Rose-700
    '#0f172a', // Slate-900 (Black/Dark Grey)
    '#854d0e', // Yellow-800 (Dark Brownish Gold)
  ];

  /** 建立自动保存与退出握手；读取未完成或损坏时不调度任何默认快照写入。 */
  constructor() {
    this.loading = this.initializeData();
    effect(() => {
      const data = this.snapshot();
      if (this.initialized() && !this.loadError() && !this.restoring()) this.scheduleSave(data);
    }, { allowSignalWrites: true });

    window.electronAPI?.onPrepareClose(requestId => {
      this.zone.run(() => {
        this.closing = true;
        void this.flushForClose().then(success => {
          window.electronAPI?.completeClose(requestId, success);
          this.closing = false;
        });
      });
    });
    window.addEventListener('beforeunload', event => {
      if (window.electronAPI) {
        // 正常桌面关闭由主进程握手处理；刷新时只在确有未保存内容时阻止离开。
        if (!this.closing && !this.loadError() && this.hasChanges()) event.returnValue = false;
      } else if (this.initialized() && !this.loadError()) {
        // 浏览器卸载不保证异步任务完成，直接同步写入单个完整快照。
        if (this.restoreTask || this.imports.size) {
          event.preventDefault(); event.returnValue = ''; return;
        }
        const result = this.saveBrowserSnapshot();
        if (!result.success) { event.preventDefault(); event.returnValue = ''; }
      }
    });
  }

  /** @returns {AppData} 当前业务快照；不包含临时地图视角或保存状态。 */
  private snapshot(): AppData {
    return { version: CURRENT_VERSION, folders: this.folders(), routes: this.routes(), settings: this.appSettings() };
  }

  /** @returns {boolean} 直接比较 Signal 状态，覆盖用户修改后立即关闭、effect 尚未运行的情况。 */
  private hasChanges(): boolean {
    return JSON.stringify(this.snapshot()) !== this.persisted;
  }

  /** @param {AppData} data 已完整校验的数据。 @returns {void} 一次应用全量状态，启动时重置比较视图。 */
  private applyData(data: AppData): void {
    this.folders.set(data.folders);
    this.routes.set(data.routes);
    this.appSettings.set({ ...data.settings, isComparisonMode: false });
  }

  /** @returns {Promise<void>} 区分首次启动与读取失败；桌面仅首次无文件时迁移历史浏览器镜像。 */
  initializeData(): Promise<void> {
    this.loading = this.readInitialData();
    return this.loading;
  }

  /** @returns {Promise<void>} 实际加载任务；与退出处理共享同一 Promise，重试时同样等待。 */
  private async readInitialData(): Promise<void> {
    this.initialized.set(false);
    this.loadError.set('');
    this.saveStatus.set('loading');
    try {
      let result = window.electronAPI ? await window.electronAPI.loadData() : loadBrowserData(localStorage);
      if (window.electronAPI && result.status === 'missing') {
        result = loadBrowserData(localStorage);
        if (result.status === 'ok' || result.status === 'recovered') result.needsMigration = true;
      }
      if (result.status === 'error') throw new Error(result.error);
      if (result.status === 'ok' || result.status === 'recovered') {
        this.applyData(normalizeData(result.data));
        this.notice.set(result.message ?? '');
      }
      const migration = (result.status === 'ok' || result.status === 'recovered') && result.needsMigration;
      this.persisted = migration ? '' : JSON.stringify(this.snapshot());
      this.observed = this.persisted;
      this.saveStatus.set('saved');
      this.saveError.set('');
      // Token 检查不得延迟数据加载和退出保存；网络失败只影响地图设置。
      const key = this.appSettings().mapboxApiKey;
      if (key) void this.validateMapboxKey(key);
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : '读取数据失败');
      this.saveStatus.set('error');
    } finally { this.initialized.set(true); }
  }

  /** @param {AppData} data 当前快照。 @returns {void} 合并 400ms 内的修改，保留最近一次快照。 */
  private scheduleSave(data: AppData): void {
    const fingerprint = JSON.stringify(data);
    if (fingerprint === this.observed) return;
    this.observed = fingerprint;
    this.pending = data;
    this.saveStatus.set('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flushSave(), 400);
  }

  /** @returns {SaveResult} 同步保存浏览器快照；失败不会把状态标记为已保存。 */
  private saveBrowserSnapshot(): SaveResult {
    if (!this.hasChanges()) return { success: true };
    try { return saveBrowserData(localStorage, this.snapshot()); }
    catch { return { success: false, error: '浏览器存储不可访问，请保留当前页面并导出备份。' }; }
  }

  /** @returns {Promise<boolean>} 串行清空最新快照，失败保留待保存数据供显式重试。 */
  private async flushSave(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.saving) return this.saving;
    this.saving = this.drainSaves();
    try { return await this.saving; }
    finally { this.saving = null; }
  }

  /** @returns {Promise<boolean>} 写入期间的新快照继续排队；旧请求完成不能覆盖较新的保存状态。 */
  private async drainSaves(): Promise<boolean> {
    while (this.pending) {
      const data = this.pending;
      this.pending = null;
      this.saveStatus.set('saving');
      try {
        const result = window.electronAPI
          ? await window.electronAPI.saveData(data)
          : saveBrowserData(localStorage, data);
        if (!result.success) throw new Error(result.error);
        this.persisted = JSON.stringify(data);
      } catch (error) {
        if (!this.pending) this.pending = data;
        this.saveError.set(error instanceof Error ? error.message : '保存失败');
        this.saveStatus.set('error');
        return false;
      }
    }
    this.saveError.set('');
    this.saveStatus.set('saved');
    return true;
  }

  /** @returns {Promise<boolean>} 使用当前状态重试失败写入，不要求用户重新编辑。 */
  async retrySave(): Promise<boolean> {
    if (this.loadError() || !this.initialized()) return false;
    this.pending = this.snapshot();
    return this.flushSave();
  }

  /** @returns {Promise<boolean>} 正常退出前等待读取及全部写入；读取失败但无法编辑时可安全退出。 */
  private async flushForClose(): Promise<boolean> {
    try {
      await this.loading;
      if (this.restoreTask) await this.restoreTask;
      await Promise.all([...this.imports]);
      if (this.loadError()) return true;
      if (this.hasChanges()) this.pending = this.snapshot();
      return await this.flushSave();
    } catch { return false; }
  }

  // --- Settings & Mapbox ---

  updateSettings(partial: Partial<AppSettings>) {
    this.appSettings.update(s => ({ ...s, ...partial }));
  }

  async validateMapboxKey(key: string): Promise<boolean> {
    if (!key) {
        this.updateSettings({ mapboxKeyValid: false });
        return false;
    }
    try {
        // Try to fetch a tile from Mapbox
        const url = `https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/1/1/1?access_token=${key}`;
        const res = await fetch(url);
        if (res.ok) {
            this.updateSettings({ mapboxApiKey: key, mapboxKeyValid: true });
            return true;
        } else {
            throw new Error('Invalid key');
        }
    } catch (e) {
        this.updateSettings({ mapboxKeyValid: false });
        return false;
    }
  }

  // --- Actions ---

  addFolder(name: string) {
    const newFolder: Folder = { 
        id: crypto.randomUUID(), 
        name, 
        isExpanded: true,
        color: this.getRandomColor() 
    };
    this.folders.update(f => [...f, newFolder]);
  }

  renameFolder(id: string, newName: string) {
      this.folders.update(folders => 
        folders.map(f => f.id === id ? { ...f, name: newName } : f)
      );
  }

  deleteFolder(id: string) {
    this.folders.update(f => f.filter(folder => folder.id !== id));
    this.routes.update(r => r.filter(route => route.folderId !== id));
  }

  toggleFolderExpansion(id: string) {
    this.folders.update(folders => 
      folders.map(f => f.id === id ? { ...f, isExpanded: !f.isExpanded } : f)
    );
  }

  updateRoute(updatedRoute: RouteData) {
    this.routes.update(routes => 
      routes.map(r => r.id === updatedRoute.id ? updatedRoute : r)
    );
  }

  deleteRoute(id: string) {
    this.routes.update(r => r.filter(route => route.id !== id));
  }

  toggleRouteVisibility(id: string, isVisible: boolean) {
    this.routes.update(routes => 
      routes.map(r => r.id === id ? { ...r, isVisible } : r)
    );
  }

  toggleFolderVisibility(folderId: string, isVisible: boolean) {
    this.routes.update(routes => 
      routes.map(r => r.folderId === folderId ? { ...r, isVisible } : r)
    );
  }

  // --- GPX Processing & Helper ---
  
  /** @returns {void} 导出含设置及时间戳的 v3 完整快照，不修改当前存储与保存队列。 */
  downloadBackup() {
    const data: AppDataBackup = {
      version: CURRENT_VERSION,
      timestamp: Date.now(),
      folders: this.folders(),
      routes: this.routes(),
      settings: this.appSettings()
    };
    
    const now = new Date();
    const filename = `velo_backup_${now.getTime()}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 完整校验后先持久化、再替换界面状态；格式或写入失败均保持当前路线不变。
   * @param {File} file 用户选择并确认恢复的 JSON 文件。
   * @returns {Promise<boolean>} 仅在目标存储实际保存成功后返回 true。
   */
  restoreBackup(file: File): Promise<boolean> {
    if (this.restoreTask) return this.restoreTask;
    this.restoring.set(true);
    this.restoreTask = this.performRestore(file).finally(() => {
      this.restoreTask = null;
      this.restoring.set(false);
    });
    return this.restoreTask;
  }

  /** @param {File} file 用户选定的备份。 @returns {Promise<boolean>} 在退出前必须等待的恢复事务。 */
  private async performRestore(file: File): Promise<boolean> {
    this.operationError.set('');
    let data: AppData;
    try { data = normalizeData(JSON.parse(await file.text())); }
    catch (error) {
      this.operationError.set(error instanceof Error ? error.message : '备份格式无效');
      return false;
    }
    await Promise.all([...this.imports]);
    clearTimeout(this.timer);
    try {
      // 先完成已发出的旧写入，取消尚未发出的旧快照，避免恢复成功后又被旧请求覆盖。
      if (this.saving) await this.saving;
      this.pending = null;
      const result = window.electronAPI
        ? await window.electronAPI.restoreData(data)
        : saveBrowserData(localStorage, data, true);
      if (!result.success) throw new Error(result.error);
      this.applyData(data);
      this.loadError.set('');
      this.notice.set('备份已恢复并保存。');
      this.persisted = JSON.stringify(this.snapshot());
      this.observed = this.persisted;
      this.saveError.set('');
      this.saveStatus.set('saved');
      return true;
    } catch (error) {
      this.operationError.set(error instanceof Error ? error.message : '恢复保存失败');
      // 恢复失败时保留原界面状态及其待保存内容，用户可以继续导出或重试。
      if (!this.loadError() && this.hasChanges()) {
        this.pending = this.snapshot();
        this.saveStatus.set('error');
        this.saveError.set('恢复未完成，当前修改仍未保存。');
      }
      return false;
    }
  }

  /** @param {File[]} files 批量 GPX。 @param {string} folderId 目标文件夹。 @returns {Promise<void>} 退出前可等待的导入任务。 */
  processGpxFiles(files: File[], folderId: string): Promise<void> {
    const task = this.importGpxFiles(files, folderId).finally(() => this.imports.delete(task));
    this.imports.add(task);
    return task;
  }

  /** @param {File[]} files 选定的轨迹。 @param {string} folderId 有效目标目录。 @returns {Promise<void>} 非法轨迹不进入应用状态。 */
  private async importGpxFiles(files: File[], folderId: string): Promise<void> {
    const newRoutes: RouteData[] = [];
    const currentRoutes = [...this.routes()];

    for (const file of files) {
      try {
        const text = await file.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");
        const trkpts = xmlDoc.getElementsByTagName('trkpt');
        const points: RoutePoint[] = [];

        for (let i = 0; i < trkpts.length; i++) {
          const pt = trkpts[i];
          const eleTag = pt.getElementsByTagName('ele')[0];
          points.push({
            lat: parseFloat(pt.getAttribute('lat') || '0'),
            lon: parseFloat(pt.getAttribute('lon') || '0'),
            ele: eleTag ? parseFloat(eleTag.textContent || '0') : 0
          });
        }
        if (points.length < 2) continue;
        const stats = this.calculateStats(points);
        const color = this.getDistinctColor([...currentRoutes, ...newRoutes]);

        const candidate: RouteData = {
          id: crypto.randomUUID(),
          name: file.name.replace('.gpx', ''),
          description: 'Imported from GPX',
          folderId, points, stats, color, isVisible: true
        };
        // 在改动共享状态前校验坐标及统计，避免一个非法文件使整份数据无法保存。
        normalizeData({ ...this.snapshot(), routes: [...this.routes(), ...newRoutes, candidate] });
        newRoutes.push(candidate);
      } catch (err) {
        this.operationError.set(err instanceof Error ? err.message : 'GPX 导入失败');
      }
    }
    if (newRoutes.length > 0 && this.folders().some(folder => folder.id === folderId)) {
      this.routes.update(r => [...r, ...newRoutes]);
    }
  }

  // Helper methods
  private calculateStats(points: RoutePoint[]): RouteStats {
     let distance = 0; let gain = 0; let loss = 0;
     let maxSlope = -Infinity; let minSlope = Infinity;
     let slopeSum = 0; let slopeCount = 0;

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]; const p2 = points[i+1];
      const d = this.haversine(p1.lat, p1.lon, p2.lat, p2.lon);
      if (d === 0) continue;
      distance += d;
      const eleDiff = p2.ele - p1.ele;
      if (eleDiff > 0) gain += eleDiff;
      if (eleDiff < 0) loss += Math.abs(eleDiff);
      const runMeters = d * 1000;
      const slope = (eleDiff / runMeters) * 100;
      if (Math.abs(slope) < 50) {
        if (slope > maxSlope) maxSlope = slope;
        if (slope < minSlope) minSlope = slope;
        slopeSum += slope; slopeCount++;
      }
    }
    return {
      distanceKm: parseFloat(distance.toFixed(2)),
      elevationGainM: Math.round(gain),
      elevationLossM: Math.round(loss),
      avgSlope: slopeCount > 0 ? parseFloat((slopeSum / slopeCount).toFixed(1)) : 0,
      maxSlope: maxSlope === -Infinity ? 0 : parseFloat(maxSlope.toFixed(1)),
      minSlope: minSlope === Infinity ? 0 : parseFloat(minSlope.toFixed(1)),
    };
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private getDistinctColor(existingRoutes: RouteData[]): string {
    const usedColors = new Set(existingRoutes.map(r => r.color.toLowerCase()));
    
    // 1. Try to find a Safe Color that hasn't been used yet
    for (const color of this.SAFE_COLORS) {
        if (!usedColors.has(color.toLowerCase())) {
            return color;
        }
    }
    
    // 2. If all are used, pick a random one from the safe list
    return this.getRandomColor();
  }

  private getRandomColor(): string {
     const index = Math.floor(Math.random() * this.SAFE_COLORS.length);
     return this.SAFE_COLORS[index];
  }
}
