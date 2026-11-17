# 项目开发指南

## 修改约束

- 仅在用户明确授权后修改代码；分析任务不附带修复。修改前读取本文件及适用子目录约定；若存在 `AGNETS.md`，一并读取。
- 新增或修改的代码须有详细注释：函数/类使用 JSDoc 说明职责、参数、返回值及边界；复杂分支、数据兼容和 IPC 说明设计原因。中文注释使用 UTF-8。

## 技术与入口

- Angular 18.2.14（Standalone、Signals、`@if/@for`）+ TypeScript 5.4.5，开启严格类型与模板检查；RxJS 7.8.2。唯一前端入口为 `src/main.ts`，使用 Zone.js。
- Electron 30.5.1 + CommonJS 主进程；electron-builder 24.13.3，构建 Windows x64 NSIS 安装包。渲染进程禁用 Node 集成、启用上下文隔离，本地能力通过 preload 桥接。
- Mapbox GL JS 3.9.4 从锁定 npm 依赖复制到 `vendor/`，维持全局 `mapboxgl: any` 接口；Tailwind 3.4.19 扫描内联模板并构建本地 CSS。底图和 Token 验证仍需联网。
- 已移除 AI Studio 的 `index.tsx`、import map 与未使用依赖；`GEMINI_API_KEY` 无调用实现。无业务后端、数据库或云同步。

## 代码定位

| 位置 | 职责与扩展入口 |
| --- | --- |
| `src/app.component.ts` | 通过 Signal 切换地图、管理、设置视图；未接入 Angular Router。 |
| `src/services/route.service.ts` | 数据类型、共享状态、GPX 解析、统计、自动保存、备份及 Token 验证集中于此。 |
| `shared/storage-schema.mjs`、`storage/store.mjs` | 跨进程数据校验/迁移与桌面原子存储；类型声明为相邻 `.d.mts`。 |
| `src/component/storage-status.component.ts` | 保存反馈、失败重试及读取失败后的安全恢复入口。 |
| `src/component/map-view.component.ts` | 底图、地形、路线图层、悬浮/点击交互、文件夹对比；每条路线有独立 GeoJSON source、显示层和命中层。 |
| `src/component/management-view.component.ts`、`settings-view.component.ts` | 文件夹与路线编辑、GPX/备份导入、Mapbox 设置；组件使用内联模板。 |
| `main.js`、`preload.js` | 窗口、文件持久化、`save-data/load-data` IPC；桥接为 `window.electronAPI.saveData/loadData`。 |
| `GPX_Eample/`、`Docs/` | 前者含 28 个 GPX 样例；后者是历史提示词、教程及功能设想，不代表已实现或已授权需求。 |

## 数据与地图边界

- 界面统一使用简体中文，Mapbox 控件和桌面菜单亦提供中文；保留品牌、格式名称及单位。仅首次默认目录、新导入简介使用中文，不批量翻译已有用户名称或简介，也不更改 JSON 字段名。`shared/user-messages.mjs` 统一平台错误的中文说明。
- `RouteData` 保存 UUID、所属 `folderId`、名称/描述、`points`、`stats`、颜色及显隐状态；点格式为 `{lat, lon, ele}`，GeoJSON 坐标顺序为 `[lon, lat]`。删除文件夹会连同路线删除。
- GPX 仅提取 `trkpt`，缺失高程按 0 处理，不保留原始 XML、时间或扩展字段；不同 `trk/trkseg` 被合并，不支持 `rtept/wpt`。距离使用 Haversine；平均坡度是有效点段有符号坡度的算术平均，坡度绝对值 ≥50% 的段不参与坡度统计。
- 桌面为 `storage.json`（v3，保留 folders/routes/settings）；`.bak` 为上一版有效数据。未打包运行仍使用独立开发目录。主进程排队异步写入、同步临时文件后替换；读取损坏时禁止默认数据覆盖。恢复原文保存在 `.preserved-*.json`，详情见 [STORAGE.md](STORAGE.md)。
- 导出备份为 v3（含时间戳与 Mapbox Token），兼容无版本/v1/v2；统一校验后先落盘再替换界面。浏览器使用 `velo_data/velo_data_backup`，只在缺少新键时迁移旧三键；桌面不再维护浏览器数据镜像。
- 保存防抖 400ms；正常关闭等待待保存快照、导入、恢复及在途写入，失败返回应用。不要绕过校验直接设置加载结果，也不要把读取失败当作首次启动。主进程以单实例锁保护同一数据目录。
- `mapState` 仅在内存中保留视角；重启会重置对比模式。底图只有 Outdoors v12 和 OSM 栅格，地形在倾斜时启用；OSM 也受当前 Mapbox Token 初始化流程约束。切换样式后必须恢复路线图层。

## 工作流与待处理项

- 使用 Node.js 22.22.3、npm 10.9.8 和 `npm ci`；所有直接依赖固定版本并提交锁文件。本阶段维持旧框架版本系列，升级单独实施。
- 日常运行 `npm run dev`（`electron:dev` 为别名），前端自动刷新，主进程/preload 自动重启；Web 为 `npm start`；静态桌面预览为 `npm run electron:preview`。完整流程见 [DEVELOPMENT.md](DEVELOPMENT.md)。
- `npm run check` 执行语法检查、存储故障测试、生产构建及 Playwright 浏览器/Electron 测试；`npm run test:storage` 单独验证存储层。首次安装浏览器命令不变；测试使用 4201 端口及临时目录。
- `npm run electron:build` 使用相对资源路径，输出 `release/`，禁用自动发布；当前使用 Electron 默认图标。GitHub Actions 在 Windows 上检查构建、测试及安装包生成。
- 功能变更验证受影响的 GPX 导入、地图交互、重启持久化及备份恢复流程；交付前验证安装包。不要把普通界面调整变成每次重新安装。
- 后续安全重点：路线名称仍直接拼入 Popup 的 `setHTML`；旧框架依赖升级另行处理。存储变更必须验证旧格式、损坏文件、失败写入、重试及退出保存，不访问用户正式数据。
