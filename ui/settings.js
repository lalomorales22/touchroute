import { invoke, listen, win, currentMonitor, LogicalSize, fingerColor, THEMES, setTheme, slotKey, parseKey, slotCode, plural } from "./shared.js";

const SOON = [9, 10];
const $ = (id) => document.getElementById(id);
const grid = $("grid");
const form = $("form");

let state = null;
let selected = null; // "F-S"
let claudeReady = null;
// While a drawing is open in the editor: its id (null until saved) and the
// examples of the shape drawn so far.
let drawing = null;
const MAX_SAMPLES = 5;

const EXAMPLES = [
  "Open Terminal and start claude",
  "Open Spotify and play my liked songs",
  "Start the dev server in ~/code/site and open localhost:3000",
  "Open three Terminal windows, each running claude in a different project",
  "Lock my screen",
];

// ---------- grid ----------

function buildGrid() {
  const { maxFingers, platform } = state;
  grid.innerHTML = "";
  grid.appendChild(Object.assign(document.createElement("div"), { className: "colhead" }));
  for (let s = 1; s <= 10; s++) {
    const h = document.createElement("div");
    h.className = "colhead" + (SOON.includes(s) ? " soon" : "");
    h.dataset.col = s;
    h.innerHTML = SOON.includes(s) ? `${s}s<small>soon</small>` : `${s}s`;
    grid.appendChild(h);
  }
  for (let f = 1; f <= maxFingers; f++) {
    if (f === 6) {
      const d = document.createElement("div");
      d.className = "divider";
      d.textContent = "6 to 10 fingers work on Mac trackpads";
      grid.appendChild(d);
    }
    const rh = document.createElement("div");
    rh.className = "rowhead";
    rh.dataset.row = f;
    rh.style.setProperty("--c", fingerColor(f));
    rh.innerHTML = `<span class="fdots">${"<i></i>".repeat(f)}</span>${f}`;
    rh.title = plural(f, "finger");
    grid.appendChild(rh);
    for (let s = 1; s <= 10; s++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell" + (SOON.includes(s) ? " soon" : "") + (f > 5 ? " mac-only" : "");
      cell.style.setProperty("--c", fingerColor(f));
      cell.dataset.key = slotKey(f, s);
      if (SOON.includes(s)) {
        cell.title = `${s} seconds is coming soon`;
        cell.tabIndex = -1;
      } else {
        cell.setAttribute("aria-label", `${plural(f, "finger")}, ${plural(s, "second")}`);
        cell.onclick = () => select(cell.dataset.key);
      }
      grid.appendChild(cell);
    }
  }
  $("note").textContent = platform === "macos"
    ? "Windows and Linux trackpads report up to 5 fingers, so rows 6 to 10 only fire on a Mac. One-finger touches fire whenever a finger rests still, so keep those for things you won't mind triggering by accident."
    : "This trackpad reports up to 5 fingers. One-finger touches fire whenever a finger rests still, so keep those for things you won't mind triggering by accident.";
  paintGrid();
}

function paintGrid() {
  for (const cell of grid.querySelectorAll(".cell")) {
    const slot = state.config.slots[cell.dataset.key];
    cell.classList.toggle("set", !!slot);
    cell.classList.toggle("selected", cell.dataset.key === selected);
    cell.innerHTML = slot ? `<span class="nm"></span>` : "";
    if (slot) cell.querySelector(".nm").textContent = slot.name;
  }
}

// ---------- editor ----------

async function select(key) {
  closeDrawing();
  showTab("touches");
  selected = key;
  const [f, s] = parseKey(key);
  const slot = state.config.slots[key];
  paintGrid();
  $("blank").hidden = true;
  form.hidden = false;
  $("padWrap").hidden = true;
  form.classList.remove("is-drawing");
  $("slotCode").hidden = false;
  form.style.setProperty("--c", fingerColor(f));
  $("slotCode").textContent = slotCode(f, s);
  $("slotDesc").textContent = `${plural(f, "finger")}, held ${plural(s, "second")}`;
  $("slotState").textContent = slot ? "Saved" : "Not set up yet";
  $("name").value = slot?.name ?? "";
  $("request").value = slot?.prompt ?? "";
  $("request").placeholder = EXAMPLES[(f + s) % EXAMPLES.length];
  $("script").value = slot ? await invoke("get_script", { key }) : "";
  $("scriptBox").open = !!slot;
  $("scriptPath").textContent = `~/.touchroute/scripts/${key}.sh`;
  $("remove").hidden = !slot;
  $("quick").hidden = true;
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
  setStatus("");
  $("name").focus();
}

