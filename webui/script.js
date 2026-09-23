// VOID//PULSE — main app logic
"use strict";
const PULSE_BUILD = "1.0.0-20260923";
const SCHEDULE_FILE = "/data/local/tmp/.void-pulse-schedule.json";

(function () {
  const el = {};
  ["tierBadge","volumeRows","swMono","balanceSlider","balanceVal","oemScanList",
   "swSafeBypass","eqRack","activePresetName","activePresetDesc","engineStatus",
   "exportGraphicEqBtn","openJamesDspBtn","stageCanvas","stageHint","lightShowToggle",
   "sensSlider","fadeStatus","providerPickBtn","apiKeyInput","modelPickBtn",
   "ctxProfile","ctxTier","ctxLog","chatLog","chatInput","vaultList","swAutoBoot",
   "consoleLog","settingsTierLine","drawer","drawerScrim","pickerSheet","pickerFilter",
   "pickerList","staleBanner","staleBannerText","errorBanner","errorBannerText",
   "zenGrid","zenCurrent","swHeadsUp","statListeners","statDnd","statSchedule",
   "appSearch","swAppScope","appList","scanAppsBtn","listenerList","listenerInput",
   "dndAccessList","dndAccessInput","swScheduleEnabled","scheduleStart","scheduleEnd",
   "scheduleZen","ctxDnd","ctxAccess"
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  const VOLUME_STREAMS = [
    { stream: 3, label: "Media" },
    { stream: 2, label: "Ring" },
    { stream: 5, label: "Notification" },
    { stream: 4, label: "Alarm" },
    { stream: 0, label: "Call" }
  ];

  const state = {
    tier: "unknown",
    jamesdsp: "",
    activeGains: new Array(10).fill(0),
    activePresetId: "flat",
    mono: false,
    balance: 0,
    autoApplyOnBoot: false,
    ctx: { profile: true, tier: true, log: false, dnd: true, access: false },
    ai: { providerId: "openai", apiKey: "", model: "", customBase: "" },
    fadeTimer: null
  };

  let consoleLines = "";
  let pickerMode = null; // "preset" | "provider" | "model"
  let pickerItems = [];
  let allApps = []; // {pkg, status: 'allowed'|'denied'|'na'}

  // ---------- Shizuku bridge (window.Shizuku.exec is SYNCHRONOUS, returns a
  // JSON string — same contract as void-silence and cyber-app-manager) ----
  function bridgeAvailable() { return typeof window.Shizuku !== "undefined" && window.Shizuku !== null; }

  async function exec(cmd) {
    logConsole("$ " + cmd);
    if (!bridgeAvailable()) {
      logConsole("window.Shizuku is not available.");
      return { ok: false, exitCode: -1, stdout: "", stderr: "window.Shizuku is not available" };
    }
    let raw;
    try { raw = window.Shizuku.exec(cmd); }
    catch (e) { logConsole(String(e)); return { ok: false, exitCode: -1, stdout: "", stderr: String(e) }; }
    let res;
    try { res = JSON.parse(raw); }
    catch (e) { logConsole("unparseable bridge response: " + String(raw).slice(0, 200)); return { ok: false, exitCode: -1, stdout: "", stderr: "unparseable-bridge-response" }; }
    if (res.stdout) logConsole(res.stdout.trim());
    if (res.stderr) logConsole(res.stderr.trim());
    return res;
  }

  function logConsole(line) {
    consoleLines += line + "\n";
    if (consoleLines.length > 20000) consoleLines = consoleLines.slice(-16000);
    if (el.consoleLog) { el.consoleLog.textContent = consoleLines; el.consoleLog.scrollTop = el.consoleLog.scrollHeight; }
  }

  // ---------- build-consistency check & global error handler -------------
  function checkBuild() {
    const meta = document.querySelector('meta[name="pulse-build"]');
    const metaVal = meta ? meta.getAttribute("content") : null;
    const missing = [];
    if (typeof PULSE_PRESETS === "undefined") missing.push("kb.js");
    if (typeof PULSE_PROVIDERS === "undefined") missing.push("ai.js");
    if (typeof PulseVisualizer === "undefined") missing.push("visualizer.js");
    if (missing.length) {
      showBanner("stale", "Some files didn't load correctly (" + missing.join(", ") + "). Fully reinstall/reopen the module.");
    } else if (metaVal && metaVal.indexOf(PULSE_BUILD.split("-")[0]) === -1) {
      showBanner("stale", "This page and its scripts are on different versions — reinstall/reopen the module.");
    }
  }

  function showBanner(kind, text) {
    const banner = kind === "stale" ? el.staleBanner : el.errorBanner;
    const textEl = kind === "stale" ? el.staleBannerText : el.errorBannerText;
    if (!banner) return;
    textEl.textContent = text;
    banner.classList.add("show");
  }

  window.onerror = function (msg, src, line, col) {
    showBanner("error", String(msg) + " (" + (src || "?").split("/").pop() + ":" + line + ")");
    return false;
  };
  window.addEventListener("unhandledrejection", function (e) {
    showBanner("error", "Unhandled error: " + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
  });

  // ---------- drawer / view switching -------------------------------------
  window.openDrawer = function () { el.drawer.classList.add("open"); el.drawerScrim.classList.add("open"); };
  window.closeDrawer = function () { el.drawer.classList.remove("open"); el.drawerScrim.classList.remove("open"); };

  window.switchView = function (name) {
    document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); });
    document.querySelectorAll(".drawer-item").forEach(function (v) { v.classList.toggle("active", v.dataset.view === name); });
    document.querySelectorAll(".navbtn").forEach(function (v) { v.classList.toggle("active", v.dataset.view === name); });
    if (name === "access") { loadListenerAccess(); loadDndAccess(); }
    if (name === "schedule") { loadSchedule(); }
    closeDrawer();
  };

  // ---------- capability detection ----------------------------------------
  async function detectCapabilities() {
    const idRes = await exec("id -u");
    state.tier = (idRes.stdout || "").trim() === "0" ? "root" : "shell";
    el.tierBadge.textContent = state.tier === "root" ? "root session" : "shell session";
    el.tierBadge.className = "tier-badge " + state.tier;
    el.settingsTierLine.textContent = "Session: " + state.tier + (state.tier === "root" ? " — advanced settings unlocked" : " — no-root capabilities only");

    const pkgRes = await exec("pm list packages");
    const line = (pkgRes.stdout || "").split("\n").find(function (l) { return /jamesdsp/i.test(l); });
    state.jamesdsp = line ? line.replace("package:", "").trim() : "";
    renderEngineStatus();
  }

  function renderEngineStatus() {
    if (state.jamesdsp) {
      el.engineStatus.innerHTML = "Real-time DSP engine detected: <b>" + state.jamesdsp + "</b>. Export a profile below and import it there for genuine per-band processing.";
      el.openJamesDspBtn.style.display = "block";
    } else {
      el.engineStatus.textContent = "No system-wide DSP engine (e.g. RootlessJamesDSP) detected. This module can still shape system-level tone (mono/balance/OEM knobs) and export a standard GraphicEQ profile for whenever you install one.";
      el.openJamesDspBtn.style.display = "none";
    }
  }

  // ---------- mixer --------------------------------------------------------
  function renderVolumeRows() {
    el.volumeRows.innerHTML = "";
    VOLUME_STREAMS.forEach(function (s) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML =
        '<div class="label">' + s.label + '</div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
        '<button class="iconbtn" data-dir="lower" data-stream="' + s.stream + '">−</button>' +
        '<span class="val" style="min-width:22px;text-align:center" id="volVal' + s.stream + '">…</span>' +
        '<button class="iconbtn" data-dir="raise" data-stream="' + s.stream + '">+</button>' +
        '</div>';
      el.volumeRows.appendChild(row);
      refreshVolumeReadout(s.stream);
    });
    el.volumeRows.querySelectorAll("button[data-dir]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        const stream = parseInt(btn.dataset.stream, 10);
        await exec("media volume --stream " + stream + " --adj " + btn.dataset.dir + " --show");
        await refreshVolumeReadout(stream);
      });
    });
  }

  // Uses relative --adj raise/lower rather than a guessed --set index —
  // each stream's real max (7 vs 15 vs 25, depending on stream/device) is
  // never guessed, which is what made the old slider silently fail.
  async function refreshVolumeReadout(stream) {
    const res = await exec("media volume --stream " + stream + " --get");
    const m = (res.stdout || "").match(/(\d+)/);
    const readout = document.getElementById("volVal" + stream);
    if (readout) readout.textContent = m ? m[1] : "?";
  }

  async function setVolume(stream, level) {
    await exec("media volume --stream " + stream + " --set " + level + " --show");
  }

  window.toggleMono = function () {
    state.mono = !state.mono;
    el.swMono.classList.toggle("on", state.mono);
    exec("settings put system master_mono " + (state.mono ? 1 : 0));
  };

  el.balanceSlider && el.balanceSlider.addEventListener("change", function () {
    state.balance = parseInt(el.balanceSlider.value, 10) / 10;
    el.balanceVal.textContent = state.balance === 0 ? "Center" : state.balance.toFixed(1);
    exec("settings put system master_balance " + state.balance.toFixed(1));
  });

  window.toggleSafeBypass = function () {
    const enabling = !el.swSafeBypass.classList.contains("on");
    if (enabling) {
      const ok = window.confirm("This removes Android's hearing-safety volume warning. Sustained loud volume can permanently damage hearing. Continue?");
      if (!ok) return;
    }
    el.swSafeBypass.classList.toggle("on", enabling);
    exec("settings put global audio_safe_volume_state " + (enabling ? 3 : 1));
  };

  window.rescanOem = async function () {
    el.oemScanList.textContent = "Scanning…";
    const out = [];
    for (const ns of ["system", "secure", "global"]) {
      const res = await exec("settings list " + ns);
      (res.stdout || "").split("\n").forEach(function (line) {
        if (/dolby|atmos|equal|_eq_|sound_effect|audio_effect|tone_control|bass_boost|adapt_sound|uhq|mi_sound/i.test(line) && line.trim()) {
          out.push(ns + " · " + line.trim());
        }
      });
    }
    el.oemScanList.textContent = out.length ? out.slice(0, 25).join("\n") : "Nothing matched on this device.";
  };

  // ---------- equalizer -----------------------------------------------------
  function renderEqRack() {
    el.eqRack.innerHTML = "";
    PULSE_BANDS.forEach(function (freq, i) {
      const band = document.createElement("div");
      band.className = "eq-band";
      band.innerHTML =
        '<div class="val" id="eqVal' + i + '">0</div>' +
        '<input type="range" min="' + PULSE_GAIN_MIN + '" max="' + PULSE_GAIN_MAX + '" value="0" data-i="' + i + '">' +
        '<div class="freq">' + PULSE_BAND_LABELS[i] + '</div>';
      el.eqRack.appendChild(band);
      const slider = band.querySelector("input");
      slider.addEventListener("input", function () {
        state.activeGains[i] = parseInt(slider.value, 10);
        document.getElementById("eqVal" + i).textContent = (state.activeGains[i] > 0 ? "+" : "") + state.activeGains[i];
      });
    });
  }

  function loadPresetIntoRack(preset) {
    state.activeGains = preset.gains.slice();
    state.activePresetId = preset.id;
    el.activePresetName.textContent = preset.name;
    el.activePresetDesc.textContent = preset.description;
    document.querySelectorAll("#eqRack input[type=range]").forEach(function (s, i) {
      s.value = preset.gains[i];
      document.getElementById("eqVal" + i).textContent = (preset.gains[i] > 0 ? "+" : "") + preset.gains[i];
    });
  }

  window.applyEqProfile = async function () {
    const res = await pulseWriteFile("/data/local/tmp/void-pulse/active.json", JSON.stringify({
      name: el.activePresetName.textContent, gains: state.activeGains, mono: state.mono, balance: state.balance
    }));
    if (res && res.ok === false) { alert("Saving the profile failed — check the Console tab for the exact error."); return; }
    alert("Saved as the active profile." + (state.jamesdsp ? " This alone doesn't shape live audio — export it below and import into " + state.jamesdsp + " for that." : " Export below whenever you install a DSP engine like JamesDSP, since that's what actually applies per-band shaping."));
  };

  window.openPresetPicker = function () {
    pickerMode = "preset";
    pickerItems = PULSE_PRESETS;
    renderPicker(PULSE_PRESETS, function (p) {
      return '<div class="label">' + p.name + '</div><div class="desc">' + p.description + '</div>';
    });
    openPicker();
  };

  // ---------- GraphicEQ export / JamesDSP bridge ----------------------------
  window.exportGraphicEq = async function () {
    const line = "GraphicEQ: " + PULSE_BANDS.map(function (f, i) { return f + " " + state.activeGains[i]; }).join("; ") + ";";
    const name = (el.activePresetName.textContent || "custom").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
    const path = "/storage/emulated/0/Download/VOID-PULSE/" + name + ".txt";
    const res = await pulseWriteFile(path, line);
    if (res && res.ok === true) alert("Exported to Download/VOID-PULSE/" + name + ".txt — import it from JamesDSP's Graphic EQ screen.");
    else alert("Export failed — check the Console tab for the exact command and error.");
  };

  window.openJamesDsp = async function () {
    if (!state.jamesdsp) return;
    const res = await exec("monkey -p " + state.jamesdsp + " -c android.intent.category.LAUNCHER 1");
    if (res && res.ok === false) alert("Couldn't launch " + state.jamesdsp + " — check the Console tab; it may need to be opened manually once first.");
  };

  function shQuote(str) { return "'" + String(str).replace(/'/g, "'\\''") + "'"; }

  async function pulseWriteFile(path, text) {
    // printf with a single-quoted, escaped payload — avoids depending on a
    // base64 binary that isn't guaranteed to exist on every device/toolbox.
    const dir = path.substring(0, path.lastIndexOf("/"));
    return exec("mkdir -p " + shQuote(dir) + " && printf '%s' " + shQuote(text) + " > " + shQuote(path));
  }

  // ---------- light show -----------------------------------------------------
  window.toggleLightShow = async function () {
    if (PulseVisualizer.isRunning()) {
      PulseVisualizer.stop();
      el.lightShowToggle.textContent = "Start";
      el.stageHint.style.display = "flex";
      return;
    }
    try {
      await PulseVisualizer.start(el.stageCanvas);
      el.lightShowToggle.textContent = "Stop";
      el.stageHint.style.display = "none";
    } catch (e) {
      alert("Microphone access was denied or unavailable.");
    }
  };
  el.sensSlider && el.sensSlider.addEventListener("input", function () { PulseVisualizer.setSensitivity(parseInt(el.sensSlider.value, 10)); });
  window.setLightTheme = function (name) { PulseVisualizer.setTheme(name); };

  window.startFadeTimer = async function (minutes) {
    cancelFadeTimerInternal();
    const res = await exec("media volume --stream 3 --get");
    const match = (res.stdout || "").match(/(\d+)/);
    let vol = match ? parseInt(match[1], 10) : 12;
    const startVol = vol;
    const totalSteps = Math.max(vol, 1);
    const stepMs = (minutes * 60 * 1000) / totalSteps;
    el.fadeStatus.textContent = "Fading from " + startVol + " to 0 over " + minutes + " min…";
    state.fadeTimer = setInterval(async function () {
      vol -= 1;
      if (vol < 0) { cancelFadeTimerInternal(); el.fadeStatus.textContent = "Faded out."; return; }
      await setVolume(3, vol);
      el.fadeStatus.textContent = "Fading… now at " + vol;
    }, stepMs);
  };
  function cancelFadeTimerInternal() { if (state.fadeTimer) { clearInterval(state.fadeTimer); state.fadeTimer = null; } }
  window.cancelFadeTimer = function () { cancelFadeTimerInternal(); el.fadeStatus.textContent = "Cancelled."; };

  // ---------- AI advisor -----------------------------------------------------
  window.openProviderPicker = function () {
    pickerMode = "provider";
    renderPicker(PULSE_PROVIDERS, function (p) { return '<div class="label">' + p.name + '</div>'; });
    openPicker();
  };
  window.openModelPicker = function () {
    const models = pulseCachedModels(state.ai.providerId);
    pickerMode = "model";
    renderPicker(models.map(function (m) { return { id: m, name: m }; }), function (m) { return '<div class="label">' + m.name + '</div>'; });
    openPicker();
  };
  window.fetchModels = async function () {
    state.ai.apiKey = el.apiKeyInput.value.trim();
    try {
      const models = await pulseFetchModels(state.ai.providerId, state.ai.apiKey, state.ai.customBase);
      alert(models.length + " models fetched.");
    } catch (e) { alert("Couldn't fetch models: " + e.message); }
  };
  window.toggleCtx = function (key) {
    const map = { ctxProfile: "profile", ctxTier: "tier", ctxLog: "log", ctxDnd: "dnd", ctxAccess: "access" };
    const k = map[key];
    state.ctx[k] = !state.ctx[k];
    el[key].classList.toggle("on", state.ctx[k]);
  };
  function splitList(raw, seps) {
    if (!raw || raw.trim() === "" || raw.trim() === "null") return [];
    const re = new RegExp("[" + seps + "]");
    return raw.trim().split(re).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  window.previewContext = async function () {
    appendChat("ai", "Context preview:\n" + JSON.stringify(await buildContext(), null, 2));
  };
  async function buildContext() {
    const ctx = {};
    if (state.ctx.profile) ctx.activeProfile = { name: el.activePresetName.textContent, gains: state.activeGains, mono: state.mono, balance: state.balance };
    if (state.ctx.tier) { ctx.tier = state.tier; ctx.jamesdsp = state.jamesdsp || null; }
    if (state.ctx.dnd) {
      const zen = await exec("settings get global zen_mode").catch(function () { return {}; });
      const hu = await exec("settings get global heads_up_notifications_enabled").catch(function () { return {}; });
      ctx.zen_mode = (zen.stdout || "").trim() || null;
      ctx.heads_up = (hu.stdout || "").trim() || null;
    }
    if (state.ctx.access) {
      const listeners = await exec("settings get secure enabled_notification_listeners").catch(function () { return {}; });
      const dndPkgs = await exec("settings get secure enabled_notification_policy_access_packages").catch(function () { return {}; });
      ctx.listener_access = splitList(listeners.stdout, ":");
      ctx.dnd_access = splitList(dndPkgs.stdout, ",:");
    }
    if (state.ctx.log) ctx.log = consoleLines.slice(-3000);
    return ctx;
  }
  function appendChat(role, text) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.textContent = text;
    el.chatLog.appendChild(div);
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
    return div;
  }
  window.sendChat = async function () {
    const text = el.chatInput.value.trim();
    if (!text) return;
    el.chatInput.value = "";
    appendChat("user", text);
    const full = "Context: " + JSON.stringify(await buildContext()) + "\n\nRequest: " + text;
    try {
      const reply = await pulseSendChat(state.ai.providerId, state.ai.apiKey, state.ai.model, PULSE_AI_SYSTEM_PROMPT, full, state.ai.customBase);
      const bubble = appendChat("ai", reply.replace(/```voidpulse-eq[\s\S]*?```/, "").replace(/```voidpulse-dnd[\s\S]*?```/, "").trim() || "…");
      const action = pulseExtractAction(reply);
      if (action) {
        const card = document.createElement("div");
        card.className = "action-card";
        card.innerHTML = "<div class='label'>Proposed profile: " + (action.name || "custom") + "</div>" +
          "<div class='sub'>" + action.gains.join(", ") + " dB</div>" +
          "<button class='btn block' style='margin-top:8px'>Apply</button>";
        card.querySelector("button").onclick = function () { applyProposedProfile(action); };
        bubble.appendChild(card);
      }
      const steps = pulseExtractDndSteps(reply);
      steps.forEach(function (step) {
        const card = document.createElement("div");
        card.className = "action-card";
        card.innerHTML = "<div class='label'>" + pulseDescribeDndStep(step) + "</div><button class='btn block' style='margin-top:8px'>Apply</button>";
        card.querySelector("button").onclick = async function (e) {
          e.target.disabled = true; e.target.textContent = "Applying…";
          await applyDndStep(step);
          e.target.textContent = "Applied";
        };
        bubble.appendChild(card);
      });
    } catch (e) {
      appendChat("ai", "Error: " + e.message);
    }
  };
  function applyProposedProfile(action) {
    loadPresetIntoRack({ id: "ai-proposed", name: action.name || "AI proposed", description: "Proposed by the AI Advisor.", gains: action.gains });
    if (action.mono !== null && action.mono !== undefined) { state.mono = action.mono; el.swMono.classList.toggle("on", state.mono); }
    if (action.balance !== null && action.balance !== undefined) { state.balance = action.balance; el.balanceVal.textContent = state.balance === 0 ? "Center" : state.balance.toFixed(1); el.balanceSlider.value = state.balance * 10; }
    switchView("eq");
  }

  // ---------- vault -----------------------------------------------------------
  function loadVault() { try { return JSON.parse(localStorage.getItem("pulse-vault") || "[]"); } catch (e) { return []; } }
  function saveVault(list) { localStorage.setItem("pulse-vault", JSON.stringify(list)); }
  function renderVault() {
    const list = loadVault();
    el.vaultList.innerHTML = list.length ? "" : '<div class="sub">No saved profiles yet.</div>';
    list.forEach(function (p, idx) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = '<div><div class="label">' + p.name + '</div><div class="sub">' + p.gains.join(",") + '</div></div>';
      const btn = document.createElement("button");
      btn.className = "btn ghost"; btn.textContent = "Load";
      btn.onclick = function () { loadPresetIntoRack({ id: "vault-" + idx, name: p.name, description: "Saved profile.", gains: p.gains }); switchView("eq"); };
      row.appendChild(btn);
      el.vaultList.appendChild(row);
    });
  }
  window.saveCurrentAsProfile = function () {
    const name = prompt("Profile name?");
    if (!name) return;
    const list = loadVault();
    list.push({ name: name, gains: state.activeGains.slice(), mono: state.mono, balance: state.balance, createdAt: Date.now() });
    saveVault(list);
    renderVault();
  };
  window.exportAllProfiles = function () {
    const blob = JSON.stringify(loadVault(), null, 2);
    pulseWriteFile("/storage/emulated/0/Download/VOID-PULSE/vault-export.json", blob).then(function () {
      alert("Exported to Download/VOID-PULSE/vault-export.json");
    });
  };
  window.toggleAutoBoot = function () {
    state.autoApplyOnBoot = !state.autoApplyOnBoot;
    el.swAutoBoot.classList.toggle("on", state.autoApplyOnBoot);
    pulseWriteFile("/data/local/tmp/void-pulse/state.json", JSON.stringify({ mono: state.mono, balance: state.balance, autoApplyOnBoot: state.autoApplyOnBoot }));
  };

  // ---------- generic picker sheet ---------------------------------------------
  function renderPicker(items, rowHtml) {
    pickerItems = items;
    el.pickerList.innerHTML = "";
    items.forEach(function (it) {
      const row = document.createElement("div");
      row.className = "picker-item";
      row.innerHTML = rowHtml(it);
      row.onclick = function () { selectPickerItem(it); };
      el.pickerList.appendChild(row);
    });
  }
  function selectPickerItem(it) {
    if (pickerMode === "preset") loadPresetIntoRack(it);
    if (pickerMode === "provider") { state.ai.providerId = it.id; el.providerPickBtn.textContent = it.name + " →"; }
    if (pickerMode === "model") { state.ai.model = it.id; el.modelPickBtn.textContent = it.name + " →"; }
    closePicker();
  }
  function openPicker() { el.pickerSheet.classList.add("open"); el.pickerFilter.value = ""; }
  function closePicker() { el.pickerSheet.classList.remove("open"); }
  window.filterPicker = function () {
    const q = el.pickerFilter.value.toLowerCase();
    document.querySelectorAll(".picker-item").forEach(function (row) {
      row.style.display = row.textContent.toLowerCase().indexOf(q) !== -1 ? "" : "none";
    });
  };

  // ---------- Do Not Disturb --------------------------------------------------
  const ZEN_LABELS = { 0: "Off", 1: "Priority only", 2: "Total silence", 3: "Alarms only" };

  window.setZen = async function (zen) {
    await exec("settings put global zen_mode " + zen);
    await refreshZenState();
    await refreshStats();
  };
  async function refreshZenState() {
    const res = await exec("settings get global zen_mode").catch(function () { return {}; });
    const zen = (res.stdout || "").trim();
    document.querySelectorAll("#zenGrid .zen-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.zen === zen);
    });
    el.zenCurrent.textContent = "Current: " + (ZEN_LABELS[zen] || "Unknown");
  }
  window.toggleHeadsUp = async function () {
    const on = !el.swHeadsUp.classList.contains("on");
    el.swHeadsUp.classList.toggle("on", on);
    await exec("settings put global heads_up_notifications_enabled " + (on ? 1 : 0));
  };
  async function refreshHeadsUp() {
    const res = await exec("settings get global heads_up_notifications_enabled").catch(function () { return {}; });
    el.swHeadsUp.classList.toggle("on", (res.stdout || "1").trim() === "1");
  }
  async function refreshStats() {
    const listeners = await exec("settings get secure enabled_notification_listeners").catch(function () { return {}; });
    const dndPkgs = await exec("settings get secure enabled_notification_policy_access_packages").catch(function () { return {}; });
    el.statListeners.textContent = String(splitList(listeners.stdout, ":").length);
    el.statDnd.textContent = String(splitList(dndPkgs.stdout, ",:").length);
    const sched = await exec("cat " + SCHEDULE_FILE + " 2>/dev/null").catch(function () { return {}; });
    try {
      const parsed = JSON.parse((sched.stdout || "").trim());
      el.statSchedule.textContent = parsed.enabled ? (parsed.start + "–" + parsed.end) : "Disabled";
    } catch (e) { el.statSchedule.textContent = "Not set"; }
  }

  // ---------- per-app mute -------------------------------------------------
  window.toggleAppScope = function () { el.swAppScope.classList.toggle("on"); };
  window.renderAppList = function () {
    const filter = el.appSearch.value.trim().toLowerCase();
    const rows = allApps.filter(function (a) { return !filter || a.pkg.toLowerCase().indexOf(filter) !== -1; });
    if (rows.length === 0) {
      el.appList.innerHTML = '<div class="empty-state">' + (allApps.length ? "No apps match your filter." : "Run a scan to list installed apps.") + '</div>';
      return;
    }
    el.appList.innerHTML = rows.map(function (a) {
      const label = a.status === "allowed" ? "allowed — tap to mute" : a.status === "denied" ? "muted — tap to unmute" : "N/A";
      return '<div class="app-row" data-pkg="' + a.pkg + '"><span>' + a.pkg + '</span><span class="app-status ' + a.status + '">' + label + '</span></div>';
    }).join("");
    el.appList.querySelectorAll(".app-row").forEach(function (row) {
      row.addEventListener("click", async function () {
        const pkg = row.dataset.pkg;
        const app = allApps.find(function (a) { return a.pkg === pkg; });
        if (!app || app.status === "na") return;
        if (app.status === "allowed") {
          if (!window.confirm(pkg + " will no longer be able to post any notifications. Continue?")) return;
          await exec("pm revoke " + pkg + " android.permission.POST_NOTIFICATIONS; cmd appops set " + pkg + " POST_NOTIFICATIONS deny");
          app.status = "denied";
        } else {
          await exec("pm grant " + pkg + " android.permission.POST_NOTIFICATIONS; cmd appops set " + pkg + " POST_NOTIFICATIONS allow");
          app.status = "allowed";
        }
        renderAppList();
      });
    });
  };
  window.scanApps = async function () {
    el.scanAppsBtn.disabled = true; el.scanAppsBtn.textContent = "Scanning…";
    el.appList.innerHTML = '<div class="empty-state">Scanning…</div>';
    const scopeFlag = el.swAppScope.classList.contains("on") ? "-3" : "";
    const cmd = "for p in $(pm list packages " + scopeFlag + " | sed 's/^package://'); do printf '%s|%s\\n' \"$p\" \"$(cmd appops get $p POST_NOTIFICATIONS 2>/dev/null | head -n1)\"; done";
    try {
      const res = await exec(cmd);
      const lines = (res.stdout || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
      allApps = lines.map(function (line) {
        const idx = line.indexOf("|");
        const pkg = idx === -1 ? line : line.slice(0, idx);
        const rest = idx === -1 ? "" : line.slice(idx + 1);
        let status = "na";
        if (/allow/i.test(rest)) status = "allowed"; else if (/ignore|deny/i.test(rest)) status = "denied";
        return { pkg: pkg, status: status };
      }).sort(function (a, b) { return a.pkg.localeCompare(b.pkg); });
    } catch (e) { allApps = []; }
    el.scanAppsBtn.disabled = false; el.scanAppsBtn.textContent = "Scan installed apps";
    renderAppList();
  };

  // ---------- listener / DND access ------------------------------------------
  function renderGrantList(container, items, onRevoke) {
    if (items.length === 0) { container.innerHTML = '<div class="empty-state">None granted.</div>'; return; }
    container.innerHTML = items.map(function (name) {
      return '<div class="grant-row" data-name="' + name + '"><span>' + name + '</span><button class="btn ghost revoke-btn">Revoke</button></div>';
    }).join("");
    container.querySelectorAll(".revoke-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { onRevoke(btn.closest(".grant-row").dataset.name); });
    });
  }
  async function loadListenerAccess() {
    el.listenerList.innerHTML = '<div class="empty-state">Loading…</div>';
    const res = await exec("settings get secure enabled_notification_listeners").catch(function () { return {}; });
    renderGrantList(el.listenerList, splitList(res.stdout, ":"), disallowListener);
  }
  async function disallowListener(component) {
    await exec("cmd notification disallow_listener " + component);
    await loadListenerAccess(); await refreshStats();
  }
  window.grantListener = async function () {
    const component = el.listenerInput.value.trim();
    if (!component || component.indexOf("/") === -1) { alert("Component must be in package/Class form."); return; }
    if (!window.confirm(component + " will be able to read all of your notifications. Only do this for an app you trust.")) return;
    await exec("cmd notification allow_listener " + component);
    el.listenerInput.value = "";
    await loadListenerAccess(); await refreshStats();
  };
  window.detectListener = async function () {
    const pkg = window.prompt("Package to scan for notification listener services:");
    if (!pkg) return;
    const res = await exec('dumpsys package ' + pkg + ' | grep -B4 "android.service.notification.NotificationListenerService" | grep -Eo "' + pkg + '/[A-Za-z0-9_.\\$]+"').catch(function () { return {}; });
    const found = res.stdout ? Array.from(new Set(res.stdout.split("\n").map(function (s) { return s.trim(); }).filter(Boolean))) : [];
    if (found.length) el.listenerInput.value = found[0];
    else alert("No listener service auto-detected — check the Console tab, or enter the component manually.");
  };
  async function loadDndAccess() {
    el.dndAccessList.innerHTML = '<div class="empty-state">Loading…</div>';
    const res = await exec("settings get secure enabled_notification_policy_access_packages").catch(function () { return {}; });
    renderGrantList(el.dndAccessList, splitList(res.stdout, ",:"), disallowDndAccess);
  }
  async function disallowDndAccess(pkg) {
    await exec("cmd notification disallow_dnd " + pkg);
    await loadDndAccess(); await refreshStats();
  }
  window.grantDndAccess = async function () {
    const pkg = el.dndAccessInput.value.trim();
    if (!pkg) return;
    await exec("cmd notification allow_dnd " + pkg);
    el.dndAccessInput.value = "";
    await loadDndAccess(); await refreshStats();
  };

  // ---------- schedule -----------------------------------------------------
  window.toggleScheduleEnabled = function () { el.swScheduleEnabled.classList.toggle("on"); };
  async function loadSchedule() {
    const res = await exec("cat " + SCHEDULE_FILE + " 2>/dev/null").catch(function () { return {}; });
    if (!res.stdout || !res.stdout.trim()) return;
    try {
      const parsed = JSON.parse(res.stdout.trim());
      el.swScheduleEnabled.classList.toggle("on", !!parsed.enabled);
      if (parsed.start) el.scheduleStart.value = parsed.start;
      if (parsed.end) el.scheduleEnd.value = parsed.end;
      if (parsed.zen != null) el.scheduleZen.value = String(parsed.zen);
    } catch (e) { /* ignore malformed schedule file */ }
  }
  window.saveSchedule = async function () {
    const payload = {
      enabled: el.swScheduleEnabled.classList.contains("on"),
      start: el.scheduleStart.value || "22:30",
      end: el.scheduleEnd.value || "07:00",
      zen: parseInt(el.scheduleZen.value, 10)
    };
    await pulseWriteFile(SCHEDULE_FILE, JSON.stringify(payload));
    await refreshStats();
    alert("Schedule saved.");
  };
  window.recheckSchedule = async function () {
    const res = await exec("cat " + SCHEDULE_FILE + " 2>/dev/null").catch(function () { return {}; });
    let sched;
    try { sched = JSON.parse((res.stdout || "").trim()); } catch (e) { alert("No valid schedule saved yet."); return; }
    if (!sched.enabled) { alert("Schedule is disabled."); return; }
    const [sh, sm] = sched.start.split(":").map(Number);
    const [eh, em] = sched.end.split(":").map(Number);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = sh * 60 + sm, endMin = eh * 60 + em;
    const inWindow = startMin <= endMin ? (nowMin >= startMin && nowMin < endMin) : (nowMin >= startMin || nowMin < endMin);
    if (inWindow) { await exec("settings put global zen_mode " + sched.zen); await refreshZenState(); alert("Inside schedule window — applied."); }
    else { alert("Outside schedule window — left DND untouched."); }
  };

  // ---------- AI action bridge for DND steps ---------------------------------
  async function applyDndStep(step) {
    switch (step.type) {
      case "set_zen": await setZen(step.value); break;
      case "heads_up":
        el.swHeadsUp.classList.toggle("on", step.value);
        await exec("settings put global heads_up_notifications_enabled " + (step.value ? 1 : 0));
        break;
      case "mute_app":
        if (PULSE_PROTECTED_PACKAGES.indexOf(step.pkg) !== -1) { appendChat("ai", "Skipped: " + step.pkg + " is a protected system package."); break; }
        if (step.mute) { if (!window.confirm(step.pkg + " will no longer be able to post any notifications. Continue?")) return; await exec("pm revoke " + step.pkg + " android.permission.POST_NOTIFICATIONS; cmd appops set " + step.pkg + " POST_NOTIFICATIONS deny"); }
        else { await exec("pm grant " + step.pkg + " android.permission.POST_NOTIFICATIONS; cmd appops set " + step.pkg + " POST_NOTIFICATIONS allow"); }
        { const app = allApps.find(function (a) { return a.pkg === step.pkg; }); if (app) { app.status = step.mute ? "denied" : "allowed"; renderAppList(); } }
        break;
      case "grant_listener":
        if (!window.confirm(step.component + " will be able to read all of your notifications. Only do this for an app you trust.")) return;
        await exec("cmd notification allow_listener " + step.component);
        await loadListenerAccess(); await refreshStats();
        break;
      case "revoke_listener": await disallowListener(step.component); break;
      case "grant_dnd_access": await exec("cmd notification allow_dnd " + step.pkg); await loadDndAccess(); await refreshStats(); break;
      case "revoke_dnd_access": await disallowDndAccess(step.pkg); break;
      case "set_schedule":
        await pulseWriteFile(SCHEDULE_FILE, JSON.stringify({ enabled: step.enabled, start: step.start, end: step.end, zen: step.zen }));
        await loadSchedule(); await refreshStats();
        break;
    }
  }

  // ---------- init ----------------------------------------------------------
  async function init() {
    checkBuild();
    renderVolumeRows();
    renderEqRack();
    loadPresetIntoRack(pulseGetPreset("flat"));
    renderVault();
    await detectCapabilities();
    await Promise.all([refreshZenState(), refreshHeadsUp(), refreshStats()]);
  }
  document.addEventListener("DOMContentLoaded", init);
})();
