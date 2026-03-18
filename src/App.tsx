import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, ask, open } from "@tauri-apps/plugin-dialog";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import "./App.css";

interface FileEntry {
  name: string;
  is_dir: boolean;
  size: string;
  date: string;
  permissions: string;
}

interface DeviceInfo {
  brand: string;
  model: string;
  device: string;
  android_version: string;
  sdk_version: string;
  serial: string;
  resolution: string;
  battery_level: string;
  battery_status: string;
  storage_total: string;
  storage_used: string;
  storage_free: string;
}

type NavPage = "device" | "files" | "apk" | "favorites";
const DEFAULT_PATH = "/sdcard/";

function App() {
  const [currentPath, setCurrentPath] = useState(DEFAULT_PATH);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adbOk, setAdbOk] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [downloadStatus, setDownloadStatus] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [installStatus, setInstallStatus] = useState("");
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState("");
  const [activePage, setActivePage] = useState<NavPage>("device");
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [deviceError, setDeviceError] = useState("");

  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  useEffect(() => {
    const saved = localStorage.getItem("sdcard-favorites");
    if (saved) setFavorites(JSON.parse(saved));
  }, []);

  useEffect(() => {
    invoke("check_adb")
      .then(() => setAdbOk(true))
      .catch((e) => setError(String(e)));
  }, []);

  const loadDeviceInfo = useCallback(async () => {
    setDeviceLoading(true);
    setDeviceError("");
    try {
      const info = await invoke<DeviceInfo>("get_device_info");
      setDeviceInfo(info);
    } catch (e) {
      setDeviceError(String(e));
    } finally {
      setDeviceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adbOk) loadDeviceInfo();
  }, [adbOk, loadDeviceInfo]);

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    setIsSearching(false);
    try {
      const result = await invoke<FileEntry[]>("list_files", { path });
      setFiles(result);
      setCurrentPath(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 监听 Tauri 拖拽事件
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    const setup = async () => {
      const u1 = await listen(TauriEvent.DRAG_ENTER, () => setIsDragOver(true));
      const u2 = await listen(TauriEvent.DRAG_OVER, () => setIsDragOver(true));
      const u3 = await listen<{ paths: string[] }>(TauriEvent.DRAG_DROP, async (event) => {
        setIsDragOver(false);
        const paths = event.payload.paths;
        if (!paths || paths.length === 0) return;
        const curPath = currentPathRef.current;
        for (const localPath of paths) {
          const fileName = localPath.split(/[/\\]/).pop() || "unknown";
          const remotePath = curPath.endsWith("/") ? `${curPath}${fileName}` : `${curPath}/${fileName}`;
          try {
            setUploadStatus(`正在上传 ${fileName}...`);
            await invoke("upload_file", { localPath, remotePath });
            setUploadStatus(`${fileName} 上传完成`);
          } catch (e) {
            setUploadStatus(`上传失败: ${e}`);
          }
        }
        loadFiles(currentPathRef.current);
        setTimeout(() => setUploadStatus(""), 3000);
      });
      const u4 = await listen(TauriEvent.DRAG_LEAVE, () => setIsDragOver(false));
      unlisteners.push(u1, u2, u3, u4);
    };
    setup();
    return () => { unlisteners.forEach((u) => u()); };
  }, [loadFiles]);

  useEffect(() => {
    if (adbOk) loadFiles(DEFAULT_PATH);
  }, [adbOk, loadFiles]);

  const enterDir = (name: string) => {
    const newPath = currentPath.endsWith("/") ? `${currentPath}${name}/` : `${currentPath}/${name}/`;
    loadFiles(newPath);
  };

  const goUp = () => {
    if (currentPath === "/" || currentPath === "/sdcard/") return;
    const parts = currentPath.replace(/\/$/, "").split("/");
    parts.pop();
    loadFiles(parts.join("/") + "/");
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError("");
    setIsSearching(true);
    try {
      if (searchQuery.match(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/i)) {
        await loadFiles(`/sdcard/Android/data/${searchQuery}/`);
        setIsSearching(false);
        return;
      }
      const result = await invoke<FileEntry[]>("search_files", { path: currentPath, keyword: searchQuery });
      setFiles(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (fileName: string) => {
    const remotePath = currentPath.endsWith("/") ? `${currentPath}${fileName}` : `${currentPath}/${fileName}`;
    try {
      const localPath = await save({ defaultPath: fileName });
      if (!localPath) return;
      setDownloadStatus(`正在下载 ${fileName}...`);
      await invoke("download_file", { remotePath, localPath });
      setDownloadStatus(`${fileName} 下载完成`);
      setTimeout(() => setDownloadStatus(""), 3000);
    } catch (e) {
      setDownloadStatus(`下载失败: ${e}`);
    }
  };

  const handleDelete = async (fileName: string, isDir: boolean) => {
    const confirmed = await ask(
      `确定要删除${isDir ? "文件夹" : "文件"} "${fileName}" 吗？此操作不可恢复。`,
      { title: "确认删除", kind: "warning" }
    );
    if (!confirmed) return;
    const remotePath = currentPath.endsWith("/") ? `${currentPath}${fileName}` : `${currentPath}/${fileName}`;
    try {
      setDownloadStatus(`正在删除 ${fileName}...`);
      await invoke("delete_file", { remotePath, isDir });
      setDownloadStatus(`${fileName} 已删除`);
      loadFiles(currentPath);
      setTimeout(() => setDownloadStatus(""), 3000);
    } catch (e) {
      setDownloadStatus(`删除失败: ${e}`);
    }
  };

  const handleInstallFromLocal = async () => {
    try {
      const selected = await open({
        filters: [{ name: "APK 文件", extensions: ["apk"] }],
        multiple: false,
      });
      if (!selected) return;
      const localPath = typeof selected === "string" ? selected : selected;
      const fileName = String(localPath).split(/[/\\]/).pop() || "unknown.apk";
      setInstallStatus(`正在安装本地 APK: ${fileName}...`);
      await invoke("install_apk_from_local", { localPath: String(localPath) });
      setInstallStatus(`${fileName} 安装成功`);
    } catch (e) {
      setInstallStatus(`安装失败: ${e}`);
    }
    setTimeout(() => setInstallStatus(""), 4000);
  };

  const TEXT_EXTS = new Set([
    "txt","md","json","xml","log","csv","yml","yaml","ini","conf","sh","py","js","ts",
    "html","css","java","kt","c","cpp","h","rs","toml","cfg","properties",
  ]);
  const isTextFile = (name: string) => TEXT_EXTS.has(name.split(".").pop()?.toLowerCase() || "");

  const handlePreview = async (fileName: string) => {
    const remotePath = currentPath.endsWith("/") ? `${currentPath}${fileName}` : `${currentPath}/${fileName}`;
    try {
      setPreviewFileName(fileName);
      setPreviewContent("加载中...");
      const content = await invoke<string>("read_text_file", { remotePath });
      setPreviewContent(content);
    } catch (e) {
      setPreviewContent(`读取失败: ${e}`);
    }
  };

  const toggleFavorite = (path: string) => {
    const newFavs = favorites.includes(path) ? favorites.filter((f) => f !== path) : [...favorites, path];
    setFavorites(newFavs);
    localStorage.setItem("sdcard-favorites", JSON.stringify(newFavs));
  };

  const formatSize = (size: string) => {
    const n = parseInt(size);
    if (isNaN(n)) return size;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const getFileIcon = (name: string, isDir: boolean) => {
    if (isDir) return "📁";
    const ext = name.split(".").pop()?.toLowerCase() || "";
    const icons: Record<string, string> = {
      jpg:"🖼️",jpeg:"🖼️",png:"🖼️",gif:"🖼️",webp:"🖼️",svg:"🖼️",
      mp4:"🎬",avi:"🎬",mkv:"🎬",mov:"🎬",
      mp3:"🎵",wav:"🎵",flac:"🎵",ogg:"🎵",aac:"🎵",
      pdf:"📕",doc:"📘",docx:"📘",txt:"📝",md:"📝",
      zip:"📦",rar:"📦","7z":"📦",tar:"📦",gz:"📦",
      apk:"📱",json:"⚙️",xml:"⚙️",db:"🗄️",
    };
    return icons[ext] || "📄";
  };

  // 面包屑数据
  const breadcrumbs = currentPath.split("/").filter(Boolean);

  // ===== 错误页面 =====
  if (!adbOk && error) {
    return (
      <div className="error-screen">
        <div className="error-card">
          <h2>⚠️ ADB 未就绪</h2>
          <p className="error-msg">{error}</p>
          <p className="error-msg">请确保：</p>
          <ul className="error-tips">
            <li>已安装 Android SDK Platform Tools</li>
            <li>adb 已添加到系统 PATH</li>
            <li>已通过 USB 连接 Android 设备并开启 USB 调试</li>
          </ul>
        </div>
      </div>
    );
  }

  // ===== 主界面 =====
  return (
    <div className="app-layout">
      {/* ===== 左侧边栏 ===== */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">📱</span>
          <div>
            <div className="sidebar-title">ADB 助手</div>
            <div className="sidebar-subtitle">Android 文件管理</div>
          </div>
        </div>

        <div className="adb-status">
          <span className={`adb-dot ${adbOk ? "connected" : "disconnected"}`} />
          <span className="adb-status-text">{adbOk ? (deviceInfo ? `${deviceInfo.brand} ${deviceInfo.model}` : "设备已连接") : "未连接"}</span>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">功能</div>
          <button className={`nav-item ${activePage === "device" ? "active" : ""}`} onClick={() => { setActivePage("device"); if (adbOk) loadDeviceInfo(); }}>
            <span className="nav-icon">📋</span><span className="nav-label">设备信息</span>
          </button>
          <button className={`nav-item ${activePage === "files" ? "active" : ""}`} onClick={() => setActivePage("files")}>
            <span className="nav-icon">📁</span><span className="nav-label">文件管理</span>
          </button>
          <button className={`nav-item ${activePage === "apk" ? "active" : ""}`} onClick={() => setActivePage("apk")}>
            <span className="nav-icon">📲</span><span className="nav-label">安装 APK</span>
          </button>
          <button className={`nav-item ${activePage === "favorites" ? "active" : ""}`} onClick={() => setActivePage("favorites")}>
            <span className="nav-icon">⭐</span><span className="nav-label">收藏夹</span>
          </button>

          {/* 收藏夹展开列表 */}
          {activePage === "favorites" && (
            <div className="fav-panel">
              {favorites.length === 0 ? (
                <p className="fav-empty">暂无收藏</p>
              ) : (
                <ul className="fav-list">
                  {favorites.map((fav) => (
                    <li key={fav}>
                      <span className="fav-path" onClick={() => { loadFiles(fav); setActivePage("files"); }}>{fav}</span>
                      <button className="fav-remove" onClick={() => toggleFavorite(fav)}>✖</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </nav>

        <div className="sidebar-footer">v0.1.3</div>
      </aside>

      {/* ===== 右侧主区域 ===== */}
      <div className="main-area">
        {activePage === "files" && (
          <>
            {/* 顶部工具栏 */}
            <div className="topbar">
              <button className="topbar-btn" onClick={goUp} title="返回上级">⬆️</button>
              <button className="topbar-btn" onClick={() => loadFiles(DEFAULT_PATH)} title="根目录">🏠</button>
              <button className="topbar-btn" onClick={() => loadFiles(currentPath)} title="刷新">🔄</button>
              <button className="topbar-btn" onClick={() => toggleFavorite(currentPath)} title={favorites.includes(currentPath) ? "取消收藏" : "收藏当前目录"}>
                {favorites.includes(currentPath) ? "⭐" : "☆"}
              </button>

              {/* 面包屑 */}
              <div className="breadcrumb">
                <button className="breadcrumb-item" onClick={() => loadFiles("/")}>/</button>
                {breadcrumbs.map((seg, i) => {
                  const path = "/" + breadcrumbs.slice(0, i + 1).join("/") + "/";
                  const isLast = i === breadcrumbs.length - 1;
                  return (
                    <span key={path} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span className="breadcrumb-sep">›</span>
                      <button className={`breadcrumb-item ${isLast ? "current" : ""}`} onClick={() => !isLast && loadFiles(path)}>
                        {seg}
                      </button>
                    </span>
                  );
                })}
              </div>

              {/* 搜索 */}
              <div className="topbar-search">
                <span className="topbar-search-icon">🔍</span>
                <input
                  className="topbar-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索文件或包名"
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                {isSearching && <button className="search-clear" onClick={() => loadFiles(currentPath)}>✖</button>}
              </div>
            </div>

            {/* 内容区 */}
            <div className="content-area">
              {uploadStatus && <div className="status-toast info">{uploadStatus}</div>}
              {installStatus && <div className="status-toast success">{installStatus}</div>}
              {downloadStatus && <div className="status-toast success">{downloadStatus}</div>}
              {error && <div className="status-toast error">{error}</div>}

              <div className="file-card">
                <div className="file-card-body">
                  {loading ? (
                    <div className="loading">
                      <div className="loading-spinner" />
                      <span className="loading-text">加载中...</span>
                    </div>
                  ) : (
                    <table className="file-table">
                      <thead>
                        <tr>
                          <th>名称</th>
                          <th>大小</th>
                          <th>日期</th>
                          <th>权限</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {files.map((file) => (
                          <tr key={file.name} className={file.is_dir ? "dir-row" : "file-row"}
                            onDoubleClick={() => !file.is_dir && isTextFile(file.name) && handlePreview(file.name)}>
                            <td className={file.is_dir ? "clickable dir-name" : "file-name"} onClick={() => file.is_dir && enterDir(file.name)}>
                              <span className="file-icon">{getFileIcon(file.name, file.is_dir)}</span>{file.name}
                            </td>
                            <td className="file-size">{file.is_dir ? "—" : formatSize(file.size)}</td>
                            <td className="file-date">{file.date}</td>
                            <td><span className="permissions">{file.permissions}</span></td>
                            <td>
                              {!file.is_dir && <button className="action-btn download" onClick={() => handleDownload(file.name)}>下载</button>}
                              {file.is_dir && <button className="action-btn enter" onClick={() => enterDir(file.name)}>进入</button>}
                              <button className="action-btn delete" onClick={() => handleDelete(file.name, file.is_dir)}>删除</button>
                            </td>
                          </tr>
                        ))}
                        {files.length === 0 && !loading && (
                          <tr><td colSpan={5} className="empty-hint">📭 目录为空</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* 底部状态栏 */}
            <div className="statusbar">
              <span className="statusbar-path">📍 {currentPath}</span>
              <span className="statusbar-count">共 {files.length} 项</span>
            </div>
          </>
        )}

        {activePage === "device" && (
          <div className="content-area">
            {deviceLoading ? (
              <div className="loading">
                <div className="loading-spinner" />
                <span className="loading-text">正在获取设备信息...</span>
              </div>
            ) : deviceError ? (
              <div className="status-toast error">{deviceError}</div>
            ) : deviceInfo ? (
              <div className="device-page">
                <div className="device-header">
                  <span className="device-header-icon">📱</span>
                  <div>
                    <div className="device-header-model">{deviceInfo.brand} {deviceInfo.model}</div>
                    <div className="device-header-sub">{deviceInfo.device} · Android {deviceInfo.android_version}</div>
                  </div>
                  <button className="topbar-btn" onClick={loadDeviceInfo} title="刷新" style={{ marginLeft: "auto" }}>🔄</button>
                </div>

                <div className="device-grid">
                  <div className="device-card">
                    <div className="device-card-icon">🏷️</div>
                    <div className="device-card-label">品牌</div>
                    <div className="device-card-value">{deviceInfo.brand}</div>
                  </div>
                  <div className="device-card">
                    <div className="device-card-icon">📱</div>
                    <div className="device-card-label">型号</div>
                    <div className="device-card-value">{deviceInfo.model}</div>
                  </div>
                  <div className="device-card">
                    <div className="device-card-icon">🤖</div>
                    <div className="device-card-label">Android 版本</div>
                    <div className="device-card-value">{deviceInfo.android_version}</div>
                  </div>
                  <div className="device-card">
                    <div className="device-card-icon">🔧</div>
                    <div className="device-card-label">SDK 版本</div>
                    <div className="device-card-value">{deviceInfo.sdk_version}</div>
                  </div>
                  <div className="device-card">
                    <div className="device-card-icon">🔑</div>
                    <div className="device-card-label">序列号</div>
                    <div className="device-card-value mono">{deviceInfo.serial}</div>
                  </div>
                  <div className="device-card">
                    <div className="device-card-icon">🖥️</div>
                    <div className="device-card-label">分辨率</div>
                    <div className="device-card-value">{deviceInfo.resolution || "未知"}</div>
                  </div>
                  <div className="device-card">
                    <div className="device-card-icon">🔋</div>
                    <div className="device-card-label">电池</div>
                    <div className="device-card-value">{deviceInfo.battery_level}% · {deviceInfo.battery_status}</div>
                    <div className="battery-bar">
                      <div className="battery-bar-fill" style={{ width: `${deviceInfo.battery_level}%` }} />
                    </div>
                  </div>
                  <div className="device-card">
                    <div className="device-card-icon">💾</div>
                    <div className="device-card-label">存储</div>
                    <div className="device-card-value">{deviceInfo.storage_used} / {deviceInfo.storage_total}</div>
                    <div className="device-card-sub">可用 {deviceInfo.storage_free}</div>
                    <div className="storage-bar">
                      <div className="storage-bar-fill" style={{
                        width: `${deviceInfo.storage_total && deviceInfo.storage_used
                          ? Math.min(100, (parseFloat(deviceInfo.storage_used) / parseFloat(deviceInfo.storage_total)) * 100)
                          : 0}%`
                      }} />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {activePage === "apk" && (
          <div className="content-area">
            {installStatus && <div className="status-toast success">{installStatus}</div>}
            <div className="apk-page">
              <div className="apk-card" onClick={handleInstallFromLocal}>
                <div className="apk-card-icon">📲</div>
                <div className="apk-card-title">从本地安装 APK</div>
                <div className="apk-card-desc">选择本地 .apk 文件安装到设备</div>
              </div>
            </div>
          </div>
        )}

        {activePage === "favorites" && (
          <div className="content-area">
            <div className="apk-page">
              <div className="apk-card-icon" style={{ fontSize: 48 }}>⭐</div>
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>在左侧收藏夹列表中点击路径即可跳转</p>
            </div>
          </div>
        )}
      </div>

      {/* 拖拽遮罩 */}
      {isDragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <span className="drag-icon">📤</span>
            <p>松开鼠标上传文件到当前目录</p>
          </div>
        </div>
      )}

      {/* 文本预览弹窗 */}
      {previewContent !== null && (
        <div className="preview-overlay" onClick={() => setPreviewContent(null)}>
          <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-header">
              <span className="preview-title">📄 {previewFileName}</span>
              <button className="preview-close" onClick={() => setPreviewContent(null)}>✖</button>
            </div>
            <pre className="preview-content">{previewContent}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
