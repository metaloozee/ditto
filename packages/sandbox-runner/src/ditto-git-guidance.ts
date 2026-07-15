/** Shared system-prompt guidelines for local git + Ditto export tools. */
export const DITTO_GIT_PROMPT_GUIDELINES = [
	"Local git only via bash (status, add, commit). Push and open PRs only via ditto_push_branch / ditto_open_pull_request — never git push or gh.",
	"Commit messages must follow Conventional Commits: <type>(optional-scope): <imperative summary>. Types: feat, fix, refactor, perf, docs, test, chore, build, ci, style, revert. Subject ≤72 chars, no trailing period, no AI attribution.",
	"Before opening a PR: review branch commits (git log) and the full change set (git diff / status vs base). Draft a humanized PR title and a short plain-language description of what changed and why, then pass both as title and body.",
	'PR title: human review title (e.g. "Add skills readme"), not a raw conventional subject. PR body: brief summary; list key commits only when multi-commit. Do not invent features not in the commits or diff.',
] as const;

export const DITTO_PUSH_BRANCH_DESCRIPTION =
	"Push this session's branch to GitHub via Ditto. Use after local commits exist. Local commit via bash/git only (author is Ditto); use Conventional Commits for -m messages (feat:, fix:, chore:, …). Does not create a pull request.";

export const DITTO_OPEN_PULL_REQUEST_DESCRIPTION =
	"Open a GitHub pull request for this session's branch via Ditto. Commit local changes first (bash/git; Conventional Commits; author is Ditto). Before calling: inspect commits and the diff, then always pass a humanized title and brief body summarizing the real changes. Optional baseBranch overrides the repo default.";
