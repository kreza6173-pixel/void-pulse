#!/system/bin/sh
# void-silence — shared shell helpers.
# Sourced by action.sh and service.sh. The WebUI does its own quoting in
# JS (shQuote in webui/script.js) since it talks to the device directly
# through window.Shizuku.exec(), not through these files.

# Packages this module will never touch, regardless of what the caller
# passes in — matches the same defensive list used across the other
# void-/cyber- modules.
PROTECTED_PACKAGES="android com.android.systemui com.android.settings com.google.android.gms com.hamondev.shevery moe.shizuku.privileged.api"

is_protected() {
  pkg="$1"
  for p in $PROTECTED_PACKAGES; do
    [ "$pkg" = "$p" ] && return 0
  done
  return 1
}

# POSIX-sh single-quote escaping for building safe shell commands.
sh_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

SCHEDULE_FILE="/data/local/tmp/.void-silence-schedule.json"
LOG_FILE="/data/local/tmp/.void-silence.log"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE" 2>/dev/null
}
