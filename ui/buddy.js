import { invoke, listen, win, currentMonitor, LogicalSize, LogicalPosition, fingerColor, fingerHue, setTheme, isGalaxy, currentTheme, parseKey, slotCode, plural } from "./shared.js";

// The buddy is just its dots, floating on the desktop with no backing. Each
// colored dot is one of your touches. Zooming in spreads them slowly into a
// dial: rings are fingers (1 in the middle), spokes are seconds (1s at the
// top, clockwise), so every touch sits at its own fingers-by-seconds spot.

const COMPACT = 200;
const DIAL = 500;
const RING0 = 72;     // radius of the 1-finger ring (leaves room for the hub)
const RING_STEP = 15; // distance between rings
const TRAVEL = 1.15;  // seconds each dot takes to fly between modes
const STAGGER = 0.06; // extra delay per ring, so the dial unfolds outward
const MIN_DUST = 16;

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const displayFont = getComputedStyle(document.documentElement).getPropertyValue("--display");

// While touches are paused the buddy is just its dots: no counting ring, no
// readout, no reacting to fingers. Resuming brings all of that back.
const paused = () => state && !state.config.enabled;
const IDLE = { phase: "idle", fingers: 0, elapsed: 0, slot: null, at: 0 };

let state = null;
let theme = null;
let style = "orbs";      // "orbs" or "critters"
let react = 1;           // reactiveness, 0 (calm) to 2 (hyper)
let shock = -1;          // when the dial last finished opening (for the shockwave)
let pop = -1;            // when the dots last landed home (for the little flash)
let slots = new Map();   // key -> { f, s, name }
let dots = [];           // living dots, one per touch
let dust = [];           // tiny ambient motes that keep an empty buddy alive
let open = false;        // target mode
let openT = 0;           // 0 = cluster; counts up while the dial unfolds
let resizing = false;
let shift = { x: 0, y: 0 };
let hover = null;        // dial spot under the cursor
let mouse = null;        // cursor position, for the dots to lean toward
let touch = { ...IDLE };
let burst = 0;
let readoutUntil = 0;

// ---------- data ----------

function applyState(s) {
  state = s;
  style = s.config.style ?? "orbs";
  react = s.config.reactivity ?? 1;
  if (s.config.theme !== theme) {
    theme = s.config.theme;
    setTheme(theme);
    galaxies.clear();
  }
  if (paused()) {
    touch = { ...IDLE };
    burst = 0;
    readoutUntil = 0;
  }
  slots = new Map(Object.entries(s.config.slots).map(([key, v]) => {
    const [f, sec] = parseKey(key);
    return [key, { f, s: sec, name: v.name }];
  }));
  const old = new Map(dots.map((d) => [d.key, d]));
  dots = [...slots.entries()]
    .sort(([, a], [, b]) => a.f - b.f || a.s - b.s)
    .map(([key, v], i) => Object.assign(old.get(key) ?? spawn(i, true), { key, f: v.f, s: v.s }));
  const want = Math.max(8, MIN_DUST - dots.length);
  while (dust.length < want) dust.push(spawn(dust.length + 7, false));
  dust.length = want;
  updateHub();
}

function spawn(i, alive) {
  const c = clusterCenter();
  return {
    x: c.x, y: c.y, lx: c.x, ly: c.y,
    angle: i * 2.39996 + Math.random() * 0.4,
    orbit: (alive ? 16 : 22) + Math.sqrt(i + 1) * (alive ? 11 : 12),
    speed: (0.16 + Math.random() * 0.2) * (Math.random() < 0.5 ? -1 : 1),
    seed: Math.random() * 1000,
    hopAt: performance.now() / 1000 + 2 + Math.random() * 8,
    blinkAt: performance.now() / 1000 + 1 + Math.random() * 5,
    trail: [],
    size: alive ? 0 : 1.3 + Math.random() * 1.4,
    lit: 1,
  };
}

// ---------- geometry ----------

