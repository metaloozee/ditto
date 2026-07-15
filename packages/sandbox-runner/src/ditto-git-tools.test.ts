import { afterEach, describe, expect, it, vi } from "vitest";
import {
	postAgentGitAction,
	readDittoGitCallbackEnv,
} from "./ditto-git-callback.js";
import {
	DITTO_GIT_PROMPT_GUIDELINES,
	DITTO_OPEN_PULL_REQUEST_DESCRIPTION,
	DITTO_PUSH_BRANCH_DESCRIPTION,
} from "./ditto-git-guidance.js";

describe("ditto-git-guidance", () => {
	it("requires conventional commits and humanized PR copy from commits + diff", () => {
		const guidelines = DITTO_GIT_PROMPT_GUIDELINES.join("\n");
		expect(guidelines).toMatch(/Conventional Commits/);
		expect(guidelines).toMatch(/humanized PR title/);
		expect(guidelines).toMatch(/git log/);
		expect(guidelines).toMatch(/git diff/);
		expect(DITTO_PUSH_BRANCH_DESCRIPTION).toMatch(/Conventional Commits/);
		expect(DITTO_OPEN_PULL_REQUEST_DESCRIPTION).toMatch(/humanized title/);
		expect(DITTO_OPEN_PULL_REQUEST_DESCRIPTION).toMatch(/commits and the diff/);
	});
});

describe("ditto-git-callback", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("returns error when callback env is missing", async () => {
		const result = await postAgentGitAction({
			env: readDittoGitCallbackEnv({}),
			body: { action: "push" },
		});
		expect(result.ok).toBe(false);
		expect(result.text).toContain("Git callback not configured");
	});

	it("posts push action with bearer token", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true, result: { pushed: true } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await postAgentGitAction({
			env: {
				callbackUrl: "http://localhost:5173/api/agent/git",
				callbackToken: "jwt-token-secret",
			},
			body: { action: "push" },
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:5173/api/agent/git",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer jwt-token-secret",
				}),
			}),
		);
		expect(result.ok).toBe(true);
		expect(result.text).not.toContain("jwt-token-secret");
	});
});
