#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod actions;
mod ai;
mod config;
mod detector;
mod draw;
mod fx;
mod haptics;
mod ipc;
mod mood;
mod packs;
mod starter;
#[cfg(target_os = "macos")]
mod touch_macos;
mod update;

use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub static APP: OnceLock<AppHandle> = OnceLock::new();

const BUDDY_SIZE: f64 = 260.0;

fn config_changed(app: &AppHandle) {
    let _ = app.emit("config", state_json());
}

fn state_json() -> Value {
    json!({
        "config": config::get(),
        "platform": std::env::consts::OS,
        "maxFingers": detector::MAX_FINGERS,
        "maxSeconds": detector::MAX_SECONDS,
        "version": update::CURRENT,
        "update": update::AVAILABLE.lock().unwrap().clone(),
        "mood": mood::CURRENT.lock().unwrap().clone(),
        "effects": fx::MODES,
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
async fn ask_claude(
    request: String,
    fingers: Option<u32>,
    seconds: Option<u32>,
    drawing: Option<String>,
    current: Option<String>,
) -> Result<ai::Draft, String> {
    let trigger = match (drawing, fingers, seconds) {
        (Some(shape), _, _) => format!("holds Option and draws a shape ({shape}) on their trackpad with one finger"),
        (None, Some(f), Some(s)) => format!("holds {f} fingers still on their trackpad for {s} seconds and lets go"),
        _ => return Err("Pick a square or a drawing first.".into()),
    };
    tauri::async_runtime::spawn_blocking(move || ai::write_script(&request, &trigger, current.as_deref()))
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
fn add_fun_pack(app: AppHandle) -> usize {
    let added = config::add_fun_pack();
    config_changed(&app);
    added
}

#[tauri::command]
fn clear_all(app: AppHandle) {
    config::clear_all();
    config_changed(&app);
}

/// Changes how the buddy looks. Any field left out stays as it is.
#[tauri::command]
fn set_look(app: AppHandle, theme: Option<String>, style: Option<String>, reactivity: Option<f64>) -> Result<(), String> {
    if theme.as_deref().is_some_and(|t| !config::THEMES.contains(&t)) {
        return Err("Unknown theme.".into());
    }
    if style.as_deref().is_some_and(|s| !config::STYLES.contains(&s)) {
        return Err("Unknown style.".into());
    }
    config::update(|c| {
        if let Some(t) = theme {
            c.theme = t;
        }
        if let Some(s) = style {
            c.style = s;
        }
        if let Some(r) = reactivity {
            c.reactivity = r.clamp(0.0, 2.0);
        }
    });
    config_changed(&app);
    Ok(())
}

#[tauri::command]
fn set_haptics(app: AppHandle, on: bool) {
    config::update(|c| c.haptics = on);
    config_changed(&app);
    if on {
        haptics::feel(haptics::Feel::Medium);
    }
}

// ---------- drawings ----------

fn check_id(id: &str) -> Result<(), String> {
    if config::valid_id(id) { Ok(()) } else { Err("That isn't a valid drawing.".into()) }
}

/// A new id from the drawing's name, like "coffee-k3x9".
fn new_id(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug: String = slug.chars().take(24).collect();
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let mut tag = String::new();
    let mut k = n % 36u64.pow(4);
    for _ in 0..4 {
        tag.push(std::char::from_digit((k % 36) as u32, 36).unwrap());
        k /= 36;
    }
    if slug.is_empty() { format!("drawing-{tag}") } else { format!("{slug}-{tag}") }
}

#[tauri::command]
fn get_drawing_script(id: String) -> Result<String, String> {
    check_id(&id)?;
    Ok(std::fs::read_to_string(config::drawing_path(&id)).unwrap_or_default())
}

#[tauri::command]
fn save_drawing(
    app: AppHandle,
    id: Option<String>,
    name: String,
    prompt: String,
    script: String,
    samples: Vec<Vec<[f32; 2]>>,
) -> Result<String, String> {
    let samples: Vec<_> = samples.into_iter().filter(|s| s.len() >= 2).take(8).collect();
    if samples.is_empty() {
        return Err("Draw the shape first.".into());
    }
    let id = match id {
        Some(id) => {
            check_id(&id)?;
            id
        }
        None => new_id(&name),
    };
    config::write_drawing(&id, &script).map_err(|e| e.to_string())?;
    config::update(|c| {
        let d = config::Drawing { id: id.clone(), name, prompt, samples };
        match c.drawings.iter_mut().find(|x| x.id == id) {
            Some(x) => *x = d,
            None => c.drawings.push(d),
        }
    });
    config_changed(&app);
    Ok(id)
}

#[tauri::command]
fn delete_drawing(app: AppHandle, id: String) -> Result<(), String> {
    check_id(&id)?;
    let _ = std::fs::remove_file(config::drawing_path(&id));
    config::update(|c| c.drawings.retain(|d| d.id != id));
    config_changed(&app);
    Ok(())
}

#[tauri::command]
fn test_drawing(id: String) -> Result<(), String> {
    check_id(&id)?;
    actions::run_file(&config::drawing_path(&id), &format!("draw-{id}"));
    Ok(())
}

/// While settings is recording a drawing, trackpad strokes go to it.
#[tauri::command]
fn set_recording(on: bool) {
    draw::RECORDING.store(on, std::sync::atomic::Ordering::Relaxed);
}

/// Which saved drawing a stroke drawn in settings would match.
#[tauri::command]
fn match_stroke(points: Vec<[f32; 2]>) -> Option<String> {
    let cfg = config::get();
    draw::recognize(&points, &cfg.drawings).map(|(d, _)| d.id.clone())
}

#[tauri::command]
fn add_drawing_pack(app: AppHandle) -> usize {
    let added = config::add_drawing_pack();
    config_changed(&app);
    added
}

#[tauri::command]
fn play_fx(mode: String, args: Vec<String>) -> Result<(), String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    fx::play(&mode, &args)
}

// ---------- packs ----------

/// A pack opened from Finder before settings was ready to show it.
static OPENED_PACK: Mutex<Option<Result<packs::Pack, String>>> = Mutex::new(None);

#[tauri::command]
fn take_opened_pack() -> Option<Result<packs::Pack, String>> {
    OPENED_PACK.lock().unwrap().take()
}

#[tauri::command]
fn pack_builtin(name: String) -> Result<packs::Pack, String> {
    packs::builtin(&name).ok_or_else(|| "No such pack.".into())
}

#[tauri::command]
async fn pack_from_file() -> Result<Option<packs::Pack>, String> {
    tauri::async_runtime::spawn_blocking(|| match packs::choose_file() {
        Some(path) => packs::read(&path).map(Some),
        None => Ok(None),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pack_from_url(url: String) -> Result<packs::Pack, String> {
    tauri::async_runtime::spawn_blocking(move || packs::fetch(&url)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn pack_install(app: AppHandle, pack: packs::Pack, replace: bool) -> Result<packs::Installed, String> {
    let r = packs::install(&pack, replace)?;
    config_changed(&app);
    Ok(r)
}

#[tauri::command]
fn pack_export(name: String, author: String) -> Result<String, String> {
    let pack = packs::mine(&name, &author);
    if pack.touches.is_empty() && pack.drawings.is_empty() {
        return Err("You don't have any touches or drawings to share yet.".into());
    }
    packs::export(&pack).map(|p| p.display().to_string())
}

fn open_pack_file(app: &AppHandle, path: &std::path::Path) {
    let pack = packs::read(path);
    *OPENED_PACK.lock().unwrap() = Some(pack.clone());
    show_settings(app, None);
    let _ = app.emit_to("settings", "pack-open", pack);
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
async fn check_update() -> Result<Option<update::Update>, String> {
    tauri::async_runtime::spawn_blocking(update::check).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(update::install).await.map_err(|e| e.to_string())??;
    app.exit(0);
    Ok(())
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
        .visible(false)
        .build()
        .map(|w| {
            let _ = w.set_focus();
            // Recording a drawing stops when settings closes, so drawings work again.
            w.on_window_event(|e| {
                if let WindowEvent::Destroyed = e {
                    draw::RECORDING.store(false, std::sync::atomic::Ordering::Relaxed);
                }
            });
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
    let quit = MenuItem::with_id(app, "quit", "Quit TouchRoute", true, Some("CmdOrCtrl+Q"))?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&settings, &buddy, &pause, &sep, &quit])?;

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

/// Looks for a new release shortly after launch and then every six hours, and
/// tells the settings window when one is out.
fn watch_updates(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(10));
        loop {
            if let Ok(Some(found)) = update::check() {
                let _ = app.emit("update", found);
            }
            std::thread::sleep(std::time::Duration::from_secs(6 * 60 * 60));
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
            set_look,
            open_settings,
            open_folder,
            check_update,
            add_fun_pack,
            clear_all,
            install_update,
            set_haptics,
            get_drawing_script,
            save_drawing,
            delete_drawing,
            test_drawing,
            set_recording,
            match_stroke,
            add_drawing_pack,
            play_fx,
            take_opened_pack,
            pack_builtin,
            pack_from_file,
            pack_from_url,
            pack_install,
            pack_export,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let _ = APP.set(app.handle().clone());
            config::init();
            ipc::install_cli();
            ipc::serve();
            build_buddy(app.handle())?;
            fx::build(app.handle())?;
            build_tray(app.handle())?;
            match start_touch() {
                Ok(n) => {
                    #[cfg(target_os = "macos")]
                    eprintln!("touchroute: listening on {n} trackpad(s), {} with direct haptics", touch_macos::haptic_count());
                    #[cfg(not(target_os = "macos"))]
                    eprintln!("touchroute: listening on {n} trackpad(s)");
                }
                Err(e) => eprintln!("touchroute: {e}"),
            }
            #[cfg(target_os = "macos")]
            touch_macos::watch();
            watch_config(app.handle().clone());
            watch_updates(app.handle().clone());
            mood::watch(app.handle().clone());
            draw::demo();
            if std::env::args().any(|a| a == "--updated") {
                show_settings(app.handle(), None);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building TouchRoute")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                config::flush_position();
                let _ = std::fs::remove_file(ipc::socket_path());
            }
            // A .touchroute pack double-clicked in Finder.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                if let Some(path) = urls.iter().find_map(|u| u.to_file_path().ok()) {
                    open_pack_file(app, &path);
                }
            }
            _ => {}
        });
}
