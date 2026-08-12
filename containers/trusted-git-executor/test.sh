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
LOG_PATH = os.environ.get("REQ_LOG", "/tmp/req.log")
CERT = os.environ["TLS_CERT"]
KEY = os.environ["TLS_KEY"]

def log_req(method: str, path: str, query: str, ctype: str) -> None:
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(f"{method} {path}?{query} ctype={ctype} phase={PHASE}\n")

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

    def _phase_allows(self, service: str) -> bool:
        if PHASE == "deny":
            return False
        if PHASE == "read":
            return service == "git-upload-pack"
        if PHASE == "write":
            return service == "git-receive-pack"
        if PHASE == "both":
            return service in ("git-upload-pack", "git-receive-pack")
        return False

    def do_GET(self) -> None:
        self._handle(False)

    def do_POST(self) -> None:
        self._handle(True)

    def _handle(self, is_post: bool) -> None:
        parsed = self._match()
        if not parsed:
            return self._deny(404, b"not found")
        owner, repo, sub = parsed
        if owner != ALLOWED_OWNER or repo != ALLOWED_REPO:
            return self._deny(404, b"repo")
        qs = self.path.split("?", 1)[1] if "?" in self.path else ""
        ctype = self.headers.get("Content-Type", "")
        log_req(self.command, f"/{owner}/{repo}.git{sub}", qs, ctype)

        if self.headers.get("Authorization") or self.headers.get("Cookie"):
            return self._deny(400, b"inbound auth")

        service = None
        if sub == "/info/refs":
            if is_post:
                return self._deny(405, b"method")
            if qs not in ("service=git-upload-pack", "service=git-receive-pack"):
                return self._deny(403, b"query")
            service = qs.split("=", 1)[1]
            if not self._phase_allows(service):
                return self._deny(403, b"phase")
        elif sub == "/git-upload-pack":
            if not is_post or ctype != "application/x-git-upload-pack-request":
                return self._deny(403, b"shape")
            service = "git-upload-pack"
            if not self._phase_allows(service):
                return self._deny(403, b"phase")
        elif sub == "/git-receive-pack":
            if not is_post or ctype != "application/x-git-receive-pack-request":
                return self._deny(403, b"shape")
            service = "git-receive-pack"
            if not self._phase_allows(service):
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

	PROXY_CID="$(docker run -d --rm \
		--name "ditto047proxy_$RANDOM" \
		--network "$NET_NAME" \
		--network-alias github.com \
		-e REPO_ROOT=/git/remote.git \
		-e CANARY_FILE=/secret/canary.token \
		-e REQ_LOG=/tmp/req.log \
		-e PHASE="$phase" \
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