const view = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
const clusterCenter = () => ({ x: shift.x + COMPACT / 2, y: shift.y + COMPACT / 2 });
const dialCenter = () => ({ x: DIAL / 2, y: DIAL / 2 });
const maxSeconds = () => state?.maxSeconds ?? 8;
const maxFingers = () => state?.maxFingers ?? 10;

function latticePoint(f, s) {
  const c = dialCenter();
  const r = RING0 + (f - 1) * RING_STEP;
  const a = -Math.PI / 2 + ((s - 1) / maxSeconds()) * Math.PI * 2;
  return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
}

function resizeCanvas() {
  const dpr = devicePixelRatio || 1;
  const { w, h } = view();
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resizeCanvas).observe(canvas);

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// How far along its flight a dot on ring f is (0 = cluster, 1 = dial).
const progress = (f) => ease(clamp01((openT - (f - 1) * STAGGER) / TRAVEL));
const fullyOpen = () => TRAVEL + maxFingers() * STAGGER;
const settled = () => open && openT > fullyOpen() * 0.8;

// ---------- zoom ----------

async function setOpen(next) {
  if (next === open || resizing) return;
  if (next) {
    // The window grows invisibly (it's transparent), centered on the cluster.
    resizing = true;
    const scale = await win.scaleFactor();
    const pos = (await win.outerPosition()).toLogical(scale);
    let x = pos.x - (DIAL - COMPACT) / 2;
    let y = pos.y - (DIAL - COMPACT) / 2;
    const mon = await currentMonitor();
    if (mon) {
      const mp = mon.position.toLogical(mon.scaleFactor);
      const ms = mon.size.toLogical(mon.scaleFactor);
      x = Math.max(mp.x, Math.min(x, mp.x + ms.width - DIAL));
      y = Math.max(mp.y + 24, Math.min(y, mp.y + ms.height - DIAL));
    }
    shift = { x: pos.x - x, y: pos.y - y };
    moveAll(shift.x, shift.y);
    await win.setPosition(new LogicalPosition(x, y));
    await win.setSize(new LogicalSize(DIAL, DIAL));
    resizing = false;
    open = true;
    shock = performance.now() / 1000;
    document.body.classList.add("open");
  } else {
    open = false;
    hover = null;
    updateHub();
    document.body.classList.remove("open");
  }
}

function moveAll(dx, dy) {
  for (const d of [...dots, ...dust]) { d.x += dx; d.y += dy; d.lx += dx; d.ly += dy; }
}

// Runs once the dots have flown home after closing.
async function shrink() {
  resizing = true;
  const scale = await win.scaleFactor();
  const pos = (await win.outerPosition()).toLogical(scale);
  const back = { ...shift };
  shift = { x: 0, y: 0 };
  moveAll(-back.x, -back.y);
  await win.setSize(new LogicalSize(COMPACT, COMPACT));
  await win.setPosition(new LogicalPosition(pos.x + back.x, pos.y + back.y));
  resizing = false;
}

// ---------- input ----------

function spotAt(x, y) {
  let best = null;
  let bestD = 11;
  for (let f = 1; f <= maxFingers(); f++) {
    for (let s = 1; s <= maxSeconds(); s++) {
      const p = latticePoint(f, s);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = `${f}-${s}`; }
    }
  }
  return best;
}

let press = null;
document.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.target.closest?.("button")) return;
  press = { x: e.screenX, y: e.screenY, cx: e.clientX, cy: e.clientY };
});
document.addEventListener("mousemove", (e) => {
  mouse = { x: e.clientX, y: e.clientY };
  if (press && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) {
    press = null;
    win.startDragging();
    return;
  }
  if (settled()) {
    const next = spotAt(e.clientX, e.clientY);
    if (next !== hover) { hover = next; updateHub(); }
  }
});
document.addEventListener("mouseup", () => {
  if (press && settled()) {
    const key = spotAt(press.cx, press.cy);
    if (key) invoke("open_settings", { slot: key });
  }
  press = null;
});
document.addEventListener("mouseleave", () => {
  mouse = null;
  if (hover) { hover = null; updateHub(); }
});
document.addEventListener("dblclick", (e) => {
  if (e.target.closest?.("button")) return;
  if (settled() && spotAt(e.clientX, e.clientY)) return; // that was a click on a spot
  setOpen(!open);
});
document.addEventListener("wheel", (e) => {
  if (e.deltaY < -3) setOpen(true);
  else if (e.deltaY > 3) setOpen(false);
}, { passive: true });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
$("gear").onclick = () => invoke("open_settings", { slot: null });