function setStatus(text, err = false) {
  const el = $("askStatus");
  el.textContent = text;
  el.classList.toggle("err", err);
}

async function save() {
  if (drawing) return saveDrawing();
  if (!selected) return false;
  const script = $("script").value;
  if (!script.trim()) {
    setStatus("Write the script first, with Claude or a quick start.", true);
    return false;
  }
  const [f, s] = parseKey(selected);
  const name = $("name").value.trim() || slotCode(f, s);
  await invoke("save_slot", { key: selected, name, prompt: $("request").value.trim(), script });
  $("name").value = name;
  $("slotState").textContent = "Saved";
  $("remove").hidden = false;
  setStatus(`Saved. Hold ${plural(f, "finger")} for ${plural(s, "second")} and let go.`);
  return true;
}

form.addEventListener("submit", (e) => { e.preventDefault(); save(); });

$("test").onclick = async () => {
  if (await save()) {
    if (drawing) await invoke("test_drawing", { id: drawing.id });
    else await invoke("test_slot", { key: selected });
    setStatus("Ran it. If nothing happened, check the logs.");
  }
};

$("remove").onclick = async () => {
  if (drawing) return removeDrawing();
  if (!selected) return;
  await invoke("delete_slot", { key: selected });
  select(selected);
};

$("openScripts").onclick = () => invoke("open_folder", { which: "scripts" });
$("openLogs").onclick = () => invoke("open_folder", { which: "logs" });

// ---------- Claude ----------

$("ask").onclick = async () => {
  const request = $("request").value.trim();
  if (!request) {
    setStatus("Describe what this touch should do first.", true);
    $("request").focus();
    return;
  }
  if (claudeReady === null) claudeReady = await invoke("claude_available");
  if (!claudeReady) {
    setStatus("Claude Code isn't installed. Get it at claude.com/claude-code, or use a quick start below.", true);
    return;
  }
  const [fingers, seconds] = drawing ? [null, null] : parseKey(selected);
  const shape = drawing ? $("name").value.trim() || "a shape they drew" : null;
  const btn = $("ask");
  btn.disabled = true;
  btn.classList.add("working");
  $("askText").textContent = "Claude is writing…";
  setStatus("");
  try {
    const draft = await invoke("ask_claude", { request, fingers, seconds, drawing: shape, current: $("script").value || null });
    $("script").value = draft.script;
    const saved = drawing ? drawing.id : state.config.slots[selected];
    if (!$("name").value.trim() || !saved) $("name").value = draft.name;
    $("scriptBox").open = true;
    setStatus("Read it over, then save.");
  } catch (e) {
    setStatus(String(e), true);
  } finally {
    btn.disabled = false;
    btn.classList.remove("working");
    $("askText").textContent = "Write it with Claude";
  }
};

// ---------- quick starts (no AI needed) ----------

const shq = (s) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

// Runs its argument in Terminal, reusing the window Terminal opens when it
// launches so you don't get two.
const TERMINAL = `on run argv
  set cmd to item 1 of argv
  set wasRunning to application "Terminal" is running
  tell application "Terminal"
    activate
    if wasRunning then
      do script cmd
    else
      repeat 50 times
        if (count of windows) > 0 then exit repeat
        delay 0.1
      end repeat
      if (count of windows) > 0 then
        do script cmd in window 1
      else
        do script cmd
      end if
    end if
  end tell
end run
`;

const QUICK = {
  app: {
    placeholder: "App name, like Spotify",
    build: (v) => ({ name: `Open ${v}`, script: `#!/bin/zsh\n# Open ${v}.\nopen -a ${shq(v)}\n` }),
  },
  url: {
    placeholder: "Web address, like youtube.com",
    build: (v) => {
      const url = /^[a-z]+:\/\//i.test(v) ? v : `https://${v}`;
      let host = v;
      try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
      return { name: host, script: `#!/bin/zsh\n# Open ${host} in your browser.\nopen ${shq(url)}\n` };
    },
  },
  term: {
    placeholder: "Command, like claude or npm run dev",
    build: (v) => ({
      name: v.split(/\s+/).slice(0, 3).join(" "),
      script: `#!/bin/zsh\n# Open a Terminal window and run: ${v}\nosascript - ${shq(v)} <<'APPLESCRIPT'\n${TERMINAL}APPLESCRIPT\n`,
    }),
  },
  sh: {
    placeholder: "Path to your script, like ~/bin/deploy.sh",
    build: (v) => {
      const path = v.replace(/^~(?=\/)/, "$HOME");
      const file = v.split("/").pop();
      const quoted = path.startsWith("$HOME") ? `"$HOME${path.slice(5).replace(/(["\\$`])/g, "\\$1")}"` : shq(path);
      return { name: file, script: `#!/bin/zsh\n# Run ${v}\nzsh ${quoted}\n` };
    },
  },
};

