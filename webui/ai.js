// VOID//PULSE — AI Advisor (bring-your-own-key). Nothing here ever executes
// a shell command directly: it only proposes a `voidpulse-actions` JSON
// block, which the UI re-validates and requires an explicit Apply tap for.
"use strict";

const PULSE_PROVIDERS = [
  { id: "openai", name: "OpenAI", chatUrl: "https://api.openai.com/v1/chat/completions", modelsUrl: "https://api.openai.com/v1/models", auth: "bearer" },
  { id: "anthropic", name: "Anthropic Claude", chatUrl: "https://api.anthropic.com/v1/messages", modelsUrl: "https://api.anthropic.com/v1/models", auth: "x-api-key" },
  { id: "gemini", name: "Google Gemini", chatUrl: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models", auth: "query" },
  { id: "deepseek", name: "DeepSeek", chatUrl: "https://api.deepseek.com/chat/completions", modelsUrl: "https://api.deepseek.com/models", auth: "bearer" },
  { id: "mistral", name: "Mistral", chatUrl: "https://api.mistral.ai/v1/chat/completions", modelsUrl: "https://api.mistral.ai/v1/models", auth: "bearer" },
  { id: "xai", name: "xAI", chatUrl: "https://api.x.ai/v1/chat/completions", modelsUrl: "https://api.x.ai/v1/models", auth: "bearer" },
  { id: "custom", name: "Custom (OpenAI-compatible)", chatUrl: "", modelsUrl: "", auth: "bearer" }
];

const PULSE_STATUS_HINTS = {
  401: "Unauthorized — double-check the API key.",
  402: "Payment required — this key has no billing/credits attached.",
  403: "Forbidden — the key may lack access to this model.",
  404: "Not found — check the model name/endpoint for this provider.",
  429: "Rate limited — wait a moment and try again.",
  502: "Provider gateway error — retrying automatically.",
  503: "Provider is at high demand — retrying automatically.",
  529: "Provider is overloaded — retrying automatically."
};

function pulseGetProvider(id) { return PULSE_PROVIDERS.find(function (p) { return p.id === id; }); }

async function pulseFetchWithRetry(url, opts, retries) {
  retries = retries === undefined ? 2 : retries;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts);
      if ([502, 503, 529].indexOf(res.status) !== -1 && attempt < retries) {
        await new Promise(function (r) { setTimeout(r, 600 * (attempt + 1)); });
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await new Promise(function (r) { setTimeout(r, 600 * (attempt + 1)); });
    }
  }
  throw lastErr || new Error("network error");
}

async function pulseFetchModels(providerId, apiKey, customBase) {
  const p = pulseGetProvider(providerId);
  if (!p) throw new Error("unknown provider");
  let url = p.modelsUrl;
  const headers = { "Content-Type": "application/json" };
  if (providerId === "custom") {
    url = (customBase || "").replace(/\/$/, "") + "/models";
    headers["Authorization"] = "Bearer " + apiKey;
  } else if (p.auth === "bearer") {
    headers["Authorization"] = "Bearer " + apiKey;
  } else if (p.auth === "x-api-key") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (p.auth === "query") {
    url += "?key=" + encodeURIComponent(apiKey);
  }
  const res = await pulseFetchWithRetry(url, { method: "GET", headers: headers });
  if (!res.ok) {
    const hint = PULSE_STATUS_HINTS[res.status] || ("HTTP " + res.status);
    throw new Error(hint);
  }
  const data = await res.json();
  let list = [];
  if (Array.isArray(data.data)) list = data.data.map(function (m) { return m.id; });
  else if (Array.isArray(data.models)) list = data.models.map(function (m) { return (m.name || "").replace("models/", ""); });
  localStorage.setItem("pulse-models-" + providerId, JSON.stringify(list));
  return list;
}

function pulseCachedModels(providerId) {
  try { return JSON.parse(localStorage.getItem("pulse-models-" + providerId) || "[]"); }
  catch (e) { return []; }
}