// ---------- text ----------

function updateHub() {
  if (hover) {
    const [f, s] = parseKey(hover);
    const slot = slots.get(hover);
    $("hubCode").textContent = slotCode(f, s);
    $("hubCode").style.color = fingerColor(f, 1, 84);
    $("hubName").textContent = slot ? slot.name : "Empty";
    $("hubMeta").textContent = slot ? `${plural(f, "finger")}, ${plural(s, "second")}` : "Click to set it up";
  } else {
    $("hubCode").textContent = String(slots.size);
    $("hubCode").style.color = "";
    $("hubName").textContent = slots.size === 1 ? "touch set up" : "touches set up";
    $("hubMeta").textContent = slots.size ? "Point at a dot to see it" : "Click any spot to add one";
  }
}

function showReadout(code, label, ms) {
  $("code").textContent = code;
  $("label").textContent = label;
  $("readout").classList.add("show");
  readoutUntil = ms ? performance.now() + ms : Infinity;
}

listen("touch", ({ payload: p }) => {
  if (paused()) return;
  touch = { ...p, at: performance.now() };
  const name = (key) => slots.get(key)?.name;
  if (p.phase === "settling") {
    showReadout(String(p.fingers), `${plural(p.fingers, "finger")}, hold still`, 0);
  } else if (p.phase === "holding") {
    const sec = Math.floor(p.elapsed);
    if (sec < 1) showReadout(String(p.fingers), plural(p.fingers, "finger"), 0);
    else showReadout(slotCode(p.fingers, sec), name(`${p.fingers}-${sec}`) ?? (sec > maxSeconds() ? "let go to cancel" : "nothing here yet"), 0);
  } else if (p.phase === "fired") {
    burst = 1;
    const [f, s] = parseKey(p.slot);
    showReadout(slotCode(f, s), name(p.slot) ?? "", 1800);
  } else if (p.phase === "empty") {
    const [f, s] = parseKey(p.slot);
    showReadout(slotCode(f, s), "nothing here yet", 1300);
  } else if (p.phase === "cancelled") {
    showReadout("×", "cancelled", 800);
  } else {
    readoutUntil = Math.min(readoutUntil, performance.now() + 200);
  }
});

listen("config", ({ payload }) => applyState(payload));

// ---------- drawing ----------

