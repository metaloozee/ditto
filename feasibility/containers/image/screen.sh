#!/bin/sh
# One more screen for the capacity measurement (#37): its own display and its own Chrome profile,
# opening one page, with no DevTools. Usage: screen.sh <display> <url>
set -eu
display=$1
Xvfb ":$display" -screen 0 1280x800x24 -nolisten tcp &
while [ ! -e "/tmp/.X11-unix/X$display" ]; do sleep 0.1; done
exec /opt/workspace/chrome.sh "$display" "$HOME/screen-$display" "$2"
