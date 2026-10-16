// The effects layer: a see-through window covering the screen that never takes
// clicks or focus. It draws drawing ink and plays the full-screen effects that
// scripts ask for with `touchroute fx`.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::APP;

pub const MODES: &[&str] = &[
    // Drawn effects
    "lightning", "fire", "hearts", "warp", "matrix", "confetti", "fireworks", "supernova", "portal", "aurora", "neon",
    "bubbles", "galaxy", "disco", "snow",
    // Emoji effects
    "pop", "spin", "rain", "burst", "float", "launch", "banner",
];

#[derive(Serialize, Clone)]
struct Play {
    mode: String,
    args: Vec<String>,
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, "fx", WebviewUrl::App("fx.html".into()))
        .title("TouchRoute effects")
        .inner_size(800.0, 600.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .focused(false)
        .focusable(false)
        .build()?;
    win.set_ignore_cursor_events(true)?;
    follow_cursor();
    Ok(())
}

/// The monitor the effects layer covers now, by position.
static ON: Mutex<Option<(i32, i32, u32, u32)>> = Mutex::new(None);

/// Moves the effects layer onto whichever screen the cursor is on.
pub fn follow_cursor() {
    let Some(app) = APP.get() else { return };
    let Some(win) = app.get_webview_window("fx") else { return };
    let Ok(cursor) = app.cursor_position() else { return };
    let Ok(monitors) = app.available_monitors() else { return };
    let found = monitors.iter().find(|m| {
        let (p, s) = (m.position(), m.size());
        cursor.x >= p.x as f64 && cursor.y >= p.y as f64 && cursor.x < (p.x + s.width as i32) as f64 && cursor.y < (p.y + s.height as i32) as f64
    });
    let Some(m) = found.or(monitors.first()) else { return };
    let spot = (m.position().x, m.position().y, m.size().width, m.size().height);
    let mut on = ON.lock().unwrap();
    if *on != Some(spot) {
        *on = Some(spot);
        let _ = win.set_position(*m.position());
        let _ = win.set_size(*m.size());
    }
}

/// Plays an effect. Unknown modes are refused so typos show up in the log.
pub fn play(mode: &str, args: &[&str]) -> Result<(), String> {
    if !MODES.contains(&mode) {
        return Err(format!("Unknown effect \"{mode}\". Try one of: {}", MODES.join(", ")));
    }
    let app = APP.get().ok_or("TouchRoute is still starting.")?;
    follow_cursor();
    let args = args.iter().take(4).map(|a| a.chars().take(300).collect()).collect();
    app.emit_to("fx", "fx", Play { mode: mode.into(), args }).map_err(|e| e.to_string())
}