// A dot is a little bead: a soft halo, a dark rim so it reads on light
// wallpapers, a shaded body, and a highlight so it feels round.
function bead(x, y, r, f, alpha, lit, seed = 0) {
  if (isGalaxy()) return galaxyBead(x, y, r * 1.25, f, alpha, lit, seed);
  const fx = currentTheme();
  const t = performance.now() / 1000;
  const beat = fx.pulse ? 0.7 + 0.5 * Math.sin(t * 3 + seed) : 1;
  const halo = r * (2.4 + lit) * (fx.pulse ? 1.25 : 1);
  const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, halo);
  glow.addColorStop(0, fingerColor(f, 0.3 * alpha * lit * beat));
  glow.addColorStop(1, fingerColor(f, 0));
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, halo, 0, 7); ctx.fill();

  ctx.fillStyle = `rgba(0,0,0,${0.35 * alpha})`;
  ctx.beginPath(); ctx.arc(x, y + 0.8, r + 1, 0, 7); ctx.fill();

  const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  body.addColorStop(0, fingerColor(f, alpha, 90));
  body.addColorStop(1, fingerColor(f, alpha, 62));
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();

  if (fx.ember) {
    // A warm core that slowly glows and fades, like a coal.
    const heat = 0.55 + 0.45 * Math.sin(t * 1.6 + seed * 2);
    const core = ctx.createRadialGradient(x, y + r * 0.1, 0, x, y + r * 0.1, r * 0.75);
    core.addColorStop(0, `hsla(${28 + heat * 14}, 100%, 66%, ${0.75 * heat * alpha})`);
    core.addColorStop(1, "hsla(20, 100%, 50%, 0)");
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  if (fx.sheen) {
    // A glint that drifts around the inside of the glass.
    const a = t * 0.7 + seed;
    const gx = x + Math.cos(a) * r * 0.42, gy = y + Math.sin(a) * r * 0.42;
    const glint = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 0.45);
    glint.addColorStop(0, `rgba(255,255,255,${(fx.pulse ? 0.45 : 0.3) * alpha})`);
    glint.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glint;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  if (fx.pulse) {
    ctx.strokeStyle = fingerColor(f, 0.4 * beat * alpha, 80);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r + 2 + beat * 1.5, 0, 7); ctx.stroke();
  }

  ctx.fillStyle = `rgba(255,255,255,${0.5 * alpha})`;
  ctx.beginPath(); ctx.arc(x - r * 0.33, y - r * 0.38, r * 0.26, 0, 7); ctx.fill();
}

// ---------- critters ----------

// Eyes, blinks and a smile on top of a dot. The eyes follow the cursor, watch
// the middle while fingers are down, and wander otherwise.
function critterFace(x, y, r, d, alpha, t) {
  let tx, ty;
  const holding = touch.phase === "holding" || touch.phase === "settling";
  if (mouse) { tx = mouse.x; ty = mouse.y; }
  else if (holding) { const c = open ? dialCenter() : clusterCenter(); tx = c.x; ty = c.y; }
  else { tx = x + Math.cos(t * 0.6 + d.seed) * 40; ty = y + Math.sin(t * 0.8 + d.seed * 1.3) * 30; }
  const look = Math.atan2(ty - y, tx - x);
  const reach = Math.min(1, Math.hypot(tx - x, ty - y) / 30);

  if (t > d.blinkAt) { d.blinkStart = t; d.blinkAt = t + 2 + Math.random() * 5; }
  const since = t - (d.blinkStart ?? -9);
  const lid = since < 0.16 ? Math.max(0.1, Math.abs(Math.cos((since / 0.16) * Math.PI))) : 1;

  for (const side of [-1, 1]) {
    const ex = x + side * r * 0.36, ey = y - r * 0.12;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.3, r * 0.36 * lid, 0, 0, 7); ctx.fill();
    if (lid > 0.45) {
      const px = ex + Math.cos(look) * r * 0.12 * reach, py = ey + Math.sin(look) * r * 0.14 * reach;
      ctx.fillStyle = `rgba(14,14,18,${alpha})`;
      ctx.beginPath(); ctx.arc(px, py, r * 0.16, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.9 * alpha})`;
      ctx.beginPath(); ctx.arc(px - r * 0.05, py - r * 0.06, r * 0.05, 0, 7); ctx.fill();
    }
  }
  // A small smile that grows into a grin when a touch fires.
  const grin = Math.min(1, burst * 1.5);
  ctx.strokeStyle = isGalaxy() ? `rgba(235,235,245,${0.7 * alpha})` : `rgba(20,20,26,${0.75 * alpha})`;
  ctx.lineWidth = Math.max(0.8, r * 0.1);
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(x, y + r * 0.2, r * (0.2 + grin * 0.12), Math.PI * (0.18 - grin * 0.08), Math.PI * (0.82 + grin * 0.08)); ctx.stroke();
}

// ---------- cosmic theme ----------

// One painted galaxy per finger count: deep space, nebula clouds in that
// finger's colors, two spiral arms of stars. Made once, then spun inside
// each orb.
const galaxies = new Map();
function galaxy(f) {
  if (galaxies.has(f)) return galaxies.get(f);
  const S = 128, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const h = fingerHue(f);
  const dark = isGalaxy() === "dark";
  const bg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  bg.addColorStop(0, dark ? `hsl(${h}, 35%, 7%)` : `hsl(${h}, 60%, 22%)`);
  bg.addColorStop(1, dark ? "#000" : `hsl(${h + 40}, 70%, 5%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  for (const [dh, n] of [[0, 4], [50, 3], [-60, 3]]) {
    for (let i = 0; i < n; i++) {
      const x = Math.random() * S, y = Math.random() * S, r = 18 + Math.random() * 30;
      const cloud = g.createRadialGradient(x, y, 0, x, y, r);
      cloud.addColorStop(0, dark ? `hsla(${h + dh}, 60%, 40%, 0.16)` : `hsla(${h + dh}, 95%, 62%, 0.55)`);
      cloud.addColorStop(1, `hsla(${h + dh}, 95%, 50%, 0)`);
      g.fillStyle = cloud;
      g.fillRect(0, 0, S, S);
    }
  }
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < (dark ? 90 : 160); i++) {
      const k = i / (dark ? 90 : 160);
      const a = arm * Math.PI + k * 4.2 + (Math.random() - 0.5) * 0.5;
      const r = 4 + k * S * 0.48 + (Math.random() - 0.5) * 6;
      g.fillStyle = dark
        ? `hsla(${h + 20 - k * 60}, 50%, ${60 - k * 25}%, ${0.45 - k * 0.3})`
        : `hsla(${h + 20 - k * 60}, 100%, ${85 - k * 25}%, ${0.9 - k * 0.5})`;
      g.beginPath(); g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 0.6 + Math.random() * 1.1, 0, 7); g.fill();
    }
  }
  for (let i = 0; i < (dark ? 35 : 70); i++) {
    g.fillStyle = `rgba(255,255,255,${dark ? 0.15 + Math.random() * 0.5 : 0.4 + Math.random() * 0.6})`;
    g.beginPath(); g.arc(Math.random() * S, Math.random() * S, Math.random() * 1.2, 0, 7); g.fill();
  }
  galaxies.set(f, c);
  return c;
}

