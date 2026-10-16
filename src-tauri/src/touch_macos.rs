// Raw trackpad access on macOS through the private MultitouchSupport framework
// (the same one BetterTouchTool and MiddleClick use). It reports every finger,
// up to ~10 on Apple trackpads, without needing focus or extra permissions.

use std::ffi::{c_void, CString};
use std::os::raw::{c_char, c_int};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use crate::detector::{self, Touch};
use crate::draw;
use crate::haptics::Feel;

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
type GetDeviceId = unsafe extern "C" fn(*mut c_void, *mut u64) -> c_int;
type GetDimensions = unsafe extern "C" fn(*mut c_void, *mut c_int, *mut c_int) -> c_int;
type ActuatorCreate = unsafe extern "C" fn(u64) -> *mut c_void;
type ActuatorOpen = unsafe extern "C" fn(*mut c_void) -> c_int;
type ActuatorActuate = unsafe extern "C" fn(*mut c_void, i32, u32, f32, f32) -> c_int;

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
    device_id: GetDeviceId,
    dimensions: Option<GetDimensions>,
    actuator_create: Option<ActuatorCreate>,
    actuator_open: Option<ActuatorOpen>,
    actuate: Option<ActuatorActuate>,
}

static DEVICES: Mutex<Vec<usize>> = Mutex::new(Vec::new());

/// The haptic motor of each Force Touch trackpad, keyed by device.
static ACTUATORS: Mutex<Vec<(usize, usize)>> = Mutex::new(Vec::new());
/// Every actuator opened so far, by hardware id. Trackpads are rescanned every
/// minute; reusing these keeps that from opening a new one each time.
static OPENED: Mutex<Vec<(u64, usize)>> = Mutex::new(Vec::new());
/// The trackpad a finger last touched, so haptics play under the user's hand.
static LAST_DEVICE: Mutex<usize> = Mutex::new(0);
static ACTUATE: Mutex<Option<ActuatorActuate>> = Mutex::new(None);
/// Width over height of each trackpad's surface, so drawn circles stay round.
static ASPECT: Mutex<Vec<(usize, f32)>> = Mutex::new(Vec::new());

/// Run with TOUCHROUTE_DEBUG=1 to print every change in what the trackpad
/// reports: raw contacts, their states, and how many we count.
static DEBUG: std::sync::LazyLock<bool> = std::sync::LazyLock::new(|| std::env::var_os("TOUCHROUTE_DEBUG").is_some());
static LAST_DEBUG: Mutex<String> = Mutex::new(String::new());

fn debug_frame(device: usize, fingers: &[Finger]) {
    let states: Vec<String> = fingers.iter().map(|f| format!("{}:{}", f.identifier, f.state)).collect();
    let counted = fingers.iter().filter(|f| f.state == MAKE_TOUCH || f.state == TOUCHING).count();
    let line = format!("device {device:#x}  raw {}  counted {counted}  [{}]", fingers.len(), states.join(" "));
    let mut last = LAST_DEBUG.lock().unwrap();
    if *last != line {
        eprintln!("{line}");
        *last = line;
    }
}

extern "C" fn on_frame(device: *mut c_void, data: *const Finger, count: c_int, _ts: f64, _frame: c_int) -> c_int {
    let fingers: &[Finger] = if data.is_null() || count <= 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(data, count as usize) }
    };
    if *DEBUG {
        debug_frame(device as usize, fingers);
    }
    let touches: Vec<Touch> = fingers
        .iter()
        .filter(|f| f.state == MAKE_TOUCH || f.state == TOUCHING)
        .map(|f| Touch { id: f.identifier, x: f.normalized.pos.x, y: f.normalized.pos.y })
        .collect();
    let device = device as usize;
    if !touches.is_empty() {
        *LAST_DEVICE.lock().unwrap() = device;
    }
    // While a drawing is under way, the hold detector sees no fingers.
    if draw::on_frame(device, &touches, aspect(device)) {
        detector::on_frame(device, &[]);
    } else {
        detector::on_frame(device, &touches);
    }
    0
}

fn aspect(device: usize) -> f32 {
    ASPECT.lock().unwrap().iter().find(|(d, _)| *d == device).map_or(1.5, |(_, a)| *a)
}

