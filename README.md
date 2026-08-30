# VOID//SILENCE

**Notification & DND Studio** — a Shevery ADB module for controlling Do Not
Disturb, per-app notification muting, and notification-related access grants,
entirely from a WebUI. No root required.

## Features

- 🔕 **DND quick controls** — one-tap presets: Off / Priority only / Alarms
  only / Total silence, plus a heads-up (pop-up banner) toggle.
- 🔇 **Per-app notification mute** — fully block a specific app from posting
  notifications via the `POST_NOTIFICATIONS` runtime permission, without
  touching any other permission or setting for that app.
- 👁 **Notification Listener access manager** — see and revoke every app
  currently allowed to read your notifications; grant new access with an
  explicit warning, since this is a genuine privacy-sensitive permission.
- 🛎 **DND (Notification Policy) access manager** — see and control which
  apps are allowed to change Do Not Disturb state on their own.
- ⏰ **Scheduled DND window** — set a start/end time and a mode (e.g. Total
  silence 22:30–07:00); applied on boot/session start and on demand via a
  "Re-check now" button. See [Known limitations](#known-limitations) — this
  is intentionally not a persistent background timer.
- 🖥 **Console drawer** — every shell command this module runs, and its raw
  output, is visible in-app. Nothing happens off-screen.


<img width="1080" height="2400" alt="Image" src="https://github.com/user-attachments/assets/6532abb8-13f0-4b37-a262-88cc6096c53e" />
<img width="1080" height="2400" alt="Image" src="https://github.com/user-attachments/assets/23c6b319-fe7b-4183-b5a6-0e6d557422e2" />
<img width="1080" height="2400" alt="Image" src="https://github.com/user-attachments/assets/52c89639-4216-410b-9b21-ade59ee5bf37" />
<img width="1080" height="2400" alt="Image" src="https://github.com/user-attachments/assets/937d5bfa-5271-4b9c-9005-f5ccee76fe18" />

## Requirements

- [Shevery](https://github.com/HmnDev-Tech/shevery) with this module's
  access mode set to **Full**, or **Custom** with "WebUI shell bridge"
  enabled (ADB Modules → this module → access mode).
- Android 8.0+ (API 26) for DND controls and listener/DND access management.
- Android 13+ (API 33) for **per-app mute** specifically — see below.

## Install

**From a release ZIP:** ADB Modules → Import → select the ZIP.

**From source:**
```bash
git clone https://github.com/kreza6173-pixel/void-silence.git
cd void-silence
zip -r ../void-silence.zip . -x ".git/*"
```
Then import the resulting ZIP the same way.

## Architecture

```
void-silence/
├── module.prop      # Module manifest (usesShellBridge=true)
├── lib.sh            # Shared shell helpers (quoting, protected-package guard)
├── action.sh          # Read-only summary shown on the module's Action button
├── service.sh          # One-shot schedule catch-up, run on boot/session start
├── webui/
│   ├── index.html        # Quick Controls / Per-App Mute / Access / Schedule tabs
│   ├── style.css           # Dark theme, matches the VOID module series
│   └── script.js             # window.Shizuku.exec() shell bridge + all UI logic
├── LICENSE
└── README.md
```

## How it works

Every action maps to a small number of well-documented Android shell
primitives — nothing here relies on undocumented or version-fragile
behavior:

| Feature | Shell mechanism |
|---|---|
| DND mode | `settings put global zen_mode <0-3>` |
| Heads-up toggle | `settings put global heads_up_notifications_enabled <0\|1>` |
| Per-app mute | `pm revoke/grant <pkg> android.permission.POST_NOTIFICATIONS` + `cmd appops set <pkg> POST_NOTIFICATIONS <allow\|deny>` |
| Listener access | `cmd notification allow_listener` / `disallow_listener <pkg/Class>`, read from `settings get secure enabled_notification_listeners` |
| DND access | `cmd notification allow_dnd` / `disallow_dnd <pkg>`, read from `settings get secure enabled_notification_policy_access_packages` |
| Schedule | JSON file at `/data/local/tmp/.void-silence-schedule.json`, applied by `service.sh` (boot) and mirrored in `script.js` (manual re-check) |

## Safety architecture

| Guard | What it does |
|---|---|
| Protected-package list | Core system/Shizuku/Shevery packages are excluded from bulk operations (`lib.sh:PROTECTED_PACKAGES`) |
| Explicit confirmation | Muting an app, and granting listener access, require a confirm dialog explaining the effect — reversible settings (DND mode, heads-up) don't block you with a dialog |
| No hidden state | Every exec()'d command and its raw stdout/stderr is logged to the in-app console drawer |
| No persistent loop | The schedule feature deliberately avoids a long-running background poller — see below |

## Known limitations

- **Per-app mute needs API 33+.** `POST_NOTIFICATIONS` is a runtime
  permission introduced in Android 13. Apps targeting an older API level
  don't declare it, so revoking/granting it has no effect for them — the
  scanner marks these as **N/A** rather than pretending it worked. For
  those apps, the reliable option is the system's own per-app notification
  settings screen.
- **The schedule is not a persistent timer.** It's evaluated once when
  Shevery (re)starts this module's session, and on demand when you tap
  "Re-check now." A true always-on scheduler would mean a shell loop
  running indefinitely in the background — the same category of risk
  `void-purge`'s README already documents avoiding (hangs, battery drain,
  and no clean way to guarantee the loop survives Doze). If you need DND
  to flip at an exact minute, apply it manually from Quick Controls.
- **Listener service auto-detection is best-effort.** Finding a
  `NotificationListenerService` component from `dumpsys package` output is
  a heuristic grep, not a real manifest parser. It works for most apps; if
  it comes up empty, the raw `dumpsys` output is printed to the console
  drawer so you can find the component name yourself and enter it manually.

## License

MIT — see [LICENSE](LICENSE).

