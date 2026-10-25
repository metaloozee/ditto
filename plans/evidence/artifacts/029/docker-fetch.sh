#!/bin/sh
# Disposable local Docker check of `ditto-workspace fetch` refusals, with no network.
# Usage: sh docker-fetch.sh <image>
# Every case needs positive evidence; any miss exits 1.
set -eu
image="$1"
cid=$(docker run -d --rm --network none --entrypoint sleep "$image" 600)
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
inside() { docker exec "$cid" sh -c "$1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }
expect() {
	# expect <label> <output> <fixed string>
	printf '%s\n' "$2" | grep -qF -- "$3" || fail "$1: missing $3"
}
git_id='-c user.name=t -c user.email=t@example.com'
inside "mkdir -p /workspace && cd /workspace && git init -q -b owned && echo a > a.txt && git add a.txt && git $git_id commit -q -m base"
inside "command -v ditto-workspace >/dev/null" || fail "ditto-workspace not on PATH"
fetch='ditto-workspace fetch --repository owner/repo --ref refs/heads/feature --branch owned'
before=$(inside "cd /workspace && git rev-parse HEAD")

echo "bad slug:"
code=0
out=$(inside "ditto-workspace fetch --repository owner/repo/x --ref refs/heads/feature --branch owned" 2>&1) || code=$?
echo "$out (exit $code)"
expect "bad slug" "$out" '"error":"invalid_args"'
[ "$code" -ne 0 ] || fail "bad slug: exit 0"

echo "ref outside heads:"
out=$(inside "ditto-workspace fetch --repository owner/repo --ref refs/tags/v1 --branch owned" 2>&1) || true
echo "$out"
expect "ref outside heads" "$out" '"error":"invalid_args"'

echo "dirty worktree:"
out=$(inside "cd /workspace && echo b > a.txt && $fetch" 2>&1) || true
echo "$out"
expect "dirty" "$out" '"error":"dirty_worktree"'
inside "cd /workspace && git checkout -q -- a.txt"

echo "unreachable network:"
start=$(date +%s)
out=$(inside "$fetch" 2>&1) || true
elapsed=$(( $(date +%s) - start ))
echo "$out (${elapsed}s)"
expect "unreachable" "$out" '"error":"git_failed"'
[ "$elapsed" -lt 60 ] || fail "unreachable: took ${elapsed}s"
after=$(inside "cd /workspace && git rev-parse HEAD")
[ "$before" = "$after" ] || fail "unreachable: HEAD moved"
echo "all fetch checks passed"
