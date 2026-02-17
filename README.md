<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# **VeloRoute Manager** 

**VeloRoute Manager** 是一个现代化的桌面应用程序，专为自行车爱好者和路线规划者设计。它提供了一个直观的界面来组织、分析和可视化 GPX 骑行路线。

该应用基于 **Angular (v18+)** 和 **Electron** 构建，采用 **Zoneless** 架构以实现高性能渲染，并结合 **Mapbox GL JS** 提供令人惊叹的 3D 地形可视化体验。

## 主要功能

### 高级地图可视化

* **3D 地形渲染**：基于 Mapbox GL JS v3，支持真实的 3D 地形（DEM）和大气雾效。
* **图层切换**：支持在 Mapbox Outdoors（3D 户外风格）和 OpenStreetMap（平面风格）之间无缝切换。
* **动态视角**：支持地图倾斜（Pitch）和旋转，按住右键即可查看地形起伏。
* **对比模式 (Comparison Mode)**：一键切换视图模式，按文件夹颜色对路线进行着色，便于比较不同类型的路线集合。

### GPX 分析与管理

- **智能导入**：支持批量导入 .gpx 文件。
- **自动数据分析**：导入时自动计算关键指标：
  * 总距离 (km)
  * 累计爬升 / 下降 (m)
  * 平均坡度 / 最大坡度 (%)
- **文件夹管理**：创建自定义文件夹（如 "To Ride", "Completed", "Hiking"）来分类路线。
- **路线编辑**：重命名路线、添加描述、在文件夹之间移动路线。

### 数据持久化

- **Local-First**：基于 Electron 的本地文件存储，数据保存在用户的本地系统中 (storage.json)，无需依赖云端数据库。
- **备份与恢复**：内置 JSON 格式的完整数据导出与导入功能，防止数据丢失。

## 技术栈

本项目采用了最新的前端技术栈，确保代码的可维护性和高性能：

* **Core Framework**：Angular 18+（独立组件、信号、无区域变更检测）。
* **Desktop Container**: [Electron](https://www.google.com/url?sa=E&q=https%3A%2F%2Fwww.electronjs.org%2F) (通过 IPC 通信处理本地文件读写)。
* **Styling**: [Tailwind CSS](https://www.google.com/url?sa=E&q=https%3A%2F%2Ftailwindcss.com%2F) (实用优先的 CSS 框架)。
* **Map Engine**: [Mapbox GL JS v3](https://www.google.com/url?sa=E&q=https%3A%2F%2Fdocs.mapbox.com%2Fmapbox-gl-js%2F) (需 API Key)。
* **Language**: TypeScript (ES2022)。

## 快速开始

**本软件仅支持window环境下运行。**

### 前置要求

* Node.js (建议 v18 或更高版本)
* npm

### **安装依赖**

```bash
npm install
```

### 开发环境运行

你有两种方式运行此项目：

1. **Web 模式 (仅 Angular)**：
   仅在浏览器中运行前端界面（注意：此模式下无法使用 Electron 的文件读写功能，将回退到 localStorage）。

   ```bash
   npm start
   ```

   访问: http://localhost:4200

2. **桌面应用模式 (Electron + Angular)**：
   构建 Angular 应用并启动 Electron 窗口（推荐开发方式）。

   ```bash
   npm run electron:dev
   ```

### 构建生产版本

生成用于分发的安装包或可执行文件：
```bash
npm run electron:build
```

构建产物将位于 `release/` 目录下。

## Mapbox 配置说明

为了体验完整的 3D 地形和户外地图风格，你需要一个 Mapbox Public Access Token。**它是必须的**。

1. 前往 [Mapbox.com](https://www.google.com/url?sa=E&q=https%3A%2F%2Fmapbox.com) 注册并获取免费的 Public Token。
2. 启动应用后，界面会提示输入 API Key。
   * *若跳过，后续可在设置中修改。*
3. 输入 Key 后，应用会自动验证并保存到本地设置中。
   * *注意：如果没有 API Key，地图将显示空白。*

## 项目结构

```code
src/
├── app.component.ts          # 根组件，处理视图路由（Map vs Manage vs Settings）
├── components/
│   ├── map-view.component.ts      # 地图视图核心逻辑（Mapbox 初始化、图层管理）
│   ├── management-view.component.ts # 侧边栏管理界面（文件夹、路线列表、详情页）
│   └── settings-view.component.ts   # 设置页面（API Key 管理）
├── services/
│   └── route.service.ts      # 核心服务：状态管理 (Signals)、GPX 解析、数据持久化
├── main.ts                   # Angular 启动入口 (Zoneless 配置)
└── ...
main.js                       # Electron 主进程
preload.js                    # Electron 预加载脚本 (Context Bridge)
```



## 许可证

此项目仅供学习和个人使用。地图数据版权归 Mapbox 和 OpenStreetMap 所有。













