import { invoke, listen, fingerColor, slotKey, parseKey, slotCode, plural } from "./shared.js";

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
const asq = (s) => s.replace(/(["\\])/g, "\\$1");

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
      script: `#!/bin/zsh\n# Open a new Terminal window and run: ${v}\nosascript <<'APPLESCRIPT'\ntell application "Terminal"\n  activate\n  do script "${asq(v)}"\nend tell\nAPPLESCRIPT\n`,
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

// ---------- state ----------

function applyState(s) {
  state = s;
  $("enabled").checked = s.config.enabled;
  $("enabledText").textContent = s.config.enabled ? "On" : "Paused";
  if (!grid.children.length) buildGrid(); else paintGrid();
}

$("enabled").onchange = (e) => invoke("set_enabled", { enabled: e.target.checked });
listen("config", ({ payload }) => applyState(payload));
listen("select-slot", ({ payload }) => select(payload));

applyState(await invoke("get_state"));
const initial = new URLSearchParams(location.search).get("slot");
if (initial) select(initial);
invoke("claude_available").then((ok) => (claudeReady = ok));
