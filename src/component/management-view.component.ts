
import { Component, inject, signal, computed, output, input, OnInit } from '@angular/core';
import { RouteService, RouteData, Folder } from '../services/route.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-management-view',
  standalone: true,
  imports: [FormsModule],
  host: { 'class': 'block w-full h-full' },
  template: `
    <div class="flex h-full w-full bg-white text-slate-800">
      
      <!-- Left Sidebar: Folders & Route List -->
      <div class="w-1/3 min-w-[300px] border-r border-slate-200 flex flex-col h-full bg-slate-50">
        <div class="p-4 border-b border-slate-200 bg-white shadow-sm z-10">
          <button (click)="onBack.emit()" class="text-blue-600 font-semibold flex items-center gap-2 mb-4 hover:underline">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            Back to Map
          </button>
          
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-xl font-bold text-slate-800">Route Library</h2>
            <button (click)="onSettings.emit()" class="text-slate-500 hover:text-slate-800 p-1.5 rounded-md hover:bg-slate-100 transition-colors" title="Settings">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            </button>
          </div>
          
          <div class="flex gap-2">
            <input #folderInput type="text" placeholder="New Folder Name" class="flex-1 px-3 py-2 border rounded-md text-sm bg-slate-700 text-white placeholder-slate-400 border-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-500">
            <button (click)="addFolder(folderInput.value); folderInput.value=''" class="bg-slate-800 text-white px-3 py-2 rounded-md text-sm hover:bg-slate-700">Add</button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-2">
          @for (folder of service.folders(); track folder.id) {
            <div class="mb-2 bg-white rounded border border-slate-100 shadow-sm overflow-hidden">
              
              <div class="flex items-center justify-between group px-2 py-2 hover:bg-slate-50 min-h-[42px]">
                @if (editingFolderId() === folder.id) {
                    <!-- Inline Rename Mode -->
                    <div class="flex items-center gap-2 flex-1 p-0.5" (click)="$event.stopPropagation()">
                        <input #renameInput 
                            type="text" 
                            [value]="folder.name" 
                            (keyup.enter)="saveRename(folder.id, renameInput.value)"
                            (keyup.escape)="editingFolderId.set(null)"
                            (click)="$event.stopPropagation()"
                            class="flex-1 text-sm border border-blue-500 rounded px-2 py-1 outline-none shadow-sm focus:ring-1 focus:ring-blue-500 bg-slate-700 text-white"
                            autofocus>
                        
                        <button (click)="saveRename(folder.id, renameInput.value)" class="text-green-600 p-1.5 hover:bg-green-50 rounded" title="Save">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                        </button>
                         <button (click)="editingFolderId.set(null)" class="text-slate-400 p-1.5 hover:bg-slate-100 rounded" title="Cancel">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                } @else {
                    <!-- Normal View Mode -->
                     <div class="flex items-center gap-2 overflow-hidden flex-1 cursor-pointer select-none" (click)="service.toggleFolderExpansion(folder.id)">
                        <button class="text-slate-400 hover:text-slate-700 focus:outline-none p-1 rounded">
                           <svg class="w-4 h-4 transition-transform duration-200" [class.rotate-90]="folder.isExpanded" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                        <div class="flex items-center gap-2 font-semibold text-slate-700 overflow-hidden flex-1">
                            <svg class="w-5 h-5 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                            <span class="truncate">{{ folder.name }}</span>
                        </div>
                     </div>
                    
                    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button (click)="startRenaming($event, folder.id)" class="text-slate-300 hover:text-blue-500 p-1 bg-white/50 rounded" title="Rename Folder">
                           <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                        </button>
                        <button (click)="deleteFolder($event, folder.id)" class="text-slate-300 hover:text-red-500 p-1 bg-white/50 rounded" title="Delete Folder">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                }
              </div>

              @if (folder.isExpanded) {
                <div class="bg-slate-50 border-t border-slate-100 p-2 space-y-1">
                    @for (route of getRoutesInFolder(folder.id); track route.id) {
                    <div 
                        (click)="selectRoute(route)"
                        class="cursor-pointer px-3 py-2 rounded-md text-sm border transition-all"
                        [class.bg-blue-600]="selectedRoute()?.id === route.id"
                        [class.text-white]="selectedRoute()?.id === route.id"
                        [class.border-blue-600]="selectedRoute()?.id === route.id"
                        [class.shadow-md]="selectedRoute()?.id === route.id"
                        [class.bg-white]="selectedRoute()?.id !== route.id"
                        [class.text-slate-700]="selectedRoute()?.id !== route.id"
                        [class.border-slate-200]="selectedRoute()?.id !== route.id"
                        [class.hover:border-blue-300]="selectedRoute()?.id !== route.id"
                    >
                        <div class="font-medium truncate">{{ route.name }}</div>
                        <div class="text-xs opacity-80 flex gap-2 mt-0.5">
                        <span>{{ route.stats.distanceKm }}km</span>
                        <span>•</span>
                        <span>{{ route.stats.elevationGainM }}m</span>
                        </div>
                    </div>
                    }
                    <div class="pt-2 mt-2 border-t border-slate-200/50">
                        <label class="flex items-center justify-center gap-2 w-full border border-dashed border-slate-300 rounded p-2 text-xs text-slate-500 cursor-pointer hover:border-blue-400 hover:text-blue-500 hover:bg-white transition-colors">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                            Upload GPX(s)
                            <input type="file" accept=".gpx" multiple class="hidden" (change)="onFileSelected($event, folder.id)">
                        </label>
                    </div>
                </div>
              }
            </div>
          }
        </div>

        <div class="p-4 border-t border-slate-200 bg-white">
            <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Data Management</h3>
            <div class="flex gap-2">
                <button (click)="service.downloadBackup()" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 px-2 rounded text-xs font-medium flex items-center justify-center gap-1 transition-colors">
                    Export
                </button>
                <label class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 px-2 rounded text-xs font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors">
                    Import
                    <input type="file" accept=".json" class="hidden" (change)="onRestore($event)">
                </label>
            </div>
        </div>
      </div>

      <!-- Right Panel: Details & Editor -->
      <div class="w-2/3 h-full bg-white flex flex-col">
        @if (selectedRoute(); as route) {
          <div class="flex-1 overflow-y-auto">
             <!-- Header -->
            <div class="bg-slate-900 text-white p-8 sticky top-0 z-20 shadow-lg">
               <div class="flex items-start justify-between">
                 <div class="overflow-hidden pr-4">
                    <h1 class="text-3xl font-bold mb-2 truncate" [title]="route.name">{{ route.name }}</h1>
                    <span class="inline-block px-2 py-1 rounded text-xs font-bold uppercase tracking-wide bg-white/20 text-white">
                        {{ getFolderName(route.folderId) }}
                    </span>
                 </div>
                 <div class="text-right flex-shrink-0">
                    <div class="text-4xl font-light text-blue-400">{{ route.stats.distanceKm }} <span class="text-lg text-slate-400">km</span></div>
                 </div>
               </div>

               <div class="grid grid-cols-4 gap-4 mt-8 pt-6 border-t border-slate-700">
                  <div>
                    <div class="text-slate-400 text-xs uppercase tracking-wider mb-1">Elev Gain</div>
                    <div class="text-xl font-semibold">{{ route.stats.elevationGainM }} m</div>
                  </div>
                  <div>
                    <div class="text-slate-400 text-xs uppercase tracking-wider mb-1">Elev Loss</div>
                    <div class="text-xl font-semibold">{{ route.stats.elevationLossM }} m</div>
                  </div>
                  <div>
                    <div class="text-slate-400 text-xs uppercase tracking-wider mb-1">Avg Slope</div>
                    <div class="text-xl font-semibold">{{ route.stats.avgSlope }}%</div>
                  </div>
                   <div>
                    <div class="text-slate-400 text-xs uppercase tracking-wider mb-1">Max Slope</div>
                    <div class="text-xl font-semibold text-red-400">{{ route.stats.maxSlope }}%</div>
                  </div>
               </div>
            </div>

            <!-- Edit Form -->
            <div class="p-8 max-w-3xl mx-auto">
                <h3 class="text-lg font-bold text-slate-800 mb-6 border-b pb-2">Edit Route Details</h3>
                
                <div class="space-y-6">
                    <div>
                        <label class="block text-sm font-semibold text-slate-600 mb-2">Route Name</label>
                        <input type="text" 
                            [ngModel]="route.name" 
                            (ngModelChange)="updateName(route, $event)" 
                            class="w-full px-4 py-3 rounded-lg bg-slate-800 text-white border border-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-slate-400 shadow-inner transition-colors">
                    </div>

                    <div>
                        <label class="block text-sm font-semibold text-slate-600 mb-2">Description</label>
                        <textarea 
                            [ngModel]="route.description" 
                            (ngModelChange)="updateDesc(route, $event)" 
                            rows="6" 
                            class="w-full px-4 py-3 rounded-lg bg-slate-800 text-white border border-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-slate-400 shadow-inner transition-colors"></textarea>
                    </div>

                    <div>
                        <label class="block text-sm font-semibold text-slate-600 mb-2">Move to Folder</label>
                        <select [ngModel]="route.folderId" (ngModelChange)="updateFolder(route, $event)" class="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white text-slate-800 cursor-pointer">
                            @for (f of service.folders(); track f.id) {
                                <option [value]="f.id">{{ f.name }}</option>
                            }
                        </select>
                    </div>
                    
                    <div class="pt-8 mt-8 border-t border-slate-100 flex justify-end">
                        <button (click)="deleteRoute(route.id)" class="px-5 py-2.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all font-medium flex items-center gap-2">
                             <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                             Delete this Route
                        </button>
                    </div>
                </div>
            </div>
          </div>
        } @else {
          <div class="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-slate-50/50">
            <div class="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 shadow-sm">
                <svg class="w-10 h-10 text-slate-300" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clip-rule="evenodd"/></svg>
            </div>
            <h3 class="text-xl font-semibold text-slate-600 mb-2">No Route Selected</h3>
            <p class="text-slate-500 max-w-sm">Select a route from the sidebar to view details, analyze stats, or edit information.</p>
          </div>
        }
      </div>
    </div>
  `
})
export class ManagementViewComponent implements OnInit {
  service = inject(RouteService);
  onBack = output<void>();
  onSettings = output<void>();
  initialRouteId = input<string | undefined>();
  
