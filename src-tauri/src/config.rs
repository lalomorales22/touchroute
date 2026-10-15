// Everything lives in ~/.touchroute:
//   config.json        which slots exist and what they're called
//   scripts/F-S.sh     the script each slot runs (plain files, edit freely)
//   logs/F-S.log       output from the last run
//   fun/fx.js          the emoji effects the fun pack's scripts use

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Slot {
    pub name: String,
    /// What the user asked for, kept so Claude can revise it later.
    #[serde(default)]
    pub prompt: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Config {
    pub enabled: bool,
    pub slots: BTreeMap<String, Slot>,
    #[serde(default)]
    pub buddy_position: Option<(f64, f64)>,
    /// Orb color theme: classic, dusk, neon or cosmic.
    #[serde(default = "classic")]
    pub theme: String,
}

fn classic() -> String {
    "classic".into()
}

pub const THEMES: [&str; 4] = ["classic", "dusk", "neon", "cosmic"];

static CONFIG: Mutex<Option<Config>> = Mutex::new(None);
/// Where the buddy was dragged to; folded into config.json on the next save.
pub static CONFIG_POS: Mutex<Option<(f64, f64)>> = Mutex::new(None);

const TALK_TO_CLAUDE: &str = r#"#!/bin/zsh
# Open a Terminal window and start Claude Code in ~/claude. Starting it in the
# home folder makes macOS ask for access to Photos, Music and so on.
mkdir -p ~/claude
osascript - "cd ~/claude && claude" <<'APPLESCRIPT'
on run argv
  set cmd to item 1 of argv
  set wasRunning to application "Terminal" is running
  tell application "Terminal"
    activate
    if wasRunning then
      do script cmd
    else
      -- Terminal opens its own window when it launches. Reuse it.
      repeat 50 times
        if (count of windows) > 0 then exit repeat
        delay 0.1
      end repeat
      if (count of windows) > 0 then
        do script cmd in window 1
      else
        do script cmd
      end if
    end if
  end tell
end run
APPLESCRIPT
"#;

pub fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into())).join(".touchroute")
}

pub fn scripts_dir() -> PathBuf {
    home().join("scripts")
}

pub fn logs_dir() -> PathBuf {
    home().join("logs")
}

pub fn script_path(key: &str) -> PathBuf {
    scripts_dir().join(format!("{key}.sh"))
}

pub fn slot_key(fingers: usize, seconds: u32) -> String {
    format!("{fingers}-{seconds}")
}

/// Keys come from the UI; only accept "F-S" so they can't escape the folder.
pub fn valid_key(key: &str) -> bool {
    let mut parts = key.split('-');
    let ok = |p: Option<&str>| p.is_some_and(|p| !p.is_empty() && p.len() <= 2 && p.bytes().all(|b| b.is_ascii_digit()));
    ok(parts.next()) && ok(parts.next()) && parts.next().is_none()
}

fn config_path() -> PathBuf {
    home().join("config.json")
}

fn modified() -> Option<std::time::SystemTime> {
    fs::metadata(config_path()).and_then(|m| m.modified()).ok()
}

fn read_disk() -> Option<Config> {
    fs::read_to_string(config_path()).ok().and_then(|s| serde_json::from_str(&s).ok())
}

/// When config.json was last written, by us or by anyone else.
static SEEN: Mutex<Option<std::time::SystemTime>> = Mutex::new(None);

/// Picks up edits made outside the app (by hand or by an AI agent following
/// the TouchRoute skill). Returns true if the config changed. A file that
/// doesn't parse is ignored until it's fixed.
pub fn reload_if_changed() -> bool {
    let now = modified();
    let mut seen = SEEN.lock().unwrap();
    if now.is_none() || now == *seen {
        return false;
    }
    *seen = now;
    drop(seen);
    match read_disk() {
        Some(mut cfg) => {
            if let Some(cur) = CONFIG.lock().unwrap().as_ref() {
                cfg.buddy_position = cfg.buddy_position.or(cur.buddy_position);
            }
            *CONFIG.lock().unwrap() = Some(cfg);
            true
        }
        None => false,
    }
}

pub fn init() {
    let _ = fs::create_dir_all(scripts_dir());
    let _ = fs::create_dir_all(logs_dir());
    write_fx();
    let first_run = read_disk().is_none();
    let cfg = read_disk().unwrap_or_else(|| {
        // First run: 5 fingers for 5 seconds talks to Claude.
        let mut slots = BTreeMap::new();
        slots.insert("5-5".into(), Slot { name: "Talk to Claude".into(), prompt: "Open Terminal and start claude".into() });
        let _ = write_script("5-5", TALK_TO_CLAUDE);
        Config { enabled: true, slots, buddy_position: None, theme: classic() }
    });
    *CONFIG.lock().unwrap() = Some(cfg);
    if first_run {
        add_fun_pack();
    }
    save();
}

fn write_fx() {
    let dir = home().join("fun");
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(dir.join("fx.js"), crate::starter::FX);
}

/// Fills every empty square that the fun pack has a touch for. Never replaces
/// a touch the user already has. Returns how many it added.
pub fn add_fun_pack() -> usize {
    write_fx();
    let mut added = 0;
    update(|c| {
        for (key, name, prompt, script) in crate::starter::SLOTS {
            if c.slots.contains_key(*key) || write_script(key, script).is_err() {
                continue;
            }
            c.slots.insert(key.to_string(), Slot { name: name.to_string(), prompt: prompt.to_string() });
            added += 1;
        }
    });
    added
}

/// Removes every touch and its script.
pub fn clear_all() {
    update(|c| {
        for key in c.slots.keys() {
            let _ = fs::remove_file(script_path(key));
        }
        c.slots.clear();
    });
}

pub fn get() -> Config {
    CONFIG.lock().unwrap().clone().expect("config not loaded")
}

pub fn update(f: impl FnOnce(&mut Config)) {
    if let Some(cfg) = CONFIG.lock().unwrap().as_mut() {
        f(cfg);
    }
    save();
}

pub fn save() {
    let pos = *CONFIG_POS.lock().unwrap();
    if let Some(cfg) = CONFIG.lock().unwrap().as_mut() {
        if pos.is_some() {
            cfg.buddy_position = pos;
        }
        if let Ok(json) = serde_json::to_string_pretty(cfg) {
            let _ = fs::write(config_path(), json);
        }
    }
    *SEEN.lock().unwrap() = modified();
}

pub fn flush_position() {
    save();
}

pub fn write_script(key: &str, body: &str) -> std::io::Result<()> {
    let path = script_path(key);
    fs::write(&path, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}