function galaxyBead(x, y, r, f, alpha, lit, seed) {
  const t = performance.now() / 1000;
  const dark = isGalaxy() === "dark";
  // Cosmic's rim cycles through colors; Galaxy's barely drifts.
  const hue = (fingerHue(f) + t * (dark ? 6 : 40) + seed * 3) % 360;
  const halo = r * (dark ? 1.8 + lit * 0.5 : 2.6 + lit);
  const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, halo);
  glow.addColorStop(0, `hsla(${hue}, 100%, 65%, ${(dark ? 0.07 : 0.35) * alpha * lit})`);
  glow.addColorStop(1, `hsla(${hue}, 100%, 65%, 0)`);
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, halo, 0, 7); ctx.fill();

  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(t * 0.5 + seed);
  const R = r * 1.5;
  ctx.drawImage(galaxy(f), -R, -R, R * 2, R * 2);
  ctx.restore();

  // Shade the edge so it reads as a glass marble, then a bright rim and glint.
  const shade = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, `rgba(0,0,0,${0.55 * alpha})`);
  ctx.fillStyle = shade;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = dark ? `hsla(${hue}, 40%, 55%, ${0.4 * alpha})` : `hsla(${hue}, 100%, 72%, ${0.85 * alpha})`;
  ctx.lineWidth = dark ? 0.8 : 1.1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
  ctx.fillStyle = `rgba(255,255,255,${(dark ? 0.35 : 0.6) * alpha})`;
  ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.22, 0, 7); ctx.fill();
}