/// Clicks the Force Touch trackpad the user's finger is on. Does nothing on
/// trackpads without a haptic motor.
pub fn actuate(kind: Feel) {
    let device = *LAST_DEVICE.lock().unwrap();
    let actuators = ACTUATORS.lock().unwrap();
    let found = actuators.iter().find(|(d, _)| *d == device).or(actuators.first()).copied();
    let (Some(actuate), Some((_, act))) = (*ACTUATE.lock().unwrap(), found) else {
        // No direct line to the motor (a Bluetooth Magic Trackpad, say): ask
        // macOS to play its standard feedback instead.
        drop(actuators);
        appkit_feedback(kind);
        return;
    };
    let id = match kind {
        Feel::Light => 3,
        Feel::Medium => 4,
        Feel::Strong => 6,
    };
    let err = unsafe { actuate(act as *mut c_void, id, 0, 0.0, 0.0) };
    if err != 0 && *DEBUG {
        eprintln!("haptic click failed: {err:#x}");
    }
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
            device_id: sym(handle, "MTDeviceGetDeviceID")?,
            dimensions: sym(handle, "MTDeviceGetSensorSurfaceDimensions").ok(),
            actuator_create: sym(handle, "MTActuatorCreateFromDeviceID").ok(),
            actuator_open: sym(handle, "MTActuatorOpen").ok(),
            actuate: sym(handle, "MTActuatorActuate").ok(),
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
        let mut actuators = Vec::new();
        let mut aspects = Vec::new();
        for i in 0..CFArrayGetCount(list) {
            let dev = CFArrayGetValueAtIndex(list, i) as *mut c_void;
            (api.register)(dev, on_frame);
            (api.start)(dev, 0);
            devices.push(dev as usize);
            if let Some(dims) = api.dimensions {
                let (mut w, mut h) = (0, 0);
                if dims(dev, &mut w, &mut h) == 0 && w > 0 && h > 0 {
                    aspects.push((dev as usize, w as f32 / h as f32));
                }
            }
            let mut id = 0u64;
            if let (Some(create), Some(open)) = (api.actuator_create, api.actuator_open) {
                let got = (api.device_id)(dev, &mut id);
                if *DEBUG {
                    eprintln!("trackpad {dev:?}: id {id:#x} (status {got})");
                }
                if got == 0 {
                    let mut opened = OPENED.lock().unwrap();
                    if let Some(&(_, act)) = opened.iter().find(|(i, _)| *i == id) {
                        actuators.push((dev as usize, act));
                    } else {
                        let act = create(id);
                        let status = if act.is_null() { -1 } else { open(act) };
                        if *DEBUG {
                            eprintln!("haptics for {id:#x}: actuator {act:?}, open status {status:#x}");
                        }
                        if !act.is_null() && status == 0 {
                            opened.push((id, act as usize));
                            actuators.push((dev as usize, act as usize));
                        }
                    }
                }
            }
        }
        *ACTUATORS.lock().unwrap() = actuators;
        *ASPECT.lock().unwrap() = aspects;
        *ACTUATE.lock().unwrap() = api.actuate;
    }
    detector::reset();
    Ok(devices.len())
}

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> *mut c_void;
    fn sel_registerName(name: *const c_char) -> *mut c_void;
    fn objc_msgSend();
}

/// NSHapticFeedbackManager.defaultPerformer.performFeedbackPattern(…), on the
/// main thread. Works on any Force Touch trackpad while a finger is on it.
fn appkit_feedback(kind: Feel) {
    let Some(app) = crate::APP.get() else { return };
    let _ = app.run_on_main_thread(move || unsafe {
        type Get = extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void;
        type Perform = extern "C" fn(*mut c_void, *mut c_void, isize, usize);
        let get: Get = std::mem::transmute(objc_msgSend as *const c_void);
        let perform: Perform = std::mem::transmute(objc_msgSend as *const c_void);
        let cls = objc_getClass(c"NSHapticFeedbackManager".as_ptr());
        if cls.is_null() {
            return;
        }
        let performer = get(cls, sel_registerName(c"defaultPerformer".as_ptr()));
        if performer.is_null() {
            return;
        }
        // Generic, alignment and level change, from softest to firmest.
        let pattern = match kind {
            Feel::Light => 0,
            Feel::Medium => 1,
            Feel::Strong => 2,
        };
        // Performance time "now".
        perform(performer, sel_registerName(c"performFeedbackPattern:performanceTime:".as_ptr()), pattern, 1);
    });
}

/// How many trackpads have a haptic motor TouchRoute can click.
pub fn haptic_count() -> usize {
    ACTUATORS.lock().unwrap().len()
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
