#!/system/bin/sh
# VOID//PULSE — reapplies the saved profile on boot/session start.
# One-shot, not a persistent loop (same reasoning as void-silence's
# schedule catch-up: a long-running background poller is its own class
# of risk — hangs, battery drain, no guarantee it survives Doze).
DIR="$(dirname "$0")"
. "$DIR/lib.sh"

pulse_init_dirs
pulse_log "service.sh: session start catch-up"

STATE="$PULSE_HOME/state.json"
if [ -f "$STATE" ]; then
  get_field() {
    # tiny POSIX JSON scalar reader for flat "key": value fields — good
    # enough for our own state file, not a general JSON parser
    grep -o "\"$1\"[^,}]*" "$STATE" | sed -E 's/.*: *"?([^",}]*)"?/\1/' | head -n1
  }
  mono="$(get_field mono)"
  balance="$(get_field balance)"
  autoApply="$(get_field autoApplyOnBoot)"
  if [ "$autoApply" = "true" ]; then
    [ -n "$mono" ] && pulse_set_mono "$mono"
    [ -n "$balance" ] && pulse_set_balance "$balance"
    pulse_log "reapplied mono=$mono balance=$balance"
  else
    pulse_log "autoApplyOnBoot disabled, skipped"
  fi
else
  pulse_log "no saved sound state, nothing to reapply"
fi

# --- DND schedule catch-up ------------------------------------------------
# Same one-shot reasoning as above: if a schedule is armed and "now" falls
# inside its window, apply it immediately. The WebUI's "Re-check now"
# button re-runs this exact same logic on demand.
if [ -f "$SCHEDULE_FILE" ]; then
  sjson="$(cat "$SCHEDULE_FILE" 2>/dev/null)"
  sfield() { printf '%s' "$sjson" | sed -n "s/.*\"$1\":\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/p" | head -n1; }
  s_enabled="$(sfield enabled)"
  if [ "$s_enabled" = "true" ]; then
    s_start="$(sfield start)"; s_end="$(sfield end)"; s_zen="$(sfield zen)"
    now_min=$(( $(date +%H) * 60 + $(date +%M) ))
    start_min=$(( $(printf '%s' "$s_start" | cut -d: -f1) * 60 + $(printf '%s' "$s_start" | cut -d: -f2) ))
    end_min=$(( $(printf '%s' "$s_end" | cut -d: -f1) * 60 + $(printf '%s' "$s_end" | cut -d: -f2) ))
    in_window=0
    if [ "$start_min" -le "$end_min" ]; then
      [ "$now_min" -ge "$start_min" ] && [ "$now_min" -lt "$end_min" ] && in_window=1
    else
      { [ "$now_min" -ge "$start_min" ] || [ "$now_min" -lt "$end_min" ]; } && in_window=1
    fi
    if [ "$in_window" = "1" ]; then
      settings put global zen_mode "$s_zen"
      pulse_log "schedule: in window ($s_start-$s_end), applied zen_mode=$s_zen"
    else
      pulse_log "schedule: outside window ($s_start-$s_end), left zen_mode untouched"
    fi
  else
    pulse_log "schedule present but disabled, skipped"
  fi
fi
