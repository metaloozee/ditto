#!/usr/bin/env bash
# Local Trusted Git Executor image + synthetic HTTPS github.com interception checks.
# Proxy mode uses the SAME executor container and the actual fixed helper surface
# (ls-remote-ref, validate-bundle, push-validated) — no arbitrary /bin/sh git bypass.
set -euo pipefail

MODE="${1:-}"
IMAGE="${2:-ditto-trusted-git-executor:test}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
WORKDIR="$(mktemp -d /tmp/ditto-047-XXXXXX)"
cleanup() {
	if [[ -n "${EXEC_CID:-}" ]]; then docker rm -f "$EXEC_CID" >/dev/null 2>&1 || true; fi
	if [[ -n "${PROXY_CID:-}" ]]; then docker rm -f "$PROXY_CID" >/dev/null 2>&1 || true; fi
	if [[ -n "${NET_NAME:-}" ]]; then docker network rm "$NET_NAME" >/dev/null 2>&1 || true; fi
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
	printf '%s' "$1" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p' | head -1
}

json_ok() {
	printf '%s' "$1" | grep -q '"ok":true'
}

run_helper() {
	docker run --rm -i \
		--user 65532:65532 \
		--read-only \
		--tmpfs /var/lib/ditto-git-executor:rw,size=256m,mode=1777 \
		--network none \
		--entrypoint /usr/local/bin/ditto-git-executor \
		"$IMAGE" "$@"
}

# Run helper inside the long-lived executor container (same container for all proxy checks).
exec_helper() {
	# stdin may be provided by caller
	docker exec -i \
		-u 65532:65532 \
		"$EXEC_CID" \
		/usr/local/bin/ditto-git-executor "$@"
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
	git -C "$base/src" bundle create "$base/valid.bundle" "$REF"
	BUNDLE_SIZE="$(wc -c <"$base/valid.bundle" | tr -d ' ')"
	BUNDLE_DIGEST="$(sha256sum "$base/valid.bundle" | awk '{print $1}')"
	git -C "$base/src" branch other
	git -C "$base/src" bundle create "$base/extra.bundle" "$REF" refs/heads/other
	FOREIGN_OLD="ffffffffffffffffffffffffffffffffffffffff"
}

