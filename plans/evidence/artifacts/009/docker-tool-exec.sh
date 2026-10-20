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
echo "file tools cannot reach executor state:"
run write '{"path":"/var/lib/ditto-exec/executor.json","content":"{}"}' forge-state 2
inside "cat /var/lib/ditto-exec/executor.json; echo"
echo "container environment stays readable through /proc (limit, not a guarantee):"
run bash '{"command":"grep -c DITTO_SYNTHETIC_SECRET /proc/1/environ || true"}' proc-env 2
echo "overlapping requests for one shell operation:"
printf '%s' "{\"version\":1,\"operationId\":\"overlap\",\"workspaceSessionId\":\"session\",\"executorGeneration\":2,\"epoch\":1,\"deadlineAt\":$deadline,\"tool\":\"bash\",\"arguments\":{\"command\":\"sleep 1; echo x >> overlap.txt\"}}" \
	| docker exec -i "$cid" sh -c "cat > /var/lib/ditto-exec/requests/overlap.json"
for i in 1 2 3; do inside "ditto-exec run /var/lib/ditto-exec/requests/overlap.json" & done
wait
inside "wc -l < /workspace/overlap.txt"
echo "SIGKILL executor during shell:"
(run bash '{"command":"sleep 6; echo late >> killed.txt"}' killed-shell 2 || true) &
sleep 3
inside "pkill -9 -f '[d]itto-exec run'" || true
wait
run bash '{"command":"sleep 6; echo late >> killed.txt"}' killed-shell 2
echo "killed.txt before the detached shell finishes:"; inside "cat /workspace/killed.txt 2>/dev/null || echo absent"
sleep 8
echo "detached shell after executor kill:"; inside "cat /workspace/killed.txt 2>/dev/null || echo 'killed.txt absent'"
echo "files:"; inside "cat /workspace/src/app.ts /workspace/count.txt"
