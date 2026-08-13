use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::{
    Foundation::{GlobalFree, HANDLE, HGLOBAL},
    System::{
        DataExchange::{
            CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber,
            IsClipboardFormatAvailable, OpenClipboard, SetClipboardData,
        },
        Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE},
    },
};

const MAX_HISTORY_ITEMS: usize = 50;
const POLL_INTERVAL: Duration = Duration::from_millis(350);
const MAX_CLIPBOARD_BYTES: usize = 64 * 1024 * 1024;
const CF_BITMAP: u32 = 2;
const CF_DIB: u32 = 8;
const CF_UNICODETEXT: u32 = 13;
const CF_DIBV5: u32 = 17;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardItem {
    pub id: String,
    #[serde(default = "default_clipboard_kind")]
    pub kind: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    pub created_at: u64,
}

fn default_clipboard_kind() -> String {
    "text".to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct ClipboardImage {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

struct ClipboardService {
    items: Mutex<Vec<ClipboardItem>>,
    storage_path: Option<PathBuf>,
    image_dir: Option<PathBuf>,
    ignored_copy: Mutex<Option<(ClipboardPayload, u64)>>,
    stopped: AtomicBool,
}

enum ClipboardPayload {
    Text(String),
    Image {
        bmp: Vec<u8>,
        width: u32,
        height: u32,
    },
}

impl ClipboardPayload {
    fn matches(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Text(left), Self::Text(right)) => left == right,
            (
                Self::Image {
                    bmp: left_bmp,
                    width: left_width,
                    height: left_height,
                },
                Self::Image {
                    bmp: right_bmp,
                    width: right_width,
                    height: right_height,
                },
            ) => left_width == right_width && left_height == right_height && left_bmp == right_bmp,
            _ => false,
        }
    }
}

static SERVICE: OnceLock<Arc<ClipboardService>> = OnceLock::new();

fn service() -> Option<Arc<ClipboardService>> {
    SERVICE.get().cloned()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn persist(service: &ClipboardService, items: &[ClipboardItem]) {
    let Some(path) = service.storage_path.as_ref() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(content) = serde_json::to_vec(items) {
        let _ = fs::write(path, content);
    }
}

fn remove_image_file(item: &ClipboardItem) {
    if item.kind == "image" {
        if let Some(path) = item.image_path.as_deref() {
            let _ = fs::remove_file(path);
        }
    }
}

fn next_item_id(items: &[ClipboardItem]) -> String {
    format!("{}-{}", now_millis(), items.len())
}

fn insert_item(service: &ClipboardService, text: String) -> Option<ClipboardItem> {
    let text = text.trim_end_matches(['\r', '\n']).to_string();
    if text.trim().is_empty() {
        return None;
    }

    let mut items = service.items.lock().ok()?;
    if items
        .first()
        .is_some_and(|item| item.kind == "text" && item.text == text)
    {
        return None;
    }
    items.retain(|item| !(item.kind == "text" && item.text == text));

    let item = ClipboardItem {
        id: next_item_id(&items),
        kind: "text".to_string(),
        text,
        image_path: None,
        width: None,
        height: None,
        created_at: now_millis(),
    };
    items.insert(0, item.clone());
    let removed = if items.len() > MAX_HISTORY_ITEMS {
        items.pop()
    } else {
        None
    };
    persist(service, &items);
    if let Some(removed) = removed.as_ref() {
        remove_image_file(removed);
    }
    Some(item)
}

fn insert_image(
    service: &ClipboardService,
    bmp: Vec<u8>,
    width: u32,
    height: u32,
) -> Option<ClipboardItem> {
    let image_dir = service.image_dir.as_ref()?;
    fs::create_dir_all(image_dir).ok()?;

    let mut items = service.items.lock().ok()?;
    let id = next_item_id(&items);
    let image_path = image_dir.join(format!("{id}.bmp"));
    fs::write(&image_path, &bmp).ok()?;

    let item = ClipboardItem {
        id,
        kind: "image".to_string(),
        text: String::new(),
        image_path: Some(image_path.to_string_lossy().into_owned()),
        width: Some(width),
        height: Some(height),
        created_at: now_millis(),
    };
    items.insert(0, item.clone());
    let removed = if items.len() > MAX_HISTORY_ITEMS {
        items.pop()
    } else {
        None
    };
    persist(service, &items);
    if let Some(removed) = removed.as_ref() {
        remove_image_file(removed);
    }
    Some(item)
}

fn read_i32(bytes: &[u8], offset: usize) -> Option<i32> {
    let bytes = bytes.get(offset..offset + 4)?;
    Some(i32::from_le_bytes(bytes.try_into().ok()?))
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    let bytes = bytes.get(offset..offset + 2)?;
    Some(u16::from_le_bytes(bytes.try_into().ok()?))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let bytes = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes(bytes.try_into().ok()?))
}