test_image() {
	require_image
	ver="$(docker run --rm --entrypoint /usr/bin/git "$IMAGE" version)"
	[[ "$ver" == "git version 2.49.1" ]] || die "git version: $ver"
	docker run --rm --entrypoint /bin/sh "$IMAGE" -c 'test -f /etc/ssl/certs/ca-certificates.crt' \
		|| die "ca bundle missing"
	uid="$(docker run --rm --entrypoint /bin/sh "$IMAGE" -c 'id -u')"
	[[ "$uid" == "65532" ]] || die "expected user 65532, got $uid"

	exp="$(docker image inspect "$IMAGE" --format '{{json .Config.ExposedPorts}}')"
	vol="$(docker image inspect "$IMAGE" --format '{{json .Config.Volumes}}')"
	[[ "$exp" == "null" ]] || die "exposed ports: $exp"
	[[ "$vol" == "null" ]] || die "volumes: $vol"

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
	out="$(run_helper validate-bundle "$BUNDLE_DIGEST" "$BUNDLE_SIZE" "$REF" "$TIP_SHA" "$OLD_SHA" <"$WORKDIR/valid.bundle")"
	json_ok "$out" || die "valid bundle rejected: $out"
	[[ "$(json_code "$out")" == "ok" ]] || die "valid code: $out"
	pass "valid bundle"

	bad_digest="$(printf '%064d' 1)"
	set +e
	out="$(run_helper validate-bundle "$bad_digest" "$BUNDLE_SIZE" "$REF" "$TIP_SHA" "$OLD_SHA" <"$WORKDIR/valid.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "corrupt digest should fail"
	[[ "$(json_code "$out")" == "digest_mismatch" ]] || die "digest code: $out"
	pass "corrupt digest"

	printf 'not-a-bundle' >"$WORKDIR/bad.bundle"
	bs=$(wc -c <"$WORKDIR/bad.bundle" | tr -d ' ')
	bd=$(sha256sum "$WORKDIR/bad.bundle" | awk '{print $1}')
	set +e
	out="$(run_helper validate-bundle "$bd" "$bs" "$REF" "$TIP_SHA" "-" <"$WORKDIR/bad.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "malformed should fail"
	pass "malformed bundle"

	es=$(wc -c <"$WORKDIR/extra.bundle" | tr -d ' ')
	ed=$(sha256sum "$WORKDIR/extra.bundle" | awk '{print $1}')
	set +e
	out="$(run_helper validate-bundle "$ed" "$es" "$REF" "$TIP_SHA" "$OLD_SHA" <"$WORKDIR/extra.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "extra ref should fail"
	[[ "$(json_code "$out")" == "bundle_refs" ]] || die "extra ref code: $out"
	pass "extra ref"

	set +e
	out="$(run_helper validate-bundle "$BUNDLE_DIGEST" "$BUNDLE_SIZE" "$REF" "$TIP_SHA" "$FOREIGN_OLD" <"$WORKDIR/valid.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "foreign old should fail"
	pass "non-descendant/foreign old"

	set +e
	out="$(run_helper validate-bundle "$BUNDLE_DIGEST" "$BUNDLE_SIZE" "refs/tags/v1" "$TIP_SHA" "-" <"$WORKDIR/valid.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "tag ref should fail"
	pass "invalid ref"

	# check-ref-format: leading-dot component and .lock
	set +e
	out="$(run_helper validate-bundle "$BUNDLE_DIGEST" "$BUNDLE_SIZE" "refs/heads/.hidden" "$TIP_SHA" "-" <"$WORKDIR/valid.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "dot-leading ref should fail"
	set +e
	out="$(run_helper validate-bundle "$BUNDLE_DIGEST" "$BUNDLE_SIZE" "refs/heads/foo.lock" "$TIP_SHA" "-" <"$WORKDIR/valid.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die ".lock ref should fail"
	pass "check-ref-format restrictions"

	set +e
	out="$(run_helper validate-bundle "$BUNDLE_DIGEST" "999999999" "$REF" "$TIP_SHA" "-" <"$WORKDIR/valid.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "oversize should fail"
	pass "oversize claim"

	# Exact byte cap: feed expected_size+1 bytes and require rejection
	# (not rounded dd blocks).
	printf 'x' >"$WORKDIR/one.byte"
	set +e
	# claim size 1 but feed 2 bytes
	out="$(printf 'xy' | run_helper validate-bundle "$(printf 'xy' | sha256sum | awk '{print $1}')" "1" "$REF" "$TIP_SHA" "-" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "exact oversize byte should fail"
	pass "exact byte cap while writing"

	set +e
	out="$(run_helper totally-unknown 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "unknown should fail"
	[[ "$(json_code "$out")" == "unknown_command" ]] || die "unknown code: $out"
	pass "unknown subcommand"

	set +e
	out="$(run_helper push-validated '../x' 'repo' "$REF" "$TIP_SHA" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "path escape owner should fail"
	pass "path escape args"

	# LFS pointer blob rejection fixture
	lfs_dir="$WORKDIR/lfs"
	mkdir -p "$lfs_dir"
	git -c init.defaultBranch=main init -q "$lfs_dir"
	git -C "$lfs_dir" config user.email "plan047@example.com"
	git -C "$lfs_dir" config user.name "Plan 047"
	git -C "$lfs_dir" config commit.gpgsign false
	printf 'version https://git-lfs.github.com/spec/v1\noid sha256:%s\nsize 123\n' "$(printf '0%.0s' {1..64})" >"$lfs_dir/big.bin"
	git -C "$lfs_dir" add big.bin
	git -C "$lfs_dir" commit -q -m "lfs"
	LFS_TIP="$(git -C "$lfs_dir" rev-parse HEAD)"
	git -C "$lfs_dir" bundle create "$WORKDIR/lfs.bundle" refs/heads/main
	lsz=$(wc -c <"$WORKDIR/lfs.bundle" | tr -d ' ')
	ldig=$(sha256sum "$WORKDIR/lfs.bundle" | awk '{print $1}')
	set +e
	out="$(run_helper validate-bundle "$ldig" "$lsz" "refs/heads/main" "$LFS_TIP" "-" <"$WORKDIR/lfs.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "lfs pointer should fail: $out"
	[[ "$(json_code "$out")" == "lfs" ]] || die "lfs code: $out"
	pass "lfs pointer rejection"

	# Multi-commit path churn counted across history (not net tip diff).
	# Three commits each add a distinct file then the last deletes the first two
	# so net tip diff is tiny; with a lowered path-record limit this must fail.
	churn="$WORKDIR/churn"
	mkdir -p "$churn"
	git -c init.defaultBranch=main init -q "$churn"
	git -C "$churn" config user.email "plan047@example.com"
	git -C "$churn" config user.name "Plan 047"
	git -C "$churn" config commit.gpgsign false
	echo a >"$churn/a.txt"
	git -C "$churn" add a.txt && git -C "$churn" commit -q -m "a"
	echo b >"$churn/b.txt"
	git -C "$churn" add b.txt && git -C "$churn" commit -q -m "b"
	echo c >"$churn/c.txt"
	rm -f "$churn/a.txt" "$churn/b.txt"
	git -C "$churn" add -A && git -C "$churn" commit -q -m "c-net-small"
	CHURN_TIP="$(git -C "$churn" rev-parse HEAD)"
	git -C "$churn" bundle create "$WORKDIR/churn.bundle" refs/heads/main
	csz=$(wc -c <"$WORKDIR/churn.bundle" | tr -d ' ')
	cdig=$(sha256sum "$WORKDIR/churn.bundle" | awk '{print $1}')
	set +e
	out="$(docker run --rm -i \
		--user 65532:65532 \
		--read-only \
		--tmpfs /var/lib/ditto-git-executor:rw,size=256m,mode=1777 \
		--network none \
		-e DITTO_TEST_MAX_PATH_RECORDS=2 \
		--entrypoint /usr/local/bin/ditto-git-executor \
		"$IMAGE" validate-bundle "$cdig" "$csz" "refs/heads/main" "$CHURN_TIP" "-" <"$WORKDIR/churn.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "path churn under low limit should fail: $out"
	[[ "$(json_code "$out")" == "path_limit" ]] || die "expected path_limit: $out"
	pass "multi-commit path churn counted (test limit override)"

	# Root/initial commit path records must count (plain diff-tree omits parentless).
	# One root commit adding three paths under DITTO_TEST_MAX_PATH_RECORDS=2 => path_limit.
	rootp="$WORKDIR/root-paths"
	mkdir -p "$rootp"
	git -c init.defaultBranch=main init -q "$rootp"
	git -C "$rootp" config user.email "plan047@example.com"
	git -C "$rootp" config user.name "Plan 047"
	git -C "$rootp" config commit.gpgsign false
	echo one >"$rootp/one.txt"
	echo two >"$rootp/two.txt"
	echo three >"$rootp/three.txt"
	git -C "$rootp" add one.txt two.txt three.txt
	git -C "$rootp" commit -q -m "root-three-paths"
	ROOT_TIP="$(git -C "$rootp" rev-parse HEAD)"
	git -C "$rootp" bundle create "$WORKDIR/root-paths.bundle" refs/heads/main
	rsz=$(wc -c <"$WORKDIR/root-paths.bundle" | tr -d ' ')
	rdig=$(sha256sum "$WORKDIR/root-paths.bundle" | awk '{print $1}')
	set +e
	out="$(docker run --rm -i \
		--user 65532:65532 \
		--read-only \
		--tmpfs /var/lib/ditto-git-executor:rw,size=256m,mode=1777 \
		--network none \
		-e DITTO_TEST_MAX_PATH_RECORDS=2 \
		--entrypoint /usr/local/bin/ditto-git-executor \
		"$IMAGE" validate-bundle "$rdig" "$rsz" "refs/heads/main" "$ROOT_TIP" "-" <"$WORKDIR/root-paths.bundle" 2>/dev/null)"
	rc=$?
	set -e
	[[ "$rc" -ne 0 ]] || die "root commit under low path limit should fail: $out"
	[[ "$(json_code "$out")" == "path_limit" ]] || die "expected path_limit for root paths: $out"
	pass "root-commit path records counted (test limit override)"

	CANARY='ghs_CANARYTOKEN_plan047_do_not_leak_0123456789abcdef'

	out="$(printf '%s' "$CANARY" | run_helper scan-canary)"
	json_ok "$out" || die "canary scan failed: $out"
	printf '%s' "$out" | grep -F -q "$CANARY" && die "canary echoed on stdout"
	pass "canary-negative"

	envjson="$(docker image inspect "$IMAGE" --format '{{json .Config.Env}}')"
	printf '%s' "$envjson" | grep -Eiq 'gh[pousr]_|x-access-token|PRIVATE|TOKEN|SECRET' \
		&& die "credential-like image env" || true
	pass "image env clean"
}

