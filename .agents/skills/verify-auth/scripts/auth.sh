#!/usr/bin/env bash
# Launch, inspect, drive and tear down the isolated auth stage that verify-auth drives.
#
#   auth.sh up              fresh D1 + fake GitHub/Google/Resend + the real Worker on $VERIFY_AUTH_PORT (default 1339)
#   auth.sh doctor          read-only: is the stage ours, migrated, wired to the fakes, and can a browser launch?
#   auth.sh check [args]    run auth-check.mjs against it (args pass through: --only id,id  --headed  --list)
#   auth.sh sql '<select>'  read-only query against the stage's D1
#   auth.sh down            stop only what `up` started and delete the stage's D1; evidence is kept
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
port="${VERIFY_AUTH_PORT:-1339}"
app="http://localhost:$port"
root="$repo/.scratch/verify-auth"
stage="$root/stage-$port"
mkdir -p "$stage"

listener_pid() { ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2; }
# Alchemy and workerd put their children in new process groups, so ownership
# and teardown follow the process tree from the pid that `up` recorded.
tree() { local p; echo "$1"; for p in $(ps -o pid= --ppid "$1" 2>/dev/null); do tree "$p"; done; }
alive() { [[ -f "$1" ]] && ps -p "$(cat "$1")" >/dev/null 2>&1; }
ours() {
	local pid; pid="$(listener_pid)"
	[[ -n "$pid" ]] && alive "$stage/stage.pid" && tree "$(cat "$stage/stage.pid")" | grep -x "$pid" >/dev/null
}
upstream_url() { cat "$stage/upstream.url" 2>/dev/null; }
d1_file() { find "$stage/.alchemy/local/d1" -name '*.sqlite' ! -name metadata.sqlite 2>/dev/null | head -1; }
signed_out() { [[ "$(curl -sf "$app/api/auth/get-session")" == "null" ]]; }

stop_tree() {
	local file="$1" root pids
	[[ -f "$file" ]] || return 0
	root="$(cat "$file")"
	pids="$(tree "$root" | xargs)"
	[[ -n "$pids" ]] && kill -TERM $pids 2>/dev/null || true
	for _ in $(seq 1 20); do
		ps -p "${pids// /,}" >/dev/null 2>&1 || break
		sleep 0.5
	done
	kill -KILL $pids 2>/dev/null || true
	rm -f "$file"
	echo "stopped $(basename "$file" .pid) (pids $pids)"
}

cmd_up() {
	if ours && alive "$stage/upstream.pid"; then echo "already up: $app (upstream $(upstream_url))"; return; fi
	if [[ -n "$(listener_pid)" ]]; then
		echo "port $port is held by pid $(listener_pid), which auth.sh did not start. Set VERIFY_AUTH_PORT to a free port." >&2
		exit 1
	fi
	# A half-started earlier run: clear it so the D1 starts empty.
	stop_tree "$stage/stage.pid" >/dev/null
	stop_tree "$stage/upstream.pid" >/dev/null
	rm -rf "$stage/.alchemy" "$stage/upstream.url"

	(cd "$repo" && exec setsid node "$here/upstream.ts") >"$stage/upstream.log" 2>&1 &
	echo "$!" >"$stage/upstream.pid"
	for _ in $(seq 1 20); do
		grep -q '^upstream: ' "$stage/upstream.log" 2>/dev/null && break
		sleep 0.25
	done
	local upstream; upstream="$(sed -n 's/^upstream: //p' "$stage/upstream.log")"
	if [[ -z "$upstream" ]]; then echo "fake upstream did not start:" >&2; cat "$stage/upstream.log" >&2; cmd_down; exit 1; fi
	echo "$upstream" >"$stage/upstream.url"

	# Alchemy keeps state and the local D1 under the cwd's .alchemy, so this stage
	# shares nothing with `vp run dev` or the auth test suite. Only the `test`
	# stage binds the knobs that point the Worker at the fakes.
	(
		cd "$stage" && exec env CI=true \
			BETTER_AUTH_URL="$app" \
			BETTER_AUTH_SECRET="verify-auth-only-secret-not-for-any-real-stage" \
			COOKIE_ENCRYPTION_KEY=verify-auth-only-key COMPUTER_IDLE_SECONDS=300 \
			GITHUB_CLIENT_ID=test-github-client GITHUB_CLIENT_SECRET=test-github-secret \
			GOOGLE_CLIENT_ID=test-google-client GOOGLE_CLIENT_SECRET=test-google-secret \
			OAUTH_UPSTREAM="$upstream" \
			RESEND_API_KEY=re_test RESEND_FROM="Ditto <sign-in@test.example>" RESEND_BASE_URL="$upstream/resend" \
			SESSION_EXPIRES_IN="${VERIFY_AUTH_SESSION_EXPIRES_IN:-30}" \
			CODE_EXPIRES_IN="${VERIFY_AUTH_CODE_EXPIRES_IN:-10}" \
			CODE_RESEND_IN="${VERIFY_AUTH_CODE_RESEND_IN:-3}" \
			setsid "$repo/node_modules/.bin/alchemy" dev --stage test --no-input --env-file /dev/null --config "$repo/alchemy.run.ts"
	) >"$stage/stage.log" 2>&1 &
	echo "$!" >"$stage/stage.pid"

	for _ in $(seq 1 180); do
		if curl -sf "$app/sign-in" | grep -q 'Sign in to Ditto' && signed_out && [[ -n "$(d1_file)" ]]; then
			echo "up: $app (upstream $upstream, d1 $(d1_file), log $stage/stage.log)"
			return
		fi
		if ! alive "$stage/stage.pid"; then break; fi
		sleep 1
	done
	echo "stage did not become usable; log:" >&2
	tail -30 "$stage/stage.log" >&2
	cmd_down
	exit 1
}

