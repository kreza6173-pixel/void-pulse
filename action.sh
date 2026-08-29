#!/system/bin/sh
# void-silence — Action button summary.
# Read-only: prints current state, changes nothing.

DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/lib.sh"

zen="$(settings get global zen_mode 2>/dev/null)"
case "$zen" in
  0) zen_label="Off" ;;
  1) zen_label="Priority only" ;;
  2) zen_label="Total silence" ;;
  3) zen_label="Alarms only" ;;
  *) zen_label="Unknown ($zen)" ;;
esac

heads_up="$(settings get global heads_up_notifications_enabled 2>/dev/null)"
[ "$heads_up" = "1" ] && heads_up_label="On" || heads_up_label="Off"

listeners="$(settings get secure enabled_notification_listeners 2>/dev/null)"
if [ -z "$listeners" ] || [ "$listeners" = "null" ]; then
  listener_count=0
else
  listener_count="$(printf '%s' "$listeners" | tr ':' '\n' | grep -c .)"
fi

dnd_access="$(settings get secure enabled_notification_policy_access_packages 2>/dev/null)"
if [ -z "$dnd_access" ] || [ "$dnd_access" = "null" ]; then
  dnd_count=0
else
  dnd_count="$(printf '%s' "$dnd_access" | tr ',' '\n' | grep -c .)"
fi

if [ -f "$SCHEDULE_FILE" ]; then
  schedule_label="armed"
else
  schedule_label="not set"
fi

echo "DND: $zen_label  |  Heads-up: $heads_up_label"
echo "Listener access: $listener_count app(s)  |  DND access: $dnd_count app(s)"
echo "Schedule: $schedule_label"