# --- Synthetic HTTPS github.com interception ---
# Host-side proxy presents TLS as github.com using a Cloudflare-like CA.
# Executor mounts that CA at /etc/cloudflare/certs/cloudflare-containers-ca.crt
# and resolves github.com to the proxy. Actual helper subcommands only.

generate_ca_and_cert() {
	mkdir -p "$WORKDIR/certs"
	# CA
	openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
		-keyout "$WORKDIR/certs/ca.key" \
		-out "$WORKDIR/certs/ca.crt" \
		-subj "/CN=Ditto Plan047 Test CA" >/dev/null 2>&1
	# github.com leaf
	openssl req -newkey rsa:2048 -nodes \
		-keyout "$WORKDIR/certs/github.key" \
		-out "$WORKDIR/certs/github.csr" \
		-subj "/CN=github.com" >/dev/null 2>&1
	cat >"$WORKDIR/certs/github.ext" <<'EXT'
subjectAltName=DNS:github.com
extendedKeyUsage=serverAuth
basicConstraints=CA:FALSE
EXT
	openssl x509 -req -in "$WORKDIR/certs/github.csr" \
		-CA "$WORKDIR/certs/ca.crt" -CAkey "$WORKDIR/certs/ca.key" -CAcreateserial \
		-out "$WORKDIR/certs/github.crt" -days 1 -extfile "$WORKDIR/certs/github.ext" >/dev/null 2>&1
	chmod 644 "$WORKDIR/certs/ca.crt" "$WORKDIR/certs/github.crt"
	chmod 600 "$WORKDIR/certs/github.key" "$WORKDIR/certs/ca.key"
}

