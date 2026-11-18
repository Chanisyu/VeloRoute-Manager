
import { Component, ElementRef, OnInit, ViewChild, OnDestroy, inject, effect, output, signal, NgZone } from '@angular/core';
import { RouteService, RouteData } from '../services/route.service';
import { FormsModule } from '@angular/forms';

declare const mapboxgl: any;
const ROUTE_LINE_WIDTH = 4;
const ROUTE_LINE_OPACITY = 0.85;

/** 地图命中事件中供路线悬浮使用的坐标与属性。 */
interface RouteMapHoverEvent {
  lngLat: { lng: number; lat: number };
  features?: Array<{ properties?: { description?: unknown } }>;
}

/** Mapbox 3.9.4 内置控件的中文文案；仅覆盖显示文本，不修改地图事件和地理数据。 */
const MAPBOX_ZH_CN = {
  'AttributionControl.ToggleAttribution': '显示或隐藏地图版权信息',
  'FullscreenControl.Enter': '进入全屏',
  'FullscreenControl.Exit': '退出全屏',
  'GeolocateControl.FindMyLocation': '定位到当前位置',
  'GeolocateControl.LocationNotAvailable': '无法获取当前位置',
  'LogoControl.Title': 'Mapbox 官网',
  'Map.Title': '地图',
  'NavigationControl.ResetBearing': '恢复正北方向',
  'NavigationControl.ZoomIn': '放大',
  'NavigationControl.ZoomOut': '缩小',
  'ScrollZoomBlocker.CtrlMessage': '按住 Ctrl 并滚动以缩放地图',
  'ScrollZoomBlocker.CmdMessage': '按住 ⌘ 并滚动以缩放地图',
  'TouchPanBlocker.Message': '使用双指移动地图'
};

