use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use tauri::Manager;

static ADB_PATH: OnceLock<String> = OnceLock::new();

fn get_adb() -> &'static str {
    ADB_PATH.get_or_init(|| "adb".to_string())
}

fn init_adb_path(app: &tauri::AppHandle) {
    // 优先使用打包在 app 内的 adb
    let resource_path = app.path().resource_dir().ok().map(|p| p.join("binaries/adb"));
    if let Some(ref path) = resource_path {
        if path.exists() {
            // 确保可执行权限
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
            }
            let _ = ADB_PATH.set(path.to_string_lossy().to_string());
            return;
        }
    }

    // 回退：尝试从用户 shell 环境找 adb
    for shell in &["/bin/zsh", "/bin/bash"] {
        if let Ok(output) = Command::new(shell).args(["-l", "-c", "which adb"]).output() {
            let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !p.is_empty() && PathBuf::from(&p).exists() {
                let _ = ADB_PATH.set(p);
                return;
            }
        }
    }

    // 常见路径
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{}/Library/Android/sdk/platform-tools/adb", home),
        format!("{}/Android/Sdk/platform-tools/adb", home),
        "/usr/local/bin/adb".to_string(),
        "/opt/homebrew/bin/adb".to_string(),
    ];
    for c in candidates {
        if PathBuf::from(&c).exists() {
            let _ = ADB_PATH.set(c);
            return;
        }
    }
    let _ = ADB_PATH.set("adb".to_string());
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: String,
    pub date: String,
    pub permissions: String,
}

#[tauri::command]
fn check_adb() -> Result<String, String> {
    let adb = get_adb();
    let output = Command::new(adb)
        .arg("version")
        .output()
        .map_err(|e| format!("adb 未找到 ({}): {}", adb, e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err("adb 命令执行失败".to_string())
    }
}

#[tauri::command]
fn list_files(path: &str) -> Result<Vec<FileEntry>, String> {
    let adb = get_adb();
    let output = Command::new(adb)
        .args(["shell", &format!("ls -la '{}'", path)])
        .output()
        .map_err(|e| format!("执行 adb 命令失败: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("adb shell 失败: {}", err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries: Vec<FileEntry> = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("total") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 8 { continue; }

        let permissions = parts[0].to_string();
        let is_dir = permissions.starts_with('d');
        let size = parts[4].to_string();
        let date = format!("{} {}", parts[5], parts[6]);
        let name = parts[7..].join(" ");

        if name == "." || name == ".." { continue; }

        entries.push(FileEntry { name, is_dir, size, date, permissions });
    }
    Ok(entries)
}

#[tauri::command]
fn download_file(remote_path: &str, local_path: &str) -> Result<String, String> {
    let adb = get_adb();
    let output = Command::new(adb)
        .args(["pull", remote_path, local_path])
        .output()
        .map_err(|e| format!("执行 adb pull 失败: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("下载失败: {}", err))
    }
}

#[tauri::command]
fn search_files(path: &str, keyword: &str) -> Result<Vec<FileEntry>, String> {
    let adb = get_adb();
    let output = Command::new(adb)
        .args(["shell", &format!("find '{}' -maxdepth 3 -name '*{}*' 2>/dev/null", path, keyword)])
        .output()
        .map_err(|e| format!("执行搜索失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries: Vec<FileEntry> = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }

        let info_output = Command::new(adb)
            .args(["shell", &format!("ls -lad '{}'", line)])
            .output();

        if let Ok(info) = info_output {
            let info_str = String::from_utf8_lossy(&info.stdout);
            let info_line = info_str.trim();
            let parts: Vec<&str> = info_line.split_whitespace().collect();
            if parts.len() >= 8 {
                let permissions = parts[0].to_string();
                let is_dir = permissions.starts_with('d');
                let size = parts[4].to_string();
                let date = format!("{} {}", parts[5], parts[6]);
                let name = line.to_string();
                entries.push(FileEntry { name, is_dir, size, date, permissions });
            }
        }
    }
    Ok(entries)
}

#[tauri::command]
fn upload_file(local_path: &str, remote_path: &str) -> Result<String, String> {
    let adb = get_adb();
    let output = Command::new(adb)
        .args(["push", local_path, remote_path])
        .output()
        .map_err(|e| format!("执行 adb push 失败: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("上传失败: {}", err))
    }
}

#[tauri::command]
fn delete_file(remote_path: &str, is_dir: bool) -> Result<String, String> {
    let adb = get_adb();
    let cmd = if is_dir {
        format!("rm -rf '{}'", remote_path)
    } else {
        format!("rm -f '{}'", remote_path)
    };
    let output = Command::new(adb)
        .args(["shell", &cmd])
        .output()
        .map_err(|e| format!("执行 adb shell rm 失败: {}", e))?;

    if output.status.success() {
        Ok("删除成功".to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("删除失败: {}", err))
    }
}

#[tauri::command]
fn install_apk_from_local(local_path: &str) -> Result<String, String> {
    let adb = get_adb();
    let output = Command::new(adb)
        .args(["install", "-r", local_path])
        .output()
        .map_err(|e| format!("执行 adb install 失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if stdout.contains("Success") {
        Ok("安装成功".to_string())
    } else {
        Err(format!("安装失败: {} {}", stdout.trim(), stderr.trim()))
    }
}

#[tauri::command]
fn read_text_file(remote_path: &str) -> Result<String, String> {
    let adb = get_adb();
    let output = Command::new(adb)
        .args(["shell", &format!("cat '{}'", remote_path)])
        .output()
        .map_err(|e| format!("执行 adb shell cat 失败: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("读取失败: {}", err))
    }
}





#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            init_adb_path(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_adb,
            list_files,
            download_file,
            search_files,
            upload_file,
            delete_file,
            install_apk_from_local,
            read_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
