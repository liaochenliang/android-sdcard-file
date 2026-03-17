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
  const [showFavorites, setShowFavorites] = useState(false);
  const [pathInput, setPathInput] = useState(DEFAULT_PATH);
  const [downloadStatus, setDownloadStatus] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [installStatus, setInstallStatus] = useState("");
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState("");

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

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    setIsSearching(false);
    try {
      const result = await invoke<FileEntry[]>("list_files", { path });
      setFiles(result);
      setCurrentPath(path);
      setPathInput(path);
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
      const u1 = await listen(TauriEvent.DRAG_ENTER, () => {
        setIsDragOver(true);
      });
      const u2 = await listen(TauriEvent.DRAG_OVER, () => {
        setIsDragOver(true);
      });
      const u3 = await listen<{ paths: string[] }>(TauriEvent.DRAG_DROP, async (event) => {
        setIsDragOver(false);
        const paths = event.payload.paths;
        if (!paths || paths.length === 0) return;

        const curPath = currentPathRef.current;
        for (const localPath of paths) {
          const fileName = localPath.split(/[/\\]/).pop() || "unknown";
          const remotePath = curPath.endsWith("/")
            ? `${curPath}${fileName}`
            : `${curPath}/${fileName}`;
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
      const u4 = await listen(TauriEvent.DRAG_LEAVE, () => {
        setIsDragOver(false);
      });
      unlisteners.push(u1, u2, u3, u4);
    };

    setup();
    return () => { unlisteners.forEach((u) => u()); };
  }, [loadFiles]);

  useEffect(() => {
    if (adbOk) loadFiles(DEFAULT_PATH);
  }, [adbOk, loadFiles]);

  const enterDir = (name: string) => {
    const newPath = currentPath.endsWith("/")
      ? `${currentPath}${name}/`
      : `${currentPath}/${name}/`;
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
      const result = await invoke<FileEntry[]>("search_files", {
        path: currentPath,
        keyword: searchQuery,
      });
      setFiles(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (fileName: string) => {
    const remotePath = currentPath.endsWith("/")
      ? `${currentPath}${fileName}`
      : `${currentPath}/${fileName}`;
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
    const remotePath = currentPath.endsWith("/")
      ? `${currentPath}${fileName}`
      : `${currentPath}/${fileName}`;
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
    "txt", "md", "json", "xml", "log", "csv", "yml", "yaml",
    "ini", "conf", "sh", "py", "js", "ts", "html", "css",
    "java", "kt", "c", "cpp", "h", "rs", "toml", "cfg", "properties",
  ]);

  const isTextFile = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    return TEXT_EXTS.has(ext);
  };

  const handlePreview = async (fileName: string) => {
    const remotePath = currentPath.endsWith("/")
      ? `${currentPath}${fileName}`
      : `${currentPath}/${fileName}`;
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
    const newFavs = favorites.includes(path)
      ? favorites.filter((f) => f !== path)
      : [...favorites, path];
    setFavorites(newFavs);
    localStorage.setItem("sdcard-favorites", JSON.stringify(newFavs));
  };

  const isFavorited = favorites.includes(currentPath);

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
      jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️", webp: "🖼️", svg: "🖼️",
      mp4: "🎬", avi: "🎬", mkv: "🎬", mov: "🎬",
      mp3: "🎵", wav: "🎵", flac: "🎵", ogg: "🎵", aac: "🎵",
      pdf: "📕", doc: "📘", docx: "📘", txt: "📝", md: "📝",
      zip: "📦", rar: "📦", "7z": "📦", tar: "📦", gz: "📦",
      apk: "📱", json: "⚙️", xml: "⚙️", db: "🗄️",
    };
    return icons[ext] || "📄";
  };

  if (!adbOk && error) {
    return (
      <div className="app">
        <div className="glow-orb glow-orb-1" />
        <div className="glow-orb glow-orb-2" />
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
      </div>
    );
  }

  return (
    <div className="app">
      <div className="glow-orb glow-orb-1" />
      <div className="glow-orb glow-orb-2" />

      {/* 标题栏 */}
      <div className="titlebar">
        <h1>📱 SDCard 文件管理器</h1>
      </div>

      {/* 工具栏 */}
      <div className="toolbar">
        <button className="toolbar-btn" onClick={goUp} title="返回上级"><span className="toolbar-icon">⬆️</span><span className="toolbar-label">上级</span></button>
        <button className="toolbar-btn" onClick={() => loadFiles(DEFAULT_PATH)} title="根目录"><span className="toolbar-icon">🏠</span><span className="toolbar-label">根目录</span></button>
        <button className={`toolbar-btn ${isFavorited ? "active" : ""}`} onClick={() => toggleFavorite(currentPath)} title={isFavorited ? "取消收藏" : "收藏"}>
          <span className="toolbar-icon">{isFavorited ? "⭐" : "☆"}</span><span className="toolbar-label">{isFavorited ? "已收藏" : "收藏"}</span>
        </button>
        <button className={`toolbar-btn ${showFavorites ? "active" : ""}`} onClick={() => setShowFavorites(!showFavorites)} title="收藏夹"><span className="toolbar-icon">📑</span><span className="toolbar-label">收藏夹</span></button>
        <button className="toolbar-btn" onClick={handleInstallFromLocal} title="从本地安装 APK"><span className="toolbar-icon">📲</span><span className="toolbar-label">安装APK</span></button>
        <form className="path-bar" onSubmit={(e) => { e.preventDefault(); loadFiles(pathInput); }}>
          <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} className="path-input" />
          <button type="submit" className="path-go-btn">前往</button>
        </form>
      </div>

      {/* 搜索栏 */}
      <div className="search-bar">
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索文件名 或输入包名如 com.medialab.app"
            className="search-input"
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
        </div>
        <button className="search-btn" onClick={handleSearch}>搜索</button>
        {isSearching && <button className="search-clear-btn" onClick={() => loadFiles(currentPath)}>✖ 清除</button>}
      </div>

      {/* 状态提示 */}
      {uploadStatus && <div className="status-bar upload-status">{uploadStatus}</div>}
      {installStatus && <div className="status-bar install-status">{installStatus}</div>}
      {downloadStatus && <div className="status-bar">{downloadStatus}</div>}
      {error && <div className="error-bar">{error}</div>}

      {/* 拖拽遮罩 */}
      {isDragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <span className="drag-icon">📤</span>
            <p>松开鼠标上传文件到当前目录</p>
          </div>
        </div>
      )}

      {/* 主内容 */}
      <div className="main-content">
        {showFavorites && (
          <div className="sidebar">
            <h3>📑 收藏夹</h3>
            {favorites.length === 0 ? (
              <p className="empty-hint" style={{ padding: "12px 0", fontSize: "12px" }}>暂无收藏</p>
            ) : (
              <ul className="fav-list">
                {favorites.map((fav) => (
                  <li key={fav}>
                    <span className="fav-path" onClick={() => loadFiles(fav)}>{fav}</span>
                    <button className="fav-remove" onClick={() => toggleFavorite(fav)}>✖</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="file-list-container">
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
                    onDoubleClick={() => !file.is_dir && isTextFile(file.name) && handlePreview(file.name)}
                  >
                    <td
                      className={file.is_dir ? "clickable dir-name" : "file-name"}
                      onClick={() => file.is_dir && enterDir(file.name)}
                    >
                      <span className="file-icon">{getFileIcon(file.name, file.is_dir)}</span>
                      {file.name}
                    </td>
                    <td className="file-size">{file.is_dir ? "—" : formatSize(file.size)}</td>
                    <td className="file-date">{file.date}</td>
                    <td><span className="permissions">{file.permissions}</span></td>
                    <td>
                      {!file.is_dir && (
                        <button className="btn-download" onClick={() => handleDownload(file.name)}>下载</button>
                      )}
                      {file.is_dir && (
                        <button className="btn-enter" onClick={() => enterDir(file.name)}>进入</button>
                      )}
                      <button className="btn-delete" onClick={() => handleDelete(file.name, file.is_dir)}>删除</button>
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

      {/* 底部 */}
      <div className="footer">
        <span className="footer-path">📍 {currentPath}</span>
        <span className="footer-count">共 {files.length} 项</span>
      </div>
    </div>
  );
}

export default App;
