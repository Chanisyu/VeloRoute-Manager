import { AfterViewInit, Component, computed, effect, ElementRef, input, OnDestroy, signal, ViewChild } from '@angular/core';
import type { RoutePoint } from '../../shared/storage-schema.mjs';
import { buildRouteProfile, clampProfileWindow, sampleRouteProfile, visibleProfilePoints, zoomProfileWindow } from '../../shared/route-profile.mjs';

let nextProfileId = 0;

/**
 * 提供独立的交互剖面图；横向缩放、平移和悬停只影响本组件，不改动路线或保存状态。
 * 数据输入为原始点与分段；无有效高程区间时隐藏整图，缺失位置不显示提示或警告。
 */
@Component({
  selector: 'app-route-profile', standalone: true,
  host: { '[style.display]': 'profile().runs.length ? "block" : "none"' },
  template: `
    <section #frame class="rounded-xl border border-slate-200 bg-white overflow-hidden" aria-label="路线剖面图">
      <div class="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h3 class="text-sm font-semibold text-slate-800">路线剖面图</h3>
        <div class="flex items-center gap-3">
          <span class="text-xs text-slate-400">滚轮缩放 · 左键拖动</span>
          <button type="button" (click)="resetView()" class="text-xs text-blue-600 hover:text-blue-800 rounded px-2 py-1 focus-visible:outline-blue-600">显示全程</button>
        </div>
      </div>
      <div class="relative select-none" data-testid="profile-plot">
        <svg class="block w-full h-[280px] touch-none" [style.cursor]="dragging() ? 'grabbing' : 'crosshair'"
          [attr.viewBox]="'0 0 ' + width() + ' 280'" role="img" aria-label="可缩放和拖动的路线高程剖面图"
          [attr.data-start]="window()[0]" [attr.data-end]="window()[1]"
          (wheel)="wheel($event)" (pointerdown)="pointerDown($event)" (pointermove)="pointerMove($event)"
          (pointerup)="pointerEnd($event)" (pointercancel)="pointerEnd($event)"
          (lostpointercapture)="cancelDrag()" (pointerleave)="leave()">
          <defs><clipPath [id]="clipId"><rect x="56" y="22" [attr.width]="plotWidth()" height="222" /></clipPath></defs>
          <text x="12" y="14" fill="#64748b" font-size="11">高程（m）</text>
          @for (tick of yTicks(); track tick.value) {
            <line x1="56" [attr.x2]="width() - 16" [attr.y1]="tick.pixel" [attr.y2]="tick.pixel" stroke="#e2e8f0" />
            <text x="48" [attr.y]="tick.pixel + 4" text-anchor="end" fill="#64748b" font-size="11">{{ tick.label }}</text>
          }
          @for (tick of xTicks(); track tick.value) {
            <line [attr.x1]="tick.pixel" [attr.x2]="tick.pixel" y1="22" y2="244" stroke="#f1f5f9" />
            <text [attr.x]="tick.pixel" y="263" text-anchor="middle" fill="#64748b" font-size="11">{{ tick.label }}</text>
          }
          <text [attr.x]="width() - 16" y="278" text-anchor="end" fill="#64748b" font-size="10">里程（{{ profile().distance < 1000 ? 'm' : 'km' }}）</text>
          <g [attr.clip-path]="'url(#' + clipId + ')'">
            @for (path of paths(); track $index) {
              <path [attr.d]="path.area" fill="#dbeafe" fill-opacity="0.6" />
              <path data-testid="profile-line" [attr.d]="path.line" fill="none" stroke="#2563eb" stroke-width="1.8" stroke-linejoin="round" />
            }
            @if (hover(); as point) {
              <line [attr.x1]="point.x" [attr.x2]="point.x" y1="22" y2="244" stroke="#64748b" stroke-dasharray="3 3" />
              <circle [attr.cx]="point.x" [attr.cy]="toY(point.elevation)" r="4" fill="#2563eb" stroke="white" stroke-width="2" />
            }
          </g>
        </svg>
        @if (hover(); as point) {
          <div data-testid="profile-tooltip" class="absolute top-6 z-10 pointer-events-none rounded-lg bg-slate-900/95 px-3 py-2 text-xs leading-6 text-white shadow-lg"
            [style.left.px]="tooltipLeft()">
            <div>里程：{{ formatDistance(point.distance) }}</div>
            <div>高程：{{ point.elevation.toFixed(1) }} m</div>
            @if (point.grade !== null) { <div data-testid="profile-grade">20米平均坡度：{{ point.grade.toFixed(1) }}%</div> }
          </div>
        }
      </div>
    </section>
  `
})
export class RouteProfileComponent implements AfterViewInit, OnDestroy {
  points = input.required<RoutePoint[]>();
  segmentStarts = input<number[] | undefined>();
  routeId = input.required<string>();
  @ViewChild('frame', { static: true }) frame!: ElementRef<HTMLElement>;
  readonly clipId = `route-profile-clip-${++nextProfileId}`;
  readonly profile = computed(() => buildRouteProfile(this.points(), this.segmentStarts()));
  readonly width = signal(640);
  readonly window = signal<[number, number]>([0, 0]);
  readonly hover = signal<{ distance: number; elevation: number; grade: number | null; x: number } | null>(null);
  readonly dragging = signal(false);
  readonly plotWidth = computed(() => Math.max(1, this.width() - 72));
  readonly tooltipLeft = computed(() => Math.max(56, Math.min(this.width() - 188, (this.hover()?.x ?? 56) + 12)));
  private observer?: ResizeObserver;
  private drag: { id: number; clientX: number; start: number; span: number; pixelWidth: number } | null = null;

