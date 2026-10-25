#!/bin/sh
# Disposable local Docker check of the image-owned ditto-workspace command.
# Usage: sh docker-workspace.sh <image>
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

echo "clean status:"
out=$(inside "ditto-workspace status --branch owned" 2>&1) || true
echo "$out"
expect "clean status" "$out" '"ok":true'
expect "clean status" "$out" '"changed":0'

echo "branch mismatch:"
code=0
out=$(inside "ditto-workspace status --branch other" 2>&1) || code=$?
echo "$out (exit $code)"
expect "branch mismatch" "$out" '"error":"branch_mismatch"'
[ "$code" -ne 0 ] || fail "branch mismatch: exit 0"

echo "changes counted:"
out=$(inside "cd /workspace && echo b > a.txt && echo n > new.txt && ditto-workspace status --branch owned" 2>&1) || true
echo "$out"
expect "changes" "$out" '"changed":2'

echo "untracked .env stays out while a sibling commits:"
out=$(inside "cd /workspace && echo SECRET=1 > .env && printf 'sibling commit' > /tmp/message.txt && ditto-workspace commit --branch owned --message-file /tmp/message.txt" 2>&1) || true
echo "$out"
expect "sibling commit" "$out" '"committed":true'
files=$(inside "cd /workspace && git ls-files")
echo "$files"
expect "sibling commit" "$files" 'new.txt'
if printf '%s\n' "$files" | grep -qx '.env'; then fail "sibling commit: .env tracked"; fi

echo "hook does not run:"
out=$(inside "cd /workspace && printf '#!/bin/sh\ntouch /tmp/hook-ran\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit && echo c > a.txt && ditto-workspace commit --branch owned --message-file /tmp/message.txt" 2>&1) || true
echo "$out"
expect "hook" "$out" '"committed":true'
inside "test ! -e /tmp/hook-ran" || fail "hook: pre-commit hook ran"

echo "pre-staged .env.local refuses:"
before=$(inside "cd /workspace && git rev-parse HEAD")
out=$(inside "cd /workspace && echo S=1 > .env.local && git add -f .env.local && echo d > a.txt && ditto-workspace commit --branch owned --message-file /tmp/message.txt" 2>&1) || true
echo "$out"
expect "secret path" "$out" '"error":"secret_path"'
after=$(inside "cd /workspace && git rev-parse HEAD")
[ "$before" = "$after" ] || fail "secret path: HEAD moved"

echo "message with shell syntax is verbatim:"
msg="'; touch /tmp/injected #"
out=$(inside "cd /workspace && git reset -q .env.local && printf %s \"'; touch /tmp/injected #\" > /tmp/message.txt && echo e > a.txt && ditto-workspace commit --branch owned --message-file /tmp/message.txt" 2>&1) || true
echo "$out"
expect "shell syntax" "$out" '"committed":true'
subject=$(inside "cd /workspace && git log -1 --format=%s")
[ "$subject" = "$msg" ] || fail "shell syntax: subject was '$subject'"
inside "test ! -e /tmp/injected" || fail "shell syntax: injected file exists"
echo "all workspace checks passed"
