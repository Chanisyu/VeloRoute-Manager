
import { Component, signal } from '@angular/core';
import { MapViewComponent } from './components/map-view.component';
import { ManagementViewComponent } from './components/management-view.component';
import { SettingsViewComponent } from './components/settings-view.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [MapViewComponent, ManagementViewComponent, SettingsViewComponent],
  template: `
    <main class="w-screen h-screen overflow-hidden relative">
      @if (currentMode() === 'map') {
        <app-map-view 
          (onManageClick)="setMode('manage')"
          (onRouteSelect)="goToManageWithRoute($event)"
        ></app-map-view>
      } @else if (currentMode() === 'manage') {
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
    </main>
  `
})
export class AppComponent {
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
