// VOID//PULSE — knowledge base: band layout, presets, safe-settings allow-list
"use strict";

// Standard ISO 10-band graphic EQ centre frequencies.
const PULSE_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const PULSE_BAND_LABELS = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
const PULSE_GAIN_MIN = -12;
const PULSE_GAIN_MAX = 12;

// Each preset: id, name, category, gains[10] in dB, description.
const PULSE_PRESETS = [
  { id: "flat", name: "Flat / Reference", category: "genre", gains: [0,0,0,0,0,0,0,0,0,0],
    description: "No coloring — a neutral reference curve to compare everything else against." },
  { id: "bass-boost", name: "Bass Boost", category: "genre", gains: [8,6,4,2,0,0,0,0,0,0],
    description: "Lifts sub and low-bass for extra weight without touching the mids." },
  { id: "treble-boost", name: "Treble Boost", category: "genre", gains: [0,0,0,0,0,0,2,4,6,8],
    description: "Adds air and sparkle to the top end." },
  { id: "rock", name: "Rock", category: "genre", gains: [5,4,2,0,-1,0,2,4,5,5],
    description: "Punchy low end and present highs, mids pulled back slightly for guitars/vocals to cut through." },
  { id: "pop", name: "Pop", category: "genre", gains: [-1,2,4,5,3,0,-1,-1,2,3],
    description: "Vocal-forward mid lift with a light low-mid boost." },
  { id: "jazz", name: "Jazz", category: "genre", gains: [4,3,1,2,-1,-1,0,1,3,4],
    description: "Warm low end, relaxed mids, gentle top-end detail for cymbals and brass." },
  { id: "classical", name: "Classical", category: "genre", gains: [4,3,2,1,0,0,0,1,2,3],
    description: "Wide, smooth curve for orchestral dynamic range." },
  { id: "electronic", name: "Electronic / EDM", category: "genre", gains: [6,5,2,0,-2,1,0,2,4,6],
    description: "Deep sub-bass and crisp highs with a scooped low-mid for clean drops." },
  { id: "hip-hop", name: "Hip-Hop", category: "genre", gains: [7,6,3,1,-1,0,1,1,3,4],
    description: "Heavy low end for 808s/kicks, vocals kept clear in the mids." },
  { id: "acoustic", name: "Acoustic", category: "genre", gains: [3,3,2,1,0,1,2,3,3,2],
    description: "Natural, gently rounded curve for unplugged instruments and vocals." },
  { id: "vocal-boost", name: "Vocal Boost", category: "genre", gains: [-2,-1,0,2,4,4,3,1,0,-1],
    description: "Pulls the low end back and lifts 500Hz–2kHz where most vocal presence lives." },
  { id: "loudness", name: "Loudness", category: "genre", gains: [6,4,1,0,0,0,1,3,5,6],
    description: "Classic smiley-face curve — boosted lows and highs for low-volume listening." },

  { id: "asmr-whisper", name: "ASMR — Whisper Clarity", category: "asmr", gains: [-6,-4,-2,0,2,4,6,6,4,2],
    description: "Cuts rumble and room noise, lifts the consonant/sibilance range so whispers stay intelligible." },
  { id: "asmr-tapping", name: "ASMR — Tapping & Scratching", category: "asmr", gains: [-8,-6,-3,-1,0,1,3,6,8,6],
    description: "Emphasizes the crisp transients of tapping, scratching and crinkling sounds." },
  { id: "asmr-tingles", name: "ASMR — Deep Tingles / Warmth", category: "asmr", gains: [4,5,4,3,2,1,0,-1,-1,-2],
    description: "Warm, low-mid heavy curve for close-mic'd voice and binaural warmth." },
  { id: "asmr-ambience", name: "ASMR — Rain & Ambience", category: "asmr", gains: [3,3,2,1,0,0,-1,-1,-2,-3],
    description: "Cozy, smoothed curve for rain, fire and ambient background sound." },
  { id: "asmr-sleep", name: "ASMR — Sleep / Night", category: "asmr", gains: [2,3,2,1,0,-1,-2,-4,-6,-8],
    description: "Gently rolls off harsh highs and adds low-end warmth for late-night listening." }
];

function pulseGetPreset(id) {
  return PULSE_PRESETS.find(function (p) { return p.id === id; }) || null;
}

// Settings keys the module is willing to WRITE. Everything else surfaced
// by the OEM scan is shown read-only — we never blind-write an unknown key.
// Packages the AI Advisor is never allowed to mute/revoke-access for,
// even if it proposes it — matches the defensive list used across the
// other void-/cyber- modules. Manual, human-driven changes in the Per-App
// Mute tab aren't restricted by this list.
const PULSE_PROTECTED_PACKAGES = ["android", "com.android.systemui", "com.android.settings", "com.google.android.gms", "com.hamondev.shevery", "moe.shizuku.privileged.api"];

const PULSE_SAFE_WRITE_KEYS = [
  { key: "master_mono", namespace: "system", type: "bool", label: "Mono audio" },
  { key: "master_balance", namespace: "system", type: "float", label: "Left/right balance", min: -1, max: 1 },
  { key: "audio_safe_volume_state", namespace: "global", type: "danger-toggle", label: "Safe volume warning bypass" }
];

// Short system prompt fed to the AI Advisor so its suggestions stay
// grounded in what this module can actually apply. Two independent fenced
// block types may appear in one reply: an EQ profile and/or a list of DND
// steps — the user reviews and applies each one individually.
const PULSE_AI_SYSTEM_PROMPT =
  "You are the AI Advisor inside VOID//PULSE, an Android module that combines a 10-band equalizer/sound studio with Do Not Disturb and notification control. " +
  "For the equalizer, bands (Hz) are: " + PULSE_BAND_LABELS.join(", ") + ", gain range per band " + PULSE_GAIN_MIN + " to " + PULSE_GAIN_MAX + " dB. " +
  "When relevant, propose an EQ profile as a fenced ```voidpulse-eq``` JSON block: {\"action\":\"apply_profile\",\"name\":string,\"gains\":number[10],\"mono\":boolean|null,\"balance\":number|null}. " +
  "For DND/notifications, propose changes as a fenced ```voidpulse-dnd``` JSON ARRAY of step objects, each one of: " +
  '{"type":"set_zen","value":0|1|2|3} (0=off,1=priority only,2=total silence,3=alarms only), ' +
  '{"type":"heads_up","value":true|false}, ' +
  '{"type":"mute_app","pkg":"com.example.app","mute":true|false}, ' +
  '{"type":"grant_listener","component":"pkg/pkg.ClassName"}, {"type":"revoke_listener","component":"pkg/pkg.ClassName"}, ' +
  '{"type":"grant_dnd_access","pkg":"com.example.app"}, {"type":"revoke_dnd_access","pkg":"com.example.app"}, ' +
  '{"type":"set_schedule","enabled":true|false,"start":"HH:MM","end":"HH:MM","zen":1|2|3}. ' +
  "Use either block, both, or neither, whichever the request calls for. Reply with a short plain-language explanation first, then any fenced block(s). " +
  "Nothing you propose executes automatically — the user reviews and taps Apply on each item individually. Never propose anything outside these exact shapes.";

if (typeof module !== "undefined") { module.exports = { PULSE_BANDS, PULSE_PRESETS, PULSE_SAFE_WRITE_KEYS }; }
