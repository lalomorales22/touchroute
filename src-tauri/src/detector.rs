// Turns raw touch frames into "N fingers held still for S seconds".
//
// 1. Settling: fingers land one at a time, so we wait until the count has
//    stayed the same for SETTLE seconds. Moving doesn't cancel yet.
// 2. Holding: the count is locked. Seconds are measured from when that
//    count landed. Every finger must
//    stay put; drifting (a scroll or drag) cancels. Another finger landing
//    goes back to settling with the new count.
// 3. Releasing: the first finger lifting ends the hold. If the count comes
//    back within FLICKER, it was a finger blinking out, so holding resumes.
//    When every finger is up, the slot for the whole seconds held fires.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use tauri::Emitter;

use crate::{actions, config, APP};

#[derive(Clone, Copy)]
pub struct Touch {
    pub id: i32,
    pub x: f32,
    pub y: f32,
}

#[derive(Serialize, Clone)]
pub struct TouchEvent {
    pub phase: &'static str,
    pub fingers: usize,
    pub elapsed: f64,
    pub slot: Option<String>,
}

#[derive(PartialEq, Clone, Copy)]
enum Phase {
    Idle,
    Settling,
    Holding,
    Releasing,
    Cancelled,
}

struct State {
    phase: Phase,
    /// When the current finger count was reached (settling) or locked (holding).
    since: Instant,
    /// When the first finger lifted, while releasing.
    lift: Instant,
    fingers: usize,
    anchors: HashMap<i32, (f32, f32)>,
    per_device: HashMap<usize, Vec<Touch>>,
    last_emit: Option<Instant>,
}

/// The finger count must hold steady this long before it's trusted. Time spent
/// settling still counts toward the seconds.
const SETTLE: f64 = 0.3;
/// How far (as a fraction of the trackpad) a finger may drift before the hold
/// counts as a scroll or drag.
const MOVE_LIMIT: f32 = 0.05;
/// A finger that drops out and comes back within this long never left.
const FLICKER: f64 = 0.3;
/// Fingers rarely lift together; give them this long to finish.
const RELEASE_GRACE: f64 = 1.2;
pub const MAX_SECONDS: u32 = 8;
#[cfg(target_os = "macos")]
pub const MAX_FINGERS: usize = 10;
#[cfg(not(target_os = "macos"))]
pub const MAX_FINGERS: usize = 5;

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn emit(phase: &'static str, fingers: usize, elapsed: f64, slot: Option<String>) {
    if let Some(app) = APP.get() {
        let _ = app.emit("touch", TouchEvent { phase, fingers, elapsed, slot });
    }
}

pub fn reset() {
    *STATE.lock().unwrap() = None;
}

pub fn busy() -> bool {
    STATE.lock().unwrap().as_ref().is_some_and(|s| s.phase != Phase::Idle)
}

fn anchors(touches: &[Touch]) -> HashMap<i32, (f32, f32)> {
    touches.iter().map(|t| (t.id, (t.x, t.y))).collect()
}

fn secs(a: Instant, b: Instant) -> f64 {
    b.duration_since(a).as_secs_f64()
}

pub fn on_frame(device: usize, touches: &[Touch]) {
    let mut guard = STATE.lock().unwrap();
    let s = guard.get_or_insert_with(|| State {
        phase: Phase::Idle,
        since: Instant::now(),
        lift: Instant::now(),
        fingers: 0,
        anchors: HashMap::new(),
        per_device: HashMap::new(),
        last_emit: None,
    });

    // Combine every trackpad (built-in + Magic Trackpad) into one view.
    s.per_device.insert(device, touches.to_vec());
    let all: Vec<Touch> = s.per_device.values().flatten().copied().collect();
    let n = all.len();
    let now = Instant::now();
    let throttle = |s: &mut State| {
        let due = s.last_emit.map_or(true, |t| now.duration_since(t).as_millis() >= 50);
        if due {
            s.last_emit = Some(now);
        }
        due
    };
    let mut fire: Option<(usize, f64)> = None;

    match s.phase {
        Phase::Idle => {
            if n > 0 {
                s.phase = Phase::Settling;
                s.since = now;
                s.fingers = n;
                emit("settling", n, 0.0, None);
            }
        }
        Phase::Settling => {
            if n == 0 {
                s.phase = Phase::Idle;
                emit("idle", 0, 0.0, None);
            } else if n != s.fingers {
                s.fingers = n;
                s.since = now;
                emit("settling", n, 0.0, None);
            } else if secs(s.since, now) >= SETTLE {
                // The clock started when this count landed, not now, so the
                // seconds match what the user is counting in their head.
                s.phase = Phase::Holding;
                s.anchors = anchors(&all);
                s.last_emit = Some(now);
                emit("holding", n, secs(s.since, now), None);
            } else if throttle(s) {
                emit("settling", n, 0.0, None);
            }
        }
        Phase::Holding => {
            let elapsed = secs(s.since, now);
            if n == 0 {
                fire = Some((s.fingers, elapsed));
                s.phase = Phase::Idle;
            } else if n > s.fingers {
                s.phase = Phase::Settling;
                s.fingers = n;
                s.since = now;
                emit("settling", n, 0.0, None);
            } else if n < s.fingers {
                s.phase = Phase::Releasing;
                s.lift = now;
            } else {
                let moved = all.iter().any(|t| match s.anchors.get(&t.id) {
                    Some(&(ax, ay)) => (t.x - ax).hypot(t.y - ay) > MOVE_LIMIT,
                    None => false,
                });
                // A finger that blinked out comes back with a new id; anchor it fresh.
                for t in &all {
                    s.anchors.entry(t.id).or_insert((t.x, t.y));
                }
                if moved || elapsed >= (MAX_SECONDS + 1) as f64 {
                    s.phase = Phase::Cancelled;
                    emit("cancelled", s.fingers, elapsed, None);
                } else if throttle(s) {
                    emit("holding", s.fingers, elapsed, None);
                }
            }
        }
        Phase::Releasing => {
            let held = secs(s.since, s.lift);
            let lifting = secs(s.lift, now);
            if n == 0 {
                fire = Some((s.fingers, held));
                s.phase = Phase::Idle;
            } else if n >= s.fingers && lifting < FLICKER {
                // Only a blink: carry on as if nothing happened.
                s.phase = Phase::Holding;
            } else if lifting > RELEASE_GRACE {
                s.phase = Phase::Cancelled;
                emit("cancelled", s.fingers, held, None);
            }
        }
        Phase::Cancelled => {
            if n == 0 {
                s.phase = Phase::Idle;
                emit("idle", 0, 0.0, None);
            }
        }
    }

    drop(guard);
    if let Some((fingers, held)) = fire {
        finish(fingers, held);
    }
}

fn finish(fingers: usize, held: f64) {
    let seconds = held.floor() as u32;
    if seconds < 1 || seconds > MAX_SECONDS || fingers > MAX_FINGERS {
        emit("idle", 0, 0.0, None);
        return;
    }
    let key = config::slot_key(fingers, seconds);
    let cfg = config::get();
    if cfg.enabled && cfg.slots.contains_key(&key) {
        actions::run(&key);
        emit("fired", fingers, held, Some(key));
    } else {
        emit("empty", fingers, held, Some(key));
    }
}
