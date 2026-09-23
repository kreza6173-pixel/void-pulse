#!/system/bin/sh
# VOID//PULSE — status summary (read-only, safe to run any time)
DIR="$(dirname "$0")"
. "$DIR/lib.sh"

echo "== VOID//PULSE status =="
echo "session tier   : $(pulse_tier)"

jd="$(pulse_detect_jamesdsp)"
if [ -n "$jd" ]; then
  echo "JamesDSP       : detected ($jd)"
else
  echo "JamesDSP       : not installed"
fi

if [ -f "$PULSE_HOME/active.json" ]; then
  echo "active profile : $(cat "$PULSE_HOME/active.json" 2>/dev/null | head -c 200)"
else
  echo "active profile : none saved yet"
fi

echo ""
echo "-- current stream volumes (stream:index) --"
pulse_current_volumes

echo ""
echo "-- detected OEM sound-related settings (informational) --"
pulse_scan_audio_keys | head -n 25

echo ""
echo "-- log tail --"
[ -f "$PULSE_LOG" ] && tail -n 15 "$PULSE_LOG" || echo "(no log yet)"
