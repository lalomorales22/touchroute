// Turns raw touch frames into "N fingers held still for S seconds".
//
// Fingers land, the count settles, and the timer runs while every finger
// stays put. Lifting fires the slot for the whole seconds held. Moving
// (scrolling, dragging) or holding past the last second cancels.

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

#[derive(PartialEq)]
enum Phase {
    Idle,
    Holding,
    Releasing,
    Cancelled,
}

struct State {
    phase: Phase,
    start: Instant,
    held: f64,
    fingers: usize,
    anchors: HashMap<i32, (f32, f32)>,
    per_device: HashMap<usize, Vec<Touch>>,
    last_emit: Option<Instant>,
}

/// How far (as a fraction of the trackpad) a finger may drift before the hold
/// counts as a scroll or drag.
const MOVE_LIMIT: f32 = 0.035;
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

pub fn on_frame(device: usize, touches: &[Touch]) {
    let mut guard = STATE.lock().unwrap();
    let s = guard.get_or_insert_with(|| State {
        phase: Phase::Idle,
        start: Instant::now(),
        held: 0.0,
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
    let elapsed = now.duration_since(s.start).as_secs_f64();

    match s.phase {
        Phase::Idle => {
            if n > 0 {
                s.phase = Phase::Holding;
                s.start = now;
                s.fingers = n;
                s.anchors = anchors(&all);
                s.last_emit = Some(now);
                emit("holding", n, 0.0, None);
            }
        }
        Phase::Holding => {
            if n == 0 {
                s.held = elapsed;
                let (f, held) = (s.fingers, s.held);
                s.phase = Phase::Idle;
                drop(guard);
                finish(f, held);
            } else if n > s.fingers {
                // Another finger landed: the count changed, so start over.
                s.fingers = n;
                s.start = now;
                s.anchors = anchors(&all);
                emit("holding", n, 0.0, None);
            } else if n < s.fingers {
                s.phase = Phase::Releasing;
                s.held = elapsed;
            } else {
                let moved = all.iter().any(|t| match s.anchors.get(&t.id) {
                    Some(&(ax, ay)) => (t.x - ax).hypot(t.y - ay) > MOVE_LIMIT,
                    None => false,
                });
                for t in &all {
                    s.anchors.entry(t.id).or_insert((t.x, t.y));
                }
                if moved || elapsed >= (MAX_SECONDS + 1) as f64 {
                    s.phase = Phase::Cancelled;
                    emit("cancelled", s.fingers, elapsed, None);
                } else if s.last_emit.map_or(true, |t| now.duration_since(t).as_millis() >= 50) {
                    s.last_emit = Some(now);
                    emit("holding", s.fingers, elapsed, None);
                }
            }
        }
        Phase::Releasing => {
            if n == 0 {
                let (f, held) = (s.fingers, s.held);
                s.phase = Phase::Idle;
                drop(guard);
                finish(f, held);
            } else if elapsed - s.held > RELEASE_GRACE {
                s.phase = Phase::Cancelled;
                emit("cancelled", s.fingers, elapsed, None);
            }
        }
        Phase::Cancelled => {
            if n == 0 {
                s.phase = Phase::Idle;
                emit("idle", 0, 0.0, None);
            }
        }
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
