import type { RouteData } from './route.service';

/** 供下载和桌面编辑器使用的标准 GPX 副本。 */
export interface GpxCopy {
  name: string;
  xml: string;
}

/** @param value 路线名称或简介。 @returns 转义后的 XML 文本，移除 XML 1.0 禁止的字符。 */
function xmlText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** @param value 已校验的有限坐标或高程。 @returns GPX decimal 文本，展开科学计数法以保留有效数字。 */
function decimal(value: number): string {
  const [mantissa, exponent] = Math.abs(value).toString().split('e');
  if (!exponent) return String(value);
  const [whole, fraction = ''] = mantissa.split('.');
  const digits = whole + fraction;
  const index = whole.length + Number(exponent);
  const sign = value < 0 ? '-' : '';
  if (index < 1) return sign + '0.' + '0'.repeat(-index) + digits;
  if (index >= digits.length) return sign + digits.padEnd(index, '0');
  return sign + digits.slice(0, index) + '.' + digits.slice(index);
}

/** @param route 当前路线快照。 @returns UTF-8 GPX 1.1 内容，保持点序、分段和已知高程。 */
export function createGpxCopy(route: RouteData): GpxCopy {
  let basename = [...route.name.replace(/[<>:"/\\|?*#%\u0000-\u001F\uD800-\uDFFF]/gu, '_')]
    .slice(0, 100).join('').trim().replace(/[. ]+$/, '');
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(basename)) basename = '_' + basename;
  const name = (basename || '路线') + '.gpx';
  const starts = route.segmentStarts ?? [0];
  const segments = starts.map((start, index) => {
    const points = route.points.slice(start, starts[index + 1] ?? route.points.length);
    const lines = points.map(({ lat, lon, ele }) => {
      const elevation = ele === null ? '' : '<ele>' + decimal(ele) + '</ele>';
      return '<trkpt lat="' + decimal(lat) + '" lon="' + decimal(lon) + '">' + elevation + '</trkpt>';
    });
    return '<trkseg>\n' + lines.join('\n') + '\n</trkseg>';
  });
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="VeloRoute Manager">\n' +
    '<trk><name>' + xmlText(route.name) + '</name><desc>' + xmlText(route.description) + '</desc>\n' +
    segments.join('\n') + '\n</trk>\n</gpx>\n';
  return { name, xml };
}

/** @param file 已生成的 GPX 副本。 @returns 无返回值；仅在本机发起下载。 */
export function downloadGpxCopy(file: GpxCopy): void {
  const url = URL.createObjectURL(new Blob([file.xml], { type: 'application/gpx+xml' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