  selectedRouteId = signal<string | null>(null);
  editingFolderId = signal<string | null>(null);

  selectedRoute = computed(() => 
    this.service.routes().find(r => r.id === this.selectedRouteId()) || null
  );

  ngOnInit() {
    const initId = this.initialRouteId();
    if (initId) {
      this.selectedRouteId.set(initId);
    }
  }

  getRoutesInFolder(folderId: string) {
    return this.service.routes().filter(r => r.folderId === folderId);
  }

  getFolderName(id: string) {
    return this.service.folders().find(f => f.id === id)?.name || 'Unknown';
  }

  addFolder(name: string) {
    if(!name.trim()) return;
    this.service.addFolder(name);
  }

  startRenaming(event: Event, id: string) {
      event.stopPropagation();
      this.editingFolderId.set(id);
  }

  saveRename(id: string, newName: string) {
      if (newName && newName.trim()) {
          this.service.renameFolder(id, newName.trim());
      }
      this.editingFolderId.set(null);
  }

  deleteFolder(event: Event, id: string) {
      event.stopPropagation();
      if(confirm('Are you sure you want to delete this folder and all its routes?')) {
          this.service.deleteFolder(id);
      }
  }

  selectRoute(route: RouteData) {
    this.selectedRouteId.set(route.id);
  }

  onFileSelected(event: Event, folderId: string) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const files = Array.from(input.files);
      this.service.processGpxFiles(files, folderId);
      input.value = '';
    }
  }

  async onRestore(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      if (confirm('Restoring will OVERWRITE all current data. Continue?')) {
          const success = await this.service.restoreBackup(file);
          if (success) {
            alert('Data restored successfully!');
          } else {
            alert('Failed to restore data.');
          }
      }
      input.value = '';
    }
  }

  updateName(route: RouteData, name: string) {
    this.service.updateRoute({ ...route, name });
  }

  updateDesc(route: RouteData, description: string) {
    this.service.updateRoute({ ...route, description });
  }

  updateFolder(route: RouteData, folderId: string) {
    this.service.updateRoute({ ...route, folderId });
  }

  deleteRoute(id: string) {
    if(confirm('Are you sure you want to delete this route?')) {
        this.service.deleteRoute(id);
        this.selectedRouteId.set(null);
    }
  }
}