cmd_doctor() {
	local fail=0
	ok() { echo "ok    $1"; }
	bad() { echo "FAIL  $1"; fail=1; }
	note() { echo "note  $1"; }
	if ours; then ok "Worker on :$port started by auth.sh (pid $(cat "$stage/stage.pid"))"; else bad "no auth.sh stage on :$port (run: auth.sh up)"; fi
	if alive "$stage/upstream.pid"; then ok "fake upstream at $(upstream_url) started by auth.sh"; else bad "fake upstream not running (run: auth.sh down && auth.sh up)"; fi
	if [[ "$(curl -sf "$(upstream_url)/__emails?to=doctor@example.com" 2>/dev/null)" == "[]" ]]; then ok "fake Resend inbox answers"; else bad "fake Resend inbox does not answer"; fi
	if curl -sf "$app/sign-in" | grep -q 'Sign in to Ditto'; then ok "/sign-in server-renders 'Sign in to Ditto'"; else bad "/sign-in does not render"; fi
	if signed_out; then ok "/api/auth/get-session answers null (auth handler + D1 reachable)"; else bad "/api/auth/get-session did not answer null"; fi
	local loc; loc="$(curl -s -o /dev/null -w '%{redirect_url}' "$app/settings")"
	if [[ "$loc" == */sign-in ]]; then ok "/settings redirects a signed-out visitor to /sign-in"; else bad "/settings redirect went to '$loc'"; fi
	local db; db="$(d1_file)"
	if [[ -n "$db" ]]; then
		local tables; tables="$(sqlite3 -readonly "$db" "select group_concat(name, ' ') from (select name from sqlite_master where type='table' and name in ('user','account','session','verification','rate_limit') order by name)")"
		if [[ "$tables" == "account rate_limit session user verification" ]]; then ok "D1 migrated: $tables"; else bad "D1 tables: '$tables'"; fi
		note "D1 holds $(sqlite3 -readonly "$db" 'select count(*) from user') users from earlier checks in this stage"
	else
		bad "no local D1 under $stage/.alchemy"
	fi
	local major; major="$(node -p 'process.versions.node.split(".")[0]')"
	if (( major >= 24 )); then ok "node $(node -v) (strips TS types, has node:sqlite)"; else bad "node $(node -v) is older than 24"; fi
	local chrome; chrome="$(cd "$repo/apps/web" && node -e "const p=require('playwright').chromium.executablePath();console.log(require('fs').existsSync(p)?p:'')" 2>/dev/null || true)"
	if [[ -n "$chrome" ]]; then ok "chromium: $chrome"; else bad "Playwright's Chromium is missing (run: pnpm -C apps/web exec playwright install chromium)"; fi
	local rev; rev="$(git -C "$repo" rev-parse --short HEAD)"
	if git -C "$repo" diff --quiet HEAD -- apps/web/src alchemy.run.ts apps/web/drizzle; then
		ok "HEAD $rev; apps/web/src, drizzle and alchemy.run.ts unmodified"
	else
		note "HEAD $rev; app sources have uncommitted edits (the stage serves the working tree, with HMR)"
	fi
	return $fail
}

cmd_down() {
	stop_tree "$stage/stage.pid"
	stop_tree "$stage/upstream.pid"
	rm -rf "$stage"
	echo "down: :$port stopped, stage D1 removed; evidence kept in $root/runs"
}

case "${1:-}" in
	up) cmd_up ;;
	doctor) cmd_doctor ;;
	check)
		shift
		VERIFY_AUTH_URL="$app" VERIFY_AUTH_UPSTREAM="$(upstream_url)" VERIFY_AUTH_D1="$(d1_file)" \
			VERIFY_AUTH_SESSION_EXPIRES_IN="${VERIFY_AUTH_SESSION_EXPIRES_IN:-30}" \
			VERIFY_AUTH_CODE_EXPIRES_IN="${VERIFY_AUTH_CODE_EXPIRES_IN:-10}" \
			VERIFY_AUTH_CODE_RESEND_IN="${VERIFY_AUTH_CODE_RESEND_IN:-3}" \
			node "$here/auth-check.mjs" "$@"
		;;
	sql) shift; sqlite3 -readonly -header -column "$(d1_file)" "$1" ;;
	down) cmd_down ;;
	*) sed -n '2,9p' "$0"; exit 2 ;;
esac
