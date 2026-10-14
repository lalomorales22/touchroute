#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod actions;
mod ai;
mod config;
mod detector;
#[cfg(target_os = "macos")]
mod touch_macos;

use std::sync::OnceLock;

use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub static APP: OnceLock<AppHandle> = OnceLock::new();

const BUDDY_SIZE: f64 = 200.0;

fn config_changed(app: &AppHandle) {
    let _ = app.emit("config", state_json());
}

fn state_json() -> Value {
    json!({
        "config": config::get(),
        "platform": std::env::consts::OS,
        "maxFingers": detector::MAX_FINGERS,
        "maxSeconds": detector::MAX_SECONDS,
    })
}

fn check_key(key: &str) -> Result<(), String> {
    if config::valid_key(key) { Ok(()) } else { Err("That isn't a valid touch.".into()) }
}

#[tauri::command]
fn get_state() -> Value {
    state_json()
}

#[tauri::command]
async fn claude_available() -> bool {
    tauri::async_runtime::spawn_blocking(ai::available).await.unwrap_or(false)
}

#[tauri::command]
async fn ask_claude(request: String, fingers: u32, seconds: u32, current: Option<String>) -> Result<ai::Draft, String> {
    tauri::async_runtime::spawn_blocking(move || ai::write_script(&request, fingers, seconds, current.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_script(key: String) -> Result<String, String> {
    check_key(&key)?;
    Ok(std::fs::read_to_string(config::script_path(&key)).unwrap_or_default())
}

#[tauri::command]
fn save_slot(app: AppHandle, key: String, name: String, prompt: String, script: String) -> Result<(), String> {
    check_key(&key)?;
    config::write_script(&key, &script).map_err(|e| e.to_string())?;
    config::update(|c| {
        c.slots.insert(key, config::Slot { name, prompt });
    });
    config_changed(&app);
    Ok(())
}

#[tauri::command]
fn delete_slot(app: AppHandle, key: String) -> Result<(), String> {
    check_key(&key)?;
    let _ = std::fs::remove_file(config::script_path(&key));
    config::update(|c| {
        c.slots.remove(&key);
    });
    config_changed(&app);
    Ok(())
}

#[tauri::command]
fn test_slot(key: String) -> Result<(), String> {
    check_key(&key)?;
    actions::run(&key);
    Ok(())
}

#[tauri::command]
fn set_enabled(app: AppHandle, enabled: bool) {
    config::update(|c| c.enabled = enabled);
    config_changed(&app);
}

#[tauri::command]
fn open_settings(app: AppHandle, slot: Option<String>) {
    show_settings(&app, slot);
}

#[tauri::command]
fn open_folder(which: String) {
    let dir = if which == "logs" { config::logs_dir() } else { config::scripts_dir() };
    let _ = std::process::Command::new("open").arg(dir).spawn();
}

#[tauri::command]
fn reconnect() -> Result<usize, String> {
    start_touch()
}

fn start_touch() -> Result<usize, String> {
    #[cfg(target_os = "macos")]
    return touch_macos::start();
    #[cfg(not(target_os = "macos"))]
    Err("Trackpad support for this system is coming soon.".into())
}

fn show_settings(app: &AppHandle, slot: Option<String>) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
        if let Some(slot) = slot {
            let _ = win.emit("select-slot", slot);
        }
        return;
    }
    let url = match slot {
        Some(s) if config::valid_key(&s) => format!("settings.html?slot={s}"),
        _ => "settings.html".into(),
    };
    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App(url.into()))
        .title("TouchRoute")
        .inner_size(1040.0, 700.0)
        .min_inner_size(860.0, 600.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .background_color(tauri::window::Color(0, 0, 0, 255))
        .build()
        .map(|w| {
            let _ = w.set_focus();
        });
}

fn toggle_buddy(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("buddy") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
        }
    }
}

fn build_buddy(app: &AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, "buddy", WebviewUrl::App("buddy.html".into()))
        .title("TouchRoute")
        .inner_size(BUDDY_SIZE, BUDDY_SIZE)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        .build()?;

    match config::get().buddy_position {
        Some((x, y)) => {
            let _ = win.set_position(tauri::LogicalPosition::new(x, y));
        }
        None => {
            if let Ok(Some(monitor)) = win.primary_monitor() {
                let scale = monitor.scale_factor();
                let size = monitor.size().to_logical::<f64>(scale);
                let _ = win.set_position(tauri::LogicalPosition::new(size.width - BUDDY_SIZE - 28.0, 64.0));
            }
        }
    }

    let handle = win.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::Moved(pos) = event {
            let scale = handle.scale_factor().unwrap_or(1.0);
            let p = pos.to_logical::<f64>(scale);
            // Remembered in memory now, written to disk on the next save or on quit.
            *config::CONFIG_POS.lock().unwrap() = Some((p.x, p.y));
        }
    });
    Ok(())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
    let buddy = MenuItem::with_id(app, "buddy", "Show or hide buddy", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause or resume touches", true, None::<&str>)?;
    let reconnect = MenuItem::with_id(app, "reconnect", "Reconnect trackpad", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit TouchRoute", true, Some("CmdOrCtrl+Q"))?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&settings, &buddy, &pause, &reconnect, &sep, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("TouchRoute")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => show_settings(app, None),
            "buddy" => toggle_buddy(app),
            "pause" => {
                config::update(|c| c.enabled = !c.enabled);
                config_changed(app);
            }
            "reconnect" => {
                let _ = start_touch();
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Reloads ~/.touchroute/config.json when something else edits it, so an AI
/// agent (or a text editor) can add touches while the app is running.
fn watch_config(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        if config::reload_if_changed() {
            eprintln!("touchroute: config.json changed on disk, reloaded");
            config_changed(&app);
        }
    });
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_state,
            claude_available,
            ask_claude,
            get_script,
            save_slot,
            delete_slot,
            test_slot,
            set_enabled,
            open_settings,
            open_folder,
            reconnect,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let _ = APP.set(app.handle().clone());
            config::init();
            build_buddy(app.handle())?;
            build_tray(app.handle())?;
            match start_touch() {
                Ok(n) => eprintln!("touchroute: listening on {n} trackpad(s)"),
                Err(e) => eprintln!("touchroute: {e}"),
            }
            #[cfg(target_os = "macos")]
            touch_macos::watch();
            watch_config(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building TouchRoute")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                config::flush_position();
            }
        });
}