  readonly yRange = computed(() => {
    const profile = this.profile(); const margin = Math.max(2, (profile.maximum - profile.minimum) * 0.08);
    return [profile.minimum - margin, profile.maximum + margin];
  });
  readonly yTicks = computed(() => this.ticks(this.yRange()[0], this.yRange()[1], 4).map(value => ({ value, pixel: this.toY(value), label: value.toFixed(0) })));
  readonly xTicks = computed(() => {
    const [start, end] = this.window(); const scale = this.profile().distance < 1000 ? 1 : 1000;
    const decimals = Math.max(0, Math.min(3, Math.ceil(-Math.log10(Math.max(1e-8, (end - start) / 5 / scale)))));
    return this.ticks(start, end, 5).map(value => ({ value, pixel: this.toX(value), label: (value / scale).toFixed(decimals) }));
  });
  readonly paths = computed(() => {
    const [start, end] = this.window();
    return this.profile().runs.map(run => {
      const points = visibleProfilePoints(run, start, end, this.plotWidth());
      const line = points.map(([x, h], i) => `${i ? 'L' : 'M'}${this.toX(x)},${this.toY(h)}`).join(' ');
      return { line, area: points.length ? `${line} L${this.toX(points.at(-1)![0])},244 L${this.toX(points[0][0])},244 Z` : '' };
    }).filter(path => path.line);
  });

  /** 初始化及切换轨迹时重置视窗；仅名称或简介编辑不会重新计算剖面或重置缩放。 */
  constructor() {
    effect(() => {
      this.routeId(); const profile = this.profile();
      this.window.set([0, profile.distance]); this.hover.set(null); this.cancelDrag();
    }, { allowSignalWrites: true });
  }

  /** @returns 无返回值；跟随实际容器宽度布局，隐藏后再显示仍可收到尺寸变化。 */
  ngAfterViewInit(): void {
    this.observer = new ResizeObserver(entries => this.width.set(Math.max(240, entries[0].contentRect.width)));
    this.observer.observe(this.frame.nativeElement);
  }

  /** @returns 无返回值；销毁后停止尺寸监听，不保留跨路线事件或定时任务。 */
  ngOnDestroy(): void { this.observer?.disconnect(); }

  /** @param start 起点。 @param end 终点。 @param count 目标刻度数量。 @returns 可读的十进制刻度，排除零宽范围。 */
  private ticks(start: number, end: number, count: number): number[] {
    if (end <= start) return [];
    const raw = (end - start) / count; const base = 10 ** Math.floor(Math.log10(raw));
    const step = ([1, 2, 5, 10].find(value => value * base >= raw) ?? 10) * base;
    const result = [];
    for (let value = Math.ceil(start / step) * step; value <= end + step * 1e-8; value += step) result.push(value);
    return result;
  }

