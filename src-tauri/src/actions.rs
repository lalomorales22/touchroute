use std::fs::File;
use std::process::{Command, Stdio};

use crate::config;

#[cfg(target_os = "macos")]
const SHELL: &str = "/bin/zsh";
#[cfg(not(target_os = "macos"))]
const SHELL: &str = "/bin/bash";

/// Runs a slot's script in a login shell (so the user's PATH works, the same
/// as in their terminal), in the background, logging to ~/.touchroute/logs.
pub fn run(key: &str) {
    let script = config::script_path(key);
    if !script.exists() {
        return;
    }
    let log = File::create(config::logs_dir().join(format!("{key}.log"))).ok();
    let (out, err) = match log.and_then(|f| f.try_clone().ok().map(|g| (f, g))) {
        Some((f, g)) => (Stdio::from(f), Stdio::from(g)),
        None => (Stdio::null(), Stdio::null()),
    };
    let child = Command::new(SHELL)
        .arg("-l")
        .arg(&script)
        .current_dir(std::env::var("HOME").unwrap_or_else(|_| "/".into()))
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err)
        .spawn();
    if let Ok(mut child) = child {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
}

/// Runs a command in the user's login shell and returns stdout.
pub fn login_shell(cmd: &str, stdin: Option<&str>) -> Result<String, String> {
    use std::io::Write;
    let mut child = Command::new(SHELL)
        .arg("-lc")
        .arg(cmd)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}
