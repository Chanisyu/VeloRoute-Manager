
import { Component, inject, signal, computed, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouteService } from '../services/route.service';

@Component({
  selector: 'app-settings-view',
  standalone: true,
  imports: [FormsModule],
  host: { 'class': 'block w-full h-full bg-slate-50' },
  template: `
    <div class="max-w-4xl mx-auto p-8 h-full flex flex-col overflow-y-auto">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-8">
        <button aria-label="返回路线管理" title="返回路线管理" (click)="onBack.emit()" class="p-2 rounded-full hover:bg-slate-200 transition-colors">
          <svg class="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
        </button>
        <h1 class="text-3xl font-bold text-slate-800">设置</h1>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden shrink-0">
        
        <!-- Map Settings -->
        <div class="p-6 border-b border-slate-100">
            <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
                地图设置
            </h2>
            
            <div class="space-y-4">
                <div>
                    <label for="settings-mapbox-token" class="block text-sm font-medium text-slate-700 mb-1">Mapbox 访问令牌</label>
                    <div class="flex gap-2">
                        <input 
                            id="settings-mapbox-token" type="text"
                            [(ngModel)]="tempKey" 
                            placeholder="例如：pk.eyJ1…"
                            class="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all bg-slate-700 text-white placeholder-slate-400 border-slate-600"
                            [class.border-red-500]="!isValid() && hasTried()"
                            [class.border-green-500]="isValid()"
                        >
                        <button 
                            (click)="validateKey()" 
                            [disabled]="isValidating()"
                            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-wait font-medium transition-colors">
                            {{ isValidating() ? '正在校验…' : '校验并保存' }}
                        </button>
                    </div>
                    
                    @if (service.appSettings().mapboxKeyValid) {
                         <p class="mt-2 text-sm text-green-600 flex items-center gap-1">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                            访问令牌校验通过，地图功能已启用。
                         </p>
                    } @else if (service.appSettings().mapboxApiKey && !service.appSettings().mapboxKeyValid) {
                        <p class="mt-2 text-sm text-red-500 flex items-center gap-1 font-medium">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            访问令牌校验失败，请检查令牌或网络连接。
                        </p>
                    }
                    
                    <p class="mt-2 text-xs text-slate-400">
                        显示地图需要有效的 Mapbox 公共访问令牌。
                        <a href="https://mapbox.com" target="_blank" class="text-blue-500 hover:underline">前往官网获取</a>。
                    </p>
                </div>
            </div>
        </div>

        <!-- 原生折叠栏目默认关闭，支持点击与键盘展开，避免统计说明常驻路线详情。 -->
        <details class="border-b border-slate-100 p-6" aria-label="统计计算说明">
          <summary class="text-lg font-semibold text-slate-800 cursor-pointer focus-visible:outline-blue-600">路线统计与计算说明</summary>
          <div class="mt-4 space-y-4 text-sm leading-6 text-slate-600">
            <h3 class="font-semibold text-slate-800">GPX 轨迹计算</h3>
            <dl class="space-y-3">
              <div><dt class="font-semibold text-slate-800">累计爬升与累计下降</dt><dd>各轨迹分段独立计算。以20米容差保留高程轮廓关键点，在前后各100米的窗口内平滑趋势残差，再分别累加上升和下降高差；最终取整数米。20米不是逐点高差扣除阈值。</dd></div>
              <div><dt class="font-semibold text-slate-800">平均上坡坡度</dt><dd>未取整的累计爬升 ÷ 平滑后上升区间的水平里程 × 100%。按距离加权，无上坡时为0；不是全程净坡度或逐点坡度的算术平均。</dd></div>
              <div><dt class="font-semibold text-slate-800">最大坡度</dt><dd>指最大 100 米平均上坡坡度。在连续采样区间内，以前后各50米的局部线性回归平滑高程，再比较完整100米窗口的平均坡度并取最大值。窗口只覆盖同一分段内相邻采样间距不超过100米的区间。</dd></div>
            </dl>
            <p class="rounded-lg bg-amber-50 p-3 text-amber-900">部分采样间距超过100米；累计升降为估算值，最大坡度仅采用有连续采样支撑的区间。</p>
            <p>任一点缺少高程时，四项高程指标显示“数据不足”。缺少完整有效的100米窗口时，“最大坡度”显示“数据不足”。</p>
            <h3 class="font-semibold text-slate-800">FIT 码表汇总</h3>
            <p>累计爬升、累计下降、平均上坡坡度和最大坡度读取 FIT 活动会话汇总。最大坡度取设备汇总的最大上坡坡度，采样窗口和滤波由设备决定。文件缺少哪一项，该项就显示“数据不足”。</p>
            <p>多个会话的升降分别相加，最大上坡坡度取各会话的最大值，要求每个会话都提供该指标。平均上坡坡度只显示单次会话的汇总值。</p>
            <p>路线剖面图使用文件中的逐点高程。悬停的20米平均坡度按同一有效区间内前后各10米的插值高差计算，缺少完整窗口时省略。</p>
            <p>已保存的旧路线保留原统计。之前导入的 FIT 路线需要重新导入原文件才能读取码表汇总。</p>
          </div>
        </details>

        <!-- About -->
        <div class="p-6 bg-slate-50">
            <h3 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">关于</h3>
            <p class="text-slate-600 text-sm">VeloRoute Manager</p>
            <p class="text-slate-500 text-xs mt-1">本地骑行路线管理与分析工具。</p>
        </div>

      </div>
    </div>
  `
})
export class SettingsViewComponent {
  service = inject(RouteService);
  onBack = output<void>();
  
  tempKey = '';
  isValidating = signal(false);
  hasTried = signal(false);
  
  isValid = computed(() => this.service.appSettings().mapboxKeyValid);

  constructor() {
      // Init input with current key
      this.tempKey = this.service.appSettings().mapboxApiKey || '';
  }

  async validateKey() {
      this.isValidating.set(true);
      this.hasTried.set(true);
      
      const success = await this.service.validateMapboxKey(this.tempKey);
      
      this.isValidating.set(false);
  }
}
