import { Component, effect, inject, signal } from '@angular/core';
import { RouteService } from '../services/route.service';

/** 在所有页面提供可渐隐的保存反馈；进行中和错误状态保持可见，读取失败时提供安全恢复入口。 */
@Component({
  selector: 'app-storage-status', standalone: true,
  template: `
    @if (!service.initialized()) {
      <div class="fixed inset-0 z-[2000] bg-slate-50 grid place-items-center" role="status">正在读取数据…</div>
    } @else if (service.loadError()) {
      <section class="fixed inset-0 z-[2000] bg-slate-50 grid place-items-center p-8">
        <div class="max-w-xl bg-white rounded-xl shadow p-8 space-y-4">
          <h1 class="text-xl font-bold">数据读取失败</h1>
          <p role="alert">{{ service.loadError() }}</p>
          <p class="text-sm text-slate-600">已停止自动保存，原有数据不会被空内容覆盖。请选择有效备份恢复，或解决文件问题后重新读取。</p>
          <button class="bg-blue-600 text-white rounded px-4 py-2" (click)="service.initializeData()" [disabled]="service.restoring()">重试读取</button>
          <label class="block border rounded px-4 py-2 cursor-pointer">选择备份恢复
            <input data-testid="recovery-file" type="file" accept=".json" (change)="restore($event)" [disabled]="service.restoring()">
          </label>
          @if (service.operationError()) { <p role="alert" class="text-red-700">{{ service.operationError() }}</p> }
        </div>
      </section>
    } @else if (statusVisible()) {
      <aside class="fixed bottom-3 right-3 z-[2000] max-w-sm bg-white/95 border rounded-lg shadow p-3 text-xs transition-opacity duration-300 motion-reduce:transition-none"
        [class.opacity-0]="fading()" [class.pointer-events-none]="fading()" [attr.aria-hidden]="fading() ? 'true' : null"
        aria-label="保存状态" aria-live="polite">
        @if (service.restoring()) { <span>正在恢复备份…</span> }
        @else if (service.saveStatus() === 'saved') { <span>已保存</span> }
        @else if (service.saveStatus() === 'pending') { <span>等待保存…</span> }
        @else if (service.saveStatus() === 'saving') { <span>正在保存…</span> }
        @else if (service.saveStatus() === 'error') {
          <p role="alert" class="text-red-700">{{ service.saveError() }}</p>
          <button class="text-blue-700 underline mt-2" (click)="service.retrySave()">重试保存</button>
        }
        @if (service.notice()) { <p class="mt-2 text-amber-800">{{ service.notice() }}</p> }
        @if (service.operationError()) { <p role="alert" class="mt-2 text-red-700">{{ service.operationError() }}</p> }
      </aside>
    }
  `
})
export class StorageStatusComponent {
  service = inject(RouteService);
  statusVisible = signal(false);
  fading = signal(false);

  /**
   * 将展示计时与业务保存状态分离；正常反馈停留三秒后渐隐，进行中或错误状态不定时隐藏。
   * 无外部参数；新的状态、通知或组件销毁会清理旧计时，防止旧回调隐藏新反馈。
   */
  constructor() {
    effect(onCleanup => {
      const ready = this.service.initialized() && !this.service.loadError();
      const status = this.service.saveStatus();
      const restoring = this.service.restoring();
      const operationError = this.service.operationError();
      // 通知变化也应重新显示；普通恢复通知可能出现于保存状态仍为 saved 的情况下。
      this.service.notice();

      let fadeTimer: ReturnType<typeof setTimeout> | undefined;
      let hideTimer: ReturnType<typeof setTimeout> | undefined;
      onCleanup(() => { clearTimeout(fadeTimer); clearTimeout(hideTimer); });
      this.statusVisible.set(ready);
      this.fading.set(false);
      if (!ready || status !== 'saved' || restoring || operationError) return;

      fadeTimer = setTimeout(() => {
        // 渐隐开始即停止拦截地图操作，并从辅助技术的可见区域移除。
        this.fading.set(true);
        // 与模板 duration-300 一致；移除节点后不留下透明遮挡或可聚焦元素。
        hideTimer = setTimeout(() => this.statusVisible.set(false), 300);
      }, 3_000);
    }, { allowSignalWrites: true });
  }

  /** @param {Event} event 用户主动选中的恢复文件。 @returns {Promise<void>} 完整校验及保存失败由状态区反馈。 */
  async restore(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this.service.restoreBackup(file);
    input.value = '';
  }
}
