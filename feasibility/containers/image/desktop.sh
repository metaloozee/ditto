#!/bin/sh
# The #29 desktop as the unprivileged browser user, with the filter on this instance's loopback.
# Ports the Worker reaches: 6080 noVNC (take-over view), 9223 DevTools (the bot), 8081 control.
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
# Chrome binds DevTools to its own loopback; the Worker reaches the instance on 9223.
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 &
/usr/local/bin/python3 /opt/workspace/control.py &

exec chromium \
	--no-sandbox \
	--disable-dev-shm-usage \
	--disable-background-networking \
	--no-first-run \
	--no-default-browser-check \
	--proxy-server=http://127.0.0.1:8080 \
	--remote-debugging-port=9222 \
	--user-data-dir="$HOME/profile" \
	--window-position=0,0 \
	--window-size=1280,800 \
	about:blank
