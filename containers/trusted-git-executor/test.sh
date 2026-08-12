#!/usr/bin/env bash
# Local Trusted Git Executor image + synthetic proxy checks.
set -euo pipefail

MODE="${1:-}"
IMAGE="${2:-ditto-trusted-git-executor:test}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
WORKDIR="$(mktemp -d /tmp/ditto-047-XXXXXX)"
cleanup() {
	# Best-effort container/network cleanup for proxy mode.
	if [[ -n "${PROXY_CID:-}" ]]; then docker rm -f "$PROXY_CID" >/dev/null 2>&1 || true; fi
	if [[ -n "${GIT_CID:-}" ]]; then docker rm -f "$GIT_CID" >/dev/null 2>&1 || true; fi
	if [[ -n "${NET_NAME:-}" ]]; then docker network rm "$NET_NAME" >/dev/null 2>&1 || true; fi
	# Root-owned objects may be written by the proxy container; force-remove.
	chmod -R u+w "$WORKDIR" 2>/dev/null || true
	rm -rf "$WORKDIR" 2>/dev/null || sudo rm -rf "$WORKDIR" 2>/dev/null || true
}
trap cleanup EXIT

die() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

require_image() {
	docker image inspect "$IMAGE" >/dev/null 2>&1 || die "image missing: $IMAGE"
}

json_code() {
	# Extract "code" field from helper JSON on stdout.
	printf '%s' "$1" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p' | head -1
}

json_ok() {
	printf '%s' "$1" | grep -q '"ok":true'
}

run_helper() {
	# run_helper <args...>  — stdin may be provided by caller redirect
	docker run --rm -i \
		--user 65532:65532 \
		--read-only \
		--tmpfs /var/lib/ditto-git-executor:rw,size=256m,mode=1777 \
		--network none \
		--entrypoint /usr/local/bin/ditto-git-executor \
		"$IMAGE" "$@"
}

make_repos() {
	local base="$1"
	mkdir -p "$base/src"
	git -c init.defaultBranch=main init -q "$base/src"
	git -C "$base/src" config user.email "plan047@example.com"
	git -C "$base/src" config user.name "Plan 047"
	git -C "$base/src" config commit.gpgsign false
	echo "hello" >"$base/src/README.md"
	git -C "$base/src" add README.md
	git -C "$base/src" commit -q -m "init"
	OLD_SHA="$(git -C "$base/src" rev-parse HEAD)"
	echo "world" >>"$base/src/README.md"
	git -C "$base/src" add README.md
	git -C "$base/src" commit -q -m "second"
	TIP_SHA="$(git -C "$base/src" rev-parse HEAD)"
	REF="refs/heads/main"
	# One-ref self-contained bundle from empty roots (full history).
	git -C "$base/src" bundle create "$base/valid.bundle" "$REF"
	BUNDLE_SIZE="$(wc -c <"$base/valid.bundle" | tr -d ' ')"
	BUNDLE_DIGEST="$(sha256sum "$base/valid.bundle" | awk '{print $1}')"
	# Corrupt digest fixture is the same bytes with wrong claimed digest.
	# Extra-ref bundle:
	git -C "$base/src" branch other
	git -C "$base/src" bundle create "$base/extra.bundle" "$REF" refs/heads/other
	# Non-descendant: orphan commit bundle tip that does not contain OLD as ancestor of a false claim.
	# For ancestry rejection we pass expected_old that is not in the bundle.
	FOREIGN_OLD="ffffffffffffffffffffffffffffffffffffffff"
}