@Component({
  selector: 'app-map-view',
  standalone: true,
  imports: [FormsModule],
  host: { 'class': 'block w-full h-full' },
  template: `
    <div class="relative w-full h-full">
      <!-- Map Container -->
      <!-- 'image-rendering: optimize-contrast' helps with sharpness on some WebKit screens -->
      <div #mapContainer class="w-full h-full z-0" style="image-rendering: -webkit-optimize-contrast;"></div>

      <!-- 底图切换：选项名称保留英文原名，操作提示使用中文。 -->
      <div class="absolute top-[110px] left-[10px] z-[400] group" (mouseenter)="handleMenuEnter()" (mouseleave)="handleMenuLeave()">
        
        <!-- Trigger Button -->
        <div title="切换底图" class="w-[34px] h-[34px] bg-white rounded border-2 border-[rgba(0,0,0,0.2)] bg-clip-padding flex items-center justify-center cursor-pointer hover:bg-slate-50 shadow-sm transition-colors text-slate-700">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
        </div>

        <!-- Dropdown Menu -->
        @if (menuRendered()) {
            <div class="absolute top-0 left-full pl-2 w-56 transition-opacity duration-300"
                 [class.opacity-0]="!menuVisible()"
                 [class.opacity-100]="menuVisible()">
                
                <div class="bg-white shadow-lg rounded border border-slate-200 overflow-hidden">
                    <div class="p-1 space-y-1">
                        <button (click)="changeBaseLayer('mapbox_outdoors')" [class.bg-blue-50]="currentLayer === 'mapbox_outdoors'" class="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 rounded hover:bg-slate-100 flex items-center gap-2">
                            <span class="w-3 h-3 rounded-full border border-slate-300 bg-green-100"></span> Outdoors (3D)
                        </button>
                        
                        <!-- OpenStreetMap Option -->
                        <button (click)="changeBaseLayer('osm')" [class.bg-blue-50]="currentLayer === 'osm'" class="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 rounded hover:bg-slate-100 flex items-center gap-2">
                            <span class="w-3 h-3 rounded-full border border-slate-300 bg-orange-100"></span> OpenStreetMap
                        </button>
                    </div>
                </div>
            </div>
        }
      </div>

      <!-- Quick Toggle Overlay (Top Right) -->
      <div class="absolute top-4 right-4 z-[500] bg-white/95 backdrop-blur rounded-lg shadow-xl p-3 max-h-[60%] overflow-y-auto border border-slate-200 w-72">
        <h3 class="font-bold text-slate-800 mb-3 text-xs uppercase tracking-wider flex items-center justify-between">
            <span>路线图层</span>
            <button (click)="fitAllBounds()" class="text-blue-600 hover:text-blue-800 text-[10px] font-semibold border border-blue-100 bg-blue-50 px-2 py-0.5 rounded hover:bg-blue-100 transition-colors" title="调整视野以显示所有已勾选路线">
                显示可见路线
            </button>
        </h3>

        <!-- Comparison Mode Toggle -->
         <div class="mb-3 px-2 py-2 bg-slate-50 border border-slate-100 rounded flex items-center gap-2">
            <input type="checkbox" 
                id="compMode"
                [ngModel]="service.appSettings().isComparisonMode"
                (ngModelChange)="toggleComparisonMode($event)"
                class="rounded border-slate-300 text-purple-600 focus:ring-purple-500 h-4 w-4 cursor-pointer">
            <label for="compMode" class="text-xs font-bold text-slate-700 cursor-pointer select-none">
                文件夹对比模式
            </label>
        </div>
        
        @for (folder of service.folders(); track folder.id) {
          <div class="mb-2 border-b border-slate-100 last:border-0 pb-2">
            <!-- 箭头列与路线列表的缩进同宽。复选框再内移一格，与下方路线行对齐。 -->
            <div class="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center mb-1">
              <button (click)="service.toggleFolderExpansion(folder.id)" class="justify-self-start text-slate-400 hover:text-slate-600 focus:outline-none p-1 rounded hover:bg-slate-100">
                <svg class="w-3 h-3 transition-transform duration-200" [class.rotate-90]="folder.isExpanded" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
              </button>
              <div class="flex min-w-0 items-center gap-2 px-1">
                <input type="checkbox"
                  [checked]="isFolderFullyVisible(folder.id)"
                  (change)="toggleFolderVisibility(folder.id, $event)"
                  class="h-3 w-3 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  title="显示或隐藏该文件夹的全部路线">
                <svg class="w-4 h-4 shrink-0 text-slate-500" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                <span class="truncate font-semibold text-xs text-slate-700 select-none cursor-pointer" (click)="service.toggleFolderExpansion(folder.id)">{{ folder.name }}</span>
              </div>
            </div>
            
            @if (folder.isExpanded) {
                <div class="pl-6 space-y-1 mt-1 transition-all duration-300">
                  @for (route of getRoutesInFolder(folder.id); track route.id) {
                    <!-- 路线行用于切换可见性，禁用文本选中以免双击时出现文字高亮。 -->
                    <label class="flex items-center gap-2 cursor-pointer select-none hover:bg-slate-100 p-1 rounded transition-colors text-xs group/item"
                           (mouseenter)="setListHover(route.id)" (mouseleave)="setListHover()"
                           (contextmenu)="openRouteDetails($event, route.id)">
                      <input type="checkbox" 
                        [checked]="route.isVisible" 
                        (change)="toggleRoute(route.id, $event)"
                        class="h-3 w-3 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500">
                        
                      <span class="w-2 h-2 rounded-full shadow-sm ring-1 ring-black/10" 
                            [style.backgroundColor]="service.appSettings().isComparisonMode ? (folder.color || '#999') : route.color">
                      </span>
                      
                      <span class="truncate text-slate-600 group-hover/item:text-slate-900">{{ route.name }}</span>
                    </label>
                  }
                </div>
            }
          </div>
        }
      </div>

      <!-- Switch Mode Button -->
      <div class="absolute bottom-8 left-1/2 -translate-x-1/2 z-[500]">
        <button 
          (click)="onManageClick.emit()"
          class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transform transition hover:scale-105 flex items-center gap-3 active:scale-95">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
          路线管理与 GPX / FIT 导入
        </button>
      </div>
      
      <!-- API Key Modal -->
      @if (showKeyModal()) {
        <div class="absolute inset-0 z-[1000] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 transition-all">
            <div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg border border-slate-100 animate-fade-in-up">
                
                <div class="text-center mb-6">
                    <div class="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
                    </div>
                    <h3 class="text-2xl font-bold text-slate-800">启用地图</h3>
                    <p class="text-slate-600 mt-2">
                        启用地图需要 Mapbox 公共访问令牌。可先跳过，稍后在设置中配置。
                    </p>
                </div>

                <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6">
                    <label for="mapbox-setup-token" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Mapbox 访问令牌</label>
                    <div class="relative">
                        <input 
                            id="mapbox-setup-token" type="text"
                            [(ngModel)]="modalKey" 
                            (keyup.enter)="validateAndSave()"
                            placeholder="例如：pk.eyJ1…"
                            class="w-full pl-4 pr-10 py-3 rounded-lg border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm font-mono text-slate-800 shadow-sm"
                            [class.border-red-300]="hasError()"
                            (input)="hasError.set(false)"
                        >
                        @if (hasError()) {
                            <div class="absolute right-3 top-3 text-red-500">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            </div>
                        }
                    </div>
                    @if (hasError()) {
                        <p class="text-red-500 text-xs mt-2">令牌校验失败，请检查令牌或网络连接后重试。</p>
                    }
                </div>
                
                <div class="flex items-start gap-3 mb-8 px-1">
                    <input 
                        type="checkbox" 
                        id="dontRemind" 
                        [ngModel]="dontRemind()"
                        (ngModelChange)="dontRemind.set($event)"
                        class="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer">
                    <label for="dontRemind" class="text-sm text-slate-600 cursor-pointer select-none leading-tight">
                        不再提醒 <br>
                        <span class="text-xs text-slate-400">跳过后地图保持空白，可稍后在设置中配置。</span>
                    </label>
                </div>
                
                <div class="flex gap-3">
                    <button (click)="dismiss()" class="flex-1 px-4 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all">
                        暂时跳过
                    </button>
                    <button 
                        (click)="validateAndSave()" 
                        [disabled]="isValidating() || !modalKey"
                        class="flex-[2] px-4 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
                        @if(isValidating()) {
                            <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        }
                        {{ isValidating() ? '正在校验…' : '启用地图' }}
                    </button>
                </div>
                
                <div class="mt-6 text-center">
                    <a href="https://mapbox.com" target="_blank" class="text-xs text-slate-400 hover:text-blue-600 hover:underline transition-colors">
                        前往 Mapbox 官网获取访问令牌
                    </a>
                </div>
            </div>
        </div>
      }
    </div>
  `
})
export class MapViewComponent implements OnInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef;
  
  service = inject(RouteService);
  zone = inject(NgZone);
  onManageClick = output<void>();
  onRouteSelect = output<string>();

  private map: any = null;
  private popup: any = null;
  private mapInitFrame?: number;
  private listHoverId?: string;
  private mapHoverId?: string;
  private highlightedId?: string;
  private readonly routeInteractionCleanups = new Map<string, () => void>();
  
  // 按实际添加顺序记录路线，用于恢复悬停前的叠放顺序。
  private renderedRouteIds = new Set<string>();
  
  currentLayer = 'mapbox_outdoors';
  
  // Signals for reactive state
  isMapReady = signal(false); 
  private initialBoundsSet = false;

  // Menu Animation
  menuRendered = signal(false);
  menuVisible = signal(false);
  private hideTimer: any;
  private fadeTimer: any;
  
  // Modal & Popup Logic
  showKeyModal = signal(false);
  modalKey = '';
  dontRemind = signal(false);
  isValidating = signal(false);
  hasError = signal(false);

  // Resize Observer for robust responsiveness
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    effect(() => {
        // Track dependencies
        const initialized = this.service.initialized();
        const settings = this.service.appSettings();
        
        // Wait for storage load to avoid UI flash
        if (!initialized) return;

        // Initialize Map if key is present and valid
        if (settings.mapboxApiKey && settings.mapboxKeyValid) {
            if (!this.map) this.initMap(settings.mapboxApiKey);
            this.showKeyModal.set(false);
        } 
        // Logic for missing/invalid key
        else {
             // If user hasn't explicitly said "Don't Remind", show the modal
             if (!settings.dontRemindMapbox && !this.map) {
                 this.showKeyModal.set(true);
             }
        }

        // Update map data when routes or comparison mode changes
        // Dependency on isMapReady ensures this runs again once map initializes
        if (this.isMapReady() && this.map) {
             const routes = this.service.routes();
             const mode = settings.isComparisonMode;
             this.updateMapData(routes, mode);
        }
    }, { allowSignalWrites: true }); // Critical fix: allow writing signals (showKeyModal) inside effect
  }

  ngOnInit() {
    // Check if we need to prepopulate key from settings (e.g. if it was invalid)
    if (this.service.appSettings().mapboxApiKey) {
        this.modalKey = this.service.appSettings().mapboxApiKey;
    }

    // Initialize ResizeObserver
    if (this.mapContainer?.nativeElement) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.map) {
           this.map.resize();
        }
      });
      this.resizeObserver.observe(this.mapContainer.nativeElement);
    }
  }

  /** @returns 无返回值；切换页时保存视角，释放地图并取消未执行的初始化。 */
  ngOnDestroy(): void {
    if (this.mapInitFrame !== undefined) cancelAnimationFrame(this.mapInitFrame);
    // Save map state before destroying
    if (this.map) {
        const center = this.map.getCenter();
        const zoom = this.map.getZoom();
        const pitch = this.map.getPitch();
        const bearing = this.map.getBearing();
        
        this.service.mapState.set({
            center: { lng: center.lng, lat: center.lat },
            zoom,
            pitch,
            bearing
        });
        
        this.map.remove();
        this.map = null;
        this.routeInteractionCleanups.clear();
    }
    
    if (this.resizeObserver) {
        this.resizeObserver.disconnect();
    }
    
    clearTimeout(this.hideTimer);
    clearTimeout(this.fadeTimer);
  }

  /** @param {string} apiKey 已通过校验的访问令牌。 @returns {void} 创建使用中文控件的地图，保留原有底图与视角逻辑。 */
  private initMap(apiKey: string) {
    if (this.map || this.mapInitFrame !== undefined) return;

    // Use requestAnimationFrame to ensuring the container has calculated dimensions
    this.mapInitFrame = requestAnimationFrame(() => {
        this.mapInitFrame = undefined;
        if (this.map || !this.mapContainer?.nativeElement) return;

        mapboxgl.accessToken = apiKey;
        
        // Load saved state or use defaults
        const savedState = this.service.mapState();
        
        this.map = new mapboxgl.Map({
            locale: MAPBOX_ZH_CN,
            container: this.mapContainer.nativeElement,
            style: 'mapbox://styles/mapbox/outdoors-v12',
            center: savedState ? savedState.center : [114.2477, 22.7199], 
            zoom: savedState ? savedState.zoom : 12,
            pitch: savedState ? savedState.pitch : 0,
            bearing: savedState ? savedState.bearing : 0,
            projection: 'globe', // Standard v3 projection
            // Enable antialiasing for sharper lines and text
            antialias: true,
            // Force High DPI rendering
            pixelRatio: window.devicePixelRatio || 1,
            // Explicitly enable resize tracking
            trackResize: true
        });
        
        // If we restored state, mark bounds as set to prevent auto-fit
        if (savedState) {
            this.initialBoundsSet = true;
        }

        // MATCH GPX STUDIO: visualizePitch: true
        this.map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');

        this.popup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            className: 'route-popup'
        });

        // Trigger isMapReady when basic load is done
        this.map.once('load', () => {
            this.map.resize();
            this.isMapReady.set(true); 
        });

        // Add pitch listener to toggle terrain like GPX Studio
        this.map.on('pitch', () => this.updateTerrain());

        // Handle Style loads
        this.map.on('style.load', () => {
            this.map.resize();

            // 1. MATCH GPX STUDIO: Specific Fog Colors
            try {
                this.map.setFog({
                    color: 'rgb(186, 210, 235)',
                    'high-color': 'rgb(36, 92, 223)',
                    'horizon-blend': 0.1,
                    'space-color': 'rgb(156, 240, 255)',
                });
            } catch (e) { /* Fog might not work on custom raster styles */ }

            // 2. Localization
            try {
                 this.setMapLanguage();
            } catch (e) { /* Lang set might fail on raster styles */ }
            
            // 3. ENHANCEMENT: Sharpen Contours
            try {
                this.enhanceContours();
            } catch (e) { /* Contours might not exist on raster styles */ }

            // 4. MATCH GPX STUDIO: Dynamic Terrain Logic
            try {
                this.updateTerrain(); 
            } catch (e) { /* Terrain might fail */ }

            // 切换样式会重建图层和命中监听，列表上仍有效的悬停会在重建后应用。
            this.clearMapHover();
            for (const cleanup of this.routeInteractionCleanups.values()) cleanup();
            this.routeInteractionCleanups.clear();
            this.renderedRouteIds.clear();
            
            setTimeout(() => {
                 this.updateMapData(this.service.routes(), this.service.appSettings().isComparisonMode);
            }, 150);

            if (!this.initialBoundsSet && this.service.routes().some(r => r.isVisible)) {
                setTimeout(() => {
                   this.fitAllBounds(true);
                   this.initialBoundsSet = true;
                }, 100);
            }
        });
    });
  }

  // MATCH GPX STUDIO: Terrain Logic
  private updateTerrain() {
      if (!this.map || !this.map.getStyle()) return;

      const sourceId = 'mapbox-dem';
      const isPitched = this.map.getPitch() > 0;
      
      if (!this.map.getSource(sourceId)) {
           try {
              this.map.addSource(sourceId, {
                  'type': 'raster-dem',
                  'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                  'tileSize': 512,
                  'maxzoom': 14
              });
           } catch (e) { return; }
      }

      try {
          if (isPitched) {
              const currentTerrain = this.map.getTerrain();
              if (!currentTerrain || currentTerrain.source !== sourceId || currentTerrain.exaggeration !== 1) {
                  this.map.setTerrain({ 'source': sourceId, 'exaggeration': 1 });
              }
          } 
          else {
              if (this.map.getTerrain()) {
                  this.map.setTerrain(null);
              }
          }
      } catch (e) {}
  }

  private enhanceContours() {
      if (!this.map) return;
      const layers = this.map.getStyle().layers;
      if (!layers) return;
      layers.forEach((layer: any) => {
          if (layer.id.includes('contour') && layer.type === 'line') {
              try {
                  this.map.setPaintProperty(layer.id, 'line-opacity', 0.3);
              } catch(e) {}
          }
      });
  }

  private setMapLanguage() {
      if (!this.map) return;
      const style = this.map.getStyle();
      if (!style || !style.layers) return;

      for (const layer of style.layers) {
          if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
              if (layer.source === 'composite' || layer.source === 'mapbox') {
                  try {
                      const oldTextField = layer.layout['text-field'];
                      const str = JSON.stringify(oldTextField);
                      const usesName = str.includes('name');
                      const usesRef = str.includes('ref');
                      const isShield = layer.id.toLowerCase().includes('shield');

                      if (usesName && !usesRef && !isShield) {
                          this.map.setLayoutProperty(layer.id, 'text-field', [
                              'coalesce',
                              ['get', 'name_zh-Hans'],
                              ['get', 'name']
                          ]);
                      }
                  } catch (e) {}
              }
          }
      }
  }

  // --- Mapbox Data Handling ---

  /**
   * 同步路线的独立显示与命中图层；已知分段以多段线绘制，不跨缺口连线。
   * @param routes 当前路线快照。
   * @param isCompMode 是否按文件夹着色。
   * @returns 无返回值；地图或样式未就绪时沿用原有保护逻辑。
   */
  private updateMapData(routes: RouteData[], isCompMode: boolean) {
      if (!this.map || !this.map.getStyle()) return;

      const folders = this.service.folders();
      const hoveredRoute = routes.find(route => route.id === this.listHoverId);
      // 路线行被移除或收起时，浏览器可能不会发出 mouseleave。
      if (!hoveredRoute || !folders.some(folder => folder.id === hoveredRoute.folderId && folder.isExpanded)) {
          this.listHoverId = undefined;
      }
      const visibleRoutes = routes.filter(r => r.isVisible);
      const visibleIds = new Set(visibleRoutes.map(r => r.id));

      this.renderedRouteIds.forEach(id => {
          if (!visibleIds.has(id)) {
              this.removeRouteFromMap(id);
              this.renderedRouteIds.delete(id);
          }
      });

      visibleRoutes.forEach(route => {
          let color = route.color;
          if (isCompMode) {
            const folder = folders.find(f => f.id === route.folderId);
            if (folder && folder.color) color = folder.color;
          }

          const layerId = `route-layer-${route.id}`;
          const layerExists = !!this.map.getLayer(layerId);
          const isTracked = this.renderedRouteIds.has(route.id);

          if (!isTracked || !layerExists) {
              this.removeRouteFromMap(route.id);
              this.addRouteToMap(route, color);
              // 重建的图层重新追加到末尾，旧记录也要移到添加顺序的末尾。
              this.renderedRouteIds.delete(route.id);
              this.renderedRouteIds.add(route.id);
          } else {
              this.map.setPaintProperty(layerId, 'line-color', color);
          }
      });
      // 可见性变化或样式重载后，仍在列表中的悬停可以应用到新建立的图层。
      this.syncRouteHighlight();
  }

  /**
   * 建立路线的多段GeoJSON、可见层和命中层，避免将原始分段之间的空白画成路线。
   * @param route 含原始坐标及可选分段的路线；旧路线沿用单段表现。
   * @param color 当前路线或文件夹颜色。
   * @returns 无返回值；少于两个点的独立分段不绘制，地图异常沿用原有捕获逻辑。
   */
  private addRouteToMap(route: RouteData, color: string) {
      const geojson = {
          type: 'Feature',
          properties: {
              id: route.id,
              description: `<strong class="text-sm">${route.name}</strong><br><span class="text-xs text-gray-500">${route.stats.distanceKm} km</span>`
          },
          geometry: {
              // 各段独立绘制；历史路线没有分段时仍按原有单段显示，不猜测断点。
              type: 'MultiLineString',
              coordinates: (route.segmentStarts ?? [0]).map((start, i, starts) =>
                route.points.slice(start, starts[i + 1] ?? route.points.length).map(p => [p.lon, p.lat])
              ).filter(segment => segment.length >= 2)
          }
      };

      try {
        const sourceId = `route-source-${route.id}`;
        const hitLayerId = `route-hit-${route.id}`;
        const visLayerId = `route-layer-${route.id}`;

        if (!this.map.getSource(sourceId)) {
            this.map.addSource(sourceId, { type: 'geojson', data: geojson });
        }
        if (!this.map.getLayer(hitLayerId)) {
            this.map.addLayer({
                id: hitLayerId, type: 'line', source: sourceId,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-width': 15, 'line-color': 'transparent' }
            });
        }
        if (!this.map.getLayer(visLayerId)) {
            this.map.addLayer({
                id: visLayerId, type: 'line', source: sourceId,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': color, 'line-width': ROUTE_LINE_WIDTH, 'line-opacity': ROUTE_LINE_OPACITY }
            });
        }

        this.setupInteractions(route.id);
      } catch (e) {
          console.error(`Failed to render route ${route.id}`, e);
      }
  }

  /** @param id 即将隐藏或重建的路线。 @returns 无返回值；清理图层、命中监听及沿线提示。 */
  private removeRouteFromMap(id: string): void {
      this.routeInteractionCleanups.get(id)?.();
      this.routeInteractionCleanups.delete(id);
      if (this.mapHoverId === id) this.clearMapHover();
      if (this.map.getLayer(`route-layer-${id}`)) this.map.removeLayer(`route-layer-${id}`);
      if (this.map.getLayer(`route-hit-${id}`)) this.map.removeLayer(`route-hit-${id}`); 
      if (this.map.getSource(`route-source-${id}`)) this.map.removeSource(`route-source-${id}`);
  }

  /** @param id 可见路线的标识符。 @returns 无返回值；为命中层绑定悬浮提示与详情入口。 */
  private setupInteractions(id: string): void {
      const hitLayer = `route-hit-${id}`;

      /** @param event 地图命中事件。 @returns 无返回值；显示当前命中路线的高亮和浮窗。 */
      const enter = (event: RouteMapHoverEvent): void => {
          const description = event.features?.[0]?.properties?.description;
          if (typeof description !== 'string') return;
          this.mapHoverId = id;
          this.map.getCanvas().style.cursor = 'pointer';
          this.syncRouteHighlight();
          this.popup.setLngLat(event.lngLat).setHTML(description).addTo(this.map);
      };

      /** @returns 无返回值；重叠路线的离开事件不能清除另一条路线的提示。 */
      const leave = (): void => {
          if (this.mapHoverId !== id) return;
          this.clearMapHover();
          this.syncRouteHighlight();
      };

      /** @returns 无返回值；通知根组件打开该路线详情。 */
      const select = (): void => this.zone.run(() => this.onRouteSelect.emit(id));
      this.map.on('mouseenter', hitLayer, enter);
      this.map.on('mouseleave', hitLayer, leave);
      this.map.on('click', hitLayer, select);
      // 使用原回调引用解绑，避免重建图层后同一命中事件被多次处理。
      this.routeInteractionCleanups.set(id, () => {
          this.map.off('mouseenter', hitLayer, enter);
          this.map.off('mouseleave', hitLayer, leave);
          this.map.off('click', hitLayer, select);
      });
  }

  /** @returns 无返回值；移到列表或移除命中层时收起沿线浮窗。 */
  private clearMapHover(): void {
      if (this.mapHoverId === undefined) return;
      this.mapHoverId = undefined;
      this.map.getCanvas().style.cursor = '';
      this.popup.remove();
  }

  /** @returns 无返回值；优先应用列表悬停，恢复上一条路线的普通样式与层级。 */
  private syncRouteHighlight(): void {
      const next = this.listHoverId ?? this.mapHoverId;
      if (this.highlightedId !== undefined && this.highlightedId !== next) {
          this.paintRouteHighlight(this.highlightedId, false);
      }
      this.highlightedId = next;
      if (next !== undefined) this.paintRouteHighlight(next, true);
  }

  /** @param id 路线标识符。 @param active 是否高亮。 @returns 无返回值；可见线层在高亮时临时置顶，透明命中层位置不变。 */
  private paintRouteHighlight(id: string, active: boolean): void {
      const layer = `route-layer-${id}`;
      if (!this.map?.getLayer(layer)) return;
      this.map.setPaintProperty(layer, 'line-width', active ? 7 : ROUTE_LINE_WIDTH);
      this.map.setPaintProperty(layer, 'line-opacity', active ? 1 : ROUTE_LINE_OPACITY);
      this.map.moveLayer(layer, active ? undefined : this.nextRouteHitLayer(id));
  }

  /**
   * 还原线层时插到下一条路线的命中层之前，使两条路线恢复原相对位置。
   * @param id 即将结束高亮的路线标识符。
   * @returns 下一条仍有图层的路线命中层 ID，末尾返回 undefined。
   */
  private nextRouteHitLayer(id: string): string | undefined {
      let afterRoute = false;
      for (const routeId of this.renderedRouteIds) {
          if (afterRoute) {
              const hitLayer = `route-hit-${routeId}`;
              if (this.map.getLayer(hitLayer)) return hitLayer;
          }
          if (routeId === id) afterRoute = true;
      }
      return undefined;
  }

  /** @param id 鼠标所在路线，离开时省略。 @returns 无返回值；列表悬停仅触发图层高亮。 */
  setListHover(id?: string): void {
      if (id !== undefined) this.clearMapHover();
      this.listHoverId = id;
      this.syncRouteHighlight();
  }

  /** @param event 路线行右键事件。 @param id 列表路线的标识符。 @returns 无返回值；隐藏路线也可打开详情。 */
  openRouteDetails(event: MouseEvent, id: string): void {
      event.preventDefault();
      this.onRouteSelect.emit(id);
  }

  // --- UI Interactions ---

  handleMenuEnter() {
    clearTimeout(this.hideTimer);
    clearTimeout(this.fadeTimer);
    this.menuRendered.set(true);
    requestAnimationFrame(() => this.menuVisible.set(true));
  }

  handleMenuLeave() {
      this.hideTimer = setTimeout(() => {
          this.menuVisible.set(false);
          this.fadeTimer = setTimeout(() => this.menuRendered.set(false), 300);
      }, 500);
  }

  changeBaseLayer(layer: string) {
      if (this.currentLayer === layer) return;
      this.currentLayer = layer;
      
      if (this.map) {
          if (layer === 'osm') {
              const osmStyle = {
                  version: 8,
                  sources: {
                      'osm-raster-tiles': {
                          type: 'raster',
                          tiles: [ 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' ],
                          tileSize: 256,
                          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      }
                  },
                  layers: [
                      {
                          id: 'osm-raster-layer',
                          type: 'raster',
                          source: 'osm-raster-tiles',
                          minzoom: 0,
                          maxzoom: 19
                      }
                  ]
              };
              this.map.setStyle(osmStyle);
          } else {
             this.map.setStyle('mapbox://styles/mapbox/outdoors-v12');
          }
      }
      this.menuVisible.set(false);
      setTimeout(() => this.menuRendered.set(false), 300);
  }

  async validateAndSave() {
     if (!this.modalKey) return;
     this.isValidating.set(true);
     this.hasError.set(false);
     
     const isValid = await this.service.validateMapboxKey(this.modalKey);
     this.isValidating.set(false);
     
     if (isValid) {
         this.showKeyModal.set(false);
         // initMap will be called by effect when it detects key valid
     } else {
         this.hasError.set(true);
     }
  }

  dismiss() {
     if (this.dontRemind()) {
         this.service.updateSettings({ dontRemindMapbox: true });
     }
     this.showKeyModal.set(false);
  }

  fitAllBounds(immediate = false) {
    if (!this.map) return;
    const routes = this.service.routes().filter(r => r.isVisible);
    if (routes.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    routes.forEach(r => {
        if(r.points && r.points.length > 0) {
            r.points.forEach(p => bounds.extend([p.lon, p.lat]));
        }
    });

    if (!bounds.isEmpty()) {
        this.map.fitBounds(bounds, { padding: 50, animate: !immediate });
    }
  }

  // --- UI Helpers ---
  
  getRoutesInFolder(folderId: string) {
    return this.service.routes().filter(r => r.folderId === folderId);
  }

  toggleRoute(id: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.service.toggleRouteVisibility(id, checked);
  }

  toggleFolderVisibility(folderId: string, event: Event) {
      const checked = (event.target as HTMLInputElement).checked;
      this.service.toggleFolderVisibility(folderId, checked);
  }

  isFolderFullyVisible(folderId: string): boolean {
      const routes = this.getRoutesInFolder(folderId);
      if (routes.length === 0) return false;
      return routes.every(r => r.isVisible);
  }

  toggleComparisonMode(val: boolean) {
      this.service.updateSettings({ isComparisonMode: val });
  }
}