let quickType = null;
document.querySelectorAll(".chip").forEach((chip) => {
  chip.onclick = () => {
    quickType = chip.dataset.t;
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === chip));
    $("quick").hidden = false;
    $("quickInput").value = "";
    $("quickInput").placeholder = QUICK[quickType].placeholder;
    $("quickInput").focus();
  };
});

function useQuick() {
  const v = $("quickInput").value.trim();
  if (!v || !quickType) return;
  const { name, script } = QUICK[quickType].build(v);
  $("script").value = script;
  $("name").value = name;
  $("scriptBox").open = true;
  setStatus("Ready. Save it to make it live.");
}
$("quickUse").onclick = useQuick;
$("quickInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); useQuick(); }
});

// ---------- live trackpad ----------

function clearLive() {
  grid.querySelectorAll(".holding").forEach((el) => el.classList.remove("holding"));
  grid.querySelectorAll(".live-row").forEach((el) => el.classList.remove("live-row"));
}

listen("touch", ({ payload: p }) => {
  const live = $("live");
  clearLive();
  if (p.phase === "settling") {
    grid.querySelector(`.rowhead[data-row="${p.fingers}"]`)?.classList.add("live-row");
    live.classList.add("on");
    live.innerHTML = `<b>${p.fingers}</b>${plural(p.fingers, "finger")} down, hold still`;
  } else if (p.phase === "holding") {
    const sec = Math.floor(p.elapsed);
    grid.querySelector(`.rowhead[data-row="${p.fingers}"]`)?.classList.add("live-row");
    if (sec >= 1) grid.querySelector(`.cell[data-key="${p.fingers}-${sec}"]`)?.classList.add("holding");
    live.classList.add("on");
    live.innerHTML = sec >= 1
      ? `<b>${slotCode(p.fingers, sec)}</b>${state.config.slots[`${p.fingers}-${sec}`]?.name ?? "nothing here yet"}`
      : `<b>${p.fingers}</b>${plural(p.fingers, "finger")} down`;
  } else if (p.phase === "fired" || p.phase === "empty") {
    const cell = grid.querySelector(`.cell[data-key="${p.slot}"]`);
    if (cell) { cell.classList.remove("flash"); void cell.offsetWidth; cell.classList.add("flash"); }
    const [f, s] = parseKey(p.slot);
    live.innerHTML = p.phase === "fired"
      ? `<b>${slotCode(f, s)}</b>ran ${state.config.slots[p.slot]?.name ?? ""}`
      : `<b>${slotCode(f, s)}</b>nothing here yet. Click it to set it up.`;
  } else if (p.phase === "cancelled") {
    live.innerHTML = "Cancelled: fingers moved or held too long";
  } else {
    live.classList.remove("on");
  }
});

// ---------- fun pack and clear all ----------

function boardStatus(text) {
  $("boardStatus").textContent = text;
}

$("funPack").onclick = async () => {
  const added = await invoke("add_fun_pack");
  boardStatus(added ? `Added ${plural(added, "touch", "touches")}.` : "Every fun pack square is already in use.");
};

// Clear all asks for a second click instead of a dialog, and forgets after a few seconds.
let clearTimer = null;
$("clearAll").onclick = async () => {
  const btn = $("clearAll");
  const count = Object.keys(state.config.slots).length;
  if (!count) return boardStatus("There's nothing to clear.");
  if (!btn.classList.contains("armed")) {
    btn.classList.add("armed");
    btn.textContent = `Remove all ${count}?`;
    clearTimer = setTimeout(disarm, 4000);
    return;
  }
  disarm();
  await invoke("clear_all");
  if (selected) select(selected);
  boardStatus(`Removed ${plural(count, "touch", "touches")}. Add fun pack brings the fun ones back.`);
};
function disarm() {
  clearTimeout(clearTimer);
  $("clearAll").classList.remove("armed");
  $("clearAll").textContent = "Clear all";
}

// ---------- window size ----------

