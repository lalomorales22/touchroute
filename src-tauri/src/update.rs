// Checks GitHub for a newer release and installs it in place. Uses the
// system curl and ditto, the same tools install.sh uses, so updating does
// exactly what a fresh install would.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

const REPO: &str = "lalomorales22/touchroute";
const ASSET: &str = "TouchRoute-macos-arm64.zip";
pub const CURRENT: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Serialize)]
pub struct Update {
    pub current: String,
    pub latest: String,
    pub notes: String,
    pub url: String,
}

/// The newest release seen on the last check, if it's newer than this build.
pub static AVAILABLE: Mutex<Option<Update>> = Mutex::new(None);

fn version(v: &str) -> Vec<u32> {
    v.trim_start_matches('v').split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

pub fn check() -> Result<Option<Update>, String> {
    let out = Command::new("/usr/bin/curl")
        .args(["-fsSL", "--max-time", "15", "-H", "Accept: application/vnd.github+json"])
        .arg(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("Couldn't reach GitHub to check for updates.".into());
    }
    let release: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let tag = release["tag_name"].as_str().unwrap_or_default();
    let has_asset = release["assets"]
        .as_array()
        .is_some_and(|a| a.iter().any(|x| x["name"] == ASSET));
    let found = (has_asset && version(tag) > version(CURRENT)).then(|| Update {
        current: CURRENT.into(),
        latest: tag.trim_start_matches('v').into(),
        notes: release["body"].as_str().unwrap_or_default().into(),
        url: release["html_url"].as_str().unwrap_or_default().into(),
    });
    *AVAILABLE.lock().unwrap() = found.clone();
    Ok(found)
}

/// The TouchRoute.app this process is running from.
fn bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?.canonicalize().ok()?;
    let app = exe.parent()?.parent()?.parent()?; // .app/Contents/MacOS/touchroute
    (app.extension()? == "app").then(|| app.to_path_buf())
}

fn run(cmd: &mut Command) -> Result<(), String> {
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

/// Downloads and unpacks the new version next to the current one, then hands
/// off to a small shell script that swaps it in once this process has quit and
/// opens it again. The caller should quit the app right after this returns.
pub fn install() -> Result<(), String> {
    let app = bundle().ok_or("Updates only work for the installed app.")?;
    let dir = app.parent().ok_or("Couldn't find the Applications folder.")?;
    let staged = dir.join(".TouchRoute-update.app");
    let zip = std::env::temp_dir().join("touchroute-update.zip");
    let unpacked = std::env::temp_dir().join("touchroute-update");

    let _ = std::fs::remove_dir_all(&unpacked);
    let _ = std::fs::remove_dir_all(&staged);
    run(Command::new("/usr/bin/curl")
        .args(["-fsSL", "--max-time", "300", "-o"])
        .arg(&zip)
        .arg(format!("https://github.com/{REPO}/releases/latest/download/{ASSET}")))
    .map_err(|_| "The download failed. Check your connection and try again.".to_string())?;
    run(Command::new("/usr/bin/ditto").args(["-x", "-k"]).arg(&zip).arg(&unpacked))
        .map_err(|_| "The download was damaged. Try again.".to_string())?;
    let new_app = unpacked.join("TouchRoute.app");
    if !new_app.join("Contents/MacOS/touchroute").exists() {
        return Err("The download didn't contain TouchRoute.app.".into());
    }
    run(Command::new("/usr/bin/ditto").arg(&new_app).arg(&staged))
        .map_err(|_| format!("Couldn't write to {}.", dir.display()))?;
    // The app isn't notarized yet; this keeps macOS from refusing to open it.
    let _ = Command::new("/usr/bin/xattr").args(["-dr", "com.apple.quarantine"]).arg(&staged).status();
    let _ = std::fs::remove_file(&zip);
    let _ = std::fs::remove_dir_all(&unpacked);

    swap_and_relaunch(&app, &staged)
}

fn swap_and_relaunch(app: &Path, staged: &Path) -> Result<(), String> {
    // Wait for this process to exit, move the old app aside, move the new one
    // in, and put the old one back if that fails.
    let script = r#"
i=0
while [ $i -lt 150 ] && ps -p "$1" -o stat= 2>/dev/null | grep -qv Z; do sleep 0.2; i=$((i+1)); done
old="$2.old"
rm -rf "$old"
if mv "$2" "$old" && mv "$3" "$2"; then
  rm -rf "$old"
else
  [ -d "$2" ] || mv "$old" "$2"
  rm -rf "$3"
fi
open "$2" --args --updated
"#;
    Command::new("/bin/sh")
        .args(["-c", script, "touchroute-update"])
        .arg(std::process::id().to_string())
        .arg(app)
        .arg(staged)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
