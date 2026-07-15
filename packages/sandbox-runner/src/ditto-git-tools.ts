import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
	postAgentGitAction,
	readDittoGitCallbackEnv,
} from "./ditto-git-callback.js";
import {
	DITTO_GIT_PROMPT_GUIDELINES,
	DITTO_OPEN_PULL_REQUEST_DESCRIPTION,
	DITTO_PUSH_BRANCH_DESCRIPTION,
} from "./ditto-git-guidance.js";

export { DITTO_GIT_PROMPT_GUIDELINES } from "./ditto-git-guidance.js";

export const dittoPushBranchTool = defineTool({
	name: "ditto_push_branch",
	label: "Push branch",
	description: DITTO_PUSH_BRANCH_DESCRIPTION,
	promptSnippet: "Push session branch to GitHub (after local commits)",
	promptGuidelines: [...DITTO_GIT_PROMPT_GUIDELINES],
	parameters: Type.Object({}),
	async execute() {
		const result = await postAgentGitAction({
			env: readDittoGitCallbackEnv(),
			body: { action: "push" },
		});
		return {
			content: [{ type: "text", text: result.text }],
			details: { ok: result.ok },
		};
	},
});

export const dittoOpenPullRequestTool = defineTool({
	name: "ditto_open_pull_request",
	label: "Open pull request",
	description: DITTO_OPEN_PULL_REQUEST_DESCRIPTION,
	promptSnippet: "Open GitHub PR with humanized title/body from commits + diff",
	promptGuidelines: [...DITTO_GIT_PROMPT_GUIDELINES],
	parameters: Type.Object({
		title: Type.Optional(
			Type.String({
				description:
					'Humanized PR title for reviewers (e.g. "Add billing page"). Prefer always setting this after reviewing commits and the diff.',
			}),
		),
		body: Type.Optional(
			Type.String({
				description:
					"Brief PR description of what changed and why, based on commits and the diff. Prefer always setting this. Multi-commit: short summary plus optional bullet list of subjects.",
			}),
		),
		baseBranch: Type.Optional(
			Type.String({ description: "Base branch name (default: repo default)" }),
		),
	}),
	async execute(_toolCallId, params) {
		const body: Record<string, unknown> = { action: "openPullRequest" };
		if (params.title) {
			body.title = params.title;
		}
		if (params.body) {
			body.body = params.body;
		}
		if (params.baseBranch) {
			body.baseBranch = params.baseBranch;
		}

		const result = await postAgentGitAction({
			env: readDittoGitCallbackEnv(),
			body,
		});
		return {
			content: [{ type: "text", text: result.text }],
			details: { ok: result.ok },
		};
	},
});

export const dittoGitCustomTools = [
	dittoPushBranchTool,
	dittoOpenPullRequestTool,
] as const;