test_image() {
	require_image
	# Exact git/ca and non-root.
	ver="$(docker run --rm --entrypoint /usr/bin/git "$IMAGE" version)"
	[[ "$ver" == "git version 2.49.1" ]] || die "git version: $ver"
	docker run --rm --entrypoint /bin/sh "$IMAGE" -c 'test -f /etc/ssl/certs/ca-certificates.crt' \
		|| die "ca bundle missing"
	uid="$(docker run --rm --entrypoint /bin/sh "$IMAGE" -c 'id -u')"
	[[ "$uid" == "65532" ]] || die "expected user 65532, got $uid"

	cfg="$(docker image inspect "$IMAGE" --format '{{json .Config.ExposedPorts}} {{json .Config.Volumes}}')"
	[[ "$cfg" == *"null"* ]] || [[ "$cfg" == "null null" ]] || true
	# ExposedPorts and Volumes must be null/empty.
	exp="$(docker image inspect "$IMAGE" --format '{{json .Config.ExposedPorts}}')"
	vol="$(docker image inspect "$IMAGE" --format '{{json .Config.Volumes}}')"
	[[ "$exp" == "null" ]] || die "exposed ports: $exp"
	[[ "$vol" == "null" ]] || die "volumes: $vol"

	# No Pi/Node/LFS/SSH/gh/project files.
	docker run --rm --network none --entrypoint /bin/sh "$IMAGE" -c '
		set -e
		! command -v node >/dev/null 2>&1
		! command -v npm >/dev/null 2>&1
		! command -v python3 >/dev/null 2>&1
		! command -v git-lfs >/dev/null 2>&1
		! command -v ssh >/dev/null 2>&1
		! command -v gh >/dev/null 2>&1
		! test -e /workspace
		! test -e /app
		test -x /usr/local/bin/ditto-git-executor
	' || die "image content audit failed"
	pass "image pins, user, surface"

	make_repos "$WORKDIR"
	# Valid bundle
	out="$(run_helper validate-bundle "$BUNDLE_DIGEST" "$BUNDLE_SIZE" "$REF" "$TIP_SHA" "$OLD_SHA" <"$WORKDIR/valid.bundle")"
	json_ok "$out" || die "valid bundle rejected: $out"
	[[ "$(json_code "$out")" == "ok" ]] || die "valid code: $out"
	pass "valid bundle"

	# Corrupt digest
	bad_digest="$(printf '%064d' 1)"
	set +e
	out="$(run_helper validate-bundle "$bad_digest" "$BUNDLE_SIZE" "$REF" "$TIP_SHA" "$OLD_SHA" <"$WORKDIR/valid.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "corrupt digest should fail"
	[[ "$(json_code "$out")" == "digest_mismatch" ]] || die "digest code: $out"
	pass "corrupt digest"

	# Malformed bundle
	printf 'not-a-bundle' >"$WORKDIR/bad.bundle"
	bs=$(wc -c <"$WORKDIR/bad.bundle" | tr -d ' ')
	bd=$(sha256sum "$WORKDIR/bad.bundle" | awk '{print $1}')
	set +e
	out="$(run_helper validate-bundle "$bd" "$bs" "$REF" "$TIP_SHA" "-" <"$WORKDIR/bad.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "malformed should fail"
	pass "malformed bundle"

	# Extra ref
	es=$(wc -c <"$WORKDIR/extra.bundle" | tr -d ' ')
	ed=$(sha256sum "$WORKDIR/extra.bundle" | awk '{print $1}')
	set +e
	out="$(run_helper validate-bundle "$ed" "$es" "$REF" "$TIP_SHA" "$OLD_SHA" <"$WORKDIR/extra.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "extra ref should fail"
	[[ "$(json_code "$out")" == "bundle_refs" ]] || die "extra ref code: $out"
	pass "extra ref"

	# Non-descendant / foreign old
	set +e
	out="$(run_helper validate-bundle "$BUNDLE_DIGEST" "$BUNDLE_SIZE" "$REF" "$TIP_SHA" "$FOREIGN_OLD" <"$WORKDIR/valid.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "foreign old should fail"
	pass "non-descendant/foreign old"

	# Invalid ref
	set +e
	out="$(run_helper validate-bundle "$BUNDLE_DIGEST" "$BUNDLE_SIZE" "refs/tags/v1" "$TIP_SHA" "-" <"$WORKDIR/valid.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "tag ref should fail"
	pass "invalid ref"

	# Oversize claimed size with short body still mismatches size
	set +e
	out="$(run_helper validate-bundle "$BUNDLE_DIGEST" "999999999" "$REF" "$TIP_SHA" "-" <"$WORKDIR/valid.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "oversize should fail"
	pass "oversize claim"

	# Unknown subcommand
	set +e
	out="$(run_helper totally-unknown 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "unknown should fail"
	[[ "$(json_code "$out")" == "unknown_command" ]] || die "unknown code: $out"
	pass "unknown subcommand"

	# Symlink/path escape arity rejection for push without quarantine
	set +e
	out="$(run_helper push-validated '../x' 'repo' "$REF" "$TIP_SHA" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "path escape owner should fail"
	pass "path escape args"

	# Canary-negative on empty state (canary via stdin, not argv)
	CANARY='ghs_CANARYTOKEN_plan047_do_not_leak_0123456789abcdef'
	out="$(printf '%s' "$CANARY" | run_helper scan-canary)"
	json_ok "$out" || die "canary scan failed: $out"
	# Ensure helper stdout did not echo canary
	printf '%s' "$out" | grep -F -q "$CANARY" && die "canary echoed on stdout"
	pass "canary-negative"

	# Env must not contain credential-like values in image config
	envjson="$(docker image inspect "$IMAGE" --format '{{json .Config.Env}}')"
	printf '%s' "$envjson" | grep -Eiq 'gh[pousr]_|x-access-token|PRIVATE|TOKEN|SECRET' \
		&& die "credential-like image env" || true
	pass "image env clean"
}