// Opens big enough to show the whole grid without scrolling, as long as the
// screen has room.
async function fitWindow() {
  const board = document.querySelector(".board");
  const pad = parseFloat(getComputedStyle(board).paddingLeft) * 2;
  const editor = document.querySelector(".editor").offsetWidth;
  const titlebar = document.querySelector(".titlebar").offsetHeight;
  let w = Math.ceil(grid.scrollWidth + pad + editor + 2);
  let h = Math.ceil(titlebar + board.scrollHeight + 2);
  const mon = await currentMonitor();
  if (mon) {
    const size = mon.size.toLogical(mon.scaleFactor);
    w = Math.min(w, size.width - 40);
    h = Math.min(h, size.height - 80);
  }
  await win.setSize(new LogicalSize(w, h));
  await win.center();
}

// ---------- updates ----------

let update = null;

function showUpdate(u) {
  update = u;
  const btn = $("update");
  btn.hidden = !u;
  if (!u) return;
  btn.disabled = false;
  btn.classList.remove("working", "err");
  $("updateText").textContent = `Update to ${u.latest}`;
  btn.title = `You have ${u.current}. Version ${u.latest} is out.` + (u.notes ? `\n\n${u.notes}` : "");
}

$("update").onclick = async () => {
  const btn = $("update");
  btn.disabled = true;
  btn.classList.remove("err");
  btn.classList.add("working");
  $("updateText").textContent = "Updating…";
  try {
    // TouchRoute quits, swaps in the new version and opens again.
    await invoke("install_update");
  } catch (e) {
    btn.disabled = false;
    btn.classList.remove("working");
    btn.classList.add("err");
    $("updateText").textContent = "Update failed, try again";
    btn.title = String(e);
  }
};

listen("update", ({ payload }) => showUpdate(payload));

// ---------- orb themes ----------

// A swatch is a little wheel of the theme's colors; cosmic gets a galaxy.
function swatchFill(name) {
  const t = THEMES[name];
  const col = ([h, s]) => `hsl(${h}, ${s}%, ${t.light ? t.light(72) : 72}%)`;
  if (t.galaxy === "dark") {
    return `radial-gradient(circle at 30% 40%, rgba(255,255,255,0.7) 0 0.8px, transparent 1.2px),
      radial-gradient(circle at 68% 62%, rgba(255,255,255,0.5) 0 0.7px, transparent 1px),
      radial-gradient(circle at 55% 45%, ${col(t.tones[1])} 0, transparent 40%),
      radial-gradient(circle, #0d0d1a, #000)`;
  }
  if (t.galaxy) {
    return `radial-gradient(circle at 35% 35%, #fff 0 1px, transparent 1.5px),
      radial-gradient(circle at 65% 60%, ${col(t.tones[3])} 0, transparent 45%),
      radial-gradient(circle at 35% 65%, ${col(t.tones[4])} 0, transparent 45%),
      radial-gradient(circle, ${col(t.tones[0])}, #0b0420)`;
  }
  return `conic-gradient(${t.tones.slice(0, 6).map(col).join(", ")}, ${col(t.tones[0])})`;
}

for (const name of Object.keys(THEMES)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "swatch";
  b.dataset.theme = name;
  b.title = `${THEMES[name].label} orbs`;
  b.setAttribute("role", "radio");
  b.style.setProperty("--sw", swatchFill(name));
  b.onclick = () => invoke("set_look", { theme: name });
  $("themes").appendChild(b);
}

$("shuffle").onclick = () => {
  const btn = $("shuffle");
  btn.classList.remove("roll"); void btn.offsetWidth; btn.classList.add("roll");
  const others = Object.keys(THEMES).filter((n) => n !== theme);
  invoke("set_look", { theme: others[Math.floor(Math.random() * others.length)] });
};

document.querySelectorAll("#styles button").forEach((b) => {
  b.onclick = () => invoke("set_look", { style: b.dataset.style });
});

// Send the slider's value while dragging, but at most every 80ms.
let reactTimer = null;
$("react").addEventListener("input", (e) => {
  clearTimeout(reactTimer);
  reactTimer = setTimeout(() => invoke("set_look", { reactivity: Number(e.target.value) }), 80);
});

// ---------- tabs ----------

