# VOID//PULSE

**Sound & Notification Studio** — a single Shevery ADB module combining a
10-band EQ profile designer with genre/ASMR presets, a mic-reactive light
show, and full Do Not Disturb / notification / listener control, with one
AI Advisor across all of it. Automatically detects whether the current
Shizuku session is running as root or shell-only and adapts what it offers.

## Features

**Sound**
- 🎚 **Mixer** — per-stream volume (media, ring, notification, alarm, call),
  mono audio, left/right balance, and an optional (heavily-warned) safe
  volume bypass.
- 🎛 **10-band equalizer** — a full profile designer (31Hz–16kHz) with 12
  genre presets and 5 ASMR presets (whisper clarity, tapping/scratching,
  deep tingles, rain/ambience, sleep), plus unlimited custom profiles.
- 🔌 **DSP engine bridge** — detects [RootlessJamesDSP](https://github.com/timschneeb/RootlessJamesDSP)
  (or any installed package matching "jamesdsp") and exports your profile
  as a standard `GraphicEQ:` file for one-tap import there, since that's
  where genuine real-time per-band processing actually happens.
- ✨ **Mic-reactive light show** — a cyberpunk visualizer that listens
  through the device microphone and reacts to whatever's actually playing
  in the room, with three color themes and adjustable sensitivity.
- ⏰ **Sleep fade timer** — fades media volume to zero over 15/30/60
  minutes while the module is open.
- 🗄 **Vault** — save, load, and export custom EQ profiles as JSON; optional
  auto-apply of your last profile on boot/session start.

**Notifications & DND**
- 🔕 **Do Not Disturb** — one-tap Off / Priority only / Alarms only / Total
  silence, plus a heads-up (floating banner) toggle.
- 📵 **Per-app notification mute** — blocks a specific app from posting
  notifications via the `POST_NOTIFICATIONS` runtime permission.
- 🔐 **Listener / DND access management** — see and revoke which apps can
  read your notifications or change DND state, with detection help for
  finding an app's listener service component.
- ⏱ **Scheduled DND window** — a start/end time and mode, applied on
  session start and on-demand via "Re-check now".

**Across both**
- 🤖 **One AI Advisor** — bring-your-own-key (OpenAI, Anthropic Claude,
  Google Gemini, DeepSeek, Mistral, xAI, or a custom OpenAI-compatible
  endpoint). Describe what you want — a mood, a genre, "quiet my phone for
  a 2-hour study session but let alarms through" — and it can propose an
  EQ profile, a list of DND/notification steps, or both in the same reply.
  Every proposal is shown as an individual card; nothing applies until you
  tap Apply on that specific one. Context sent to the model is opt-in per
  category, with the listener/DND access package list default-off since
  it's the most sensitive one.
- 🖥 **Console drawer** — every shell command this module runs, and its raw
  output, is visible in-app. Nothing happens off-screen.

## An honest note on what "equalizer" means here

A true system-wide, per-app 10-band audio equalizer requires a persistent
native Android service holding an audio effect session — that's what apps
like RootlessJamesDSP actually are. A Shevery module (a WebView plus shell
scripts triggered through Shizuku's shell bridge) cannot run that kind of
always-on audio processing loop; a shell command is a one-shot action, not
a live audio pipeline.

So VOID//PULSE is honest about the split:

- **Always available, on any device:** the Mixer's volume/mono/balance
  controls are real, immediate system settings. The Equalizer tab is a full
  profile designer with presets, vault, and AI suggestions, and can export
  any profile as a standards-based `GraphicEQ:` file.
- **With RootlessJamesDSP (or similar) installed:** exported profiles give
  you genuine real-time per-band DSP — the module detects it, offers a
  one-tap launch, and generates the import file for you.
- **Root session:** unlocks OEM `secure`/`global` settings that reliably
  reject writes from a shell-only session on some devices, and a fuller
  settings snapshot in the Vault's export.

DND/notification control, by contrast, needs no such caveat — every
control on that side (`zen_mode`, per-app `POST_NOTIFICATIONS`, listener
and DND access grants) is a real, documented Android primitive that a
one-shot shell command genuinely and fully controls.

## Requirements

- [Shevery](https://github.com/HmnDev-Tech/shevery) with this module's
  access mode set to **Full**, or **Custom** with "WebUI shell bridge"
  enabled.
- Android 8.0+ (API 26). Per-app mute needs the target app to run Android
  13+ (API 33) — others show as N/A there.
- Microphone permission, only if you use the Light Show tab.
- [RootlessJamesDSP](https://github.com/timschneeb/RootlessJamesDSP) (or
  another system-wide DSP engine), only if you want real per-band audio
  processing rather than profile design + system tone controls.

## Install

**From a release ZIP:** ADB Modules → Import → select the ZIP.

**From source:**
```bash
git clone https://github.com/kreza6173-pixel/void-pulse.git
cd void-pulse
zip -r ../void-pulse.zip . -x ".git/*"
```
Then import the resulting ZIP the same way.

## Architecture

```
void-pulse/
├── module.prop      # Module manifest (usesShellBridge=true)
├── lib.sh            # Shared shell helpers for action.sh/service.sh
├── action.sh          # Read-only status summary shown on the module's Action button
├── service.sh          # One-shot catch-up on boot/session start: EQ state + DND schedule
├── webui/
│   ├── index.html        # Mixer / EQ / Light Show / DND / Per-App Mute / Access / Schedule / AI / Vault / Console
│   ├── style.css           # Cyberpunk glass theme, drawer nav, fixed-px pickers
│   ├── script.js            # window.Shizuku.exec() shell bridge + all UI logic
│   ├── ai.js                 # AI Advisor: BYOK provider integration + local action validation
│   ├── kb.js                  # Band layout, genre/ASMR presets, safe-write & protected-package allow-lists
│   └── visualizer.js           # Mic-reactive canvas light show
├── LICENSE
└── README.md
```

## How it works

| Feature | Shell mechanism |
|---|---|
| Stream volume | `media volume --stream <0-5> --set <index> --show` |
| Mono audio | `settings put system master_mono <0\|1>` |
| Balance | `settings put system master_balance <-1.0..1.0>` |
| Safe volume bypass | `settings put global audio_safe_volume_state <1\|3>` |
| Session tier | `id -u` (0 = root session, otherwise shell-only) |
| DSP engine detection | `pm list packages` grepped for a `jamesdsp` match |
| Launch detected engine | `monkey -p <pkg> -c android.intent.category.LAUNCHER 1` |
| OEM sound-key scan | `settings list system/secure/global` filtered client-side, read-only |
| Profile/state persistence | JSON at `/data/local/tmp/void-pulse/`, reapplied by `service.sh` |
| GraphicEQ export | Standard `GraphicEQ: f1 g1; f2 g2; …` file in `/storage/emulated/0/Download/VOID-PULSE/` |
| DND mode | `settings put global zen_mode <0-3>` |
| Heads-up toggle | `settings put global heads_up_notifications_enabled <0\|1>` |
| Per-app mute | `pm revoke/grant <pkg> android.permission.POST_NOTIFICATIONS` + `cmd appops set <pkg> POST_NOTIFICATIONS deny\|allow` |
| Listener access | `cmd notification allow_listener\|disallow_listener <pkg/Class>` |
| DND access | `cmd notification allow_dnd\|disallow_dnd <pkg>` |
| Schedule | JSON at `/data/local/tmp/.void-pulse-schedule.json`, applied by `service.sh` and the "Re-check now" button |

## Safety architecture

| Guard | What it does |
|---|---|
| Fixed allow-list of settings keys | The UI only ever writes `master_mono`, `master_balance`, and the safe-volume flag — any other OEM key the scanner finds is shown read-only, never blind-written |
| Explicit confirmation | Disabling the safe-volume warning, muting an app, and granting listener access all require a confirm dialog explaining the effect — whether triggered manually or via the AI Advisor |
| Protected-package list | The AI Advisor will not mute or touch access for core system packages (`android`, `com.android.systemui`, etc.), even if it proposes it; manual, human-driven changes aren't restricted by this list |
| Local re-validation of AI proposals | Every AI-proposed EQ profile or DND step is checked against fixed bounds (10-band/±12dB/valid-balance, or enum + package/component/time-format regexes) before it can be applied — the model's own JSON is never trusted directly, and nothing auto-executes |
| No hidden state | Every exec()'d command and its raw output is logged to the in-app console drawer |
| No persistent loop | The boot catch-up (EQ state + DND schedule) and the sleep-fade timer are one-shot/foreground-only, not an always-on background service |
| Build-consistency check | A `<meta name="pulse-build">` tag is compared against each script file's own presence on load; a mismatch or a missing file shows a dismissible warning instead of failing silently |

## Known limitations

- **No real per-app or system-wide DSP without a dedicated engine.** See
  "An honest note on what 'equalizer' means here" above — this is an
  architectural limit of the Shevery shell-bridge model, not a bug.
- **The light show reacts to the microphone, not internal audio.** It hears
  whatever's audible in the room, including anything besides your music.
- **The OEM settings scan is best-effort.** It surfaces likely candidates by
  keyword; unlisted OEMs may expose EQ controls under names the scanner
  doesn't recognize.
- **The sleep fade timer and the scheduled DND window only reapply on
  session start / "Re-check now",** not continuously in the background — a
  genuine always-on background loop is its own class of risk (hangs,
  battery drain, no guarantee it survives Doze).
- **Per-app mute needs Android 13+ on the target app** to be reliably
  controllable this way; older-targeting apps show as N/A.

## License

MIT — see [LICENSE](LICENSE).