# --- Synthetic smart-HTTP proxy mode ---
# Host-side Python proxy injects credentials upstream; container git has none.

start_proxy_fixture() {
	NET_NAME="ditto047net_$RANDOM"
	docker network create "$NET_NAME" >/dev/null

	# Bare repo served via git http-backend behind a tiny python proxy.
	mkdir -p "$WORKDIR/remote.git"
	git init -q --bare "$WORKDIR/remote.git"
	git --git-dir="$WORKDIR/remote.git" config http.receivepack true
	git -C "$WORKDIR/src" push "$WORKDIR/remote.git" main:main >/dev/null

	# Upstream "github" stand-in: nginx not required; use git-http-backend via python.
	# Credential canary used only inside host proxy when forwarding.
	CANARY_TOKEN='ghs_CANARYTOKEN_plan047_proxy_only_0123456789abcdef'
	printf '%s' "$CANARY_TOKEN" >"$WORKDIR/canary.token"
	chmod 600 "$WORKDIR/canary.token"

	cat >"$WORKDIR/proxy.py" <<'PY'
#!/usr/bin/env python3
"""Host-side smart-HTTP proxy: inject Basic auth only on upstream hop."""
from __future__ import annotations

import base64
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO_ROOT = os.environ["REPO_ROOT"]
CANARY = open(os.environ["CANARY_FILE"], "r", encoding="utf-8").read().strip()
ALLOWED_OWNER = os.environ.get("ALLOWED_OWNER", "acme")
ALLOWED_REPO = os.environ.get("ALLOWED_REPO", "widget")
PHASE = os.environ.get("PHASE", "read")  # read | write | deny
LOG_PATH = os.environ.get("REQ_LOG", "/tmp/req.log")

def log_req(method: str, path: str, query: str, ctype: str) -> None:
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(f"{method} {path}?{query} ctype={ctype}\n")

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # quiet
        return

    def _deny(self, code: int = 403, msg: str = b"denied") -> None:
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(msg)))
        self.end_headers()
        self.wfile.write(msg)

    def _match(self) -> tuple[str, str, str] | None:
        # Expect /OWNER/REPO.git/...
        m = re.match(r"^/([^/]+)/([^/]+)\.git(/.*)?$", self.path.split("?", 1)[0])
        if not m:
            return None
        return m.group(1), m.group(2), m.group(3) or ""

    def _phase_allows(self, service: str, is_rpc: bool) -> bool:
        if PHASE == "deny":
            return False
        if PHASE == "read":
            return service == "git-upload-pack"
        if PHASE == "write":
            return service == "git-receive-pack"
        return False

    def do_GET(self) -> None:  # noqa: N802
        self._handle(False)

    def do_POST(self) -> None:  # noqa: N802
        self._handle(True)

    def _handle(self, is_post: bool) -> None:
        parsed = self._match()
        if not parsed:
            return self._deny(404, b"not found")
        owner, repo, sub = parsed
        if owner != ALLOWED_OWNER or repo != ALLOWED_REPO:
            return self._deny(404, b"repo")
        qs = ""
        if "?" in self.path:
            qs = self.path.split("?", 1)[1]
        ctype = self.headers.get("Content-Type", "")
        log_req(self.command, f"/{owner}/{repo}.git{sub}", qs, ctype)

        # Reject inbound credentials/cookies from client.
        if self.headers.get("Authorization") or self.headers.get("Cookie"):
            return self._deny(400, b"inbound auth")

        service = None
        if sub == "/info/refs":
            if is_post:
                return self._deny(405, b"method")
            if qs != "service=git-upload-pack" and qs != "service=git-receive-pack":
                return self._deny(403, b"query")
            service = qs.split("=", 1)[1]
            if not self._phase_allows(service, False):
                return self._deny(403, b"phase")
        elif sub == "/git-upload-pack":
            if not is_post or ctype != "application/x-git-upload-pack-request":
                return self._deny(403, b"shape")
            service = "git-upload-pack"
            if not self._phase_allows(service, True):
                return self._deny(403, b"phase")
        elif sub == "/git-receive-pack":
            if not is_post or ctype != "application/x-git-receive-pack-request":
                return self._deny(403, b"shape")
            service = "git-receive-pack"
            if not self._phase_allows(service, True):
                return self._deny(403, b"phase")
        else:
            return self._deny(403, b"path")

        # Forward to local git http-backend with injected auth header only here.
        try:
            open(os.path.join(REPO_ROOT, "git-daemon-export-ok"), "a").close()
        except OSError:
            pass
        env = os.environ.copy()
        env["GIT_PROJECT_ROOT"] = os.path.dirname(REPO_ROOT)
        env["GIT_HTTP_EXPORT_ALL"] = "1"
        env["GIT_CONFIG_COUNT"] = "1"
        env["GIT_CONFIG_KEY_0"] = "safe.directory"
        env["GIT_CONFIG_VALUE_0"] = "*"
        env["PATH_INFO"] = f"/{os.path.basename(REPO_ROOT)}{sub}"
        env["REQUEST_METHOD"] = self.command
        env["QUERY_STRING"] = qs
        env["CONTENT_TYPE"] = ctype
        env["GATEWAY_INTERFACE"] = "CGI/1.1"
        env["SERVER_PROTOCOL"] = "HTTP/1.1"
        env["REMOTE_ADDR"] = "127.0.0.1"
        body = b""
        if is_post:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            env["CONTENT_LENGTH"] = str(len(body))
        # Prove canary exists only in this host process environment for upstream.
        env["HTTP_AUTHORIZATION"] = "Basic " + base64.b64encode(
            f"x-access-token:{CANARY}".encode()
        ).decode()
        backend = "git"
        for cand in (
            "/usr/libexec/git-core/git-http-backend",
            "/usr/lib/git-core/git-http-backend",
        ):
            if os.path.isfile(cand):
                backend = cand
                break
        cmd = [backend] if backend != "git" else ["git", "http-backend"]
        try:
            proc = subprocess.run(
                cmd,
                input=body,
                capture_output=True,
                env=env,
                check=False,
            )
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).encode()[:200]
            return self._deny(500, b"backend spawn: " + msg)
        raw = proc.stdout
        if not raw:
            err = (proc.stderr or b"empty")[:300]
            return self._deny(500, b"backend empty: " + err)
        # CGI headers then body
        if b"\r\n\r\n" in raw:
            header_blob, resp_body = raw.split(b"\r\n\r\n", 1)
        elif b"\n\n" in raw:
            header_blob, resp_body = raw.split(b"\n\n", 1)
        else:
            header_blob, resp_body = b"Status: 500\n", raw
        status = 200
        headers: list[tuple[str, str]] = []
        for line in header_blob.replace(b"\r\n", b"\n").split(b"\n"):
            if not line or b":" not in line:
                if line.lower().startswith(b"status:"):
                    try:
                        status = int(line.split(b":", 1)[1].strip().split()[0])
                    except Exception:
                        status = 500
                continue
            k, v = line.split(b":", 1)
            key = k.decode()
            if key.lower() == "status":
                try:
                    status = int(v.strip().split()[0])
                except Exception:
                    status = 500
                continue
            headers.append((key, v.strip().decode()))
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(resp_body)))
        self.end_headers()
        self.wfile.write(resp_body)

