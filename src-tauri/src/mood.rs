// What the computer is up to, so the buddy can react: dozing off while you're
// away, sweating when the Mac is busy, drooping when the battery runs low.
// The buddy works out the time of day itself.

use std::process::Command;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Nobody has touched the keyboard, mouse or trackpad for this long.
const AWAY_AFTER: f64 = 120.0;

#[derive(Serialize, Clone, PartialEq, Default)]
pub struct Mood {
    pub away: bool,
    pub busy: bool,
    pub battery: Option<u8>,
    pub charging: bool,
}

#[cfg(target_os = "macos")]
fn idle_seconds() -> f64 {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, kind: u32) -> f64;
    }
    // Combined session state, any input event.
    unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) }
}

#[cfg(not(target_os = "macos"))]
fn idle_seconds() -> f64 {
    0.0
}

/// The one-minute load average per CPU core; above about 0.75 the Mac is working hard.
fn load() -> f64 {
    extern "C" {
        fn getloadavg(loadavg: *mut f64, n: i32) -> i32;
    }
    let mut l = [0.0f64; 1];
    let cores = std::thread::available_parallelism().map_or(4, |n| n.get()) as f64;
    if unsafe { getloadavg(l.as_mut_ptr(), 1) } == 1 { l[0] / cores } else { 0.0 }
}

/// Battery percentage and whether it's charging, from `pmset -g batt`.
fn battery() -> (Option<u8>, bool) {
    let Ok(out) = Command::new("/usr/bin/pmset").args(["-g", "batt"]).output() else { return (None, false) };
    let text = String::from_utf8_lossy(&out.stdout);
    let Some(line) = text.lines().find(|l| l.contains("InternalBattery")) else { return (None, false) };
    let pct = line.split('\t').nth(1).and_then(|r| r.split('%').next()).and_then(|n| n.trim().parse().ok());
    let charging = text.contains("AC Power") && !line.contains("discharging");
    (pct, charging)
}

pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = Mood::default();
        let mut busy_level = 0.0;
        let mut last_slow = Instant::now() - Duration::from_secs(3600);
        let (mut batt, mut charging) = (None, false);
        loop {
            if last_slow.elapsed() >= Duration::from_secs(20) {
                last_slow = Instant::now();
                (batt, charging) = battery();
                busy_level = load();
            }
            let idle = idle_seconds();
            #[allow(unused_mut)]
            let mut mood = Mood {
                // Wake the moment anything moves; doze only after a while.
                away: if last.away { idle > 1.5 } else { idle > AWAY_AFTER },
                busy: if last.busy { busy_level > 0.6 } else { busy_level > 0.8 },
                battery: batt,
                charging,
            };
            // Debug builds: TOUCHROUTE_DEMO_MOOD=away or busy forces a mood.
            #[cfg(debug_assertions)]
            if let Ok(m) = std::env::var("TOUCHROUTE_DEMO_MOOD") {
                mood.away |= m.contains("away");
                mood.busy |= m.contains("busy");
            }
            if mood != last {
                let _ = app.emit("mood", &mood);
                *CURRENT.lock().unwrap() = mood.clone();
                last = mood;
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

pub static CURRENT: std::sync::Mutex<Mood> = std::sync::Mutex::new(Mood { away: false, busy: false, battery: None, charging: false });
