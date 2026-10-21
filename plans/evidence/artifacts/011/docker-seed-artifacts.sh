#!/bin/sh
# Disposable local Docker check of seed capture and workspace restore through
# the image-owned archive command. One live container at a time: the builder is
# destroyed and confirmed gone before the workspace executor starts.
# Usage: sh docker-seed-artifacts.sh <image> <runner-dist-dir> <hostile-archive-dir>
set -eu
image="$1"
dist="$2"
hostile="$3"
label=ditto-011-fixture
work=$(mktemp -d)
trap 'docker rm -f $(docker ps -aq --filter "label=$label") >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
live() { docker ps -q --filter "label=$label" | wc -l | tr -d ' '; }
start() {
	[ "$(live)" = 0 ] || { echo "refusing: a fixture container is still live"; exit 1; }
	cid=$(docker run -d --rm --label "$label" -e DITTO_SYNTHETIC_SECRET=must-not-leak --network none --entrypoint sleep "$image" 600)
	docker cp "$dist/archive-cli.js" "$cid:/opt/ditto-runner/dist/archive-cli.js"
}
stop() {
	docker rm -f "$cid" >/dev/null
	while [ "$(live)" != 0 ]; do sleep 1; done
	echo "container $1 terminated; live fixture containers: $(live)"
}
inside() { docker exec "$cid" sh -c "$1"; }
limits="--max-compressed-bytes 1073741824 --max-extracted-bytes 3221225472 --max-disk-percent 100"
temp=/tmp/ditto-workspace-archive.tar.gz
# Exact command shape of sandboxArtifactExecution.extract.
extract() {
	inside "if echo '$1  $temp' | sha256sum -c --status; then find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && node /opt/ditto-runner/dist/archive-cli.js restore $limits --expected-sha256 $1; else echo '{\"ok\":false,\"error\":\"precheck_digest_mismatch\"}'; fi" || true
}
put() { docker cp "$1" "$cid:$temp"; }

echo "== builder: source fixture, capture"
start
inside "mkdir -p /workspace/src /workspace/node_modules/dep && cd /workspace && git init -q -b main && printf 'export const a = 1;\n' > src/a.ts && printf 'PUBLIC=1\n' > .env && echo dep > node_modules/dep/index.js && git -c user.email=t@example.com -c user.name=t add src .env && git -c user.email=t@example.com -c user.name=t commit -qm seed && ln -s src/a.ts alias.ts"
head=$(inside "git -C /workspace rev-parse HEAD")
echo "builder HEAD $head"
inside "node /opt/ditto-runner/dist/archive-cli.js create $limits" | tee "$work/create.json"
docker cp "$cid:$temp" "$work/seed.tar.gz"
digest=$(sha256sum "$work/seed.tar.gz" | cut -d' ' -f1)
size=$(wc -c < "$work/seed.tar.gz" | tr -d ' ')
grep -q "\"digest\":\"$digest\"" "$work/create.json" && grep -q "\"compressedBytes\":$size" "$work/create.json" && echo "streamed bytes match the packed digest and length ($size bytes)"
tar -tzf "$work/seed.tar.gz" | grep -q node_modules && echo "FAIL node_modules archived" || echo "node_modules excluded"
inside "env" | grep -c DITTO_SYNTHETIC_SECRET >/dev/null && echo "archive command env holds no storage values: $(inside 'env' | grep -ci -e R2_ -e BUCKET -e X-Amz || true) matches"
stop builder

echo "== executor: restore seed"
start
inside "mkdir -p /workspace && echo stale > /workspace/stale.txt"
put "$work/seed.tar.gz"
extract "$digest"
echo
echo "restored HEAD $(inside 'git -C /workspace rev-parse HEAD') status [$(inside 'git -C /workspace status --porcelain | tr "\n" " "')]"
inside "ls -A /workspace | tr '\n' ' '; echo; readlink /workspace/alias.ts; test ! -e /workspace/stale.txt && echo stale file removed"

echo "== interrupted upload: partial temp file with the full digest"
head -c 100 "$work/seed.tar.gz" > "$work/partial.tar.gz"
put "$work/partial.tar.gz"
extract "$digest"
echo
inside "git -C /workspace rev-parse HEAD; echo workspace untouched"

echo "== corrupt archive whose own digest is passed"
pdigest=$(sha256sum "$work/partial.tar.gz" | cut -d' ' -f1)
put "$work/partial.tar.gz"
extract "$pdigest"
echo
echo "workspace entries after a failed extraction: $(inside 'ls -A /workspace | wc -l')"

for name in traversal absolute symlink-escape ambiguous-symlink hardlink-escape device; do
	echo "== hostile archive: $name"
	inside "mkdir -p /workspace"
	hd=$(sha256sum "$hostile/$name.tar.gz" | cut -d' ' -f1)
	put "$hostile/$name.tar.gz"
	extract "$hd"
	echo
	inside "ls -A /workspace | tr '\n' ' '; echo; ls / | grep -c escape || true; test -L /workspace/evil && echo 'evil symlink present' || true"
done
inside "test ! -e /tmp/escape.txt && test ! -e /escape.txt && echo no file outside the workspace"
stop executor
