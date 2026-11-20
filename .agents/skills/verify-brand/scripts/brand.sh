#!/usr/bin/env bash
# Launch, inspect, check and tear down the Vite dev server that verify-brand drives.
#
#   brand.sh up       start apps/web on $VERIFY_BRAND_PORT (default 4517) and wait until /design renders the mark
#   brand.sh doctor   read-only: is the instance ours, serving the mark, and can a browser be launched?
#   brand.sh check    run brand-check.mjs against it (extra args pass through)
#   brand.sh down     stop only the server this script started; evidence is kept
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
port="${VERIFY_BRAND_PORT:-4517}"
base="http://127.0.0.1:$port"
state="$repo/.scratch/verify-brand"
pgid_file="$state/server-$port.pgid"
log="$state/server-$port.log"
mkdir -p "$state"

listener_pid() { ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2; }
pgid_of() { ps -o pgid= -p "$1" 2>/dev/null | tr -d ' '; }
ours() {
	local pid; pid="$(listener_pid)"
	[[ -n "$pid" && -f "$pgid_file" && "$(pgid_of "$pid")" == "$(cat "$pgid_file")" ]]
}
renders_mark() { local html; html="$(curl -sf "$base/design")" && [[ "$html" == *'aria-label="Ditto, feeling neutral. Change mood"'* ]]; }

cmd_up() {
	if ours; then echo "already up: $base (pgid $(cat "$pgid_file"))"; return; fi
	if [[ -n "$(listener_pid)" ]]; then
		echo "port $port is held by pid $(listener_pid), which this script did not start. Set VERIFY_BRAND_PORT to a free port." >&2
		exit 1
	fi
	(cd "$repo/apps/web" && setsid pnpm exec vp dev --port "$port" --strictPort --host 127.0.0.1 >"$log" 2>&1 &)
	for _ in $(seq 1 90); do
		if renders_mark; then
			pgid_of "$(listener_pid)" >"$pgid_file"
			echo "up: $base (pgid $(cat "$pgid_file"), log $log)"
			return
		fi
		sleep 1
	done
	echo "server did not render /design within 90s; log:" >&2
	tail -20 "$log" >&2
	exit 1
}

cmd_doctor() {
	local fail=0
	ok() { echo "ok    $1"; }
	bad() { echo "FAIL  $1"; fail=1; }
	if ours; then ok "server on :$port started by brand.sh (pgid $(cat "$pgid_file"))"; else bad "no brand.sh server on :$port (run: brand.sh up)"; fi
	if renders_mark; then ok "/design server-renders one neutral mark"; else bad "/design does not render the mark"; fi
	local n; n="$( (curl -sf "$base/design/auth" || true) | grep -o 'aria-label="Ditto, feeling' | wc -l)"
	if [[ "$n" == 8 ]]; then ok "/design/auth renders 8 marks"; else bad "/design/auth renders $n marks, expected 8"; fi
	if curl -sf -o /dev/null "$base/logo.svg"; then ok "/logo.svg served"; else bad "/logo.svg missing"; fi
	local major; major="$(node -p 'process.versions.node.split(".")[0]')"
	if (( major >= 22 )); then ok "node $(node -v) has a global WebSocket"; else bad "node $(node -v) is older than 22"; fi
	local chrome; chrome="$(node --input-type=module -e "import { findChrome } from '$here/cdp.mjs'; console.log(findChrome() ?? '')")"
	if [[ -n "$chrome" ]]; then ok "chromium: $chrome"; else bad "no chromium (set CHROME_PATH or run: npx playwright install chromium)"; fi
	if [[ -f "$here/../baseline/moods.json" ]]; then ok "mood baseline present"; else bad "mood baseline missing"; fi
	local rev; rev="$(git -C "$repo" rev-parse --short HEAD)"
	if git -C "$repo" diff --quiet HEAD -- apps/web/src/components/ditto-mark.tsx apps/web/public/logo.svg; then
		ok "HEAD $rev; ditto-mark.tsx and logo.svg unmodified"
	else
		echo "note  HEAD $rev; ditto-mark.tsx or logo.svg has uncommitted edits (the run checks the working tree)"
	fi
	return $fail
}

cmd_down() {
	if [[ ! -f "$pgid_file" ]]; then echo "nothing to stop on :$port"; return; fi
	local pgid; pgid="$(cat "$pgid_file")"
	kill -TERM -- "-$pgid" 2>/dev/null || true
	for _ in $(seq 1 10); do
		[[ -z "$(ps -o pid= -g "$pgid" 2>/dev/null)" && -z "$(listener_pid)" ]] && break
		sleep 0.5
	done
	kill -KILL -- "-$pgid" 2>/dev/null || true
	rm -f "$pgid_file"
	echo "down: stopped pgid $pgid; evidence kept in $state"
}

case "${1:-}" in
	up) cmd_up ;;
	doctor) cmd_doctor ;;
	check) shift; VERIFY_BRAND_URL="$base" node "$here/brand-check.mjs" "$@" ;;
	down) cmd_down ;;
	*) sed -n '2,8p' "$0"; exit 2 ;;
esac
