#!/bin/sh
# One screen's Chrome, as the browser user (#37). Usage: chrome.sh <display> <profile> <url> [port]
# The first screen tries Chrome's sandbox (user namespaces, then the SUID helper from
# chromium-sandbox) and records in /run/browser/sandbox.json whether it held. Only when Chrome
# cannot start sandboxed does it fall back to --no-sandbox, and the record says why. Later screens
# follow the first screen's mode.
set -eu
display=$1
profile=$2
url=$3
port=${4:-}
state=/run/browser
export DISPLAY=":$display"

set -- \
	--disable-dev-shm-usage \
	--disable-background-networking \
	--no-first-run \
	--no-default-browser-check \
	--proxy-server=http://127.0.0.1:8080 \
	--user-data-dir="$profile" \
	--window-position=0,0 \
	--window-size=1280,800
if [ -n "$port" ]; then set -- "$@" --remote-debugging-port="$port"; fi

record() {
	/usr/local/bin/python3 -c 'import json, sys; print(json.dumps({"mode": sys.argv[1], "reason": sys.argv[2] or None}))' \
		"$1" "$2" >"$state/sandbox.json"
}

if [ "$display" != 0 ]; then
	if grep -q '"mode": "none"' "$state/sandbox.json"; then set -- --no-sandbox "$@"; fi
	exec chromium "$@" "$url"
fi

# Chrome reports its DevTools address once it is up; a Chrome that cannot sandbox exits first.
log="$state/sandboxed-start.log"
chromium "$@" "$url" 2>"$log" &
pid=$!
tries=0
while kill -0 "$pid" 2>/dev/null && ! grep -q "DevTools listening" "$log" && [ "$tries" -lt 300 ]; do
	sleep 0.1
	tries=$((tries + 1))
done
if kill -0 "$pid" 2>/dev/null; then
	record sandboxed ""
	wait "$pid"
	exit $?
fi
reason=$(grep -m1 -oE '(No usable sandbox|Failed to move to new namespace)[^.]*' "$log" || tail -n1 "$log")
record none "$reason"
exec chromium --no-sandbox "$@" "$url"