test_proxy() {
	require_image
	make_repos "$WORKDIR"
	generate_ca_and_cert

	# --- Read phase via actual ls-remote-ref ---
	start_https_proxy read
	start_executor

	out="$(exec_helper ls-remote-ref acme widget refs/heads/main)"
	json_ok "$out" || die "ls-remote-ref failed: $out"
	echo "$out" | grep -q "$OLD_SHA\|$TIP_SHA" || die "unexpected ls-remote sha: $out"
	# present true with exact sha
	echo "$out" | grep -q '"present":true' || die "expected present: $out"
	pass "helper ls-remote-ref over HTTPS github.com"

	# Request shapes: only upload-pack discovery/rpc
	req_log="$(docker exec "$PROXY_CID" cat /tmp/req.log 2>/dev/null || true)"
	echo "$req_log" | grep -q 'info/refs?service=git-upload-pack' || die "missing read discovery: $req_log"
	echo "$req_log" | grep -q 'git-receive-pack' && die "write leaked into read phase: $req_log"
	pass "exact read request shapes"

	# Credential canary scan of THE SAME executor container
	CANARY_TOKEN="$(cat "$WORKDIR/canary.token")"
	scan_out="$(printf '%s' "$CANARY_TOKEN" | exec_helper scan-canary)"
	json_ok "$scan_out" || die "canary present in executor: $scan_out"
	printf '%s' "$scan_out" | grep -F -q "$CANARY_TOKEN" && die "canary echoed"
	# Also prove not in argv/env/files via host-side docker inspect (no values of secrets)
	exec_env="$(docker inspect -f '{{json .Config.Env}}' "$EXEC_CID")"
	printf '%s' "$exec_env" | grep -F -q "$CANARY_TOKEN" && die "canary in executor env"
	pass "credential absent from same executor argv/env/files/output"

	# Phase deny / expiry model
	start_https_proxy deny
	# Point executor at new proxy IP
	docker rm -f "$EXEC_CID" >/dev/null 2>&1 || true
	EXEC_CID=""
	start_executor
	set +e
	den_out="$(exec_helper ls-remote-ref acme widget refs/heads/main 2>/dev/null)"
	den_rc=$?
	set -e
	[[ "$den_rc" -ne 0 ]] || die "phase deny should fail: $den_out"
	pass "phase removal/deny"

	# Redirect denial is enforced in Worker policy; local proxy does not redirect.
	# Prove helper never disables TLS: without CA mount, HTTPS must fail.
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

	# --- Write path: validate-bundle + push-validated on SAME executor ---
	# Allow both read and write services so ls-remote during tests and push work.
	start_https_proxy both
	docker rm -f "$EXEC_CID" >/dev/null 2>&1 || true
	EXEC_CID=""
	start_executor

	# Create third commit + bundle for non-force advance
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
	pass "validate-bundle on executor"

	# Quarantine must exist inside executor for push
	docker exec -u 65532:65532 "$EXEC_CID" test -d /var/lib/ditto-git-executor/quarantine \
		|| die "quarantine missing after validate"
	pass "quarantine retained after validate"

	push_out="$(exec_helper push-validated acme widget "$REF" "$NEW_TIP")"
	json_ok "$push_out" || die "push-validated failed: $push_out"
	remote_tip="$(git --git-dir="$WORKDIR/remote.git" rev-parse refs/heads/main)"
	[[ "$remote_tip" == "$NEW_TIP" ]] || die "remote tip $remote_tip != $NEW_TIP"
	pass "non-force push-validated via HTTPS github.com"

	req_log="$(docker exec "$PROXY_CID" cat /tmp/req.log 2>/dev/null || true)"
	echo "$req_log" | grep -q 'git-receive-pack' || die "missing receive-pack: $req_log"
	pass "write request shapes logged"

	# Retry-preserved quarantine: force a failed push then ensure quarantine remains for retry.
	# Reset remote to old, re-validate, fail first push by setting phase deny mid-way is hard;
	# instead: validate again on fresh executor, first push with PHASE=deny, check quarantine remains.
	start_https_proxy deny
	docker rm -f "$EXEC_CID" >/dev/null 2>&1 || true
	EXEC_CID=""
	start_executor
	# Need a bundle relative to current remote (already at NEW_TIP). Create fourth commit.
	echo "fourth" >>"$WORKDIR/src/README.md"
	git -C "$WORKDIR/src" add README.md
	git -C "$WORKDIR/src" commit -q -m "fourth"
	TIP4="$(git -C "$WORKDIR/src" rev-parse HEAD)"
	git -C "$WORKDIR/src" bundle create "$WORKDIR/retry.bundle" "$REF"
	RSIZE="$(wc -c <"$WORKDIR/retry.bundle" | tr -d ' ')"
	RDIGEST="$(sha256sum "$WORKDIR/retry.bundle" | awk '{print $1}')"
	# validate does not need network
	val2="$(exec_helper validate-bundle "$RDIGEST" "$RSIZE" "$REF" "$TIP4" "$NEW_TIP" <"$WORKDIR/retry.bundle")"
	json_ok "$val2" || die "retry validate failed: $val2"
	docker exec -u 65532:65532 "$EXEC_CID" test -d /var/lib/ditto-git-executor/quarantine \
		|| die "quarantine missing before failed push"
	set +e
	fail_push="$(exec_helper push-validated acme widget "$REF" "$TIP4" 2>/dev/null)"
	fail_rc=$?
	set -e
	[[ "$fail_rc" -ne 0 ]] || die "deny-phase push should fail"
	# Quarantine preserved after first failure for authorized retry
	docker exec -u 65532:65532 "$EXEC_CID" test -d /var/lib/ditto-git-executor/quarantine \
		|| die "quarantine deleted after first failed push"
	docker exec -u 65532:65532 "$EXEC_CID" test -f /var/lib/ditto-git-executor/quarantine/.ditto-expected-tip \
		|| die "quarantine marker missing after first failed push"
	pass "retry-preserved quarantine after first failed push"

	# Successful retry after re-enabling write
	start_https_proxy both
	docker rm -f "$EXEC_CID" >/dev/null 2>&1 || true
	# Keep same state volume? New container loses quarantine — prove retry path on continuous container:
	# Restart executor with same validate then fail then succeed on ONE container.
	EXEC_CID=""
	start_executor
	val3="$(exec_helper validate-bundle "$RDIGEST" "$RSIZE" "$REF" "$TIP4" "$NEW_TIP" <"$WORKDIR/retry.bundle")"
	json_ok "$val3" || die "retry2 validate: $val3"
	# Flip proxy to deny for first push without recreating executor: restart proxy only, keep EXEC_CID
	old_exec="$EXEC_CID"
	start_https_proxy deny
	# Re-add host mapping requires recreate of executor — docker --add-host is create-time.
	# So: recreate executor would lose quarantine. Instead use a writable hosts approach via
	# network alias on the proxy container.
	docker rm -f "$PROXY_CID" >/dev/null 2>&1 || true
	PROXY_CID="$(docker run -d --rm \
		--name "ditto047proxy_$RANDOM" \
		--network "$NET_NAME" \
		--network-alias github.com \
		-e REPO_ROOT=/git/remote.git \
		-e CANARY_FILE=/secret/canary.token \
		-e REQ_LOG=/tmp/req.log \
		-e PHASE=both \
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
		ditto047-proxy-py:local \
		python /proxy.py)"
	sleep 1
	# Recreate executor WITHOUT add-host, relying on network-alias github.com
	docker rm -f "$old_exec" >/dev/null 2>&1 || true
	EXEC_CID="$(docker run -d \
		--name "ditto047exec_$RANDOM" \
		--user 65532:65532 \
		--network "$NET_NAME" \
		-v "$WORKDIR/certs/ca.crt:/etc/cloudflare/certs/cloudflare-containers-ca.crt:ro" \
		--tmpfs /var/lib/ditto-git-executor:rw,size=256m,mode=1777 \
		"$IMAGE")"
	sleep 0.5
	val4="$(exec_helper validate-bundle "$RDIGEST" "$RSIZE" "$REF" "$TIP4" "$NEW_TIP" <"$WORKDIR/retry.bundle")"
	json_ok "$val4" || die "alias validate: $val4"
	push4="$(exec_helper push-validated acme widget "$REF" "$TIP4")"
	json_ok "$push4" || die "alias push failed: $push4"
	remote_tip4="$(git --git-dir="$WORKDIR/remote.git" rev-parse refs/heads/main)"
	[[ "$remote_tip4" == "$TIP4" ]] || die "remote tip4 $remote_tip4 != $TIP4"
	pass "push via network-alias github.com + mounted CF CA"

	# Final canary scan on executor after write
	scan2="$(printf '%s' "$CANARY_TOKEN" | exec_helper scan-canary)"
	json_ok "$scan2" || die "post-write canary: $scan2"
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