fn dib_to_bmp(dib: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    let header_size = read_u32(dib, 0)? as usize;
    if header_size < 40 || header_size > dib.len() {
        return None;
    }
    let width = read_i32(dib, 4)?.unsigned_abs();
    let height = read_i32(dib, 8)?.unsigned_abs();
    let bit_count = read_u16(dib, 14)?;
    let compression = read_u32(dib, 16)?;
    let colors_used = read_u32(dib, 32)?;
    if width == 0 || height == 0 || bit_count == 0 {
        return None;
    }

    let palette_entries = if bit_count <= 8 {
        if colors_used != 0 {
            colors_used as usize
        } else {
            1usize.checked_shl(bit_count as u32)?
        }
    } else {
        0
    };
    let bitfield_masks = if header_size == 40 && compression == 3 {
        12
    } else {
        0
    };
    let pixel_offset = header_size
        .checked_add(bitfield_masks)?
        .checked_add(palette_entries.checked_mul(4)?)?;
    if pixel_offset > dib.len() {
        return None;
    }

    let file_size = 14usize.checked_add(dib.len())?;
    let mut bmp = Vec::with_capacity(file_size);
    bmp.extend_from_slice(&0x4d42u16.to_le_bytes());
    bmp.extend_from_slice(&(file_size as u32).to_le_bytes());
    bmp.extend_from_slice(&0u16.to_le_bytes());
    bmp.extend_from_slice(&0u16.to_le_bytes());
    bmp.extend_from_slice(&((14 + pixel_offset) as u32).to_le_bytes());
    bmp.extend_from_slice(dib);
    Some((bmp, width, height))
}

unsafe fn read_dib_from_open_clipboard(format: u32) -> Option<(Vec<u8>, u32, u32)> {
    if IsClipboardFormatAvailable(format).is_err() {
        return None;
    }
    let handle = GetClipboardData(format).ok()?;
    let size = GlobalSize(HGLOBAL(handle.0));
    if !(40..=MAX_CLIPBOARD_BYTES).contains(&size) {
        return None;
    }
    let pointer = GlobalLock(HGLOBAL(handle.0));
    if pointer.is_null() {
        return None;
    }
    let dib = std::slice::from_raw_parts(pointer as *const u8, size).to_vec();
    let _ = GlobalUnlock(HGLOBAL(handle.0));
    dib_to_bmp(&dib)
}

unsafe fn read_unicode_text_from_open_clipboard() -> Option<String> {
    if IsClipboardFormatAvailable(CF_UNICODETEXT).is_err() {
        return None;
    }
    let handle = GetClipboardData(CF_UNICODETEXT).ok()?;
    let size = GlobalSize(HGLOBAL(handle.0));
    if size == 0 {
        return None;
    }
    let pointer = GlobalLock(HGLOBAL(handle.0));
    if pointer.is_null() {
        return None;
    }
    let byte_len = size.min(1024 * 1024);
    let utf16_len = byte_len / 2;
    let slice = std::slice::from_raw_parts(pointer as *const u16, utf16_len);
    let end = slice
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(utf16_len);
    let text = String::from_utf16_lossy(&slice[..end]);
    let _ = GlobalUnlock(HGLOBAL(handle.0));
    Some(text)
}

