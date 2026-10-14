// Raw trackpad access on macOS through the private MultitouchSupport framework
// (the same one BetterTouchTool and MiddleClick use). It reports every finger,
// up to ~10 on Apple trackpads, without needing focus or extra permissions.

use std::ffi::{c_void, CString};
use std::os::raw::{c_char, c_int};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use crate::detector::{self, Touch};

#[repr(C)]
#[derive(Clone, Copy)]
struct MtPoint {
    x: f32,
    y: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MtReadout {
    pos: MtPoint,
    vel: MtPoint,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Finger {
    frame: c_int,
    timestamp: f64,
    identifier: c_int,
    state: c_int,
    foo3: c_int,
    foo4: c_int,
    normalized: MtReadout,
    size: f32,
    zero1: c_int,
    angle: f32,
    major_axis: f32,
    minor_axis: f32,
    mm: MtReadout,
    zero2: [c_int; 2],
    unk2: f32,
}

type FrameCallback = extern "C" fn(*mut c_void, *const Finger, c_int, f64, c_int) -> c_int;
type CreateList = unsafe extern "C" fn() -> *const c_void;
type Register = unsafe extern "C" fn(*mut c_void, FrameCallback);
type Start = unsafe extern "C" fn(*mut c_void, c_int);
type Stop = unsafe extern "C" fn(*mut c_void);

extern "C" {
    fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, idx: isize) -> *const c_void;
}

const FRAMEWORK: &str = "/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport";

// MTTouchState: 3 = touch made, 4 = touching. Hovering fingers (1, 2) and
// lifting fingers (5+) don't count.
const MAKE_TOUCH: c_int = 3;
const TOUCHING: c_int = 4;

struct Api {
    create_list: CreateList,
    register: Register,
    unregister: Register,
    start: Start,
    stop: Stop,
}

static DEVICES: Mutex<Vec<usize>> = Mutex::new(Vec::new());

extern "C" fn on_frame(device: *mut c_void, data: *const Finger, count: c_int, _ts: f64, _frame: c_int) -> c_int {
    let fingers: &[Finger] = if data.is_null() || count <= 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(data, count as usize) }
    };
    let touches: Vec<Touch> = fingers
        .iter()
        .filter(|f| f.state == MAKE_TOUCH || f.state == TOUCHING)
        .map(|f| Touch { id: f.identifier, x: f.normalized.pos.x, y: f.normalized.pos.y })
        .collect();
    detector::on_frame(device as usize, &touches);
    0
}

unsafe fn sym<T: Copy>(handle: *mut c_void, name: &str) -> Result<T, String> {
    let cname = CString::new(name).unwrap();
    let ptr = dlsym(handle, cname.as_ptr());
    if ptr.is_null() {
        return Err(format!("MultitouchSupport is missing {name}"));
    }
    Ok(std::mem::transmute_copy(&ptr))
}

fn api() -> Result<Api, String> {
    unsafe {
        let path = CString::new(FRAMEWORK).unwrap();
        let handle = dlopen(path.as_ptr(), 1 /* RTLD_LAZY */);
        if handle.is_null() {
            return Err("Couldn't load MultitouchSupport".into());
        }
        Ok(Api {
            create_list: sym(handle, "MTDeviceCreateList")?,
            register: sym(handle, "MTRegisterContactFrameCallback")?,
            unregister: sym(handle, "MTUnregisterContactFrameCallback")?,
            start: sym(handle, "MTDeviceStart")?,
            stop: sym(handle, "MTDeviceStop")?,
        })
    }
}

/// Starts listening on every trackpad. Returns how many were found.
pub fn start() -> Result<usize, String> {
    let api = api()?;
    let mut devices = DEVICES.lock().unwrap();
    unsafe {
        for &dev in devices.iter() {
            (api.unregister)(dev as *mut c_void, on_frame);
            (api.stop)(dev as *mut c_void);
        }
        devices.clear();
        let list = (api.create_list)();
        if list.is_null() {
            return Ok(0);
        }
        for i in 0..CFArrayGetCount(list) {
            let dev = CFArrayGetValueAtIndex(list, i) as *mut c_void;
            (api.register)(dev, on_frame);
            (api.start)(dev, 0);
            devices.push(dev as usize);
        }
    }
    detector::reset();
    Ok(devices.len())
}

/// Trackpads stop reporting after sleep, and a Magic Trackpad may connect
/// later. A clock jump means we slept; a periodic rescan catches new devices.
pub fn watch() {
    std::thread::spawn(|| {
        let tick = Duration::from_secs(5);
        let mut last = SystemTime::now();
        let mut since_rescan = Duration::ZERO;
        loop {
            std::thread::sleep(tick);
            let now = SystemTime::now();
            let gap = now.duration_since(last).unwrap_or(tick);
            last = now;
            since_rescan += gap;
            let slept = gap > tick * 3;
            if slept || (since_rescan >= Duration::from_secs(60) && !detector::busy()) {
                since_rescan = Duration::ZERO;
                if slept {
                    std::thread::sleep(Duration::from_secs(2));
                }
                let _ = start();
            }
        }
    });
}
