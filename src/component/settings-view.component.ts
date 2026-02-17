
import { Component, inject, signal, computed, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouteService } from '../services/route.service';

@Component({
  selector: 'app-settings-view',
  standalone: true,
  imports: [FormsModule],
  host: { 'class': 'block w-full h-full bg-slate-50' },
  template: `
    <div class="max-w-4xl mx-auto p-8 h-full flex flex-col">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-8">
        <button (click)="onBack.emit()" class="p-2 rounded-full hover:bg-slate-200 transition-colors">
          <svg class="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
        </button>
        <h1 class="text-3xl font-bold text-slate-800">Settings</h1>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        
        <!-- Map Settings -->
        <div class="p-6 border-b border-slate-100">
            <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
                Map Provider
            </h2>
            
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Mapbox API Key (Access Token)</label>
                    <div class="flex gap-2">
                        <input 
                            type="text" 
                            [(ngModel)]="tempKey" 
                            placeholder="pk.eyJ1..." 
                            class="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all bg-slate-700 text-white placeholder-slate-400 border-slate-600"
                            [class.border-red-500]="!isValid() && hasTried()"
                            [class.border-green-500]="isValid()"
                        >
                        <button 
                            (click)="validateKey()" 
                            [disabled]="isValidating()"
                            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-wait font-medium transition-colors">
                            {{ isValidating() ? 'Checking...' : 'Validate & Save' }}
                        </button>
                    </div>
                    
                    @if (service.appSettings().mapboxKeyValid) {
                         <p class="mt-2 text-sm text-green-600 flex items-center gap-1">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                            API Key is valid. Mapbox layers are enabled.
                         </p>
                    } @else if (service.appSettings().mapboxApiKey && !service.appSettings().mapboxKeyValid) {
                        <p class="mt-2 text-sm text-red-500 flex items-center gap-1 font-medium">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            Invalid API Key. Please check your token.
                        </p>
                    }
                    
                    <p class="mt-2 text-xs text-slate-400">
                        A Mapbox API key is required to access Satellite and Outdoors map layers. 
                        <a href="https://mapbox.com" target="_blank" class="text-blue-500 hover:underline">Get a key here</a>.
                    </p>
                </div>
            </div>
        </div>

        <!-- About -->
        <div class="p-6 bg-slate-50">
            <h3 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">About</h3>
            <p class="text-slate-600 text-sm">VeloRoute Manager v1.2</p>
            <p class="text-slate-500 text-xs mt-1">Local-first cycling route analysis and organization.</p>
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