start_https_proxy() {
	local phase="${1:-read}"
	NET_NAME="${NET_NAME:-ditto047net_$RANDOM}"
	if ! docker network inspect "$NET_NAME" >/dev/null 2>&1; then
		docker network create "$NET_NAME" >/dev/null
	fi

	mkdir -p "$WORKDIR/remote.git"
	if [[ ! -d "$WORKDIR/remote.git/refs" ]]; then
		git init -q --bare "$WORKDIR/remote.git"
		git --git-dir="$WORKDIR/remote.git" config http.receivepack true
		git -C "$WORKDIR/src" push "$WORKDIR/remote.git" main:main >/dev/null
	fi

	CANARY_TOKEN='ghs_CANARYTOKEN_plan047_proxy_only_0123456789abcdef'
	printf '%s' "$CANARY_TOKEN" >"$WORKDIR/canary.token"
	chmod 600 "$WORKDIR/canary.token"

	cat >"$WORKDIR/proxy.py" <<'PY'
#!/usr/bin/env python3
"""HTTPS smart-HTTP stand-in for github.com with host-side credential injection."""
from __future__ import annotations

import base64
import os
import re
import ssl
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO_ROOT = os.environ["REPO_ROOT"]
CANARY = open(os.environ["CANARY_FILE"], "r", encoding="utf-8").read().strip()
ALLOWED_OWNER = os.environ.get("ALLOWED_OWNER", "acme")
ALLOWED_REPO = os.environ.get("ALLOWED_REPO", "widget")
PHASE = os.environ.get("PHASE", "read")
PHASE_FILE = os.environ.get("PHASE_FILE", "")
EXPIRY_AT_MS = os.environ.get("EXPIRY_AT_MS", "")
LOG_PATH = os.environ.get("REQ_LOG", "/tmp/req.log")
CERT = os.environ["TLS_CERT"]
KEY = os.environ["TLS_KEY"]

def current_phase() -> str:
    if PHASE_FILE and os.path.isfile(PHASE_FILE):
        try:
            with open(PHASE_FILE, "r", encoding="utf-8") as f:
                val = f.read().strip()
            if val:
                return val
        except OSError:
            pass
    return PHASE

def is_expired() -> bool:
    if not EXPIRY_AT_MS:
        return False
    try:
        exp = int(EXPIRY_AT_MS)
    except ValueError:
        return True
    now_ms = int(__import__("time").time() * 1000)
    return now_ms > exp

def log_req(method: str, path: str, query: str, ctype: str, phase: str) -> None:
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(f"{method} {path}?{query} ctype={ctype} phase={phase}\n")

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _deny(self, code: int = 403, msg: str = b"denied") -> None:
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(msg)))
        self.end_headers()
        self.wfile.write(msg)

    def _match(self):
        m = re.match(r"^/([^/]+)/([^/]+)\.git(/.*)?$", self.path.split("?", 1)[0])
        if not m:
            return None
        return m.group(1), m.group(2), m.group(3) or ""

    def _phase_allows(self, service: str, phase: str) -> bool:
        if phase == "deny":
            return False
        if phase == "redirect":
            return True  # handled before service checks
        if phase == "expired":
            return False
        if phase == "read":
            return service == "git-upload-pack"
        if phase == "write":
            return service == "git-receive-pack"
        if phase == "both":
            return service in ("git-upload-pack", "git-receive-pack")
        return False

    def do_GET(self) -> None:
        self._handle(False)

    def do_POST(self) -> None:
        self._handle(True)

    def _handle(self, is_post: bool) -> None:
        phase = current_phase()
        if is_expired() or phase == "expired":
            return self._deny(403, b"expired")
        if phase == "redirect":
            self.send_response(302)
            self.send_header("Location", "https://evil.example/steal")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        parsed = self._match()
        if not parsed:
            return self._deny(404, b"not found")
        owner, repo, sub = parsed
        if owner != ALLOWED_OWNER or repo != ALLOWED_REPO:
            return self._deny(404, b"repo")
        qs = self.path.split("?", 1)[1] if "?" in self.path else ""
        ctype = self.headers.get("Content-Type", "")
        log_req(self.command, f"/{owner}/{repo}.git{sub}", qs, ctype, phase)

        if self.headers.get("Authorization") or self.headers.get("Cookie"):
            return self._deny(400, b"inbound auth")

        service = None
        if sub == "/info/refs":
            if is_post:
                return self._deny(405, b"method")
            if qs not in ("service=git-upload-pack", "service=git-receive-pack"):
                return self._deny(403, b"query")
            service = qs.split("=", 1)[1]
            if not self._phase_allows(service, phase):
                return self._deny(403, b"phase")
        elif sub == "/git-upload-pack":
            if not is_post or ctype != "application/x-git-upload-pack-request":
                return self._deny(403, b"shape")
            service = "git-upload-pack"
            if not self._phase_allows(service, phase):
                return self._deny(403, b"phase")
        elif sub == "/git-receive-pack":
            if not is_post or ctype != "application/x-git-receive-pack-request":
                return self._deny(403, b"shape")
            service = "git-receive-pack"
            if not self._phase_allows(service, phase):
                return self._deny(403, b"phase")
        else:
            return self._deny(403, b"path")

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
        # Credential exists ONLY in this host proxy upstream hop.
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
        proc = subprocess.run(cmd, input=body, capture_output=True, env=env, check=False)
        raw = proc.stdout
        if not raw:
            err = (proc.stderr or b"empty")[:300]
            return self._deny(500, b"backend empty: " + err)
        if b"\r\n\r\n" in raw:
            header_blob, resp_body = raw.split(b"\r\n\r\n", 1)
        elif b"\n\n" in raw:
            header_blob, resp_body = raw.split(b"\n\n", 1)
        else:
            header_blob, resp_body = b"Status: 500\n", raw
        status = 200
        headers = []
        for line in header_blob.replace(b"\r\n", b"\n").split(b"\n"):
            if not line or b":" not in line:
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
    port = int(os.environ.get("PORT", "443"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    server.serve_forever()

if __name__ == "__main__":
    main()
PY

	if [[ -n "${PROXY_CID:-}" ]]; then
		docker rm -f "$PROXY_CID" >/dev/null 2>&1 || true
		PROXY_CID=""
	fi

	if ! docker image inspect ditto047-proxy-py:local >/dev/null 2>&1; then
		# Build via running container (buildx network restrictions break apk in some envs).
		cid="$(docker run -d python:3.12-alpine sleep 600)"
		docker exec "$cid" apk add --no-cache git git-daemon >/dev/null
		docker commit "$cid" ditto047-proxy-py:local >/dev/null
		docker rm -f "$cid" >/dev/null
	fi

	# Runtime-switchable phase control file (same proxy process).
	mkdir -p "$WORKDIR/control"
	printf '%s\n' "$phase" >"$WORKDIR/control/phase"
	chmod 666 "$WORKDIR/control/phase" 2>/dev/null || true
	expiry_args=()
	if [[ -n "${PROXY_EXPIRY_AT_MS:-}" ]]; then
		expiry_args+=(-e "EXPIRY_AT_MS=${PROXY_EXPIRY_AT_MS}")
	fi
	PROXY_CID="$(docker run -d --rm \
		--name "ditto047proxy_$RANDOM" \
		--network "$NET_NAME" \
		--network-alias github.com \
		-e REPO_ROOT=/git/remote.git \
		-e CANARY_FILE=/secret/canary.token \
		-e REQ_LOG=/tmp/req.log \
		-e PHASE="$phase" \
		-e PHASE_FILE=/control/phase \
		"${expiry_args[@]}" \
		-e ALLOWED_OWNER=acme \
		-e ALLOWED_REPO=widget \
		-e PORT=443 \
		-e TLS_CERT=/certs/github.crt \
		-e TLS_KEY=/certs/github.key \
		-v "$WORKDIR/remote.git:/git/remote.git" \
		-v "$WORKDIR/proxy.py:/proxy.py:ro" \
		-v "$WORKDIR/canary.token:/secret/canary.token:ro" \
		-v "$WORKDIR/certs/github.crt:/certs/github.crt:ro" \
		-v "$WORKDIR/certs/github.key:/certs/github.key:ro" \
		-v "$WORKDIR/control:/control" \
		ditto047-proxy-py:local \
		python /proxy.py)"

	PROXY_HOST=""
	ready=0
	code="000"
	for _ in $(seq 1 90); do
		running="$(docker inspect -f '{{.State.Running}}' "$PROXY_CID" 2>/dev/null || echo false)"
		[[ "$running" == "true" ]] || die "proxy exited: $(docker logs "$PROXY_CID" 2>&1 | tail -30)"
		PROXY_HOST="$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$PROXY_CID" 2>/dev/null || true)"
		if [[ -n "$PROXY_HOST" ]]; then
			code="$(docker run --rm --network "$NET_NAME" \
				-v "$WORKDIR/certs/ca.crt:/ca.crt:ro" \
				curlimages/curl:8.5.0 -sk --cacert /ca.crt \
				--resolve "github.com:443:${PROXY_HOST}" \
				-o /dev/null -w '%{http_code}' \
				https://github.com/ 2>/dev/null || echo 000)"
			if [[ "$code" =~ ^[0-9]+$ ]] && [[ "$code" != "000" ]]; then
				ready=1
				break
			fi
		fi
		sleep 0.5
	done
	[[ -n "$PROXY_HOST" ]] || die "proxy ip missing"
	[[ "$ready" -eq 1 ]] || die "proxy TLS not ready code=${code}; logs: $(docker logs "$PROXY_CID" 2>&1 | tail -30)"
}

