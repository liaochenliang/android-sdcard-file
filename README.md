# Android SDCard File Manager

[中文](README_zh.md) | English

A desktop app built with Tauri 2 + React for managing Android device SDCard files via ADB.

## Features

- Browse Android device `/sdcard/` directory
- File search (by filename keyword or Android package name)
- Download files from device to local machine
- Directory bookmarks (persisted locally)
- Direct path navigation via address bar
- Auto-detects system ADB path, also supports bundled ADB

## Prerequisites

- Node.js >= 18
- Rust >= 1.70
- ADB (Android SDK Platform Tools)
- Android device with USB debugging enabled, connected via USB

## Install & Run

```bash
# Install dependencies
npm install

# Development mode
npm run tauri dev

# Production build
npm run tauri build
```

## Tech Stack

- Tauri 2
- React 19 + TypeScript
- Vite 7
- Rust (backend ADB command execution)

## Project Structure

```
├── src/                # React frontend
│   ├── App.tsx         # Main UI component
│   └── App.css         # Styles
├── src-tauri/          # Tauri/Rust backend
│   ├── src/lib.rs      # ADB command wrappers (list/download/search)
│   └── tauri.conf.json # Tauri config
└── package.json
```

## License

MIT
