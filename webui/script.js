(() => {
  "use strict";

  const SCHEDULE_FILE = "/data/local/tmp/.void-silence-schedule.json";

  const el = {
    bridgeWarning: document.getElementById("bridge-warning"),
    bridgeBadge: document.getElementById("bridge-badge"),
    tabs: document.querySelectorAll(".tab"),
    panels: document.querySelectorAll(".panel"),
    zenGrid: document.getElementById("zen-grid"),
    zenCurrent: document.getElementById("zen-current"),
    headsUpToggle: document.getElementById("heads-up-toggle"),
    statListeners: document.getElementById("stat-listeners"),
    statDnd: document.getElementById("stat-dnd"),
    statSchedule: document.getElementById("stat-schedule"),
    appSearch: document.getElementById("app-search"),
    appScopeUser: document.getElementById("app-scope-user"),
    appList: document.getElementById("app-list"),
    scanAppsBtn: document.getElementById("scan-apps-btn"),
    listenerList: document.getElementById("listener-list"),
    listenerInput: document.getElementById("listener-input"),
    listenerAddBtn: document.getElementById("listener-add-btn"),
    listenerDetectBtn: document.getElementById("listener-detect-btn"),
    dndAccessList: document.getElementById("dnd-access-list"),
    dndAccessInput: document.getElementById("dnd-access-input"),
    dndAccessAddBtn: document.getElementById("dnd-access-add-btn"),
    scheduleEnabled: document.getElementById("schedule-enabled"),
    scheduleStart: document.getElementById("schedule-start"),
    scheduleEnd: document.getElementById("schedule-end"),
    scheduleZen: document.getElementById("schedule-zen"),
    scheduleSaveBtn: document.getElementById("schedule-save-btn"),
    scheduleRecheckBtn: document.getElementById("schedule-recheck-btn"),
    consoleDrawer: document.getElementById("console-drawer"),
    consoleToggle: document.getElementById("console-toggle"),
    consoleBody: document.getElementById("console-body"),
    consoleCount: document.getElementById("console-count"),
    confirmBackdrop: document.getElementById("confirm-backdrop"),
    confirmTitle: document.getElementById("confirm-title"),
    confirmBody: document.getElementById("confirm-body"),
    confirmOk: document.getElementById("confirm-ok"),
    confirmCancel: document.getElementById("confirm-cancel"),
  };

  let consoleLines = 0;
  let bridgeOk = false;
  let allApps = []; // {pkg, status: 'allowed'|'denied'|'na'}

  // ---------- shell bridge ----------

  function shQuote(str) {
    return `'${String(str).replace(/'/g, `'\\''`)}'`;
  }

  function logConsole(text, kind) {
    consoleLines++;
    el.consoleCount.textContent = String(consoleLines);
    const line = document.createElement("div");
    line.className = "console-line" + (kind ? ` ${kind}` : "");
    line.textContent = text;
    el.consoleBody.appendChild(line);
    el.consoleBody.scrollTop = el.consoleBody.scrollHeight;
    // keep the drawer from growing unbounded in memory over a long session
    while (el.consoleBody.children.length > 300) {
      el.consoleBody.removeChild(el.consoleBody.firstChild);
    }
  }

  function bridgeAvailable() {
    return typeof window.Shizuku !== "undefined" && window.Shizuku !== null;
  }

  // window.Shizuku.exec() is SYNCHRONOUS and returns a JSON string, not a
  // Promise resolving to an object — matches the real contract used by
  // privacy-audit's shExec(). exec() here stays an async function only so
  // every call site can keep using await/.then without caring that the
  // underlying bridge call itself doesn't need it.
  async function exec(cmd) {
    logConsole("$ " + cmd);
    if (!bridgeAvailable()) {
      logConsole("window.Shizuku is not available.", "err");
      const fallback = { ok: false, exitCode: -1, stdout: "", stderr: "window.Shizuku is not available", timedOut: false };
      throw Object.assign(new Error("bridge-unavailable"), fallback);
    }
    let raw;
    try {
      raw = window.Shizuku.exec(cmd);
    } catch (e) {
      logConsole(String(e), "err");
      throw e;
    }
    let res;
    try {
      res = JSON.parse(raw);
    } catch (e) {
      logConsole("unparseable bridge response: " + String(raw).slice(0, 200), "err");
      throw new Error("unparseable-bridge-response");
    }
    if (res.stdout) logConsole(res.stdout.trim(), "ok");
    if (res.stderr) logConsole(res.stderr.trim(), "err");
    if (res.exitCode !== 0 && res.exitCode != null) logConsole(`(exit code ${res.exitCode})`, "err");
    return res;
  }

  async function checkBridge() {
    if (!bridgeAvailable()) {
      bridgeOk = false;
    } else {
      try {
        const res = await exec("echo bridge-ok");
        bridgeOk = !!(res && res.ok && res.stdout && res.stdout.indexOf("bridge-ok") !== -1);
      } catch (e) {
        bridgeOk = false;
      }
    }
    if (bridgeOk) {
      el.bridgeBadge.textContent = "bridge connected";
      el.bridgeBadge.className = "bridge-badge ok";
      el.bridgeWarning.classList.add("hidden");
    } else {
      el.bridgeBadge.textContent = "bridge unavailable";
      el.bridgeBadge.className = "bridge-badge error";
      el.bridgeWarning.classList.remove("hidden");
    }
    return bridgeOk;
  }

  // ---------- confirm modal ----------

  function confirmAction(title, body) {
    el.confirmTitle.textContent = title;
    el.confirmBody.textContent = body;
    el.confirmBackdrop.classList.remove("hidden");
    return new Promise((resolve) => {
      const cleanup = (result) => {
        el.confirmBackdrop.classList.add("hidden");
        el.confirmOk.removeEventListener("click", onOk);
        el.confirmCancel.removeEventListener("click", onCancel);
        resolve(result);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      el.confirmOk.addEventListener("click", onOk);
      el.confirmCancel.addEventListener("click", onCancel);
    });
  }

  // ---------- tabs ----------

  el.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      el.tabs.forEach((t) => t.classList.remove("active"));
      el.panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
      if (tab.dataset.tab === "access") { loadListenerAccess(); loadDndAccess(); }
      if (tab.dataset.tab === "schedule") loadSchedule();
    });
  });

  el.consoleToggle.addEventListener("click", () => {
    el.consoleDrawer.classList.toggle("open");
  });

  // ---------- quick controls: DND ----------

  const ZEN_LABELS = { 0: "Off", 1: "Priority only", 2: "Total silence", 3: "Alarms only" };

  async function refreshZenState() {
    const res = await exec("settings get global zen_mode").catch(() => null);
    const zen = res && res.stdout ? res.stdout.trim() : null;
    el.zenGrid.querySelectorAll(".zen-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.zen === zen);
    });
    el.zenCurrent.textContent = "Current: " + (ZEN_LABELS[zen] || "Unknown");
  }

  el.zenGrid.querySelectorAll(".zen-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const zen = btn.dataset.zen;
      await exec(`settings put global zen_mode ${zen}`);
      await refreshZenState();
      await refreshStats();
    });
  });

  async function refreshHeadsUp() {
    const res = await exec("settings get global heads_up_notifications_enabled").catch(() => null);
    const val = res && res.stdout ? res.stdout.trim() : "1";
    el.headsUpToggle.checked = val === "1";
  }

  el.headsUpToggle.addEventListener("change", async () => {
    await exec(`settings put global heads_up_notifications_enabled ${el.headsUpToggle.checked ? 1 : 0}`);
  });

  // ---------- stats ----------

  function splitList(raw, seps) {
    if (!raw || raw.trim() === "" || raw.trim() === "null") return [];
    const re = new RegExp(`[${seps}]`);
    return raw.trim().split(re).map((s) => s.trim()).filter(Boolean);
  }

  async function refreshStats() {
    const listenersRes = await exec("settings get secure enabled_notification_listeners").catch(() => null);
    const listeners = splitList(listenersRes && listenersRes.stdout, ":");
    el.statListeners.textContent = String(listeners.length);

    const dndRes = await exec("settings get secure enabled_notification_policy_access_packages").catch(() => null);
    const dndPkgs = splitList(dndRes && dndRes.stdout, ",:");
    el.statDnd.textContent = String(dndPkgs.length);

    const schedRes = await exec(`cat ${SCHEDULE_FILE} 2>/dev/null`).catch(() => null);
    let scheduleLabel = "not set";
    if (schedRes && schedRes.stdout && schedRes.stdout.trim()) {
      try {
        const parsed = JSON.parse(schedRes.stdout.trim());
        scheduleLabel = parsed.enabled ? "armed" : "saved (off)";
      } catch (e) { /* leave as not set */ }
    }
    el.statSchedule.textContent = scheduleLabel;
  }

  // ---------- per-app mute ----------

  function renderAppList() {
    const filter = el.appSearch.value.trim().toLowerCase();
    const rows = allApps.filter((a) => !filter || a.pkg.toLowerCase().includes(filter));
    if (rows.length === 0) {
      el.appList.innerHTML = `<div class="empty-state">${allApps.length ? "No apps match your filter." : "Run a scan to list installed apps."}</div>`;
      return;
    }
    el.appList.innerHTML = rows.map((a) => `
      <div class="app-row" data-pkg="${a.pkg}">
        <span class="app-pkg">${a.pkg}</span>
        <span class="app-status ${a.status}" data-action="toggle">${
          a.status === "allowed" ? "allowed — tap to mute" :
          a.status === "denied" ? "muted — tap to unmute" : "N/A"
        }</span>
      </div>
    `).join("");

    el.appList.querySelectorAll(".app-status[data-action]").forEach((badge) => {
      badge.addEventListener("click", async () => {
        const row = badge.closest(".app-row");
        const pkg = row.dataset.pkg;
        const app = allApps.find((a) => a.pkg === pkg);
        if (!app || app.status === "na") return;
        if (app.status === "allowed") {
          const ok = await confirmAction("Mute notifications?", `${pkg} will no longer be able to post any notifications.`);
          if (!ok) return;
          await exec(`pm revoke ${pkg} android.permission.POST_NOTIFICATIONS; cmd appops set ${pkg} POST_NOTIFICATIONS deny`);
          app.status = "denied";
        } else {
          await exec(`pm grant ${pkg} android.permission.POST_NOTIFICATIONS; cmd appops set ${pkg} POST_NOTIFICATIONS allow`);
          app.status = "allowed";
        }
        renderAppList();
      });
    });
  }

  el.appSearch.addEventListener("input", renderAppList);

  el.scanAppsBtn.addEventListener("click", async () => {
    el.scanAppsBtn.disabled = true;
    el.scanAppsBtn.textContent = "Scanning…";
    el.appList.innerHTML = `<div class="empty-state">Scanning…</div>`;
    const scopeFlag = el.appScopeUser.checked ? "-3" : "";
    const cmd = `for p in $(pm list packages ${scopeFlag} | sed 's/^package://'); do printf '%s|%s\\n' "$p" "$(cmd appops get $p POST_NOTIFICATIONS 2>/dev/null | head -n1)"; done`;
    try {
      const res = await exec(cmd);
      const lines = (res.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
      allApps = lines.map((line) => {
        const idx = line.indexOf("|");
        const pkg = idx === -1 ? line : line.slice(0, idx);
        const rest = idx === -1 ? "" : line.slice(idx + 1);
        let status = "na";
        if (/allow/i.test(rest)) status = "allowed";
        else if (/ignore|deny/i.test(rest)) status = "denied";
        return { pkg, status };
      }).sort((a, b) => a.pkg.localeCompare(b.pkg));
    } catch (e) {
      allApps = [];
    }
    el.scanAppsBtn.disabled = false;
    el.scanAppsBtn.textContent = "Scan installed apps";
    renderAppList();
  });

  // ---------- listener access ----------

  async function loadListenerAccess() {
    el.listenerList.innerHTML = `<div class="empty-state">Loading…</div>`;
    const res = await exec("settings get secure enabled_notification_listeners").catch(() => null);
    const items = splitList(res && res.stdout, ":");
    renderGrantList(el.listenerList, items, disallowListener);
  }

  function renderGrantList(container, items, onRevoke) {
    if (items.length === 0) {
      container.innerHTML = `<div class="empty-state">None granted.</div>`;
      return;
    }
    container.innerHTML = items.map((name) => `
      <div class="grant-row" data-name="${name}">
        <span class="grant-name">${name}</span>
        <button class="btn btn-ghost revoke-btn">Revoke</button>
      </div>
    `).join("");
    container.querySelectorAll(".revoke-btn").forEach((btn) => {
      btn.addEventListener("click", () => onRevoke(btn.closest(".grant-row").dataset.name));
    });
  }

  async function disallowListener(component) {
    await exec(`cmd notification disallow_listener ${component}`);
    await loadListenerAccess();
    await refreshStats();
  }

  el.listenerAddBtn.addEventListener("click", async () => {
    const component = el.listenerInput.value.trim();
    if (!component || component.indexOf("/") === -1) {
      logConsole("Listener component must be in package/Class form.", "err");
      return;
    }
    const ok = await confirmAction(
      "Grant notification listener access?",
      `${component} will be able to read all of your notifications. Only do this for an app you trust.`
    );
    if (!ok) return;
    await exec(`cmd notification allow_listener ${component}`);
    el.listenerInput.value = "";
    await loadListenerAccess();
    await refreshStats();
  });

  el.listenerDetectBtn.addEventListener("click", async () => {
    const pkg = window.prompt("Package to scan for notification listener services:");
    if (!pkg) return;
    logConsole(`Scanning ${pkg} for NotificationListenerService components…`);
    const res = await exec(
      `dumpsys package ${pkg} | grep -B4 "android.service.notification.NotificationListenerService" | grep -Eo "${pkg}/[A-Za-z0-9_.\\$]+"`
    ).catch(() => null);
    const found = res && res.stdout ? [...new Set(res.stdout.split("\n").map((s) => s.trim()).filter(Boolean))] : [];
    if (found.length === 0) {
      logConsole("No listener service auto-detected — check the raw dumpsys output above, or enter the component manually.", "err");
    } else {
      el.listenerInput.value = found[0];
      logConsole(`Detected: ${found.join(", ")} — filled the first match into the input field.`, "ok");
    }
  });

  // ---------- DND access ----------

  async function loadDndAccess() {
    el.dndAccessList.innerHTML = `<div class="empty-state">Loading…</div>`;
    const res = await exec("settings get secure enabled_notification_policy_access_packages").catch(() => null);
    const items = splitList(res && res.stdout, ",:");
    renderGrantList(el.dndAccessList, items, disallowDndAccess);
  }

  async function disallowDndAccess(pkg) {
    await exec(`cmd notification disallow_dnd ${pkg}`);
    await loadDndAccess();
    await refreshStats();
  }

  el.dndAccessAddBtn.addEventListener("click", async () => {
    const pkg = el.dndAccessInput.value.trim();
    if (!pkg) return;
    await exec(`cmd notification allow_dnd ${pkg}`);
    el.dndAccessInput.value = "";
    await loadDndAccess();
    await refreshStats();
  });

  // ---------- schedule ----------

  async function loadSchedule() {
    const res = await exec(`cat ${SCHEDULE_FILE} 2>/dev/null`).catch(() => null);
    if (!res || !res.stdout || !res.stdout.trim()) return;
    try {
      const parsed = JSON.parse(res.stdout.trim());
      el.scheduleEnabled.checked = !!parsed.enabled;
      if (parsed.start) el.scheduleStart.value = parsed.start;
      if (parsed.end) el.scheduleEnd.value = parsed.end;
      if (parsed.zen != null) el.scheduleZen.value = String(parsed.zen);
    } catch (e) {
      logConsole("Existing schedule.json is not valid JSON, ignoring it.", "err");
    }
  }

  el.scheduleSaveBtn.addEventListener("click", async () => {
    const payload = {
      enabled: el.scheduleEnabled.checked,
      start: el.scheduleStart.value || "22:30",
      end: el.scheduleEnd.value || "07:00",
      zen: parseInt(el.scheduleZen.value, 10),
    };
    const json = JSON.stringify(payload);
    await exec(`printf '%s' ${shQuote(json)} > ${SCHEDULE_FILE}`);
    logConsole("Schedule saved.", "ok");
    await refreshStats();
  });

  el.scheduleRecheckBtn.addEventListener("click", async () => {
    const res = await exec(`cat ${SCHEDULE_FILE} 2>/dev/null`).catch(() => null);
    if (!res || !res.stdout || !res.stdout.trim()) {
      logConsole("No schedule saved yet.", "err");
      return;
    }
    let sched;
    try {
      sched = JSON.parse(res.stdout.trim());
    } catch (e) {
      logConsole("schedule.json is not valid JSON.", "err");
      return;
    }
    if (!sched.enabled) {
      logConsole("Schedule is saved but disabled — nothing to apply.");
      return;
    }
    const [sh, sm] = sched.start.split(":").map(Number);
    const [eh, em] = sched.end.split(":").map(Number);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const inWindow = startMin <= endMin
      ? (nowMin >= startMin && nowMin < endMin)
      : (nowMin >= startMin || nowMin < endMin);
    if (inWindow) {
      await exec(`settings put global zen_mode ${sched.zen}`);
      logConsole(`Inside schedule window (${sched.start}-${sched.end}) — applied zen_mode=${sched.zen}.`, "ok");
      await refreshZenState();
    } else {
      logConsole(`Outside schedule window (${sched.start}-${sched.end}) — left DND untouched.`);
    }
  });

  // ---------- init ----------

  const bridgeRetryBtn = document.getElementById("bridge-retry-btn");
  if (bridgeRetryBtn) {
    bridgeRetryBtn.addEventListener("click", async () => {
      bridgeRetryBtn.disabled = true;
      bridgeRetryBtn.textContent = "Retrying…";
      const ok = await checkBridge();
      bridgeRetryBtn.disabled = false;
      bridgeRetryBtn.textContent = "Retry connection";
      if (ok) await Promise.all([refreshZenState(), refreshHeadsUp(), refreshStats()]);
    });
  }

  function init() {
    checkBridge().then((ok) => {
      if (!ok) return;
      Promise.all([refreshZenState(), refreshHeadsUp(), refreshStats()]);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