start_executor() {
	# One long-lived executor: CA mounted; github.com resolved via network-alias on proxy.
	if [[ -n "${EXEC_CID:-}" ]]; then
		docker rm -f "$EXEC_CID" >/dev/null 2>&1 || true
		EXEC_CID=""
	fi
	EXEC_CID="$(docker run -d \
		--name "ditto047exec_$RANDOM" \
		--user 65532:65532 \
		--network "$NET_NAME" \
		-v "$WORKDIR/certs/ca.crt:/etc/cloudflare/certs/cloudflare-containers-ca.crt:ro" \
		--tmpfs /var/lib/ditto-git-executor:rw,size=256m,mode=1777 \
		"$IMAGE")"
	sleep 0.5
	docker inspect -f '{{.State.Running}}' "$EXEC_CID" | grep -q true || die "executor not running"
}

set_proxy_phase() {
	local p="$1"
	printf '%s\n' "$p" >"$WORKDIR/control/phase"
}

assert_no_canary() {
	local where="$1"
	local data="$2"
	# Do not print the canary value.
	if printf '%s' "$data" | grep -F -q -- "$CANARY_TOKEN"; then
		die "canary present in $where"
	fi
}


test_proxy() {
	require_image
	make_repos "$WORKDIR"
	generate_ca_and_cert
	CANARY_TOKEN='ghs_CANARYTOKEN_plan047_proxy_only_0123456789abcdef'

	# --- Read phase via actual ls-remote-ref ---
	start_https_proxy read
	start_executor

	out="$(exec_helper ls-remote-ref acme widget refs/heads/main)"
	json_ok "$out" || die "ls-remote-ref failed: $out"
	echo "$out" | grep -q "$OLD_SHA\|$TIP_SHA" || die "unexpected ls-remote sha: $out"
	echo "$out" | grep -q '"present":true' || die "expected present: $out"
	pass "helper ls-remote-ref over HTTPS github.com"

	req_log="$(docker exec "$PROXY_CID" cat /tmp/req.log 2>/dev/null || true)"
	echo "$req_log" | grep -q 'info/refs?service=git-upload-pack' || die "missing read discovery: $req_log"
	echo "$req_log" | grep -q 'git-receive-pack' && die "write leaked into read phase: $req_log"
	assert_no_canary "proxy request log" "$req_log"
	pass "exact read request shapes"

	# Credential canary scan of THE SAME executor container
	scan_out="$(printf '%s' "$CANARY_TOKEN" | exec_helper scan-canary)"
	json_ok "$scan_out" || die "canary present in executor"
	assert_no_canary "scan-canary stdout" "$scan_out"
	exec_env="$(docker inspect -f '{{json .Config.Env}}' "$EXEC_CID")"
	assert_no_canary "executor env" "$exec_env"
	exec_args="$(docker inspect -f '{{json .Args}}{{json .Config.Cmd}}{{json .Config.Entrypoint}}' "$EXEC_CID")"
	assert_no_canary "executor argv" "$exec_args"
	pass "credential absent from same executor argv/env/files/output"

	# Absolute expiry: proxy denies after EXPIRY_AT_MS
	PROXY_EXPIRY_AT_MS="$(( $(date +%s%3N) - 1000 ))"
	start_https_proxy read
	docker rm -f "$EXEC_CID" >/dev/null 2>&1 || true
	EXEC_CID=""
	start_executor
	set +e
	exp_out="$(exec_helper ls-remote-ref acme widget refs/heads/main 2>/dev/null)"
	exp_rc=$?
	set -e
	[[ "$exp_rc" -ne 0 ]] || die "expired phase should fail: $exp_out"
	pass "absolute expiry denies ls-remote-ref"
	unset PROXY_EXPIRY_AT_MS

	# Redirect mode: fixed helper must fail (does not silently follow off-host)
	start_https_proxy redirect
	docker rm -f "$EXEC_CID" >/dev/null 2>&1 || true
	EXEC_CID=""
	start_executor
	set +e
	redir_out="$(exec_helper ls-remote-ref acme widget refs/heads/main 2>/dev/null)"
	redir_rc=$?
	set -e
	[[ "$redir_rc" -ne 0 ]] || die "redirect should fail ls-remote-ref: $redir_out"
	pass "redirect denial via fixed ls-remote-ref"

	# TLS required: without CA mount, HTTPS must fail
	start_https_proxy read
	no_ca_cid="$(docker run -d --rm \
		--user 65532:65532 \
		--network "$NET_NAME" \
		--tmpfs /var/lib/ditto-git-executor:rw,size=256m,mode=1777 \
		"$IMAGE")"
	set +e
	no_ca_out="$(docker exec -i -u 65532:65532 "$no_ca_cid" /usr/local/bin/ditto-git-executor \
		ls-remote-ref acme widget refs/heads/main 2>/dev/null)"
	no_ca_rc=$?
	set -e
	docker rm -f "$no_ca_cid" >/dev/null 2>&1 || true
	[[ "$no_ca_rc" -ne 0 ]] || die "missing CF CA should fail TLS: $no_ca_out"
	pass "TLS required; synthetic CA needed (never disable TLS)"

	# --- Same-container write: validate, deny push, switch phase, retry push ---
	start_https_proxy both
	docker rm -f "$EXEC_CID" >/dev/null 2>&1 || true
	EXEC_CID=""
	start_executor
	SAME_EXEC="$EXEC_CID"

	echo "third" >>"$WORKDIR/src/README.md"
	git -C "$WORKDIR/src" add README.md
	git -C "$WORKDIR/src" commit -q -m "third"
	NEW_TIP="$(git -C "$WORKDIR/src" rev-parse HEAD)"
	git -C "$WORKDIR/src" bundle create "$WORKDIR/write.bundle" "$REF"
	WSIZE="$(wc -c <"$WORKDIR/write.bundle" | tr -d ' ')"
	WDIGEST="$(sha256sum "$WORKDIR/write.bundle" | awk '{print $1}')"
	REMOTE_OLD="$(git --git-dir="$WORKDIR/remote.git" rev-parse refs/heads/main)"

	val_out="$(exec_helper validate-bundle "$WDIGEST" "$WSIZE" "$REF" "$NEW_TIP" "$REMOTE_OLD" <"$WORKDIR/write.bundle")"
	json_ok "$val_out" || die "validate-bundle failed: $val_out"
	docker exec -u 65532:65532 "$EXEC_CID" test -d /var/lib/ditto-git-executor/quarantine \
		|| die "quarantine missing after validate"
	pass "validate-bundle on executor"

	# Deny first push on the SAME container via control file (no recreate).
	set_proxy_phase deny
	set +e
	fail_push="$(exec_helper push-validated acme widget "$REF" "$NEW_TIP" 2>/dev/null)"
	fail_rc=$?
	set -e
	[[ "$fail_rc" -ne 0 ]] || die "deny-phase push should fail"
	[[ "$EXEC_CID" == "$SAME_EXEC" ]] || die "executor recreated unexpectedly"
	docker exec -u 65532:65532 "$EXEC_CID" test -d /var/lib/ditto-git-executor/quarantine \
		|| die "quarantine deleted after first failed push"
	docker exec -u 65532:65532 "$EXEC_CID" test -f /var/lib/ditto-git-executor/quarantine/.ditto-expected-tip \
		|| die "quarantine marker missing after first failed push"
	pass "same-container deny push preserves quarantine"

	# Switch proxy phase to write on the same proxy+executor; second push succeeds.
	set_proxy_phase write
	push_out="$(exec_helper push-validated acme widget "$REF" "$NEW_TIP")"
	json_ok "$push_out" || die "retry push-validated failed: $push_out"
	[[ "$EXEC_CID" == "$SAME_EXEC" ]] || die "executor changed on retry"
	remote_tip="$(git --git-dir="$WORKDIR/remote.git" rev-parse refs/heads/main)"
	[[ "$remote_tip" == "$NEW_TIP" ]] || die "remote tip $remote_tip != $NEW_TIP"
	pass "same-container retry push-validated succeeds after phase switch"

	# Third attempt impossible: quarantine cleaned after successful push.
	set +e
	third="$(exec_helper push-validated acme widget "$REF" "$NEW_TIP" 2>/dev/null)"
	third_rc=$?
	set -e
	[[ "$third_rc" -ne 0 ]] || die "third push should be impossible"
	docker exec -u 65532:65532 "$EXEC_CID" test ! -d /var/lib/ditto-git-executor/quarantine \
		|| die "quarantine should be gone after successful push"
	pass "third attempt impossible; cleanup state gone"

	req_log="$(docker exec "$PROXY_CID" cat /tmp/req.log 2>/dev/null || true)"
	echo "$req_log" | grep -q 'git-receive-pack' || die "missing receive-pack: $req_log"
	assert_no_canary "proxy request log post-write" "$req_log"
	pass "write request shapes logged without canary"

	# Final canary scan on executor after write
	scan2="$(printf '%s' "$CANARY_TOKEN" | exec_helper scan-canary)"
	json_ok "$scan2" || die "post-write canary present"
	assert_no_canary "post-write scan stdout" "$scan2"
	pass "post-write credential-negative scan"

	# Cleanup proof
	docker rm -f "$EXEC_CID" >/dev/null 2>&1 || true
	EXEC_CID=""
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
