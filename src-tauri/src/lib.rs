mod audio;
mod clipboard;

use audio::{
    get_audio_devices, set_default_device, set_device_mute, set_device_volume,
    toggle_default_input_mute,
};
use clipboard::{
    clear_clipboard_history, copy_clipboard_image, copy_clipboard_item, get_clipboard_history,
    get_clipboard_image,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOSENDCHANGING, SWP_NOZORDER,
};

const NATIVE_PANEL_WIDTH: f64 = 360.0;
const NATIVE_PANEL_HEIGHT: f64 = 620.0;

#[tauri::command]
fn hide_panel(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_panel_geometry(
    window: WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    let width = width.max(32);
    let height = height.max(32);

    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                x,
                y,
                width,
                height,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING | SWP_NOZORDER,
            )
            .map_err(|error| error.to_string())?;
        }
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        window
            .set_size(LogicalSize::new(width as f64, height as f64))
            .map_err(|error| error.to_string())?;
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn is_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn enable_autostart(app: AppHandle) -> Result<(), String> {
    app.autolaunch().enable().map_err(|error| error.to_string())
}

#[tauri::command]
fn disable_autostart(app: AppHandle) -> Result<(), String> {
    app.autolaunch()
        .disable()
        .map_err(|error| error.to_string())
}

fn reveal_initial_panel(window: &WebviewWindow) {
    // Keep the first native frame usable even if the frontend has not mounted
    // yet. Without this fallback, a transparent window can stay at Tauri's
    // 16x16 startup size and appear to be running only in the background.
    let _ = window.set_size(LogicalSize::new(NATIVE_PANEL_WIDTH, NATIVE_PANEL_HEIGHT));

    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let width = (NATIVE_PANEL_WIDTH * scale).round() as i32;
        let area = monitor.work_area();
        let x = area.position.x + ((area.size.width as i32 - width) / 2);
        let y = area.position.y;
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }

    let _ = window.show();

}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_audio_devices,
            set_default_device,
            set_device_mute,
            set_device_volume,
            toggle_default_input_mute,
            get_clipboard_history,
            get_clipboard_image,
            clear_clipboard_history,
            copy_clipboard_item,
            copy_clipboard_image,
            hide_panel,
            set_panel_geometry,
            is_autostart_enabled,
            enable_autostart,
            disable_autostart
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    None,
                ))?;

                if let Some(window) = app.get_webview_window("main") {
                    reveal_initial_panel(&window);
                }

                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

                clipboard::start(app.handle());

                let show_item = MenuItem::with_id(app, "show", "显示面板", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .tooltip("Audio Switcher")
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            if let Some(window) = tray.app_handle().get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running audio switcher");
}
