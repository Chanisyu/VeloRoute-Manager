# 开发与验证流程

## 环境与依赖

- 本阶段恢复 Angular 18 / Electron 30 的构建基线；框架大版本升级单独实施。
- Node.js **22.22.3**（见 `.nvmrc`）、npm **10.9.8**。使用版本管理器切换运行环境，不要覆盖其他项目的全局环境。
- Windows 可运行 `dev.cmd`；它优先使用 `%LOCALAPPDATA%/VeloRoute-Toolchain/node-v22.22.3-win-x64/` 中的独立运行时（若已安装），否则使用终端的 Node.js。该脚本不自动下载或修改系统环境。
- 首次准备及拉取依赖更新后运行 `npm ci`，不要删除锁文件或使用 `--force`、`--legacy-peer-deps` 绕过依赖检查。
- 新增依赖必须固定版本并提交 `package.json` 与 `package-lock.json`；不要提交 `node_modules/`、`dist/`、`release/` 或测试输出。

## 日常开发

1. 运行 `npm run dev`：启动 Angular 服务并等待就绪，再打开 Electron 开发窗口。
2. 修改 `src/`：自动编译并刷新界面。修改 `main.js`、`preload.js`、`storage/` 或 `shared/`：自动重启 Electron；共享模块也参与前端编译。
3. 开发窗口使用 `%APPDATA%/veloroute-manager-development/`，与正式安装版的数据隔离；关闭窗口后在终端按 `Ctrl+C` 结束开发服务。
4. 每次变更由开发者先执行 `npm run check`，根据变更补充必要的测试，再说明用户应验证的界面行为。
5. 用户在开发窗口操作确认，无需打包、下载或重新安装。修改依赖、Angular 配置或启动脚本后应重新启动开发命令。

仅预览浏览器时使用 `npm start`，访问 <http://127.0.0.1:4200>；该模式的数据使用独立的浏览器 localStorage，不能替代桌面持久化验证。

## 检查与交付

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 构建前端；相对资源路径适用于 Electron 的 `file://` 加载。 |
| `npm run test:storage` | 存储校验、迁移、原子写入、备份保护及故障恢复测试。 |
| `npm test` | 存储测试、生产构建与浏览器/Electron 测试；首次先安装 Chromium。 |
| `npm run check` | 主进程语法检查、生产前端构建和自动化测试。 |
| `npm run electron:preview` | 构建后直接运行本地静态产物，验证与开发服务器的加载差异。 |
| `npm run electron:build` | 生成 `release/` 中的 Windows x64 NSIS 安装包。 |

- 打包前关闭静态预览窗口，避免构建产物被占用。发布前验证安装、启动、资源加载和卸载；日常界面改动无需安装包测试。
- 自动测试使用系统临时目录，结束后清理，不访问正式用户数据。地图底图与 Token 验证仍依赖外网及有效 Mapbox Public Token。
- 提交使用专业简洁的中文标题与正文，说明修改内容及验证结果；构建基线、功能改动和依赖大版本升级分别提交。
- 保存状态、正常退出等待与备份恢复流程见 [STORAGE.md](STORAGE.md)。不要使用强制终止进程替代正常关闭的验收。
- 未保存修改可能阻止桌面刷新；待显示“已保存”后再刷新。主进程的开发热重启属于进程重启，不具备正常关闭握手的保证。
- 旧框架及打包工具的依赖审计仍包含已知漏洞，恢复构建不代表完成安全升级。运行 `npm audit` 查看详情；涉及 Angular/Electron 大版本的修复应另行评估，不直接执行 `npm audit fix --force`。
- Windows 重装依赖前关闭开发窗口；若编辑器占用 `node_modules/` 文件导致 `EBUSY`，先解除文件占用再运行 `npm ci`。不要关闭未保存的编辑文档或删除项目源码。
