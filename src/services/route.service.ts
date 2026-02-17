
import { Injectable, signal, computed, effect } from '@angular/core';

export interface RouteStats {
  distanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  avgSlope: number;
  maxSlope: number;
  minSlope: number;
}

export interface RoutePoint {
  lat: number;
  lon: number;
  ele: number;
}

export interface RouteData {
  id: string;
  name: string;
  description: string;
  folderId: string;
  points: RoutePoint[];
  stats: RouteStats;
  color: string;
  isVisible: boolean;
}

export interface Folder {
  id: string;
  name: string;
  isExpanded: boolean;
  // Generated color for Comparison Mode
  color?: string; 
}

export interface AppSettings {
  mapboxApiKey: string;
  mapboxKeyValid: boolean;
  dontRemindMapbox: boolean;
  isComparisonMode: boolean; // UI state for map
}

export interface MapState {
  center: { lng: number; lat: number };
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface AppDataBackup {
  version: number;
  timestamp: number;
  folders: Folder[];
  routes: RouteData[];
  settings?: AppSettings;
}

interface ElectronAPI {
  saveData: (data: any) => Promise<{ success: boolean; error?: string }>;
  loadData: () => Promise<any | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

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

  private isLoaded = false;

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

  constructor() {
    this.initializeData();
    
    // Auto-save effect
    effect(() => {
      const currentFolders = this.folders();
      const currentRoutes = this.routes();
      const currentSettings = this.appSettings();

      if (this.isLoaded) {
        this.saveData(currentFolders, currentRoutes, currentSettings);
      }
    });
  }

  private async initializeData() {
    if (window.electronAPI) {
      try {
        const data = await window.electronAPI.loadData();
        if (data) {
            console.log('Loaded data from Electron storage');
            if (data.folders) this.folders.set(this.ensureFolderColors(data.folders));
            if (data.routes) this.routes.set(data.routes);
            if (data.settings) {
                this.appSettings.set({
                    ...this.appSettings(), 
                    ...data.settings,
                    isComparisonMode: false // Always reset view mode on load
                });
                
                // Re-validate key on startup if exists
                if (data.settings.mapboxApiKey) {
                    await this.validateMapboxKey(data.settings.mapboxApiKey);
                }
            }
        } else {
            await this.loadFromLocalStorage(); 
        }
      } catch (err) {
        console.error('Error loading from Electron:', err);
        await this.loadFromLocalStorage(); 
      }
    } else {
      await this.loadFromLocalStorage();
    }
    
    this.isLoaded = true;
    this.initialized.set(true);
  }

  private async loadFromLocalStorage() {
    const savedFolders = localStorage.getItem('velo_folders');
    const savedRoutes = localStorage.getItem('velo_routes');
    const savedSettings = localStorage.getItem('velo_settings');

    if (savedFolders) {
        const parsed: Folder[] = JSON.parse(savedFolders);
        this.folders.set(this.ensureFolderColors(parsed.map(f => ({...f, isExpanded: f.isExpanded ?? true}))));
    }
    if (savedRoutes) this.routes.set(JSON.parse(savedRoutes));
    if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        this.appSettings.set({ ...this.appSettings(), ...settings, isComparisonMode: false });
        if(settings.mapboxApiKey) {
            await this.validateMapboxKey(settings.mapboxApiKey);
        }
    }
  }

  private saveData(folders: Folder[], routes: RouteData[], settings: AppSettings) {
    const dataToSave = { folders, routes, settings };

    if (window.electronAPI) {
      window.electronAPI.saveData(dataToSave).catch(err => {
        console.error('Failed to auto-save to file:', err);
      });
    }

    localStorage.setItem('velo_folders', JSON.stringify(folders));
    localStorage.setItem('velo_routes', JSON.stringify(routes));
    localStorage.setItem('velo_settings', JSON.stringify(settings));
  }

  private ensureFolderColors(folders: Folder[]): Folder[] {
      return folders.map(f => {
          if (!f.color) {
              return { ...f, color: this.getRandomColor() };
          }
          return f;
      });
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
  
  downloadBackup() {
    const data: AppDataBackup = {
      version: 2,
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

  async restoreBackup(file: File): Promise<boolean> {
    try {
      const text = await file.text();
      const data: AppDataBackup = JSON.parse(text);
      if (!data.folders || !data.routes) throw new Error('Invalid');
      
      this.folders.set(this.ensureFolderColors(data.folders));
      this.routes.set(data.routes);
      if (data.settings) {
          this.appSettings.set(data.settings);
      }
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  async processGpxFiles(files: File[], folderId: string) {
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

        newRoutes.push({
          id: crypto.randomUUID(),
          name: file.name.replace('.gpx', ''),
          description: 'Imported from GPX',
          folderId, points, stats, color, isVisible: true
        });
      } catch (err) { console.error(err); }
    }
    if (newRoutes.length > 0) this.routes.update(r => [...r, ...newRoutes]);
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
