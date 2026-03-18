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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceInfo {
    pub brand: String,
    pub model: String,
    pub device: String,
    pub android_version: String,
    pub sdk_version: String,
    pub serial: String,
    pub resolution: String,
    pub battery_level: String,
    pub battery_status: String,
    pub storage_total: String,
    pub storage_used: String,
    pub storage_free: String,
}

fn adb_shell(cmd: &str) -> String {
    let adb = get_adb();
    Command::new(adb)
        .args(["shell", cmd])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn adb_getprop(prop: &str) -> String {
    adb_shell(&format!("getprop {}", prop))
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
fn get_device_info() -> Result<DeviceInfo, String> {
    // 先检查 adb 可用
    let adb = get_adb();
    let ver = Command::new(adb).arg("version").output()
        .map_err(|e| format!("adb 未找到: {}", e))?;
    if !ver.status.success() {
        return Err("adb 不可用".to_string());
    }

    let brand = adb_getprop("ro.product.brand");
    let model = adb_getprop("ro.product.model");
    let device = adb_getprop("ro.product.device");
    let android_version = adb_getprop("ro.build.version.release");
    let sdk_version = adb_getprop("ro.build.version.sdk");

    // 序列号
    let serial = Command::new(adb).args(["get-serialno"]).output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    // 分辨率
    let wm_out = adb_shell("wm size");
    let resolution = wm_out.split(':').last().unwrap_or("").trim().to_string();

    // 电池
    let battery_out = adb_shell("dumpsys battery");
    let mut battery_level = String::new();
    let mut battery_status = String::new();
    for line in battery_out.lines() {
        let line = line.trim();
        if line.starts_with("level:") {
            battery_level = line.replace("level:", "").trim().to_string();
        }
        if line.starts_with("status:") {
            let code = line.replace("status:", "").trim().to_string();
            battery_status = match code.as_str() {
                "2" => "充电中".to_string(),
                "3" => "放电中".to_string(),
                "4" => "未充电".to_string(),
                "5" => "已充满".to_string(),
                _ => code,
            };
        }
    }

    // 存储 (df /sdcard)
    let df_out = adb_shell("df /data");
    let mut storage_total = String::new();
    let mut storage_used = String::new();
    let mut storage_free = String::new();
    for line in df_out.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            storage_total = format_storage_size(parts[1]);
            storage_used = format_storage_size(parts[2]);
            storage_free = format_storage_size(parts[3]);
            break;
        }
    }

    Ok(DeviceInfo {
        brand, model, device, android_version, sdk_version, serial,
        resolution, battery_level, battery_status,
        storage_total, storage_used, storage_free,
    })
}

fn format_storage_size(kb_str: &str) -> String {
    // df 输出单位通常是 1K-blocks
    let n: f64 = kb_str.replace("K", "").replace("G", "").replace("M", "")
        .parse().unwrap_or(0.0);
    if kb_str.contains('G') {
        return format!("{:.1} GB", n);
    }
    if kb_str.contains('M') {
        return format!("{:.1} MB", n);
    }
    // 默认 KB
    if n < 1024.0 { return format!("{:.0} KB", n); }
    if n < 1024.0 * 1024.0 { return format!("{:.1} MB", n / 1024.0); }
    format!("{:.1} GB", n / 1024.0 / 1024.0)
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
            get_device_info,
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