let tab = "touches";
function showTab(name) {
  if (name === tab) return;
  tab = name;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".page").forEach((p) => (p.hidden = p.id !== `page-${name}`));
  // The editor follows the tab: touches on Touches, drawings on Drawings.
  if (name !== "drawings" && drawing) closeEditor();
  if (name !== "touches" && selected) closeEditor();
  document.querySelector(".blank .hint").hidden = name !== "touches";
  $("blankText").textContent = {
    touches: "Choose a square on the left to set up a touch.",
    drawings: "Choose a drawing on the left, or make a new one.",
    effects: "Every effect here works in any touch or drawing.",
    packs: "Packs fill empty squares and never touch yours unless you say so.",
  }[name];
}
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

function closeEditor() {
  closeDrawing();
  selected = null;
  form.hidden = true;
  $("blank").hidden = false;
  paintGrid();
  paintDrawings();
}

// ---------- drawings ----------

// Fits a stroke into a box, keeping its shape, for thumbnails and the pad.
function fit(pts, w, h, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const k = Math.min((w - pad * 2) / Math.max(1e-6, x1 - x0), (h - pad * 2) / Math.max(1e-6, y1 - y0));
  const ox = (w - (x1 - x0) * k) / 2, oy = (h - (y1 - y0) * k) / 2;
  return pts.map(([x, y]) => [ox + (x - x0) * k, oy + (y - y0) * k]);
}

function thumb(pts) {
  const d = fit(pts, 100, 100, 14).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${d}" pathLength="1"/></svg>`;
}

function paintDrawings() {
  const list = state.config.drawings ?? [];
  const g = $("drawGrid");
  g.innerHTML = "";
  list.forEach((d, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "draw-card" + (drawing?.id === d.id ? " selected" : "");
    b.dataset.id = d.id;
    b.style.setProperty("--h", String((i * 47 + 200) % 360));
    b.innerHTML = thumb(d.samples[0] ?? [[0, 0], [1, 1]]) + `<span class="nm"></span>`;
    b.querySelector(".nm").textContent = d.name;
    b.onclick = () => openDrawing(d.id);
    g.appendChild(b);
  });
  if (!list.length) g.innerHTML = `<p class="hint">No drawings yet. Make one, or add the drawing pack.</p>`;
  document.querySelector('.tabs [data-tab="drawings"]').textContent = list.length ? `Drawings · ${list.length}` : "Drawings";
}

async function openDrawing(id) {
  selected = null;
  paintGrid();
  showTab("drawings");
  const d = id ? state.config.drawings.find((x) => x.id === id) : null;
  drawing = { id: d?.id ?? null, samples: d ? d.samples.map((s) => s.slice()) : [] };
  invoke("set_recording", { on: true });
  $("blank").hidden = true;
  form.hidden = false;
  $("padWrap").hidden = false;
  form.classList.add("is-drawing");
  $("slotCode").hidden = true;
  form.style.setProperty("--c", `hsl(${(state.config.drawings.indexOf(d) * 47 + 200 + 360) % 360} 70% 72%)`);
  $("slotDesc").textContent = d ? d.name : "New drawing";
  $("slotState").textContent = d ? "Saved. Draw it with ⌥ Option to run it." : "Draw your shape above";
  $("name").value = d?.name ?? "";
  $("request").value = d?.prompt ?? "";
  $("request").placeholder = "Play the fireworks effect and open Spotify";
  $("script").value = d ? await invoke("get_drawing_script", { id: d.id }) : "";
  $("scriptBox").open = !!d;
  $("scriptPath").textContent = d ? `~/.touchroute/drawings/${d.id}.sh` : "";
  $("remove").hidden = !d;
  $("quick").hidden = true;
  setStatus("");
  paintDrawings();
  drawPad();
  if (!d) $("name").focus();
}

function closeDrawing() {
  if (!drawing) return;
  drawing = null;
  invoke("set_recording", { on: false });
}

async function saveDrawing() {
  if (!drawing.samples.length) { setStatus("Draw the shape first.", true); return false; }
  const script = $("script").value;
  if (!script.trim()) { setStatus("Write the script first, with Claude or a quick start.", true); return false; }
  const name = $("name").value.trim() || "My drawing";
  try {
    drawing.id = await invoke("save_drawing", { id: drawing.id, name, prompt: $("request").value.trim(), script, samples: drawing.samples });
  } catch (e) { setStatus(String(e), true); return false; }
  $("name").value = name;
  $("slotDesc").textContent = name;
  $("slotState").textContent = "Saved. Draw it with ⌥ Option to run it.";
  $("scriptPath").textContent = `~/.touchroute/drawings/${drawing.id}.sh`;
  $("remove").hidden = false;
  setStatus("Saved. Hold ⌥ Option and draw it on your trackpad.");
  return true;
}

