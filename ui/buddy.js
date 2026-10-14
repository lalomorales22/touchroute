import { invoke, listen, win, currentMonitor, LogicalSize, LogicalPosition, fingerColor, parseKey, slotCode, plural } from "./shared.js";

// Each configured touch is one dot in the buddy. Zooming in flies every dot to
// its row in the list, so the creature literally is your touches.

const COMPACT = 168;
const OPEN_W = 340;
const MIN_DOTS = 22;

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const readout = document.getElementById("readout");
const codeEl = document.getElementById("code");
const labelEl = document.getElementById("label");
const rowsEl = document.getElementById("rows");
const subEl = document.getElementById("sub");

let state = null;
let slots = [];
let dots = [];
let open = false;
let busy = false;           // window resize in progress
let shift = { x: 0, y: 0 }; // how far the window moved to fit on screen when opened
let touch = { phase: "idle", fingers: 0, elapsed: 0, slot: null, at: 0 };
let burst = 0;
let readoutUntil = 0;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- data ----------

function applyState(s) {
  state = s;
  document.body.classList.toggle("paused", !s.config.enabled);
  slots = Object.entries(s.config.slots)
    .map(([key, v]) => { const [f, sec] = parseKey(key); return { key, f, s: sec, name: v.name }; })
    .sort((a, b) => a.f - b.f || a.s - b.s);
  buildDots();
  renderList();
}

function buildDots() {
  const old = new Map(dots.filter((d) => d.key).map((d) => [d.key, d]));
  const c = center();
  const next = slots.map((s, i) => {
    const prev = old.get(s.key);
    return prev ? Object.assign(prev, { f: s.f, s: s.s }) : makeDot(i, s, c);
  });
  const ambient = Math.max(6, MIN_DOTS - slots.length);
  for (let i = 0; i < ambient; i++) next.push(makeDot(slots.length + i, null, c));
  dots = next;
}

function makeDot(i, slot, c) {
  const seed = Math.random() * 1000;
  return {
    key: slot?.key ?? null,
    f: slot?.f ?? 0,
    s: slot?.s ?? 0,
    x: c.x + (Math.random() - 0.5) * 20,
    y: c.y + (Math.random() - 0.5) * 20,
    vx: 0, vy: 0,
    angle: i * 2.39996 + Math.random() * 0.3, // golden-angle spread
    orbit: 14 + Math.sqrt(i + 1) * 9.5,
    speed: (0.18 + Math.random() * 0.22) * (Math.random() < 0.5 ? -1 : 1),
    seed,
    size: slot ? 3.2 + Math.min(slot.s, 8) * 0.28 : 1.2 + Math.random() * 1.3,
    tint: 1 + Math.floor(Math.random() * 10),
    alpha: slot ? 1 : 0.5,
    lit: 1,
  };
}

function renderList() {
  subEl.textContent = slots.length ? `${plural(slots.length, "touch", "touches")} set up` : "Nothing set up yet";
  rowsEl.innerHTML = "";
  if (!slots.length) {
    rowsEl.innerHTML = `<div class="empty">Hold fingers on your trackpad,<br>let go, and something happens.<br><button id="first">Set up your first touch</button></div>`;
    rowsEl.querySelector("#first").onclick = () => invoke("open_settings", { slot: null });
    return;
  }
  let lastF = 0;
  let group;
  for (const s of slots) {
    if (s.f !== lastF) {
      lastF = s.f;
      group = document.createElement("div");
      group.className = "group";
      group.innerHTML = `<h2>${plural(s.f, "finger")}</h2>`;
      rowsEl.appendChild(group);
    }
    const row = document.createElement("div");
    row.className = "row";
    row.dataset.key = s.key;
    row.innerHTML = `<span class="pin"></span><span class="c"></span><span class="n"></span>`;
    row.querySelector(".c").textContent = slotCode(s.f, s.s);
    row.querySelector(".n").textContent = s.name;
    row.onclick = () => invoke("open_settings", { slot: s.key });
    group.appendChild(row);
  }
}

function openHeight() {
  const groups = new Set(slots.map((s) => s.f)).size;
  return Math.round(Math.min(560, Math.max(250, 104 + slots.length * 30 + groups * 33)));
}

// ---------- geometry ----------