function drawDial(alpha) {
  if (alpha < 0.01) return;
  const c = dialCenter();
  const F = maxFingers(), S = maxSeconds();
  ctx.lineWidth = 1;
  for (let f = 1; f <= F; f++) {
    // Each ring sweeps around from the top, inner rings first.
    const sweep = clamp01(alpha * 1.6 - (f - 1) * 0.06) * Math.PI * 2;
    if (sweep <= 0) continue;
    ctx.strokeStyle = `rgba(255,255,255,${0.06 * alpha})`;
    ctx.beginPath(); ctx.arc(c.x, c.y, RING0 + (f - 1) * RING_STEP, -Math.PI / 2, -Math.PI / 2 + sweep); ctx.stroke();
  }
  for (let f = 1; f <= F; f++) {
    for (let s = 1; s <= S; s++) {
      const key = `${f}-${s}`;
      if (slots.has(key)) continue;
      const p = latticePoint(f, s);
      const on = key === hover;
      ctx.fillStyle = `rgba(0,0,0,${0.3 * alpha})`;
      ctx.beginPath(); ctx.arc(p.x, p.y + 0.5, on ? 4.6 : 2.5, 0, 7); ctx.fill();
      ctx.fillStyle = fingerColor(f, (on ? 0.95 : 0.45) * alpha, 82);
      ctx.beginPath(); ctx.arc(p.x, p.y, on ? 3.6 : 1.6, 0, 7); ctx.fill();
    }
  }
  // seconds around the outside, finger counts in the gap before 1s
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 4;
  const outer = RING0 + (F - 1) * RING_STEP + 18;
  ctx.font = `400 10.5px ${displayFont}`;
  for (let s = 1; s <= S; s++) {
    const a = -Math.PI / 2 + ((s - 1) / S) * Math.PI * 2;
    ctx.fillStyle = `rgba(233,234,236,${0.62 * alpha})`;
    ctx.fillText(`${s}s`, c.x + Math.cos(a) * outer, c.y + Math.sin(a) * outer);
  }
  const fa = -Math.PI / 2 - Math.PI / S;
  ctx.font = `400 9px ${displayFont}`;
  for (let f = 1; f <= F; f++) {
    const r = RING0 + (f - 1) * RING_STEP;
    ctx.fillStyle = fingerColor(f, 0.75 * alpha, 82);
    ctx.fillText(String(f), c.x + Math.cos(fa) * r, c.y + Math.sin(fa) * r);
  }
  ctx.shadowBlur = 0;
}

function drawRing(c, elapsed, f, R) {
  const max = maxSeconds();
  const seg = (Math.PI * 2) / max;
  const fired = touch.phase === "fired";
  ctx.lineCap = "round";
  ctx.lineWidth = 2.5;
  for (let i = 0; i < max; i++) {
    const a0 = -Math.PI / 2 + i * seg + 0.07;
    const a1 = a0 + seg - 0.14;
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.arc(c.x, c.y + 1, R, a0, a1); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath(); ctx.arc(c.x, c.y, R, a0, a1); ctx.stroke();
    const fill = fired ? 1 : clamp01(elapsed - i);
    if (fill > 0) {
      ctx.strokeStyle = fingerColor(f, fired ? burst : 0.95, 84);
      ctx.beginPath(); ctx.arc(c.x, c.y, R, a0, a0 + (a1 - a0) * fill); ctx.stroke();
    }
  }
}

// ---------- flight effects ----------

function drawTrail(d, size, alpha) {
  const n = d.trail.length;
  if (n < 2) return;
  ctx.lineCap = "round";
  for (let i = 1; i < n; i++) {
    const k = i / n;
    ctx.strokeStyle = fingerColor(d.f, 0.35 * k * alpha, 84);
    ctx.lineWidth = size * 1.2 * k;
    ctx.beginPath();
    ctx.moveTo(d.trail[i - 1].x, d.trail[i - 1].y);
    ctx.lineTo(d.trail[i].x, d.trail[i].y);
    ctx.stroke();
  }
}