async function removeDrawing() {
  if (drawing.id) await invoke("delete_drawing", { id: drawing.id });
  closeEditor();
}

$("newDrawing").onclick = () => openDrawing(null);
$("drawPack").onclick = async () => {
  const n = await invoke("add_drawing_pack");
  $("drawStatus").textContent = n ? `Added ${plural(n, "drawing")}.` : "You already have every drawing in the pack.";
};

// The pad: every example you've drawn, older ones faint, the newest glowing.
const pad = $("pad");
const pctx = pad.getContext("2d");
let live = null; // a stroke being drawn with the mouse

function drawPad(flash = 0) {
  const W = pad.width, H = pad.height;
  pctx.clearRect(0, 0, W, H);
  pctx.lineCap = "round";
  pctx.lineJoin = "round";
  const all = drawing?.samples ?? [];
  all.forEach((s, i) => {
    const newest = i === all.length - 1;
    const pts = fit(s, W, H, 40);
    if (newest) {
      for (const [w, a] of [[22, 0.08], [10, 0.25], [4, 1]]) {
        const g = pctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, `hsla(190, 100%, 70%, ${a})`);
        g.addColorStop(0.5, `hsla(290, 100%, 72%, ${a})`);
        g.addColorStop(1, `hsla(340, 100%, 70%, ${a})`);
        pctx.strokeStyle = g;
        pctx.lineWidth = w + flash * 8;
        stroke(pts);
      }
    } else {
      pctx.strokeStyle = "rgba(255,255,255,0.14)";
      pctx.lineWidth = 3;
      stroke(pts);
    }
  });
  if (live && live.length > 1) {
    pctx.strokeStyle = "rgba(255,255,255,0.9)";
    pctx.lineWidth = 4;
    stroke(live);
  }
  $("padHint").hidden = all.length > 0 || !!live;
  $("samples").innerHTML = Array.from({ length: MAX_SAMPLES }, (_, i) => `<i class="${i < all.length ? "on" : ""}"></i>`).join("") +
    `<span>${all.length ? `${plural(all.length, "example")}` : ""}</span>`;
}
function stroke(pts) {
  pctx.beginPath();
  pts.forEach(([x, y], i) => (i ? pctx.lineTo(x, y) : pctx.moveTo(x, y)));
  pctx.stroke();
}

async function addSample(points) {
  if (!drawing) return;
  drawing.samples.push(points);
  if (drawing.samples.length > MAX_SAMPLES) drawing.samples.shift();
  let k = 1;
  const pulse = () => { drawPad(k); k -= 0.08; if (k > 0) requestAnimationFrame(pulse); else drawPad(); };
  pulse();
  // Warn when the new shape is easy to mix up with another saved drawing.
  const hit = await invoke("match_stroke", { points });
  const other = hit && hit !== drawing.id ? state.config.drawings.find((d) => d.id === hit) : null;
  setStatus(other ? `That looks a lot like “${other.name}”. Try a more different shape.` : drawing.samples.length < 2 ? "Got it. Draw it once or twice more to help it learn." : "Got it.", !!other);
}

pad.addEventListener("pointerdown", (e) => {
  pad.setPointerCapture(e.pointerId);
  const r = pad.getBoundingClientRect();
  live = [[((e.clientX - r.left) / r.width) * pad.width, ((e.clientY - r.top) / r.height) * pad.height]];
});
pad.addEventListener("pointermove", (e) => {
  if (!live) return;
  const r = pad.getBoundingClientRect();
  live.push([((e.clientX - r.left) / r.width) * pad.width, ((e.clientY - r.top) / r.height) * pad.height]);
  drawPad();
});
pad.addEventListener("pointerup", () => {
  const pts = live;
  live = null;
  const len = pts ? pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0) : 0;
  if (len > 60) addSample(pts.map(([x, y]) => [x / pad.height, y / pad.height]));
  else drawPad();
});
$("padClear").onclick = () => { if (drawing) { drawing.samples = []; drawPad(); setStatus(""); } };