def main() -> None:
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.serve_forever()

if __name__ == "__main__":
    main()
PY

	# Run proxy on host network namespace via docker with volume mounts.
	# Use python image sharing the custom network; map repo + script.
	PROXY_CID="$(docker run -d --rm \
		--name "ditto047proxy_$RANDOM" \
		--network "$NET_NAME" \
		-e REPO_ROOT=/git/remote.git \
		-e CANARY_FILE=/secret/canary.token \
		-e REQ_LOG=/tmp/req.log \
		-e PHASE=read \
		-e ALLOWED_OWNER=acme \
		-e ALLOWED_REPO=widget \
		-e PORT=8080 \
		-v "$WORKDIR/remote.git:/git/remote.git" \
		-v "$WORKDIR/proxy.py:/proxy.py:ro" \
		-v "$WORKDIR/canary.token:/secret/canary.token:ro" \
		python:3.12-alpine \
		sh -c 'apk add --no-cache git git-daemon >/dev/null && python /proxy.py')"
	# Wait for proxy
	for _ in $(seq 1 30); do
		if docker exec "$PROXY_CID" wget -q -O- http://127.0.0.1:8080/ >/dev/null 2>&1; then
			break
		fi
		# 404 is fine — server is up
		if docker exec "$PROXY_CID" sh -c 'wget -q -O- http://127.0.0.1:8080/ 2>&1 | grep -q denied\|not' ; then
			break
		fi
		sleep 0.5
	done
	PROXY_HOST="$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$PROXY_CID")"
	[[ -n "$PROXY_HOST" ]] || die "proxy ip missing"
}

