#!/bin/sh
# The #29 desktop as the unprivileged browser user, with the filter on this instance's loopback.
# Ports the Worker reaches: 6080 noVNC (take-over view), 9223 the DevTools gate (the bot), 8081
# control. Chrome's own DevTools port, 9222, is fenced to the gate's user (#37).
set -eu

nssdb="$HOME/.pki/nssdb"
mkdir -p "$nssdb"
certutil -N -d "sql:$nssdb" --empty-password
certutil -A -d "sql:$nssdb" -n "workspace egress CA" -t "C,," -i /ca-public/ca.pem

export DISPLAY=:0
Xvfb :0 -screen 0 1280x800x24 -nolisten tcp &
while [ ! -e /tmp/.X11-unix/X0 ]; do sleep 0.1; done

x11vnc -display :0 -localhost -rfbport 5900 -forever -shared -nopw -quiet &
websockify --web /usr/share/novnc 6080 127.0.0.1:5900 >/dev/null 2>&1 &
/usr/local/bin/python3 /opt/workspace/control.py &

exec /opt/workspace/chrome.sh 0 "$HOME/profile" about:blank 9222
