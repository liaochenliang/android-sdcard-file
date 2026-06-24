use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Command, Output};
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct ConnectedDevice {
    serial: String,
    state: String,
}

fn parse_connected_devices(output: &str) -> Vec<ConnectedDevice> {
    output
        .lines()
        .skip(1)
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }

            let mut parts = line.split_whitespace();
            let serial = parts.next()?.to_string();
            let state = parts.next()?.to_string();

            Some(ConnectedDevice { serial, state })
        })
        .collect()
}

fn select_physical_device_serial(devices: &[ConnectedDevice]) -> Result<String, String> {
    let physical: Vec<&ConnectedDevice> = devices
        .iter()
        .filter(|device| device.state == "device" && !device.serial.starts_with("emulator-"))
        .collect();

    match physical.len() {
        1 => Ok(physical[0].serial.clone()),
        0 => {
            let has_emulator = devices.iter().any(|device| device.serial.starts_with("emulator-"));
            if has_emulator {
                Err("未检测到可用的 USB 真机，当前仅连接了模拟器".to_string())
            } else {
                Err("未检测到可用的 USB 真机，请连接并授权设备".to_string())
            }
        }
        _ => Err("检测到多台 USB 真机，请只保留一台设备连接".to_string()),
    }
}

fn adb_args_with_serial<'a>(serial: &'a str, args: &'a [&'a str]) -> Vec<&'a str> {
    let mut full_args = vec!["-s", serial];
    full_args.extend_from_slice(args);
    full_args
}

fn get_target_device_serial() -> Result<String, String> {
    let adb = get_adb();
    let output = Command::new(adb)
        .args(["devices", "-l"])
        .output()
        .map_err(|e| format!("执行 adb devices 失败: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "adb devices 执行失败".to_string()
        } else {
            format!("adb devices 执行失败: {}", err)
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let devices = parse_connected_devices(&stdout);
    select_physical_device_serial(&devices)
}

fn run_adb_on_target(args: &[&str]) -> Result<Output, String> {
    let adb = get_adb();
    let serial = get_target_device_serial()?;
    let full_args = adb_args_with_serial(&serial, args);

    Command::new(adb)
        .args(&full_args)
        .output()
        .map_err(|e| format!("执行 adb 命令失败: {}", e))
}

fn adb_shell(cmd: &str) -> Result<String, String> {
    let output = run_adb_on_target(&["shell", cmd])?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn adb_getprop(prop: &str) -> Result<String, String> {
    adb_shell(&format!("getprop {}", prop))
}

#[tauri::command]
fn check_adb() -> Result<String, String> {
    let adb = get_adb();
    let output = Command::new(adb)
        .arg("version")
        .output()
        .map_err(|e| format!("adb 未找到 ({}): {}", adb, e))?;
    if !output.status.success() {
        return Err("adb 命令执行失败".to_string());
    }

    get_target_device_serial()?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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

    let serial = get_target_device_serial()?;

    let brand = adb_getprop("ro.product.brand")?;
    let model = adb_getprop("ro.product.model")?;
    let device = adb_getprop("ro.product.device")?;
    let android_version = adb_getprop("ro.build.version.release")?;
    let sdk_version = adb_getprop("ro.build.version.sdk")?;

    let wm_out = adb_shell("wm size")?;
    let resolution = wm_out.split(':').last().unwrap_or("").trim().to_string();

    let battery_out = adb_shell("dumpsys battery")?;
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
    let df_out = adb_shell("df /data")?;
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

fn normalize_device_path(path: &str) -> String {
    match path.trim_end_matches('/') {
        "/storage/emulated" => "/storage/emulated/0/".to_string(),
        _ => path.to_string(),
    }
}

#[tauri::command]
fn list_files(path: &str) -> Result<Vec<FileEntry>, String> {
    let path = normalize_device_path(path);
    let shell_cmd = format!("ls -la '{}'", path);
    let output = run_adb_on_target(&["shell", &shell_cmd])?;

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
    let remote_path = normalize_device_path(remote_path);
    let output = run_adb_on_target(&["pull", &remote_path, local_path])
        .map_err(|e| e.replace("执行 adb 命令失败", "执行 adb pull 失败"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("下载失败: {}", err))
    }
}

#[tauri::command]
fn search_files(path: &str, keyword: &str) -> Result<Vec<FileEntry>, String> {
    let path = normalize_device_path(path);
    let search_cmd = format!("find '{}' -maxdepth 3 -name '*{}*' 2>/dev/null", path, keyword);
    let output = run_adb_on_target(&["shell", &search_cmd])
        .map_err(|e| e.replace("执行 adb 命令失败", "执行搜索失败"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries: Vec<FileEntry> = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }

        let info_cmd = format!("ls -lad '{}'", line);
        let info_output = run_adb_on_target(&["shell", &info_cmd]);

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
    let remote_path = normalize_device_path(remote_path);
    let output = run_adb_on_target(&["push", local_path, &remote_path])
        .map_err(|e| e.replace("执行 adb 命令失败", "执行 adb push 失败"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("上传失败: {}", err))
    }
}

#[tauri::command]
fn delete_file(remote_path: &str, is_dir: bool) -> Result<String, String> {
    let remote_path = normalize_device_path(remote_path);
    let cmd = if is_dir {
        format!("rm -rf '{}'", remote_path)
    } else {
        format!("rm -f '{}'", remote_path)
    };
    let output = run_adb_on_target(&["shell", &cmd])
        .map_err(|e| e.replace("执行 adb 命令失败", "执行 adb shell rm 失败"))?;

    if output.status.success() {
        Ok("删除成功".to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("删除失败: {}", err))
    }
}

#[tauri::command]
fn install_apk_from_local(local_path: &str) -> Result<String, String> {
    let output = run_adb_on_target(&["install", "-r", local_path])
        .map_err(|e| e.replace("执行 adb 命令失败", "执行 adb install 失败"))?;

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
    let remote_path = normalize_device_path(remote_path);
    let shell_cmd = format!("cat '{}'", remote_path);
    let output = run_adb_on_target(&["shell", &shell_cmd])
        .map_err(|e| e.replace("执行 adb 命令失败", "执行 adb shell cat 失败"))?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_adb_devices_prefers_usb_device_over_emulator() {
        let output = "List of devices attached\n56233d73 device usb:18022400X product:apollo model:M2007J3SC device:apollo transport_id:5\nemulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1\n";

        let devices = parse_connected_devices(output);
        let serial = select_physical_device_serial(&devices).unwrap();

        assert_eq!(serial, "56233d73");
    }

    #[test]
    fn adb_args_include_selected_usb_serial() {
        let args = adb_args_with_serial("56233d73", &["shell", "pwd"]);

        assert_eq!(args, vec!["-s", "56233d73", "shell", "pwd"]);
    }

    #[test]
    fn storage_emulated_parent_maps_to_primary_user_storage() {
        assert_eq!(normalize_device_path("/storage/emulated"), "/storage/emulated/0/");
        assert_eq!(normalize_device_path("/storage/emulated/"), "/storage/emulated/0/");
    }
}