async function pulseSendChat(providerId, apiKey, model, systemPrompt, userText, customBase) {
  const p = pulseGetProvider(providerId);
  const headers = { "Content-Type": "application/json" };
  let url = p.chatUrl;
  let body;

  if (providerId === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = { model: model, max_tokens: 800, system: systemPrompt, messages: [{ role: "user", content: userText }] };
  } else if (providerId === "gemini") {
    url = p.chatUrl.replace("{model}", model) + "?key=" + encodeURIComponent(apiKey);
    body = { contents: [{ parts: [{ text: systemPrompt + "\n\n" + userText }] }] };
  } else {
    if (providerId === "custom") { url = (customBase || "").replace(/\/$/, "") + "/chat/completions"; }
    headers["Authorization"] = "Bearer " + apiKey;
    body = { model: model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userText }] };
  }

  const res = await pulseFetchWithRetry(url, { method: "POST", headers: headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const hint = PULSE_STATUS_HINTS[res.status] || ("HTTP " + res.status);
    throw new Error(hint);
  }
  const data = await res.json();
  let text = "";
  if (providerId === "anthropic") {
    text = (data.content || []).map(function (c) { return c.text || ""; }).join("\n");
  } else if (providerId === "gemini") {
    text = ((data.candidates || [])[0] || {}).content && data.candidates[0].content.parts.map(function (pp) { return pp.text; }).join("\n") || "";
  } else {
    text = ((data.choices || [])[0] || {}).message && data.choices[0].message.content || "";
  }
  return text;
}

// Extracts a ```voidpulse-eq``` fenced JSON block, if present.
function pulseExtractAction(text) {
  const m = text.match(/```voidpulse-eq\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]);
    return pulseValidateAction(obj) ? obj : null;
  } catch (e) { return null; }
}

// Local re-validation — never trust the model's JSON as-is.
function pulseValidateAction(obj) {
  if (!obj || obj.action !== "apply_profile") return false;
  if (!Array.isArray(obj.gains) || obj.gains.length !== 10) return false;
  for (let i = 0; i < 10; i++) {
    const g = obj.gains[i];
    if (typeof g !== "number" || g < PULSE_GAIN_MIN || g > PULSE_GAIN_MAX) return false;
  }
  if (obj.balance !== null && obj.balance !== undefined) {
    if (typeof obj.balance !== "number" || obj.balance < -1 || obj.balance > 1) return false;
  }
  if (obj.mono !== null && obj.mono !== undefined && typeof obj.mono !== "boolean") return false;
  return true;
}

// ---------- DND/notification step proposals ---------------------------------
const PULSE_PKG_RE = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/;
const PULSE_COMPONENT_RE = /^[a-zA-Z0-9_.]+\/[a-zA-Z0-9_.$]+$/;
const PULSE_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pulseValidateDndStep(step) {
  if (!step || typeof step !== "object") return false;
  switch (step.type) {
    case "set_zen": return [0, 1, 2, 3].indexOf(step.value) !== -1;
    case "heads_up": return typeof step.value === "boolean";
    case "mute_app": return PULSE_PKG_RE.test(step.pkg || "") && typeof step.mute === "boolean";
    case "grant_listener": case "revoke_listener": return PULSE_COMPONENT_RE.test(step.component || "");
    case "grant_dnd_access": case "revoke_dnd_access": return PULSE_PKG_RE.test(step.pkg || "");
    case "set_schedule":
      return typeof step.enabled === "boolean" && PULSE_TIME_RE.test(step.start || "") && PULSE_TIME_RE.test(step.end || "") && [1, 2, 3].indexOf(step.zen) !== -1;
    default: return false;
  }
}

// Extracts a ```voidpulse-dnd``` fenced JSON array; returns only steps that
// pass local validation — the model's own JSON is never trusted directly.
function pulseExtractDndSteps(text) {
  const m = text.match(/```voidpulse-dnd\s*([\s\S]*?)```/);
  if (!m) return [];
  let arr;
  try { arr = JSON.parse(m[1]); } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter(pulseValidateDndStep);
}

function pulseDescribeDndStep(s) {
  switch (s.type) {
    case "set_zen": return "Set DND to " + ({0:"Off",1:"Priority only",2:"Total silence",3:"Alarms only"}[s.value]);
    case "heads_up": return (s.value ? "Enable" : "Disable") + " heads-up notifications";
    case "mute_app": return (s.mute ? "Mute" : "Unmute") + " " + s.pkg;
    case "grant_listener": return "Grant notification listener access to " + s.component;
    case "revoke_listener": return "Revoke notification listener access from " + s.component;
    case "grant_dnd_access": return "Grant DND access to " + s.pkg;
    case "revoke_dnd_access": return "Revoke DND access from " + s.pkg;
    case "set_schedule": return "Set schedule " + s.start + "–" + s.end + " (" + ({1:"Priority only",2:"Total silence",3:"Alarms only"}[s.zen]) + "), " + (s.enabled ? "enabled" : "disabled");
    default: return JSON.stringify(s);
  }
}