test_proxy() {
	require_image
	make_repos "$WORKDIR"
	start_proxy_fixture

	# Point git at http://proxy/acme/widget.git by rewriting github.com via
	# a custom network alias is hard; instead exec helper with GIT config URL rewrite
	# is forbidden by sealed env. So invoke stock git inside image with explicit URL
	# to the proxy host — the Worker normally uses github.com via interception.
	# Here we only prove request shapes + credential absence for the helper path
	# by running git with the sealed env against the synthetic proxy URL.

	# Build a one-shot runner that uses the same sealed env as the helper.
	read_out="$(docker run --rm \
		--user 65532:65532 \
		--network "$NET_NAME" \
		--entrypoint /bin/sh \
		"$IMAGE" -c "
set -e
mkdir -p /tmp/home /tmp/hooks
: >/tmp/home/.gitconfig-empty
export HOME=/tmp/home
export GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/tmp/home/.gitconfig-empty
export GIT_CONFIG_COUNT=6
export GIT_CONFIG_KEY_0=protocol.allow
export GIT_CONFIG_VALUE_0=never
export GIT_CONFIG_KEY_1=protocol.http.allow
export GIT_CONFIG_VALUE_1=always
export GIT_CONFIG_KEY_2=protocol.https.allow
export GIT_CONFIG_VALUE_2=always
export GIT_CONFIG_KEY_3=core.hooksPath
export GIT_CONFIG_VALUE_3=/tmp/hooks
export GIT_CONFIG_KEY_4=credential.helper
export GIT_CONFIG_VALUE_4=
export GIT_CONFIG_KEY_5=core.askPass
export GIT_CONFIG_VALUE_5=
# Phase read: ls-remote
git ls-remote --heads http://${PROXY_HOST}:8080/acme/widget.git refs/heads/main
")"
	echo "$read_out" | grep -Eq '^[0-9a-f]{40}[[:space:]]+refs/heads/main$' || die "ls-remote failed: $read_out"
	pass "synthetic read ls-remote"

	# Ensure canary not in container process/files via helper scan against running... 
	# scan in a fresh container with network none:
	CANARY_TOKEN="$(cat "$WORKDIR/canary.token")"
	scan_out="$(printf '%s' "$CANARY_TOKEN" | run_helper scan-canary)"
	json_ok "$scan_out" || die "canary present in image container: $scan_out"
	pass "credential canary absent from executor image"

	# Request log should show only expected shapes for the read.
	req_log="$(docker exec "$PROXY_CID" cat /tmp/req.log 2>/dev/null || true)"
	echo "$req_log" | grep -q 'git-upload-pack' || {
		# ls-remote uses info/refs?service=git-upload-pack
		echo "$req_log" | grep -q 'info/refs' || die "missing info/refs: $req_log"
	}
	pass "request shapes logged"

	# Phase deny: set PHASE=deny by restarting proxy env — use docker kill + new
	docker rm -f "$PROXY_CID" >/dev/null 2>&1 || true
	PROXY_CID="$(docker run -d --rm \
		--name "ditto047proxy_$RANDOM" \
		--network "$NET_NAME" \
		-e REPO_ROOT=/git/remote.git \
		-e CANARY_FILE=/secret/canary.token \
		-e REQ_LOG=/tmp/req.log \
		-e PHASE=deny \
		-e ALLOWED_OWNER=acme \
		-e ALLOWED_REPO=widget \
		-e PORT=8080 \
		-v "$WORKDIR/remote.git:/git/remote.git" \
		-v "$WORKDIR/proxy.py:/proxy.py:ro" \
		-v "$WORKDIR/canary.token:/secret/canary.token:ro" \
		python:3.12-alpine \
		sh -c 'apk add --no-cache git git-daemon >/dev/null && python /proxy.py')"
	sleep 2
	PROXY_HOST="$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$PROXY_CID")"
	set +e
	den_out="$(docker run --rm \
		--user 65532:65532 \
		--network "$NET_NAME" \
		--entrypoint /bin/sh \
		"$IMAGE" -c "
