import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
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

  if (!adbOk && error) {
    return (
      <div className="app">
        <div className="error-screen">
          <h2>⚠️ ADB 未就绪</h2>
          <p>{error}</p>
          <p>请确保：</p>
          <ul>
            <li>已安装 Android SDK Platform Tools</li>
            <li>adb 已添加到系统 PATH</li>
            <li>已通过 USB 连接 Android 设备并开启 USB 调试</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="toolbar">
        <button onClick={goUp} title="返回上级">⬆️</button>
        <button onClick={() => loadFiles(DEFAULT_PATH)} title="回到根目录">🏠</button>
        <button onClick={() => toggleFavorite(currentPath)} title={isFavorited ? "取消收藏" : "收藏当前路径"}>
          {isFavorited ? "⭐" : "☆"}
        </button>
        <button onClick={() => setShowFavorites(!showFavorites)} title="收藏夹">
          📑 收藏夹
        </button>
        <form className="path-bar" onSubmit={(e) => { e.preventDefault(); loadFiles(pathInput); }}>
          <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} className="path-input" />
          <button type="submit">前往</button>
        </form>
      </div>

      <div className="search-bar">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索文件名 或输入包名如 com.medialab.app"
          className="search-input"
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button onClick={handleSearch}>🔍 搜索</button>
        {isSearching && <button onClick={() => loadFiles(currentPath)}>✖ 清除搜索</button>}
      </div>

      {downloadStatus && <div className="status-bar">{downloadStatus}</div>}
      {error && <div className="error-bar">{error}</div>}

      <div className="main-content">
        {showFavorites && (
          <div className="sidebar">
            <h3>📑 收藏夹</h3>
            {favorites.length === 0 ? (
              <p className="empty-hint">暂无收藏</p>
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
            <div className="loading">加载中...</div>
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
                  <tr key={file.name} className={file.is_dir ? "dir-row" : "file-row"}>
                    <td className={file.is_dir ? "clickable dir-name" : "file-name"} onClick={() => file.is_dir && enterDir(file.name)}>
                      {file.is_dir ? "📁" : "📄"} {file.name}
                    </td>
                    <td>{file.is_dir ? "-" : formatSize(file.size)}</td>
                    <td>{file.date}</td>
                    <td className="permissions">{file.permissions}</td>
                    <td>
                      {!file.is_dir && <button className="btn-download" onClick={() => handleDownload(file.name)}>⬇️ 下载</button>}
                      {file.is_dir && <button className="btn-enter" onClick={() => enterDir(file.name)}>📂 进入</button>}
                    </td>
                  </tr>
                ))}
                {files.length === 0 && !loading && (
                  <tr><td colSpan={5} className="empty-hint">目录为空</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="footer">📍 {currentPath} | 共 {files.length} 项</div>
    </div>
  );
}

export default App;