  /** @param distance 米制里程。 @returns 当前视窗横坐标，允许边界外点由SVG裁剪。 */
  private toX(distance: number): number { return 56 + (distance - this.window()[0]) / Math.max(1e-8, this.window()[1] - this.window()[0]) * this.plotWidth(); }
  /** @param elevation 高程。 @returns 固定全程纵轴位置，横向缩放不改变纵轴比例。 */
  toY(elevation: number): number { return 244 - (elevation - this.yRange()[0]) / (this.yRange()[1] - this.yRange()[0]) * 222; }
  /** @param value 米制里程。 @returns 中文单位的光标里程；短距离用米，较长距离用公里。 */
  formatDistance(value: number): string { return value < 1000 ? `${value.toFixed(1)} m` : `${(value / 1000).toFixed(3)} km`; }

  /** @param event 指针或滚轮事件。 @returns SVG内部横坐标，兼容布局缩放，不使用会受子图元影响的offsetX。 */
  private eventX(event: MouseEvent): number {
    const bounds = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    return (event.clientX - bounds.left) * this.width() / bounds.width;
  }

  /** @param event 滚轮事件。 @returns 锚定光标进行横向缩放；仅图面拦截页面滚动，不修改全局缩放。 */
  wheel(event: WheelEvent): void {
    event.preventDefault();
    if (this.drag || !event.deltaY) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 280 : 1);
    this.window.set(zoomProfileWindow(this.window(), (this.eventX(event) - 56) / this.plotWidth(), Math.exp(Math.max(-500, Math.min(500, delta)) * 0.002), this.profile().distance));
    this.hover.set(null);
  }

  /** @param event 指针按下。 @returns 仅左键开始平移；捕获指针使拖动离开图面后仍能正常结束。 */
  pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const target = event.currentTarget as SVGSVGElement;
    target.setPointerCapture(event.pointerId);
    const bounds = target.getBoundingClientRect();
    this.drag = { id: event.pointerId, clientX: event.clientX, start: this.window()[0], span: this.window()[1] - this.window()[0], pixelWidth: bounds.width * this.plotWidth() / this.width() };
    this.dragging.set(true); this.hover.set(null);
  }

  /** @param event 指针移动。 @returns 拖动时平移；正常悬停时查询完整数据，缺失位置直接隐藏提示。 */
  pointerMove(event: PointerEvent): void {
    if (this.drag) {
      if (event.pointerId !== this.drag.id) return;
      this.window.set(clampProfileWindow(this.drag.start - (event.clientX - this.drag.clientX) / Math.max(1, this.drag.pixelWidth) * this.drag.span, this.drag.span, this.profile().distance));
      return;
    }
    const x = this.eventX(event);
    if (x < 56 || x > this.width() - 16) { this.hover.set(null); return; }
    const at = this.window()[0] + (x - 56) / this.plotWidth() * (this.window()[1] - this.window()[0]);
    const sample = sampleRouteProfile(this.profile(), at);
    this.hover.set(sample ? { ...sample, x } : null);
  }

  /** @param event 抬起或取消事件。 @returns 结束匹配的拖动并释放捕获；右键不会结束其他指针的操作。 */
  pointerEnd(event: PointerEvent): void {
    if (this.drag?.id !== event.pointerId) return;
    const target = event.currentTarget as SVGSVGElement;
    this.cancelDrag(); if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  }
  /** @returns 捕获丢失或切换路线时清除拖动状态，不留下抓取光标。 */
  cancelDrag(): void { this.drag = null; this.dragging.set(false); }
  /** @returns 离开图面时隐藏悬停；正在捕获的拖动继续有效。 */
  leave(): void { if (!this.drag) this.hover.set(null); }
  /** @returns 恢复全程横坐标并清除交互状态，不触发数据保存。 */
  resetView(): void { this.window.set([0, this.profile().distance]); this.hover.set(null); this.cancelDrag(); }
}