export HOME=/tmp
export GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=protocol.allow
export GIT_CONFIG_VALUE_0=never
export GIT_CONFIG_KEY_1=protocol.http.allow
export GIT_CONFIG_VALUE_1=always
git ls-remote --heads http://${PROXY_HOST}:8080/acme/widget.git refs/heads/main
" 2>&1)"
	den_rc=$?
	set -e
	[[ "$den_rc" -ne 0 ]] || die "phase deny should fail: $den_out"
	pass "phase deny"

	# Non-force write via validate+push against write-phase proxy.
	docker rm -f "$PROXY_CID" >/dev/null 2>&1 || true
	PROXY_CID="$(docker run -d --rm \
		--name "ditto047proxy_$RANDOM" \
		--network "$NET_NAME" \
		-e REPO_ROOT=/git/remote.git \
		-e CANARY_FILE=/secret/canary.token \
		-e REQ_LOG=/tmp/req.log \
		-e PHASE=write \
		-e ALLOWED_OWNER=acme \
		-e ALLOWED_REPO=widget \
		-e PORT=8080 \
		-v "$WORKDIR/remote.git:/git/remote.git" \
		-v "$WORKDIR/proxy.py:/proxy.py:ro" \
		-v "$WORKDIR/canary.token:/secret/canary.token:ro" \
		python:3.12-alpine \
		sh -c 'apk add --no-cache git git-daemon >/dev/null && python /proxy.py')"
	PROXY_HOST=""
	for _ in $(seq 1 60); do
		PROXY_HOST="$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$PROXY_CID" 2>/dev/null || true)"
		if [[ -n "$PROXY_HOST" ]] && docker exec "$PROXY_CID" wget -q -O- "http://127.0.0.1:8080/" >/dev/null 2>&1; then
			break
		fi
		# 403/404 still means server is up
		if [[ -n "$PROXY_HOST" ]] && docker exec "$PROXY_CID" sh -c 'wget -q -O- http://127.0.0.1:8080/ 2>&1 | grep -Eq "denied|not found|phase"'; then
			break
		fi
		sleep 0.5
	done
	[[ -n "$PROXY_HOST" ]] || die "write proxy did not become ready"

	# Create a third commit bundle and push via sealed git push to proxy.
	echo "third" >>"$WORKDIR/src/README.md"
	git -C "$WORKDIR/src" add README.md
	git -C "$WORKDIR/src" commit -q -m "third"
	NEW_TIP="$(git -C "$WORKDIR/src" rev-parse HEAD)"
	git -C "$WORKDIR/src" bundle create "$WORKDIR/write.bundle" "$REF"
	cat >"$WORKDIR/write-push.sh" <<EOF
