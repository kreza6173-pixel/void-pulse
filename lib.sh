#!/system/bin/sh
# VOID//PULSE — shared shell helpers (POSIX sh, no bash-only syntax)

PULSE_HOME="/data/local/tmp/void-pulse"
PULSE_LOG="$PULSE_HOME/logs/pulse.log"
PULSE_STATE="$PULSE_HOME/state.json"
PULSE_PROFILES="$PULSE_HOME/profiles"
PULSE_EXPORT_DIR="/storage/emulated/0/Download/VOID-PULSE"
SCHEDULE_FILE="/data/local/tmp/.void-pulse-schedule.json"

# Packages this module will never touch, regardless of what the caller
# passes in — matches the same defensive list used across the other
# void-/cyber- modules.
PROTECTED_PACKAGES="android com.android.systemui com.android.settings com.google.android.gms com.hamondev.shevery moe.shizuku.privileged.api"

pulse_is_protected() {
  pkg="$1"
  for p in $PROTECTED_PACKAGES; do
    [ "$pkg" = "$p" ] && return 0
  done
  return 1
}

pulse_init_dirs() {
  mkdir -p "$PULSE_HOME/logs" "$PULSE_PROFILES" 2>/dev/null
  [ -d "$PULSE_EXPORT_DIR" ] || mkdir -p "$PULSE_EXPORT_DIR" 2>/dev/null
}

pulse_log() {
  pulse_init_dirs
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $1" >> "$PULSE_LOG" 2>/dev/null
}

# --- capability detection -------------------------------------------------
# The shell bridge already runs as whatever identity Shizuku was granted:
# root (uid 0) if the user started Shizuku with root, otherwise the ADB
# shell UID. We detect which one we ARE, rather than trying to elevate.

pulse_is_root() {
  uid="$(id -u 2>/dev/null)"
  [ "$uid" = "0" ]
}

pulse_tier() {
  if pulse_is_root; then
    echo "root"
  else
    echo "shell"
  fi
}

pulse_detect_jamesdsp() {
  pkg="$(pm list packages 2>/dev/null | grep -i jamesdsp | head -n1 | sed 's/^package://')"
  if [ -n "$pkg" ]; then
    echo "$pkg"
  else
    echo ""
  fi
}

# Best-effort probe of OEM sound-related settings keys. Read-only listing —
# callers decide what (if anything) is safe to write.
pulse_scan_audio_keys() {
  for ns in system secure global; do
    settings list "$ns" 2>/dev/null | grep -iE 'dolby|atmos|equal|_eq_|sound_effect|audio_effect|tone_control|bass_boost|adapt_sound|uhq|mi_sound|listen' \
      | while IFS= read -r line; do
          echo "$ns|$line"
        done
  done
}

# --- validation --------------------------------------------------------
pulse_is_int() {
  case "$1" in
    ''|*[!0-9-]*) return 1 ;;
    *) return 0 ;;
  esac
}

pulse_int_in_range() {
  val="$1"; min="$2"; max="$3"
  pulse_is_int "$val" || return 1
  [ "$val" -ge "$min" ] && [ "$val" -le "$max" ]
}

# --- safe, well-documented setting writers ------------------------------
# Every one of these maps to a single, publicly documented Android shell
# primitive. No raw/arbitrary settings key is ever accepted from the UI —
# only these fixed calls with a range-validated argument.

pulse_set_stream_volume() {
  # $1 = AudioManager stream index (0=call,1=system,2=ring,3=music,4=alarm,5=notification)
  # $2 = target volume index
  stream="$1"; level="$2"
  pulse_int_in_range "$stream" 0 5 || { pulse_log "reject volume stream=$stream"; return 1; }
  pulse_int_in_range "$level" 0 25 || { pulse_log "reject volume level=$level"; return 1; }
  media volume --stream "$stream" --set "$level" --show 1>>"$PULSE_LOG" 2>&1
  pulse_log "set stream=$stream volume=$level"
}

pulse_set_mono() {
  # $1 = 1 or 0
  [ "$1" = "1" ] || [ "$1" = "0" ] || { pulse_log "reject mono=$1"; return 1; }
  settings put system master_mono "$1"
  pulse_log "set master_mono=$1"
}

pulse_set_balance() {
  # $1 = float -1.0 .. 1.0, one decimal step (validated in the UI; here we
  # just guard against anything that isn't a plausible number string)
  case "$1" in
    -1.0|-0.[0-9]|0.0|0.[0-9]|1.0) : ;;
    *) pulse_log "reject balance=$1"; return 1 ;;
  esac
  settings put system master_balance "$1"
  pulse_log "set master_balance=$1"
}

pulse_set_safe_volume_bypass() {
  # $1 = 1 (bypass) or 0 (restore protection). Requires explicit UI confirm.
  [ "$1" = "1" ] || [ "$1" = "0" ] || return 1
  if [ "$1" = "1" ]; then
    settings put global audio_safe_volume_state 3
  else
    settings put global audio_safe_volume_state 1
  fi
  pulse_log "set safe_volume_bypass=$1"
}

pulse_current_volumes() {
  for s in 0 1 2 3 4 5; do
    idx="$(media volume --stream "$s" --get 2>/dev/null | grep -o '[0-9]*' | tail -n1)"
    echo "$s:$idx"
  done
}

# --- profile persistence -------------------------------------------------
pulse_save_active_profile() {
  # $1 = raw JSON text, already built/validated by script.js
  pulse_init_dirs
  printf '%s' "$1" > "$PULSE_HOME/active.json"
  pulse_log "saved active profile"
}