function size() {
  return { w: canvas.clientWidth, h: canvas.clientHeight };
}

function center() {
  // While open, the creature's "home" stays where the compact window was.
  return open ? { x: shift.x + COMPACT / 2, y: shift.y + COMPACT / 2 } : { x: COMPACT / 2, y: COMPACT / 2 };
}

function resizeCanvas() {
  const dpr = devicePixelRatio || 1;
  const { w, h } = size();
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resizeCanvas).observe(canvas);

// ---------- zoom ----------

async function setOpen(next) {
  if (next === open || busy) return;
  busy = true;
  const scale = await win.scaleFactor();
  const pos = (await win.outerPosition()).toLogical(scale);
  if (next) {
    const H = openHeight();
    let x = pos.x, y = pos.y;
    const mon = await currentMonitor();
    if (mon) {
      const mpos = mon.position.toLogical(mon.scaleFactor);
      const msize = mon.size.toLogical(mon.scaleFactor);
      x = Math.min(x, mpos.x + msize.width - OPEN_W - 8);
      y = Math.min(y, mpos.y + msize.height - H - 8);
    }
    shift = { x: pos.x - x, y: pos.y - y };
    for (const d of dots) { d.x += shift.x; d.y += shift.y; }
    await win.setSize(new LogicalSize(OPEN_W, H));
    if (shift.x || shift.y) await win.setPosition(new LogicalPosition(x, y));
    open = true;
    document.body.classList.add("open");
  } else {
    document.body.classList.remove("open");
    open = false;
    // Let the dots fly home before the window shrinks around them.
    await new Promise((r) => setTimeout(r, reduced ? 0 : 280));
    for (const d of dots) { d.x -= shift.x; d.y -= shift.y; }
    await win.setSize(new LogicalSize(COMPACT, COMPACT));
    if (shift.x || shift.y) await win.setPosition(new LogicalPosition(pos.x + shift.x, pos.y + shift.y));
    shift = { x: 0, y: 0 };
  }
  busy = false;
}

document.addEventListener("dblclick", (e) => {
  if (e.target.closest?.(".row, button")) return;
  setOpen(!open);
});

document.addEventListener("wheel", (e) => {
  const pinch = e.ctrlKey;
  if (!open && e.deltaY < -2) setOpen(true);
  else if (open && (pinch ? e.deltaY > 2 : e.deltaY > 6 && rowsEl.scrollTop <= 0 && !e.target.closest?.("#rows"))) setOpen(false);
}, { passive: true });

document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
document.getElementById("gear").onclick = () => invoke("open_settings", { slot: null });

// Drag the buddy anywhere; a plain click or double-click still works.
let press = null;
document.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.target.closest?.(".row, button, #rows")) return;
  press = { x: e.screenX, y: e.screenY };
});
document.addEventListener("mousemove", (e) => {
  if (press && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 3) {
    press = null;
    win.startDragging();
  }
});
document.addEventListener("mouseup", () => (press = null));
document.addEventListener("mouseenter", () => document.body.classList.add("hot"));
document.addEventListener("mouseleave", () => document.body.classList.remove("hot"));

// ---------- touch feedback ----------

function slotName(key) {
  return state?.config.slots[key]?.name;
}

function showReadout(code, label, ms) {
  codeEl.textContent = code;
  labelEl.textContent = label;
  readout.classList.add("show");
  readoutUntil = ms ? performance.now() + ms : Infinity;
}

listen("touch", ({ payload: p }) => {
  touch = { ...p, at: performance.now() };
  const max = state?.maxSeconds ?? 8;
  if (p.phase === "holding") {
    const sec = Math.floor(p.elapsed);
    const key = `${p.fingers}-${sec}`;
    if (sec < 1) showReadout(String(p.fingers), plural(p.fingers, "finger"), 0);
    else showReadout(slotCode(p.fingers, sec), slotName(key) ?? (sec > max ? "let go to cancel" : "nothing here yet"), 0);
  } else if (p.phase === "fired") {
    burst = 1;
    const [f, s] = parseKey(p.slot);
    showReadout(slotCode(f, s), slotName(p.slot) ?? "", 1600);
  } else if (p.phase === "empty") {
    const [f, s] = parseKey(p.slot);
    showReadout(slotCode(f, s), "nothing here yet", 1200);
  } else if (p.phase === "cancelled") {
    showReadout("×", "cancelled", 700);
  } else {
    readoutUntil = Math.min(readoutUntil, performance.now() + 150);
  }
});

