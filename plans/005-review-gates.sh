#!/usr/bin/env bash
set -u
candidate=/home/ayan/ditto-worktrees/plan-005-codex
evidence=${1:-/home/ayan/ditto/plans/005-review-evidence/initial}
mkdir -p "$evidence"
cd "$candidate" || exit 1
run_gate() {
  name=$1
  shift
  printf '%q ' "$@" > "$evidence/$name.command"
  printf '\n' >> "$evidence/$name.command"
  "$@" > "$evidence/$name.log" 2>&1
  result=$?
  printf '%s\t%s\n' "$name" "$result" >> "$evidence/results.tsv"
  printf '%s: exit %s\n' "$name" "$result"
}
: > "$evidence/results.tsv"
run_gate phase-web pnpm --filter @ditto/web exec vitest run src/lib/session-command.test.ts src/lib/session-runtime-security.test.ts src/lib/sandbox-authority.test.ts src/lib/open-code-contract.test.ts src/lib/git-fetch-contract.test.ts src/lib/git-push-contract.test.ts src/lib/git-receive-pack.test.ts src/lib/privileged-git.test.ts src/lib/git-secret-policy.test.ts
run_gate binding-graph pnpm --filter @ditto/web exec vitest run src/lib/runtime-binding-graph.test.ts
run_gate remote-tools npm test --prefix packages/sandbox-runner -- src/remote-tool.test.ts
run_gate runner-typecheck npm run typecheck --prefix packages/sandbox-runner
run_gate runner-verify pnpm runner:verify
run_gate runtime-typecheck pnpm --filter @ditto/runtime typecheck
run_gate web-typecheck pnpm typecheck
run_gate check pnpm check
run_gate verify pnpm verify
run_gate runtime-verify pnpm runtime:verify
run_gate brain-verify pnpm brain:verify
run_gate diff-check git diff --check
awk -F '\t' '$2 != 0 { failed=1 } END { exit failed }' "$evidence/results.tsv"