listen("draw-sample", ({ payload }) => addSample(payload));
listen("drew", ({ payload: id }) => {
  const card = $("drawGrid").querySelector(`[data-id="${id}"]`);
  if (card) { card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
});

// ---------- effects ----------

const FX_INFO = {
  lightning: ["⚡", "Lightning"], fire: ["🔥", "Fire"], hearts: ["💗", "Hearts"], warp: ["🌌", "Warp speed"],
  matrix: ["🟩", "The Matrix"], confetti: ["🎊", "Confetti"], fireworks: ["🎆", "Fireworks"], supernova: ["💥", "Supernova"],
  portal: ["🌀", "Portal"], aurora: ["🌠", "Aurora"], neon: ["🔆", "Neon sign"], bubbles: ["🫧", "Bubbles"],
  galaxy: ["🪐", "Galaxy"], disco: ["🪩", "Disco"], snow: ["❄️", "Snow"],
  pop: ["🏆", "Pop"], spin: ["🦄", "Spin"], rain: ["🍕", "Rain"], burst: ["🎉", "Burst"], float: ["🎈", "Float"], launch: ["🚀", "Launch"], banner: ["😂", "Banner"],
};
const FX_ARGS = {
  neon: ["HELLO"], matrix: ["wake up"], aurora: ["breathe"], confetti: ["NICE!"],
  pop: ["🏆", "you win"], spin: ["🦄", "magical"], rain: ["🍕 🧀"], burst: ["🎉 🎊 ✨"], float: ["🎈 💖"], launch: ["🚀"], banner: ["😂", "TouchRoute is the best"],
};
const shq2 = (v) => `"${v.replace(/(["\\$`])/g, "\\$1")}"`;

function buildEffects() {
  const g = $("fxGrid");
  if (g.children.length || !state.effects) return;
  for (const mode of state.effects) {
    const [icon, label] = FX_INFO[mode] ?? ["✨", mode];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fx-tile";
    b.innerHTML = `<span class="ic">${icon}</span><span></span>`;
    b.lastChild.textContent = label;
    b.onclick = async () => {
      const args = FX_ARGS[mode] ?? [];
      b.classList.remove("go"); void b.offsetWidth; b.classList.add("go");
      try { await invoke("play_fx", { mode, args }); } catch (e) { $("fxCmd").textContent = String(e); return; }
      $("fxCmd").innerHTML = `<code></code>`;
      $("fxCmd").firstChild.textContent = ["~/.touchroute/bin/touchroute fx", mode, ...args.map(shq2)].join(" ");
    };
    g.appendChild(b);
  }
}

// ---------- packs ----------

let pending = null; // the pack being previewed

function showPack(pack) {
  pending = pack;
  $("ppName").textContent = pack.name || "A TouchRoute pack";
  $("ppBy").textContent = pack.author ? `by ${pack.author}` : "";
  $("ppDesc").textContent = pack.description || "";
  $("ppDesc").hidden = !pack.description;
  const mine = state.config.slots;
  const keys = new Map(pack.touches.map((t) => [t.key, t]));
  const grid = $("ppGrid");
  grid.innerHTML = "";
  grid.hidden = !pack.touches.length;
  const rows = Math.max(...pack.touches.map((t) => parseKey(t.key)[0]), 1);
  for (let f = 1; f <= rows; f++) {
    for (let s = 1; s <= state.maxSeconds; s++) {
      const k = slotKey(f, s), t = keys.get(k);
      const cell = document.createElement("span");
      cell.className = "pp-cell" + (t ? " on" : "") + (t && mine[k] ? " clash" : "");
      cell.style.setProperty("--c", fingerColor(f));
      if (t) cell.title = `${slotCode(f, s)}  ${t.name}` + (mine[k] ? `  (you have “${mine[k].name}” here)` : "");
      grid.appendChild(cell);
    }
  }
  $("ppDraws").innerHTML = "";
  for (const d of pack.drawings) {
    const el = document.createElement("span");
    el.className = "pp-draw";
    el.innerHTML = thumb(d.samples[0] ?? [[0, 0], [1, 1]]) + "<b></b>";
    el.querySelector("b").textContent = d.name;
    $("ppDraws").appendChild(el);
  }
  const clashes = pack.touches.filter((t) => mine[t.key]).length +
    pack.drawings.filter((d) => (state.config.drawings ?? []).some((x) => x.id === d.id || x.name.toLowerCase() === d.name.toLowerCase())).length;
  const parts = [];
  if (pack.touches.length) parts.push(plural(pack.touches.length, "touch", "touches"));
  if (pack.drawings.length) parts.push(plural(pack.drawings.length, "drawing"));
  $("ppConflict").textContent = `${parts.join(" and ")}.` + (clashes ? ` ${clashes} would land where you already have something; those stay yours unless you replace them.` : "");
  $("ppReplace").hidden = !clashes;
  $("ppScripts").textContent = [
    ...pack.touches.map((t) => `# ${slotCode(...parseKey(t.key))}  ${t.name}\n${t.script}`),
    ...pack.drawings.map((d) => `# drawing: ${d.name}\n${d.script}`),
  ].join("\n");
  $("ppStatus").textContent = "";
  $("ppAdd").disabled = $("ppReplace").disabled = false;
  $("packDialog").showModal();
}

