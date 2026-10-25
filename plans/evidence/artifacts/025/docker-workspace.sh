#!/bin/sh
# Disposable local Docker check of the image-owned ditto-workspace command.
# Usage: sh docker-workspace.sh <image>
set -eu
image="$1"
cid=$(docker run -d --rm --network none --entrypoint sleep "$image" 600)
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
inside() { docker exec "$cid" sh -c "$1"; }
git_id='-c user.name=t -c user.email=t@example.com'
inside "mkdir -p /workspace && cd /workspace && git init -q -b owned && echo a > a.txt && git add a.txt && git $git_id commit -q -m base"
echo "clean status:"; inside "ditto-workspace status --branch owned"
echo "branch mismatch:"; inside "ditto-workspace status --branch other" || echo "refused (exit $?)"
echo "changes counted:"; inside "cd /workspace && echo b > a.txt && echo n > new.txt && ditto-workspace status --branch owned"
echo "untracked .env stays out while a sibling commits:"
inside "cd /workspace && echo SECRET=1 > .env && printf 'sibling commit' > /tmp/message.txt && ditto-workspace commit --branch owned --message-file /tmp/message.txt && git ls-files"
echo "hook does not run:"
inside "cd /workspace && printf '#!/bin/sh\ntouch /tmp/hook-ran\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit && echo c > a.txt && ditto-workspace commit --branch owned --message-file /tmp/message.txt; test ! -e /tmp/hook-ran && echo hook-absent"
echo "pre-staged .env.local refuses:"
inside "cd /workspace && before=\$(git rev-parse HEAD) && echo S=1 > .env.local && git add -f .env.local && echo d > a.txt && (ditto-workspace commit --branch owned --message-file /tmp/message.txt || true) && test \"\$before\" = \"\$(git rev-parse HEAD)\" && echo head-unchanged"
echo "message with shell syntax is verbatim:"
inside "cd /workspace && git reset -q .env.local && printf %s \"'; touch /tmp/injected #\" > /tmp/message.txt && echo e > a.txt && ditto-workspace commit --branch owned --message-file /tmp/message.txt && git log -1 --format=%s && test ! -e /tmp/injected && echo no-injection"