#!/bin/sh
set -eu
mkdir -p /tmp/home /tmp/hooks /tmp/q
: >/tmp/home/.gitconfig-empty
export HOME=/tmp/home
export GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/tmp/home/.gitconfig-empty
export GIT_CONFIG_COUNT=7
export GIT_CONFIG_KEY_0=protocol.allow
export GIT_CONFIG_VALUE_0=never
export GIT_CONFIG_KEY_1=protocol.http.allow
export GIT_CONFIG_VALUE_1=always
export GIT_CONFIG_KEY_2=protocol.https.allow
export GIT_CONFIG_VALUE_2=always
export GIT_CONFIG_KEY_3=protocol.file.allow
export GIT_CONFIG_VALUE_3=always
export GIT_CONFIG_KEY_4=core.hooksPath
export GIT_CONFIG_VALUE_4=/tmp/hooks
export GIT_CONFIG_KEY_5=credential.helper
export GIT_CONFIG_VALUE_5=
export GIT_CONFIG_KEY_6=core.askPass
export GIT_CONFIG_VALUE_6=
git -c init.templateDir= init --bare /tmp/q
git --git-dir=/tmp/q fetch --no-tags /tmp/write.bundle 'refs/heads/*:refs/heads/*'
git -c protocol.file.allow=never --git-dir=/tmp/q push --no-tags \
	"http://${PROXY_HOST}:8080/acme/widget.git" "${NEW_TIP}:refs/heads/main"
EOF
	write_out="$(docker run --rm \
		--user 65532:65532 \
		--network "$NET_NAME" \
		-v "$WORKDIR/write.bundle:/tmp/write.bundle:ro" \
		-v "$WORKDIR/write-push.sh:/tmp/write-push.sh:ro" \
		--entrypoint /bin/sh \
		"$IMAGE" /tmp/write-push.sh)"
	# Verify remote advanced
	remote_tip="$(git --git-dir="$WORKDIR/remote.git" rev-parse refs/heads/main)"
	[[ "$remote_tip" == "$NEW_TIP" ]] || die "remote tip $remote_tip != $NEW_TIP"
	pass "synthetic non-force write"

	# Cleanup proof
	docker rm -f "$PROXY_CID" >/dev/null 2>&1 || true
	PROXY_CID=""
	docker network rm "$NET_NAME" >/dev/null 2>&1 || true
	NET_NAME=""
	pass "proxy fixture cleanup"
}

case "$MODE" in
image)
	test_image
	echo "ALL image checks passed"
	;;
proxy)
	test_proxy
	echo "ALL proxy checks passed"
	;;
*)
	echo "Usage: $0 image|proxy [image-tag]" >&2
	exit 2
	;;
esac
