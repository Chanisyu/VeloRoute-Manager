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
| `src/services/route.service.ts` | 共享状态、GPX/FIT 批量导入、统计调用、自动保存、备份和 Token 验证。 |
| `shared/fit-route.mjs` | 校验 FIT，提取轨迹、高程、分段及码表会话汇总。 |
| `shared/route-statistics.mjs` | 纯函数统计引擎及口径版本；细节和验证依据见 [STATISTICS.md](STATISTICS.md)。 |
| `src/component/route-profile.component.ts`、`shared/route-profile.mjs` | 路线详情的交互剖面、原始高程插值及临时视窗；像素抽稀只影响绘制，悬停读取完整数据。 |
| `shared/storage-schema.mjs`、`storage/store.mjs` | 跨进程数据校验/迁移与桌面原子存储；类型声明为相邻 `.d.mts`。 |
| `src/component/storage-status.component.ts` | 保存反馈、失败重试及读取失败后的安全恢复入口。 |
| `src/component/map-view.component.ts` | 底图、地形、路线图层、文件夹对比。悬停时临时置顶可见的高亮路线，结束后恢复图层添加顺序。右键列表和点击地图线条共用详情入口。 |
| `src/component/amap-view.component.ts`、`src/amap-frame/index.html` | 高德 JS API 2.0 的宿主与隔离页，固定消息同步可见轨迹、视角与交互。 |
| `src/component/management-view.component.ts`、`settings-view.component.ts` | 文件夹与路线编辑、GPX/备份导入、Mapbox 设置；组件使用内联模板。 |
| `desktop/gpx-studio.cjs`、`src/services/gpx-exchange.ts` | 官方 GPX Studio 在线编辑窗与本机轨迹副本交接；独立会话，使用一次性协议 URL，不给编辑器提供 IPC 或磁盘路径。 |
| `main.js`、`preload.js` | 窗口、文件持久化、`save-data/load-data` IPC；桥接为 `window.electronAPI.saveData/loadData`。 |
| `GPX_example/`、`FIT_example/`、`Docs/` | 前两者含 GPX 和码表 FIT 样例；`Docs/` 中的历史提示词与功能设想不代表已实现或已授权需求。 |

## 数据与地图边界

