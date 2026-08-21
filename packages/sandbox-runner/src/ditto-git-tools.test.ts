import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DITTO_GIT_ACTION_URL,
	postAgentGitAction,
} from "./ditto-git-action.js";
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

describe("ditto-git-action", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("posts push action to the synthetic origin without an Authorization header", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true, result: { pushed: true } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await postAgentGitAction({
			body: { action: "push" },
		});

		expect(fetchMock).toHaveBeenCalledWith(
			DITTO_GIT_ACTION_URL,
			expect.objectContaining({
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ action: "push" }),
			}),
		);
		const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
			string,
			string
		>;
		expect(headers).not.toHaveProperty("Authorization");
		expect(result.ok).toBe(true);
		expect(result.text).toContain("pushed");
	});

	it("returns a generic failure when the Worker denies the operation", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: "denied",
					reasonCode: "operation_not_open",
					correlationId: "corr-1",
				}),
				{
					status: 403,
					headers: {
						"Content-Type": "application/json",
						"x-ditto-deny-reason": "operation_not_open",
						authorization: "Bearer leaked",
					},
				},
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await postAgentGitAction({
			body: { action: "openPullRequest" },
		});

		expect(result.ok).toBe(false);
		expect(result.text).toBe("denied");
		expect(result.text).not.toMatch(/Bearer/i);
		expect(result.text).not.toContain("leaked");
	});

	it("returns a generic failure when the request cannot be sent", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("network down")),
		);

		const result = await postAgentGitAction({
			body: { action: "push" },
		});

		expect(result.ok).toBe(false);
		expect(result.text).toContain("Git action failed");
	});
});
