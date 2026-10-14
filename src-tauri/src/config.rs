// Everything lives in ~/.touchroute:
//   config.json        which slots exist and what they're called
//   scripts/F-S.sh     the script each slot runs (plain files, edit freely)
//   logs/F-S.log       output from the last run

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
}

static CONFIG: Mutex<Option<Config>> = Mutex::new(None);
/// Where the buddy was dragged to; folded into config.json on the next save.
pub static CONFIG_POS: Mutex<Option<(f64, f64)>> = Mutex::new(None);

const TALK_TO_CLAUDE: &str = r#"#!/bin/zsh
# Open a new Terminal window and start Claude Code.
osascript \
  -e 'tell application "Terminal" to activate' \
  -e 'tell application "Terminal" to do script "claude"'
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

pub fn init() {
    let _ = fs::create_dir_all(scripts_dir());
    let _ = fs::create_dir_all(logs_dir());
    let path = home().join("config.json");
    let cfg = match fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()) {
        Some(cfg) => cfg,
        None => {
            // First run: 5 fingers for 5 seconds talks to Claude.
            let mut slots = BTreeMap::new();
            slots.insert("5-5".into(), Slot { name: "Talk to Claude".into(), prompt: "Open Terminal and start claude".into() });
            let _ = write_script("5-5", TALK_TO_CLAUDE);
            Config { enabled: true, slots, buddy_position: None }
        }
    };
    *CONFIG.lock().unwrap() = Some(cfg);
    save();
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
            let _ = fs::write(home().join("config.json"), json);
        }
    }
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
