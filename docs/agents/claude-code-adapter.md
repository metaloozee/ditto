# Cursor skills in Claude Code

Eight skills here come from `cursor/plugins` and use Cursor names: `blast-radius`, `create-verification-skill`, `how`, `maintain-verification-skill`, `recall`, `technical-writing`, `unslop`, `why`. These are the **Cursor skills**. In Claude Code, read this file once per session, then map each Cursor name in a Cursor skill with the tables below. If a Cursor field has no row, drop it and say so. Pass only fields and values the tool schema accepts.

Adapted from the [upstream Claude Code adapter](https://github.com/cursor/plugins/blob/main/pstack/docs/harness/claude-code.md), which assumes the whole pstack plugin. Here only these eight are installed, as user-level skills in `~/.claude/skills/<name>/`.

## Tools

| Cursor | Claude Code |
| --- | --- |
| `Task` | `Agent` |
| `AskQuestion` | `AskUserQuestion`. In `-p` mode it is absent, so ask in plain text. |
| Open a todolist | Use `TodoWrite` if the session offers it. Otherwise keep the list in your reply and update it at each phase. |
| Run another skill (`/name` or "the **name** skill") | `Read` `~/.claude/skills/<name>/SKILL.md` and follow it. Every Cursor skill sets `disable-model-invocation: true`, so the `Skill` tool refuses them. When you tell the user to type it, write `/<name>`. |
| `Grep`, `Glob` | `Bash` with `rg` when the session has no `Grep` or `Glob`. |

## Missing skills

These are named by the Cursor skills but not installed. When a step routes to one, put one line in your reply, `Skipped in Claude Code: <step>. <skill> is not installed.`, then go on.

| Skill | Named by | Instead |
| --- | --- | --- |
| `poteto-mode` | `how`, `why`, `recall` (picking each subagent's reasoning level and speed) | Choose `effort` per subagent yourself: `high` or `xhigh` for synthesis and judgement, `low` or `medium` for search and sweeps. Drop "fast or standard speed"; it has no field here. No skip line needed. |
| `arena` | `blast-radius` step 6 | Spawn 2–3 `Agent` workers on the same brief, each with a different `model` (`opus`, `sonnet`), and merge their answers. No skip line needed. |
| `session-pickup`, `automate-me` | `recall` step 1 | Routing hints only. Tell the user the skill is absent. |
| `poteto-agent`, `comment-sicko` subagents | — | Use `general-purpose` and say so. |

## Subagent fields

| Cursor | Claude Code |
| --- | --- |
| `subagent_type: generalPurpose` | `subagent_type: "general-purpose"` |
| `readonly: true` | `subagent_type: "Explore"`. It keeps `Bash`, so the brief also says "do not edit files", and you check `git status` afterward. |
| `readonly: false` | `general-purpose`. It keeps the session's MCP servers, which `why` investigators need. |
| `environment: "cloud"` | `isolation: "worktree"`. Name the branch or commit the worker checks out. |
| `environment: "local"` | Omit. |
| `cloud_base_branch: <b>` | Tell the worker to check out `<b>` first. |
| `run_in_background: true` | Omit. Subagents run in the background by default and notify you when they finish. |
| `resume` | Spawn a new agent and paste the earlier result into its brief. |
| `file_attachments` | List the paths in the brief. |

## Models

`how` and `why` read a role line from a `pstack-models` rule, then fall back to a default slug. Map whichever value you end up with:

| Cursor | Claude Code |
| --- | --- |
| `claude-<family>-<version>-<effort>[-fast]`, such as `claude-opus-5-5-xhigh` | `model: "opus"` and `effort: "xhigh"`. `model` takes only `opus`, `sonnet`, `haiku`, `fable`. Drop `-fast`. |
| A `grok-*`, `gpt-*`, or other non-Claude slug | Omit `model` so the agent runs on the session model, and say so. |
| `auto` or `inherit-parent` | Omit `model`. |
| A role value `<model> <effort>`, such as `opus high` | `model: "opus"` and `effort: "high"`. |
| The `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc` | `~/.claude/rules/pstack-models.md`. Claude Code loads every `.md` in `~/.claude/rules/` into each session, so its role lines are already in context. If they are not, read the file. If the file or the role's line is missing, use the skill's default. |

The defaults, mapped:

| Role | Default slug | Claude Code |
| --- | --- | --- |
| `how explorer` | `grok-4.7-xhigh-fast` | omit `model` |
| `how explainer` | `claude-opus-5-5-xhigh` | `opus`, `xhigh` |
| `why investigators` | `grok-4.7-xhigh-fast` | omit `model` |
| `why synthesizer` | `claude-opus-5-5-xhigh` | `opus`, `xhigh` |

The rule file is optional, and `setup-pstack`, the upstream skill that writes it, is not installed. To override a default, write `~/.claude/rules/pstack-models.md` by hand: no frontmatter, one line per role, `<role>: <model> <effort>` (e.g. `how explorer: haiku medium`). Keep role lines out of `CLAUDE.md` and `AGENTS.md`.

## Paths

| Cursor | Claude Code |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | `.claude/skills/`, `~/.claude/skills/`. The generated `verify-<app>` skill goes in `.claude/skills/verify-<app>/`; `npx skills` doesn't manage it, so it is not in `skills-lock.json`. |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | `~/.claude/plugins/`, `.claude-plugin/plugin.json` |
| `.cursor/rules/*.mdc`, always-applied rules | `CLAUDE.md`, or `AGENTS.md` when no `CLAUDE.md` exists. Claude Code never reads `.mdc` files. The model rule is the exception; see Models. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | Only the eight skills are installed, not the upstream `docs/guide/` or `README.md`. Give the user the URL when they need a link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl` | `~/.claude/projects/<slug>/<session>.jsonl`. The slug is the workspace path with each `/`, `\`, `:` and `.` changed to `-`: `/Users/you/proj` is `-Users-you-proj`, `D:\dev\stack` is `D--dev-stack`. The newest `.jsonl` directly in that folder is the current session. Its `<session>/subagents/` folder holds subagent transcripts. Read only this workspace's folder. |

## Cursor-only features

Claude Code has no Cursor Automations, Bugbot, Cursor cloud agents, or built-in PR tool. When a step needs one, put one line in your reply, `Skipped in Claude Code: <step>. <reason>.`, then go on to the next step without stopping, asking, or retrying. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| Cursor | Claude Code |
| --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, routine wakes, and `SendToUser` secret requests | Skip with the line. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents | `environment: "cloud"` maps to a worktree, as in Subagent fields. Skip a step that needs the cloud agent itself, such as its dashboard status or its own machine. |
| A built-in PR tool | Use the forge command the step gives, such as `gh pr create`. That is not a skip, so write no line. |
