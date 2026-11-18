import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, effect, input, output, signal } from '@angular/core';
import { gcj02towgs84, wgs84togcj02 } from 'coordtransform';
import type { MapState, RouteData } from '../services/route.service';
import type { AmapCredentials } from '../services/amap-settings.service';

type Coordinate = [number, number];
interface AmapRoute { route: RouteData; color: string; }

/** 高德 SDK 运行在无同源权限的子页，通过固定消息访问地图所需的显示数据。 */
@Component({
  selector: 'app-amap-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute inset-0 block bg-slate-100' },
  template: `
    <iframe #frame src="amap/index.html" sandbox="allow-scripts" title="高德地图"
        class="absolute inset-0 w-full h-full border-0" (load)="connect()"></iframe>
    @if (!ready() && active()) {
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div class="max-w-sm mx-4 rounded-lg bg-white shadow-lg border border-slate-200 p-4 text-center text-sm text-slate-700 pointer-events-auto">
          @if (failed()) {
            <p role="alert">高德地图加载失败，请检查网络和设置中的 Key、安全密钥及域名授权。</p>
            <button (click)="retry()" class="mt-3 text-blue-700 font-medium underline">重试加载高德地图</button>
          } @else {
            <p role="status">正在加载高德地图…</p>
          }
        </div>
      </div>
    }
  `
})
export class AmapViewComponent implements OnDestroy {
  @ViewChild('frame', { static: true }) private frame!: ElementRef<HTMLIFrameElement>;
  readonly credentials = input.required<AmapCredentials>();
  readonly camera = input<MapState | null>(null);
  readonly routes = input<AmapRoute[]>([]);
  readonly listHighlight = input<string>();
  readonly active = input(true);
  readonly hovered = output<string | undefined>();
  readonly selected = output<string>();
  readonly cameraChange = output<MapState>();
  protected readonly ready = signal(false);
  protected readonly failed = signal(false);
  private sent = new Map<string, AmapRoute>();
  private timeout?: ReturnType<typeof setTimeout>;
  private connected = false;

  /** 仅在地图已加载且可见时增量发送路线，控制消息与几何更新独立。 */
  constructor() {
    window.addEventListener('message', this.receive);
    effect(() => {
      if (!this.ready() || !this.active()) return;
      this.syncRoutes(this.routes());
    });
    effect(() => {
      if (this.ready()) this.send('interaction', { active: this.active(), highlight: this.listHighlight() });
    });
  }

  /** @returns 无返回值；子页加载后传入凭据和转换后的初始视角。 */
  protected connect(): void {
    // 只对本地入口的首次加载发送凭据，隔离页后续导航不能重复请求初始化。
    if (this.connected) return;
    this.connected = true;
    clearTimeout(this.timeout);
    this.ready.set(false);
    this.failed.set(false);
    this.sent.clear();
    const camera = this.camera();
    this.send('init', {
      credentials: this.credentials(),
      camera: camera && { center: wgs84togcj02(camera.center.lng, camera.center.lat), zoom: camera.zoom + 1 }
    });
    this.timeout = setTimeout(() => this.failed.set(true), 15000);
  }

  /** @returns 无返回值；重载隔离子页，清除上一次 SDK 加载状态。 */
  protected retry(): void {
    this.failed.set(false);
    this.connected = false;
    this.frame.nativeElement.src = 'amap/index.html';
  }

  /** @returns 无返回值；将高德相机调整到当前可见的路线范围。 */
  fitRoutes(): void {
    if (this.ready()) this.send('fit');
  }

  /** @param kind 子页支持的固定命令。 @param payload 命令所需的最小数据。 @returns 无返回值。 */
  private send(kind: string, payload: object = {}): void {
    // sandbox 子页使用不透明来源，指定目标 WindowProxy，接收方也校验发送方。
    this.frame.nativeElement.contentWindow?.postMessage({ channel: 'veloroute-amap', kind, ...payload }, '*');
  }

  /** @param event 子页反馈。 @returns 无返回值；忽略其他窗口的消息及地图不可见期间的交互。 */
  private readonly receive = (event: MessageEvent): void => {
    const data = event.data;
    if (event.source !== this.frame?.nativeElement.contentWindow || event.origin !== 'null' || data?.channel !== 'veloroute-amap') return;
    if (data.kind === 'ready' || data.kind === 'error') {
      clearTimeout(this.timeout);
      this.ready.set(data.kind === 'ready');
      this.failed.set(data.kind === 'error');
    }
    if (!this.active()) return;
    if (data.kind === 'hover') this.hovered.emit(this.sent.has(data.id) ? data.id : undefined);
    if (data.kind === 'select' && this.sent.has(data.id)) this.selected.emit(data.id);
    if (data.kind === 'camera' && [data.lng, data.lat, data.zoom].every(Number.isFinite)) {
      const [lng, lat] = gcj02towgs84(data.lng, data.lat);
      this.cameraChange.emit({ center: { lng, lat }, zoom: data.zoom - 1, bearing: 0, pitch: 0 });
    }
  };

  /** @param routes 已勾选的路线及当前颜色。 @returns 无返回值；仅传送新增或变化的字段，保留原始分段。 */
  private syncRoutes(routes: AmapRoute[]): void {
    const removed = new Set(this.sent.keys());
    const changed = [];
    for (const { route, color } of routes) {
      removed.delete(route.id);
      const previous = this.sent.get(route.id);
      if (previous?.route === route && previous.color === color) continue;
      let paths: Coordinate[][] | undefined;
      if (!previous || previous.route.points !== route.points || previous.route.segmentStarts !== route.segmentStarts) {
        // 本地转换显示坐标，保存数据及统计仍使用原始轨迹，分段间不画连线。
        paths = (route.segmentStarts ?? [0]).map((start, index, starts) => route.points
          .slice(start, starts[index + 1] ?? route.points.length)
          .map(point => wgs84togcj02(point.lon, point.lat))).filter(path => path.length >= 2);
      }
      changed.push({ id: route.id, name: route.name, distance: route.stats.distanceKm, color, paths });
      this.sent.set(route.id, { route, color });
    }
    for (const id of removed) this.sent.delete(id);
    if (changed.length || removed.size) this.send('routes', { changed, removed: [...removed] });
  }

  /** @returns 无返回值；移除父页面监听并让 iframe 随组件释放 SDK。 */
  ngOnDestroy(): void {
    clearTimeout(this.timeout);
    window.removeEventListener('message', this.receive);
  }
}
