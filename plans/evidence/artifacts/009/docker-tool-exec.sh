#!/bin/sh
# Disposable local Docker check of the image-owned remote tool executor.
# Usage: sh docker-tool-exec.sh <image>
set -eu
image="$1"
cid=$(docker run -d --rm -e DITTO_SYNTHETIC_SECRET=must-not-leak --network none --entrypoint sleep "$image" 600)
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
inside() { docker exec "$cid" sh -c "$1"; }
deadline=$(( $(date +%s) * 1000 + 300000 ))
n=0
run() {
	n=$((n + 1))
	id="${3:-op-$n}"
	printf '%s' "{\"version\":1,\"operationId\":\"$id\",\"workspaceSessionId\":\"session\",\"executorGeneration\":${4:-1},\"epoch\":1,\"deadlineAt\":$deadline,\"tool\":\"$1\",\"arguments\":$2}" \
		| docker exec -i "$cid" sh -c "cat > /var/lib/ditto-exec/requests/$id.json"
	printf '%s %s => ' "$1" "$id"
	inside "ditto-exec run /var/lib/ditto-exec/requests/$id.json"
}
inside "rg --version | head -1; fdfind --version; node --version"
inside "mkdir -p /workspace && cd /workspace && git init -q && printf 'ignored.txt\n' > .gitignore && echo secret-match > ignored.txt"
inside "ditto-exec init session 1"
run write '{"path":"src/app.ts","content":"export const answer = 41;\n"}'
run read '{"path":"src/app.ts"}'
run edit '{"path":"src/app.ts","edits":[{"oldText":"41","newText":"42"}]}'
run edit '{"path":"src/app.ts","edits":[{"oldText":"41","newText":"43"}]}'
run grep '{"pattern":"answer|secret-match"}'
run find '{"pattern":"*.ts"}'
run ls '{}'
run bash '{"command":"cat src/app.ts; printf \"%s\" \"${DITTO_SYNTHETIC_SECRET:-absent}\""}'
run bash '{"command":"echo once >> count.txt; wc -l < count.txt"}' dup-shell
run bash '{"command":"echo once >> count.txt; wc -l < count.txt"}' dup-shell
run bash '{"command":"echo other"}' dup-shell
run read '{"path":"src/app.ts"}' stale-generation 0 || true
inside "ditto-exec init session 2"
run read '{"path":"src/app.ts"}' old-generation 1
echo "init older generation:"; inside "ditto-exec init session 1" || echo "refused (exit $?)"
echo "SIGKILL executor during shell:"
(run bash '{"command":"sleep 20; echo late >> killed.txt"}' killed-shell 2 || true) &
sleep 2
inside "pkill -9 -f '[d]itto-exec run'; pkill -9 -f '[s]leep 20'" || true
wait
run bash '{"command":"sleep 20; echo late >> killed.txt"}' killed-shell 2
inside "test ! -e /workspace/killed.txt && echo 'killed.txt absent'"
echo "files:"; inside "cat /workspace/src/app.ts /workspace/count.txt"
