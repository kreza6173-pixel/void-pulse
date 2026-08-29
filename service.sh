#!/system/bin/sh
# void-silence — service.sh
#
# Runs once when Shevery starts this module's session (e.g. on boot).
# It does NOT run as a persistent background loop — see the "Known
# limitations" section in README.md for why: a long-lived polling loop
# from a shell module risks exactly the kind of hang/ANR that void-purge's
# README already documents avoiding. Instead, this does a one-shot
# "catch-up" check: if a schedule is armed and the current time falls
# inside its window, it applies the configured zen mode immediately.
# The WebUI also exposes a manual "Re-check schedule now" button that
# re-runs this same logic on demand.

DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/lib.sh"

[ -f "$SCHEDULE_FILE" ] || exit 0

# schedule.json shape (written by the WebUI):
# {"enabled":true,"start":"22:30","end":"07:00","zen":2}
json="$(cat "$SCHEDULE_FILE" 2>/dev/null)"

get_field() {
  # Minimal, dependency-free JSON field extractor for this module's own
  # fixed, known schedule.json shape — not a general-purpose parser.
  printf '%s' "$json" | sed -n "s/.*\"$1\":\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/p" | head -n1
}

enabled="$(get_field enabled)"
if [ "$enabled" != "true" ]; then
  log "schedule present but disabled, skipping"
  exit 0
fi

start="$(get_field start)"   # HH:MM
end="$(get_field end)"       # HH:MM
zen="$(get_field zen)"       # 0-3

now_min=$(( $(date +%H) * 60 + $(date +%M) ))
start_min=$(( $(printf '%s' "$start" | cut -d: -f1) * 60 + $(printf '%s' "$start" | cut -d: -f2) ))
end_min=$(( $(printf '%s' "$end" | cut -d: -f1) * 60 + $(printf '%s' "$end" | cut -d: -f2) ))

in_window=0
if [ "$start_min" -le "$end_min" ]; then
  [ "$now_min" -ge "$start_min" ] && [ "$now_min" -lt "$end_min" ] && in_window=1
else
  # window wraps past midnight, e.g. 22:30 -> 07:00
  { [ "$now_min" -ge "$start_min" ] || [ "$now_min" -lt "$end_min" ]; } && in_window=1
fi

if [ "$in_window" = "1" ]; then
  settings put global zen_mode "$zen"
  log "in schedule window ($start-$end), applied zen_mode=$zen"
else
  log "outside schedule window ($start-$end), left zen_mode untouched"
fi
