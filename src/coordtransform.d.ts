declare module 'coordtransform' {
  /** @returns 高德 GCJ-02 经度、纬度，用于显示原始 GPS 点。 */
  export function wgs84togcj02(longitude: number, latitude: number): [number, number];
  /** @returns 近似 WGS-84 经度、纬度，仅用于切换底图时保持视点。 */
  export function gcj02towgs84(longitude: number, latitude: number): [number, number];
}