- 界面统一使用简体中文，Mapbox 控件和桌面菜单亦提供中文；保留品牌、格式名称、单位及底图英文名称（`Outdoors (3D)`、`OpenStreetMap`）。仅首次默认目录、新导入简介使用中文，不批量翻译已有用户名称或简介，也不更改 JSON 字段名。`shared/user-messages.mjs` 统一平台错误的中文说明。
- `RouteData` 保存 UUID、所属 `folderId`、名称/描述、`points`、`segmentStarts`、`stats`、`sourceFormat`、颜色及显隐。点为 `{lat, lon, ele}`，高程缺失为 null；GeoJSON 使用 `[lon, lat]`，已知分段绘制为 MultiLineString。删除文件夹会连同路线删除。
- GPX 导入保留原始点序和 trkseg、rte 边界，读取 trkpt/rtept，不导入 wpt，不保留 XML、时间和扩展字段。编辑器导回走相同导入流程并新增路线。统计 v1 按20m RDP关键轮廓及±100m趋势残差平滑累计升降；均值为距离加权上坡坡度，最大坡度为完整100m窗口。跨分段/长缺口不求最大坡度，无50%硬截断；数据不足用null。原始点不被滤波覆盖。
- FIT 保存有效定位点及高程，优先使用增强高程。缺定位、计时启停与后续会话起点切分轨迹。四项高程指标读取会话汇总，缺项为 null，不从逐点高程或坡度重算。新版保存 `stats.source: 'fit-session'`，与 `algorithmVersion` 互斥。
- 历史统计保留原值，旧 FIT 需重新导入原文件才能读取码表汇总。路线详情的“最大坡度”在 GPX 指最大100米平均上坡坡度，在 FIT 指设备汇总的最大上坡坡度。解释集中在设置页默认折叠的“路线统计与计算说明”。
- 剖面按原始高程绘制并保留分段，缺高程处断开且不显示提示。悬停20m坡度使用同一有效区间内前后各10m的插值高差；不足完整窗口省略该字段，不沿用顶部100m最大坡度的间距筛选规则。缩放/拖动不保存、不改原始数据。
- 桌面为 `storage.json`（v6）；`.bak` 为上一版有效数据。未打包运行仍使用独立开发目录。主进程排队异步写入、同步临时文件后替换；读取损坏时禁止默认数据覆盖。恢复原文保存在 `.preserved-*.json`，详情见 [STORAGE.md](STORAGE.md)。
- 导出备份为 v6（含时间戳与 Mapbox Token），兼容无版本及 v1 至 v5，早于 v5 且缺少导入来源的路线标为 GPX。统一校验后先落盘再替换界面。浏览器使用 `velo_data/velo_data_backup`，只在缺少新键时迁移旧三键；桌面不再维护浏览器数据镜像。
- 保存防抖 400ms；正常关闭等待待保存快照、导入、恢复及在途写入，失败返回应用。不要绕过校验直接设置加载结果，也不要把读取失败当作首次启动。主进程以单实例锁保护同一数据目录。
- 普通保存反馈显示 3 秒后渐隐 300ms 并移除；进行中及错误状态持续可见。新状态或通知须取消旧计时，展示状态不参与持久化。
- 底图支持 Outdoors v12、OSM 栅格（两者共用 Mapbox）及高德地图（独立 JS API 2.0）。地图实例跨页保留，后台隐藏画布、停用交互并推迟路线同步。更换凭据重建对应地图，Mapbox 样式就绪后恢复路线，首次倾斜时加载地形。重启后视角、底图和对比模式重置；仅配置高德时直接显示高德。
- 高德凭据由主进程通过 Electron `safeStorage` 独立加密保存，浏览器预览使用 `sessionStorage`，路线存储和备份不含高德凭据。高德远程脚本仅在 sandbox 隔离页加载；EPSG:4326 轨迹在宿主用固定版本的 `coordtransform` 本地转为 GCJ‑02 显示，各原始分段、统计和持久化坐标继续使用原数据。
- 地图与管理页通过 `routesByFolder` 共用路线分组缓存。地图渲染在 Angular 区域外运行，按已提交的路线和颜色差异更新图层。浮窗读取当前路线元数据，以纯文本填充名称。

## 工作流与待处理项

- 使用 Node.js 22.22.3、npm 10.9.8 和 `npm ci`；所有直接依赖固定版本并提交锁文件。本阶段维持旧框架版本系列，升级单独实施。
- 日常运行 `npm run dev`（`electron:dev` 为别名），前端自动刷新，主进程/preload 自动重启；Web 为 `npm start`；静态桌面预览为 `npm run electron:preview`。完整流程见 [DEVELOPMENT.md](DEVELOPMENT.md)。
- `npm run check` 执行语法检查、存储故障测试、生产构建及 Playwright 浏览器/Electron 测试；`npm run test:storage` 单独验证存储层。首次安装浏览器命令不变；测试使用 4201 端口及临时目录。
- `npm run test:statistics` 验证解析解、分段、缺高程、重复位置、采样缺口及200条可复现随机轨迹的不变量；已接入完整检查。
- `npm run test:fit` 验证 FIT 字段换算、分段、损坏文件与码表样例，已接入完整检查。
- `npm run electron:build` 使用相对资源路径，输出 `release/`，禁用自动发布；当前使用 Electron 默认图标。GitHub Actions 在 Windows 上检查构建、测试及安装包生成。
- 功能变更验证受影响的 GPX/FIT 导入、地图交互、重启持久化及备份恢复流程；交付前验证安装包。不要把普通界面调整变成每次重新安装。
- 旧框架依赖升级另行处理。存储变更必须验证旧格式、损坏文件、失败写入、重试及退出保存，不访问用户正式数据。
