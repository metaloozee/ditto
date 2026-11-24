#!/bin/sh
# A headed Chrome on a virtual screen, behind the workspace egress filter.
# The screen is served as VNC on :5900 and DevTools on :9223, both on the
# internal workspace network only; the viewer publishes them to the host's loopback.
set -eu

nssdb="$HOME/.pki/nssdb"
if [ ! -f "$nssdb/cert9.db" ]; then
	mkdir -p "$nssdb"
	certutil -N -d "sql:$nssdb" --empty-password
fi
# The filter makes a new CA per trial; replace whatever an earlier run trusted.
certutil -D -d "sql:$nssdb" -n "workspace egress CA" 2>/dev/null || true
certutil -A -d "sql:$nssdb" -n "workspace egress CA" -t "C,," -i /ca-public/ca.pem

export DISPLAY=:0
rm -f /tmp/.X0-lock
Xvfb :0 -screen 0 1280x800x24 -nolisten tcp &
while [ ! -e /tmp/.X11-unix/X0 ]; do sleep 0.1; done

x11vnc -display :0 -rfbport 5900 -forever -shared -nopw -quiet &
# Chrome binds DevTools to its own loopback; expose it to the workspace network.
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 &

# The profile outlives the container so a sign-in survives a restart. Only this desktop uses
# it, so a lock left by the previous container is stale.
rm -f "$HOME"/profile/Singleton*

exec chromium \
	--no-sandbox \
	--disable-dev-shm-usage \
	--disable-background-networking \
	--no-first-run \
	--no-default-browser-check \
	--proxy-server=http://filter:8080 \
	--remote-debugging-port=9222 \
	--user-data-dir="$HOME/profile" \
	--window-position=0,0 \
	--window-size=1280,800 \
	about:blank
