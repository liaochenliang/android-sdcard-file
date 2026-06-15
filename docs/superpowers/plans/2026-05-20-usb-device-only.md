# USB 真机优先 ADB 选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让应用在同时存在真机和模拟器时只连接 USB 真机，并在没有可用真机时给出明确错误。

**Architecture:** 在 Tauri 后端集中解析 `adb devices -l` 输出，筛选非模拟器设备并生成统一的 ADB 参数。所有 ADB 子命令都复用这套参数，前端继续读取已有错误信息，无需新增交互。

**Tech Stack:** Rust, Tauri 2, React, ADB

---

### Task 1: 真机选择解析

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn parse_adb_devices_prefers_usb_device_over_emulator() {
    let output = "List of devices attached\n56233d73 device usb:18022400X product:apollo model:M2007J3SC device:apollo transport_id:5\nemulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1\n";

    let devices = parse_connected_devices(output);
    let serial = select_physical_device_serial(&devices).unwrap();

    assert_eq!(serial, "56233d73");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test parse_adb_devices_prefers_usb_device_over_emulator`
Expected: FAIL with missing parser/helper symbols.

- [ ] **Step 3: Write minimal implementation**

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
struct ConnectedDevice {
    serial: String,
    state: String,
}

fn parse_connected_devices(output: &str) -> Vec<ConnectedDevice> {
    // parse adb devices -l lines into ConnectedDevice values
}

fn select_physical_device_serial(devices: &[ConnectedDevice]) -> Result<String, String> {
    // keep only `device` state entries whose serial does not start with emulator-
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test parse_adb_devices_prefers_usb_device_over_emulator`
Expected: PASS

### Task 2: 统一 ADB 调用

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn adb_args_include_selected_usb_serial() {
    let args = adb_args_with_serial("56233d73", &["shell", "pwd"]);
    assert_eq!(args, vec!["-s", "56233d73", "shell", "pwd"]);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test adb_args_include_selected_usb_serial`
Expected: FAIL with missing helper.

- [ ] **Step 3: Write minimal implementation**

```rust
fn adb_args_with_serial<'a>(serial: &'a str, args: &'a [&'a str]) -> Vec<&'a str> {
    let mut full_args = vec!["-s", serial];
    full_args.extend_from_slice(args);
    full_args
}
```

Then route `check_adb`, `get_device_info`, `adb_shell`, `list_files`, `download_file`, `search_files`, `upload_file`, `delete_file`, `install_apk_from_local`, and `read_text_file` through the selected serial helper.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run: `cargo test parse_adb_devices_prefers_usb_device_over_emulator adb_args_include_selected_usb_serial`
Expected: PASS

### Task 3: 端到端回归验证

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Verify the Rust crate still compiles and tests pass**

Run: `cargo test`
Expected: PASS

- [ ] **Step 2: Verify frontend type-check/build still passes**

Run: `npm run build`
Expected: PASS
