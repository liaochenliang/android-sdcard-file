# ADB SDCard 文件管理器

基于 Tauri + React + TypeScript 的桌面应用，通过 ADB 管理 Android 设备 SD 卡文件。

## 功能

- 📁 浏览 `/sdcard/` 目录，支持进入子目录和返回上级
- 🔍 文件名搜索，支持输入包名（如 `com.medialab.app`）直接跳转到应用数据目录
- ⬇️ 下载设备文件到本地
- ⭐ 收藏夹，快速访问常用路径
- 📍 路径导航栏，手动输入路径跳转
- 🔧 内置 adb，无需额外安装


## 安装

从 [Releases](../../releases) 页面下载对应平台安装包：

| 平台 | 文件 |
|------|------|
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Windows | `.msi` / `.exe` |

## 使用前提

- Android 设备已通过 USB 连接电脑
- 设备已开启 USB 调试（开发者选项）
- 首次连接时在设备上确认授权

## 从源码构建

```bash
# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建 release
npm run tauri build
```

### 构建要求

- Node.js >= 18
- Rust >= 1.70
- macOS: Xcode Command Line Tools
- Windows: Visual Studio Build Tools

## 技术栈

- [Tauri 2](https://tauri.app/) - 桌面应用框架
- [React 19](https://react.dev/) - 前端 UI
- TypeScript - 类型安全
- Rust - 后端 ADB 命令调用

## License

MIT