// A ring of light that rolls out from the middle as the dial opens.
function drawShock(t) {
  const age = t - shock;
  if (shock < 0 || age > 1.1) return;
  const c = dialCenter();
  const k = age / 1.1;
  const r = 30 + k * (RING0 + (maxFingers() - 1) * RING_STEP + 30);
  ctx.lineWidth = 2.5 * (1 - k) + 0.5;
  ctx.strokeStyle = `rgba(255,255,255,${0.3 * (1 - k)})`;
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 7); ctx.stroke();
  ctx.strokeStyle = fingerColor(1 + Math.floor(t * 4) % maxFingers(), 0.35 * (1 - k), 80);
  ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.86, 0, 7); ctx.stroke();
}

// A soft flash where the dots land when the dial closes.
function drawPop(t, c) {
  const age = t - pop;
  if (pop < 0 || age > 0.6) return;
  const k = age / 0.6;
  const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 20 + k * 60);
  g.addColorStop(0, `rgba(255,255,255,${0.35 * (1 - k)})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(c.x, c.y, 20 + k * 60, 0, 7); ctx.fill();
}

// ---------- animation ----------

let last = performance.now();
let skip = false;

function frame(now) {
  requestAnimationFrame(frame);
  const moving = open ? openT < fullyOpen() : openT > 0;
  const holding = touch.phase === "holding" || touch.phase === "settling";
  const popping = now / 1000 - pop < 0.6;
  const active = moving || open || holding || popping || style === "critters" || burst > 0.01 || mouse || $("readout").classList.contains("show");
  // At rest the buddy runs at 30fps to stay light on the battery.
  skip = !skip;
  if (!active && skip) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  // Opening and closing take the same unhurried time.
  const step = reduced ? 99 : dt;
  const prevT = openT;
  openT = open ? Math.min(fullyOpen(), openT + step) : Math.max(0, openT - step);
  if (!open && prevT > 0 && openT === 0) {
    pop = now / 1000;
    if ((shift.x || shift.y) && !resizing) shrink();
  }
  if (now > readoutUntil) $("readout").classList.remove("show");

  const { w, h } = view();
  ctx.clearRect(0, 0, w, h);

  const c = clusterCenter();
  const counting = touch.phase === "holding";
  const elapsed = counting ? touch.elapsed + (now - touch.at) / 1000 : 0;
  // Reactiveness scales how much the dots wobble, hop, lean and react.
  const R = reduced ? 0 : react;
  const breathe = 1 + Math.sin(t * 1.2) * 0.06 * (0.4 + 0.6 * R);
  const squeeze = holding ? Math.max(0.3, 1 - 0.4 * R) : 1;
  burst *= Math.pow(0.05, dt);
  const follow = 1 - Math.exp(-dt * 5);

  drawDial(clamp01((openT - TRAVEL * 0.5) / 0.6));
  drawShock(t);

  // Living positions: each dot orbits, wobbles, breathes, hops now and then,
  // and leans a little toward the cursor.
  const live = (d, amp) => {
    d.angle += d.speed * dt * (holding ? 1 + 2 * R : 0.5 + 0.5 * R);
    if (t > d.hopAt) d.hopAt = t + (4 + Math.random() * 9) / (0.3 + 0.7 * R);
    const sinceHop = t - d.hopAt + 4 / (0.3 + 0.7 * R);
    const hop = reduced ? 0 : Math.max(0, Math.sin(Math.min(1, Math.max(0, sinceHop / 0.45)) * Math.PI)) * (sinceHop < 0.45 ? 1 : 0);
    const wob = reduced ? 0 : (Math.sin(t * 1.7 + d.seed) * 4 * amp + Math.sin(t * 0.6 + d.seed * 2) * 3 * amp) * (0.3 + 0.7 * R);
    const r = (d.orbit * breathe + wob) * squeeze * (1 + burst * 0.8 * R);
    let x = c.x + Math.cos(d.angle) * r;
    let y = c.y + Math.sin(d.angle) * r * 0.88 - hop * 6 * R;
    if (mouse && !open) { x += (mouse.x - x) * 0.07 * R; y += (mouse.y - y) * 0.07 * R; }
    d.lx += (x - d.lx) * follow;
    d.ly += (y - d.ly) * follow;
    return { x: d.lx, y: d.ly };
  };

  const dustAlpha = (1 - clamp01(openT / 0.5)) * 0.8;
  for (const d of dust) {
    const p = live(d, 1.2);
    if (dustAlpha < 0.02) continue;
    ctx.fillStyle = `rgba(0,0,0,${dustAlpha * 0.4})`;
    ctx.beginPath(); ctx.arc(p.x, p.y + 0.5, d.size + 0.8, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(222,225,230,${dustAlpha})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, d.size, 0, 7); ctx.fill();
  }

  const D = dialCenter();
  const critters = style === "critters";
  for (const d of dots) {
    const home = live(d, 1);
    const k = progress(d.f);
    const L = latticePoint(d.f, d.s);
    const j = reduced ? 0 : 1.2;
    const lx = L.x + Math.sin(t * 2.1 + d.seed) * j;
    const ly = L.y + Math.cos(t * 1.8 + d.seed) * j;
    if (k <= 0 || k >= 1) {
      d.x = k >= 1 ? lx : home.x;
      d.y = k >= 1 ? ly : home.y;
    } else {
      // Fly along a swirl around the dial's center instead of a straight line:
      // swing out wide, spin a little (odd rings one way, even the other),
      // and land with a small overshoot.
      const aH = Math.atan2(home.y - D.y, home.x - D.x), rH = Math.hypot(home.x - D.x, home.y - D.y);
      const aL = Math.atan2(ly - D.y, lx - D.x), rL = Math.hypot(lx - D.x, ly - D.y);
      let da = aL - aH;
      da = ((da + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const arc = Math.sin(k * Math.PI);
      const a = aH + da * k + (d.f % 2 ? 1 : -1) * 1.3 * arc;
      const r = rH + (rL - rH) * k + 26 * arc + 10 * Math.sin(k * Math.PI * 2) * k;
      d.x = D.x + Math.cos(a) * r;
      d.y = D.y + Math.sin(a) * r;
    }
    // A short comet tail while flying.
    if (k > 0 && k < 1) d.trail.push({ x: d.x, y: d.y });
    if (d.trail.length > 9 || ((k <= 0 || k >= 1) && d.trail.length)) d.trail.shift();
    const dim = holding && touch.fingers ? 1 - 0.55 * Math.min(1, R) : 1;
    const litTarget = holding && touch.fingers ? (d.f === touch.fingers ? 1 + 0.5 * R : dim) : d.key === hover ? 1.6 : 1;
    d.lit += (litTarget - d.lit) * follow;
    const size = (4.6 + Math.min(d.s, 8) * 0.3) * (1 - 0.22 * k) * (d.key === hover ? 1.25 : 1) * (critters ? 1.45 : 1);
    const alpha = Math.min(1, 0.55 + 0.45 * d.lit);
    drawTrail(d, size, alpha);
    if (critters) {
      // Squash and stretch, so each critter wiggles.
      const wig = Math.sin(t * (4 + R * 3) + d.seed * 5) * 0.09 * (0.3 + 0.7 * R);
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.scale(1 + wig, 1 - wig);
      ctx.translate(-d.x, -d.y);
      bead(d.x, d.y, size, d.f, alpha, d.lit, d.seed);
      ctx.restore();
      critterFace(d.x, d.y - size * wig * 0.5, size * (isGalaxy() ? 1.25 : 1), d, alpha, t);
    } else {
      bead(d.x, d.y, size, d.f, alpha, d.lit, d.seed);
    }
  }
  drawPop(t, c);

  if (counting || touch.phase === "fired") {
    if (openT > 0) {
      if (counting && elapsed >= 1) {
        const p = latticePoint(touch.fingers, Math.min(maxSeconds(), Math.floor(elapsed)));
        ctx.strokeStyle = fingerColor(touch.fingers, 0.9, 86);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, 9 + (elapsed % 1) * 4, 0, 7); ctx.stroke();
      }
    } else {
      drawRing(c, elapsed, touch.fingers || 1, 88);
    }
  }
}

applyState(await invoke("get_state"));
requestAnimationFrame(frame);
