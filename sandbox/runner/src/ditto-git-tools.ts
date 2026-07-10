import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
	postAgentGitAction,
	readDittoGitCallbackEnv,
} from "./ditto-git-callback.js";

export const dittoPushBranchTool = defineTool({
	name: "ditto_push_branch",
	label: "Push branch",
	description:
		"Push this session's branch to GitHub via Ditto. Use after local commits exist (use bash/git for status and commit; commit author is Ditto). Use Conventional Commits for git commit -m messages (feat:, fix:, chore:, etc.). Does not create a pull request.",
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
	description:
		"Open a GitHub pull request for this session's branch via Ditto. Commit local changes first (bash/git; author is Ditto). Use Conventional Commits for git commit -m messages (feat:, fix:, chore:, etc.). Optionally set title, body, and baseBranch.",
	parameters: Type.Object({
		title: Type.Optional(Type.String({ description: "Pull request title" })),
		body: Type.Optional(Type.String({ description: "Pull request body" })),
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