unsafe fn read_current_payload() -> Option<ClipboardPayload> {
    if OpenClipboard(None).is_err() {
        return None;
    }

    let result = read_dib_from_open_clipboard(CF_DIBV5)
        .or_else(|| read_dib_from_open_clipboard(CF_DIB))
        .or_else(|| read_dib_from_open_clipboard(CF_BITMAP))
        .map(|(bmp, width, height)| ClipboardPayload::Image { bmp, width, height })
        .or_else(|| read_unicode_text_from_open_clipboard().map(ClipboardPayload::Text));

    let _ = CloseClipboard();
    result
}

fn read_current_payload_safe() -> Option<ClipboardPayload> {
    unsafe { read_current_payload() }
}

fn mark_ignored_copy(service: &ClipboardService, payload: ClipboardPayload) {
    if let Ok(mut ignored_copy) = service.ignored_copy.lock() {
        *ignored_copy = Some((payload, now_millis()));
    }
}

fn clear_ignored_copy(service: &ClipboardService) {
    if let Ok(mut ignored_copy) = service.ignored_copy.lock() {
        *ignored_copy = None;
    }
}

fn is_ignored_copy(service: &ClipboardService, payload: &ClipboardPayload) -> bool {
    let Ok(mut ignored_copy) = service.ignored_copy.lock() else {
        return false;
    };
    let Some((expected, created_at)) = ignored_copy.take() else {
        return false;
    };
    if now_millis().saturating_sub(created_at) > 2_000 {
        return false;
    }
    expected.matches(payload)
}

pub fn start(app: &AppHandle) {
    if SERVICE.get().is_some() {
        return;
    }

    let storage_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join("clipboard-history.json"));
    let image_dir = storage_path
        .as_ref()
        .and_then(|path| path.parent().map(|parent| parent.join("clipboard-images")));
    let items = storage_path
        .as_ref()
        .and_then(|path| fs::read(path).ok())
        .and_then(|content| serde_json::from_slice::<Vec<ClipboardItem>>(&content).ok())
        .unwrap_or_default();
    let service = Arc::new(ClipboardService {
        items: Mutex::new(items),
        storage_path,
        image_dir,
        ignored_copy: Mutex::new(None),
        stopped: AtomicBool::new(false),
    });
    let _ = SERVICE.set(service.clone());

    let app_handle = app.clone();
    thread::spawn(move || {
        let mut last_sequence = unsafe { GetClipboardSequenceNumber() };
        while !service.stopped.load(Ordering::Relaxed) {
            thread::sleep(POLL_INTERVAL);
            let sequence = unsafe { GetClipboardSequenceNumber() };
            if sequence == 0 || sequence == last_sequence {
                continue;
            }
            last_sequence = sequence;
            let Some(payload) = read_current_payload_safe() else {
                continue;
            };
            if is_ignored_copy(&service, &payload) {
                continue;
            }
            let item = match payload {
                ClipboardPayload::Text(text) => insert_item(&service, text),
                ClipboardPayload::Image { bmp, width, height } => {
                    insert_image(&service, bmp, width, height)
                }
            };
            if let Some(item) = item {
                let _ = app_handle.emit("clipboard-updated", item);
            }
        }
    });
}

#[tauri::command]
pub fn get_clipboard_history() -> Result<Vec<ClipboardItem>, String> {
    Ok(service()
        .and_then(|service| service.items.lock().ok().map(|items| items.clone()))
        .unwrap_or_default())
}

