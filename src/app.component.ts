
import { Component, signal, inject } from '@angular/core';
import { RouteService } from './services/route.service';
import { StorageStatusComponent } from './component/storage-status.component';
// 使用仓库实际的 component 目录，保证 CLI 与桌面构建解析同一组视图。
import { MapViewComponent } from './component/map-view.component';
import { ManagementViewComponent } from './component/management-view.component';
import { SettingsViewComponent } from './component/settings-view.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [MapViewComponent, ManagementViewComponent, SettingsViewComponent, StorageStatusComponent],
  template: `
    <app-storage-status></app-storage-status>
    <main class="w-screen h-screen overflow-hidden relative" [attr.inert]="service.restoring() ? '' : null">
      @if (service.initialized() && !service.loadError()) {
      <!-- 保留 WebGL 画布的尺寸和图层。切页只隐藏地图，后台控件不接收鼠标或键盘输入。 -->
      <div class="absolute inset-0" [class.invisible]="currentMode() !== 'map'" [attr.inert]="currentMode() === 'map' ? null : ''">
        <app-map-view
          [active]="currentMode() === 'map'"
          (onManageClick)="setMode('manage')"
          (onSettingsClick)="setMode('settings')"
          (onRouteSelect)="goToManageWithRoute($event)"
        ></app-map-view>
      </div>
      @if (currentMode() === 'manage') {
        <app-management-view 
          [initialRouteId]="activeRouteId()"
          (onBack)="setMode('map')"
          (onSettings)="setMode('settings')"
        ></app-management-view>
      } @else if (currentMode() === 'settings') {
          <app-settings-view
            (onBack)="setMode('manage')"
          ></app-settings-view>
      }
      }
    </main>
  `
})
export class AppComponent {
  // 未完成读取或读取失败时不挂载业务视图，避免用户误编辑空数据。
  service = inject(RouteService);
  currentMode = signal<'map' | 'manage' | 'settings'>('map');
  activeRouteId = signal<string | undefined>(undefined);

  setMode(mode: 'map' | 'manage' | 'settings') {
    this.currentMode.set(mode);
    if (mode === 'map') {
        this.activeRouteId.set(undefined);
    }
  }

  goToManageWithRoute(routeId: string) {
    this.activeRouteId.set(routeId);
    this.currentMode.set('manage');
  }
}
