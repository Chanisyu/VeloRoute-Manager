# 项目开发指南

## 修改约束

- 仅在用户明确授权后修改代码；分析任务不附带修复。修改前读取本文件及适用子目录约定；若存在 `AGNETS.md`，一并读取。
- 新增或修改的代码须有详细注释：函数/类使用 JSDoc 说明职责、参数、返回值及边界；复杂分支、数据兼容和 IPC 说明设计原因。中文注释使用 UTF-8。

## 技术与入口

- Angular 18（Standalone、Signals、`@if/@for`）+ TypeScript ~5.4.2，开启严格类型与模板检查；RxJS ~7.8。实际入口为 `src/main.ts`，使用 Zone.js，README 的 Zoneless 描述不符合当前构建。
- Electron ^30 + CommonJS 主进程；electron-builder ^24.13，配置为 Windows NSIS 安装包。渲染进程禁用 Node 集成、启用上下文隔离，本地能力通过 preload 桥接。
- Mapbox GL JS 3.9.4 与 Tailwind 样式由 `index.html` 的 CDN 加载；地图对象为全局 `mapboxgl: any`，不是 npm 模块。当前不能视为离线应用。
- 根目录 `index.tsx` 和 Angular 21 import map 是 AI Studio 遗留项，不是 CLI 构建入口；Leaflet 虽已声明但无业务引用，`GEMINI_API_KEY` 无调用实现。无业务后端、数据库或云同步。

## 代码定位

| 位置 | 职责与扩展入口 |
| --- | --- |
| `src/app.component.ts` | 通过 Signal 切换地图、管理、设置视图；未接入 Angular Router。 |
| `src/services/route.service.ts` | 数据类型、共享状态、GPX 解析、统计、自动保存、备份及 Token 验证集中于此。 |
| `src/component/map-view.component.ts` | 底图、地形、路线图层、悬浮/点击交互、文件夹对比；每条路线有独立 GeoJSON source、显示层和命中层。 |
| `src/component/management-view.component.ts`、`settings-view.component.ts` | 文件夹与路线编辑、GPX/备份导入、Mapbox 设置；组件使用内联模板。 |
| `main.js`、`preload.js` | 窗口、文件持久化、`save-data/load-data` IPC；桥接为 `window.electronAPI.saveData/loadData`。 |
| `GPX_Eample/`、`Docs/` | 前者含 28 个 GPX 样例；后者是历史提示词、教程及功能设想，不代表已实现或已授权需求。 |

## 数据与地图边界

- `RouteData` 保存 UUID、所属 `folderId`、名称/描述、`points`、`stats`、颜色及显隐状态；点格式为 `{lat, lon, ele}`，GeoJSON 坐标顺序为 `[lon, lat]`。删除文件夹会连同路线删除。
- GPX 仅提取 `trkpt`，缺失高程按 0 处理，不保留原始 XML、时间或扩展字段；不同 `trk/trkseg` 被合并，不支持 `rtept/wpt`。距离使用 Haversine；平均坡度是有效点段有符号坡度的算术平均，坡度绝对值 ≥50% 的段不参与坡度统计。
- 桌面存储为 `app.getPath('userData')/storage.json`，结构 `{folders, routes, settings}`；Web 从 `velo_folders/velo_routes/velo_settings` 读取。桌面保存也会写 localStorage，不能将其理解为仅有失败回退。
- 导出备份为 `version: 2`，含时间戳、文件夹、路线及设置（包括 Mapbox Token）；恢复会覆盖现有数据，目前无完整结构校验或版本迁移。修改数据结构须兼容已有存储和备份。
- `mapState` 仅在内存中保留视角；重启会重置对比模式。底图只有 Outdoors v12 和 OSM 栅格，地形在倾斜时启用；OSM 也受当前 Mapbox Token 初始化流程约束。切换样式后必须恢复路线图层。

## 工作流与待处理项

- Web：`npm start`；前端构建：`npm run build`；桌面预览：`npm run electron:dev`（先构建后加载 `file://`，无热更新）；Windows 打包：`npm run electron:build`（设置相对 base href，输出 `release/`）。Node/TypeScript 须按 [Angular 兼容表](https://angular.dev/reference/versions) 配套选择。
- 已确认的构建阻断：实际目录是 `src/component/`，根组件三个导入却指向 `./components/`。此外，构建/打包引用的 `src/favicon.ico` 缺失，HTML 引用的 `/index.css` 也不存在。
- 未提交依赖锁文件，`tailwindcss` 使用 `latest`，Angular 构建依赖有重复声明；恢复可复现构建后再分步升级旧框架。不要将 CDN import map 的版本当作 npm 依赖版本。
- `npm test` 虽已声明，但 `angular.json` 没有 test target，也无测试文件、lint 或 CI 配置。功能变更至少验证构建，以及 GPX 导入、地图交互、重启持久化和备份恢复中受影响的流程。
- 可靠性重点：主进程整份同步覆盖 JSON，无原子写入/备份；前端未处理保存返回的 `{success:false}`。安全重点：路线名称直接拼入 Popup 的 `setHTML`，导入数据与 IPC 参数缺少严格校验。
- `LICENSE` 为 MIT，与 README 的“仅供学习和个人使用”表述不一致，发布前需统一。