async function installPending(replace) {
  $("ppAdd").disabled = $("ppReplace").disabled = true;
  try {
    const r = await invoke("pack_install", { pack: pending, replace });
    const bits = [];
    if (r.added) bits.push(`added ${r.added}`);
    if (r.replaced) bits.push(`replaced ${r.replaced}`);
    if (r.skipped) bits.push(`kept ${r.skipped} of yours`);
    $("importStatus").textContent = `${pending.name}: ${bits.join(", ") || "nothing new"}.`;
    $("packDialog").close();
    invoke("play_fx", { mode: "confetti", args: [] }).catch(() => {});
  } catch (e) {
    $("ppStatus").textContent = String(e);
    $("ppAdd").disabled = $("ppReplace").disabled = false;
  }
}
$("ppAdd").onclick = () => installPending(false);
$("ppReplace").onclick = () => installPending(true);

$("exportPack").onclick = async () => {
  try {
    const path = await invoke("pack_export", { name: $("packName").value.trim() || "My touches", author: $("packAuthor").value.trim() });
    $("exportStatus").textContent = `Saved ${path.split("/").pop()} to your Desktop.`;
  } catch (e) { $("exportStatus").textContent = String(e); }
};
$("openPack").onclick = async () => {
  $("importStatus").textContent = "";
  try { const p = await invoke("pack_from_file"); if (p) showPack(p); } catch (e) { $("importStatus").textContent = String(e); }
};
async function getFromUrl() {
  const url = $("packUrl").value.trim();
  if (!url) return;
  $("importStatus").textContent = "Downloading…";
  try { showPack(await invoke("pack_from_url", { url })); $("importStatus").textContent = ""; }
  catch (e) { $("importStatus").textContent = String(e); }
}
$("getPack").onclick = getFromUrl;
$("packUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); getFromUrl(); } });
document.querySelectorAll("[data-builtin]").forEach((b) => (b.onclick = async () => showPack(await invoke("pack_builtin", { name: b.dataset.builtin }))));

// A .touchroute file opened from Finder arrives as { Ok: pack } or { Err: message }.
function openedPack(r) {
  if (!r) return;
  showTab("packs");
  if (r.Ok) showPack(r.Ok);
  else $("importStatus").textContent = r.Err;
}
listen("pack-open", ({ payload }) => { invoke("take_opened_pack"); openedPack(payload); });

$("haptics").onchange = (e) => invoke("set_haptics", { on: e.target.checked });
$("chatty").onchange = (e) => invoke("set_look", { chatty: e.target.checked });

// ---------- state ----------

let theme = null;
function applyState(s) {
  state = s;
  document.querySelectorAll("#styles button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.style === (s.config.style ?? "orbs"))));
  if (document.activeElement !== $("react")) $("react").value = s.config.reactivity ?? 1;
  if (s.config.theme !== theme) {
    theme = s.config.theme;
    setTheme(theme);
    document.querySelectorAll(".swatch").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.theme === theme)));
    if (grid.children.length) {
      buildGrid();
      if (selected) form.style.setProperty("--c", fingerColor(parseKey(selected)[0]));
    }
  }
  $("enabled").checked = s.config.enabled;
  $("haptics").checked = s.config.haptics ?? true;
  $("chatty").checked = s.config.chatty ?? true;
  if (drawing?.id && !s.config.drawings.some((d) => d.id === drawing.id)) closeEditor();
  paintDrawings();
  buildEffects();
  $("enabledText").textContent = s.config.enabled ? "On" : "Paused";
  if (!grid.children.length) buildGrid(); else paintGrid();
}

$("enabled").onchange = (e) => invoke("set_enabled", { enabled: e.target.checked });
listen("config", ({ payload }) => applyState(payload));
listen("select-slot", ({ payload }) => select(payload));

applyState(await invoke("get_state"));
try { await fitWindow(); } catch (e) { console.error(e); }
win.show();
win.setFocus();
showUpdate(state.update);
invoke("check_update").then(showUpdate).catch(() => {});
const initial = new URLSearchParams(location.search).get("slot");
if (initial) select(initial);
openedPack(await invoke("take_opened_pack"));
invoke("claude_available").then((ok) => (claudeReady = ok));