#[tauri::command]
pub fn get_clipboard_image(id: String) -> Result<Option<ClipboardImage>, String> {
    let Some(service) = service() else {
        return Ok(None);
    };
    let item = service
        .items
        .lock()
        .map_err(|error| error.to_string())?
        .iter()
        .find(|item| item.id == id && item.kind == "image")
        .cloned();
    let Some(item) = item else {
        return Ok(None);
    };
    let Some(path) = item.image_path.as_deref() else {
        return Ok(None);
    };
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(Some(ClipboardImage {
        data_url: format!("data:image/bmp;base64,{}", BASE64.encode(bytes)),
        width: item.width.unwrap_or_default(),
        height: item.height.unwrap_or_default(),
    }))
}

#[tauri::command]
pub fn clear_clipboard_history() -> Result<(), String> {
    let Some(service) = service() else {
        return Ok(());
    };
    let mut items = service.items.lock().map_err(|error| error.to_string())?;
    for item in items.iter() {
        remove_image_file(item);
    }
    items.clear();
    persist(&service, &items);
    Ok(())
}

unsafe fn set_clipboard_bytes(format: u32, bytes: &[u8]) -> Result<(), String> {
    let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|error| error.to_string())?;
    let pointer = GlobalLock(HGLOBAL(memory.0));
    if pointer.is_null() {
        let _ = GlobalFree(Some(HGLOBAL(memory.0)));
        return Err("无法写入剪贴板内存".to_string());
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer as *mut u8, bytes.len());
    let _ = GlobalUnlock(HGLOBAL(memory.0));

    if OpenClipboard(None).is_err() {
        let _ = GlobalFree(Some(HGLOBAL(memory.0)));
        return Err("剪贴板正在被其他程序占用".to_string());
    }
    let result = if EmptyClipboard().is_ok() {
        SetClipboardData(format, Some(HANDLE(memory.0)))
            .map(|_| ())
            .map_err(|error| error.to_string())
    } else {
        Err("无法清空当前剪贴板".to_string())
    };
    let _ = CloseClipboard();
    if result.is_err() {
        let _ = GlobalFree(Some(HGLOBAL(memory.0)));
    }
    result
}

#[tauri::command]
pub fn copy_clipboard_item(text: String) -> Result<(), String> {
    let Some(service) = service() else {
        return Err("剪贴板服务尚未启动".to_string());
    };
    let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = utf16.len() * std::mem::size_of::<u16>();
    mark_ignored_copy(&service, ClipboardPayload::Text(text.clone()));
    let result = unsafe {
        set_clipboard_bytes(
            CF_UNICODETEXT,
            std::slice::from_raw_parts(utf16.as_ptr() as *const u8, bytes),
        )
    };
    if result.is_err() {
        clear_ignored_copy(&service);
    }
    result
}

#[tauri::command]
pub fn copy_clipboard_image(id: String) -> Result<(), String> {
    let Some(service) = service() else {
        return Err("剪贴板服务尚未启动".to_string());
    };
    let item = service
        .items
        .lock()
        .map_err(|error| error.to_string())?
        .iter()
        .find(|item| item.id == id && item.kind == "image")
        .cloned()
        .ok_or_else(|| "找不到图片记录".to_string())?;
    let path = item
        .image_path
        .ok_or_else(|| "图片文件不存在".to_string())?;
    let bmp = fs::read(Path::new(&path)).map_err(|error| error.to_string())?;
    if bmp.len() <= 14 || &bmp[..2] != b"BM" {
        return Err("图片文件格式无效".to_string());
    }
    let Some((expected_bmp, width, height)) = dib_to_bmp(&bmp[14..]) else {
        return Err("图片数据格式无效".to_string());
    };
    mark_ignored_copy(
        &service,
        ClipboardPayload::Image {
            bmp: expected_bmp,
            width,
            height,
        },
    );
    let result = unsafe { set_clipboard_bytes(CF_DIB, &bmp[14..]) };
    if result.is_err() {
        clear_ignored_copy(&service);
    }
    result
}