listen("config", ({ payload }) => applyState(payload));

// ---------- animation ----------

let last = performance.now();
let frameSkip = false;

function frame(now) {
  requestAnimationFrame(frame);
  const active = open || busy || touch.phase === "holding" || burst > 0.01 || readout.classList.contains("show");
  // A resting buddy runs at 30fps to stay light on the battery.
  frameSkip = !frameSkip;
  if (!active && frameSkip) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  if (now > readoutUntil) readout.classList.remove("show");

  const { w, h } = size();
  ctx.clearRect(0, 0, w, h);
  const c = center();
  const holding = touch.phase === "holding";
  const elapsed = holding ? touch.elapsed + (now - touch.at) / 1000 : 0;
  const breathe = 1 + Math.sin(t * 1.3) * 0.05;
  const squeeze = holding ? 0.62 : 1;
  burst *= Math.pow(0.04, dt);

  const pins = open ? pinPositions() : null;
  const ease = 1 - Math.exp(-dt * (open ? 9 : 6));

  for (const d of dots) {
    let tx, ty, ta;
    if (open && d.key && pins.has(d.key)) {
      ({ x: tx, y: ty } = pins.get(d.key));
      ta = 1;
    } else {
      d.angle += d.speed * dt * (holding ? 3.2 : 1);
      const wob = reduced ? 0 : Math.sin(t * 1.9 + d.seed) * 3.2 + Math.sin(t * 0.7 + d.seed * 2) * 2.4;
      const r = (d.orbit * breathe + wob) * squeeze * (1 + burst * 0.9);
      tx = c.x + Math.cos(d.angle) * r;
      ty = c.y + Math.sin(d.angle) * r * 0.86;
      ta = open ? 0 : d.key ? 1 : 0.5;
    }
    d.x += (tx - d.x) * ease;
    d.y += (ty - d.y) * ease;
    d.alpha += (ta - d.alpha) * ease;
    const litTarget = holding && touch.fingers ? (d.f === touch.fingers ? 1.6 : 0.35) : 1;
    d.lit += (litTarget - d.lit) * ease;
  }

  if (holding || touch.phase === "fired") drawRing(c, elapsed);

  for (const d of dots) {
    if (d.alpha < 0.02) continue;
    // Ambient dots carry a faint tint of the finger spectrum so the buddy never looks empty.
    const color = d.key ? fingerColor(d.f, Math.min(1, d.alpha * d.lit)) : `hsla(${(188 + (d.tint - 1) * 19) % 360}, 40%, 75%, ${d.alpha * 0.55 * Math.min(1, d.lit)})`;
    ctx.shadowColor = d.key ? fingerColor(d.f, 0.9) : "transparent";
    ctx.shadowBlur = d.key ? 10 * d.lit : 0;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.size * (d.lit > 1.2 ? 1.25 : 1), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawRing(c, elapsed) {
  const max = state?.maxSeconds ?? 8;
  const f = touch.fingers || 1;
  const R = 66;
  const gap = 0.09;
  const seg = (Math.PI * 2) / max;
  const fired = touch.phase === "fired";
  for (let i = 0; i < max; i++) {
    const a0 = -Math.PI / 2 + i * seg + gap / 2;
    const a1 = a0 + seg - gap;
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, a0, a1);
    ctx.stroke();
    const fill = fired ? 1 : Math.max(0, Math.min(1, elapsed - i));
    if (fill > 0) {
      ctx.strokeStyle = fingerColor(f, fired ? burst : 1);
      ctx.shadowColor = fingerColor(f, 0.8);
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(c.x, c.y, R, a0, a0 + (a1 - a0) * fill);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}

function pinPositions() {
  const map = new Map();
  for (const row of rowsEl.querySelectorAll(".row")) {
    const r = row.querySelector(".pin").getBoundingClientRect();
    if (r.bottom < 60 || r.top > size().h - 20) continue; // scrolled out of view
    map.set(row.dataset.key, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
  return map;
}

applyState(await invoke("get_state"));
requestAnimationFrame(frame);
