import { invoke, listen, win, currentMonitor, LogicalSize, fingerColor, THEMES, setTheme, slotKey, parseKey, slotCode, plural } from "./shared.js";

const SOON = [9, 10];
const $ = (id) => document.getElementById(id);
const grid = $("grid");
const form = $("form");

let state = null;
let selected = null; // "F-S"
let claudeReady = null;

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
  selected = key;
  const [f, s] = parseKey(key);
  const slot = state.config.slots[key];
  paintGrid();
  $("blank").hidden = true;
  form.hidden = false;
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
    await invoke("test_slot", { key: selected });
    setStatus("Ran it. If nothing happened, check the logs.");
  }
};

$("remove").onclick = async () => {
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
  const [fingers, seconds] = parseKey(selected);
  const btn = $("ask");
  btn.disabled = true;
  btn.classList.add("working");
  $("askText").textContent = "Claude is writing…";
  setStatus("");
  try {
    const draft = await invoke("ask_claude", { request, fingers, seconds, current: $("script").value || null });
    $("script").value = draft.script;
    if (!$("name").value.trim() || !state.config.slots[selected]) $("name").value = draft.name;
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
invoke("claude_available").then((ok) => (claudeReady = ok));
