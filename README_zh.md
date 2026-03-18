# Android SDCard 文件管理器

中文 | [English](README.md)

基于 Tauri 2 + React 的桌面应用，通过 ADB 管理 Android 设备 SDCard 文件。

![截图](Xnip2026-03-18_18-14-39.jpg)

## 功能

- 设备信息面板（品牌、型号、Android 版本、SDK、序列号、分辨率、电池、存储）
- 浏览 Android 设备 `/sdcard/` 目录结构
- 文件搜索（支持文件名关键字和 Android 包名直达）
- 下载设备文件到本地
- 上传本地文件到设备（支持文件选择和拖拽上传）
- 删除设备上的文件/目录
- 安装本地 APK 文件到设备
- 文本文件在线预览
- 目录收藏夹（本地持久化）
- 面包屑路径导航
- 仿爱思助手侧边栏布局
- 自动检测系统 ADB 路径，也支持内置 ADB

## 环境要求

- Node.js >= 18
- Rust >= 1.70
- ADB（Android SDK Platform Tools）
- Android 设备已开启 USB 调试并通过 USB 连接

## 安装与运行

```bash
# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建生产包
npm run tauri build
```

## 技术栈

- Tauri 2
- React 19 + TypeScript
- Vite 7
- Rust（后端 ADB 命令调用）

## 项目结构

```
├── src/                # React 前端
│   ├── App.tsx         # 主界面组件（侧边栏 + 多页面）
│   └── App.css         # 样式
├── src-tauri/          # Tauri/Rust 后端
│   ├── src/lib.rs      # ADB 命令封装（device-info/list/download/upload/delete/search/install/preview）
│   └── tauri.conf.json # Tauri 配置
└── package.json
```

## 许可证

MIT
