import { describe, expect, it } from "vitest";
import {
	classifyDittoActionRequest,
	DITTO_ACTION_CONTRACT_VERSION,
	DITTO_ACTION_HOST,
	DITTO_ACTION_OPERATION_TYPE,
	DITTO_ACTION_PATH,
	DITTO_GIT_ACTION_ORIGIN,
	MAX_DITTO_ACTION_REQUEST_BODY_BYTES,
	validateDittoActionRequest,
	wrapDittoActionError,
	wrapDittoActionResult,
} from "./ditto-action-contract";

const BOUND = { contractVersion: DITTO_ACTION_CONTRACT_VERSION };

function gitActionRequest(options?: {
	body?: unknown;
	rawBody?: string;
	headers?: HeadersInit;
	url?: string;
	method?: string;
}): Request {
	const body =
		options?.rawBody ?? JSON.stringify(options?.body ?? { action: "push" });
	return new Request(options?.url ?? DITTO_GIT_ACTION_ORIGIN, {
		method: options?.method ?? "POST",
		headers: {
			"content-type": "application/json",
			...Object.fromEntries(new Headers(options?.headers ?? [])),
		},
		body,
	});
}

describe("ditto-action-contract", () => {
	it("exports origin, version, and operation type constants", () => {
		expect(DITTO_GIT_ACTION_ORIGIN).toBe("http://ditto.internal/v1/git-action");
		expect(DITTO_ACTION_HOST).toBe("ditto.internal");
		expect(DITTO_ACTION_PATH).toBe("/v1/git-action");
		expect(DITTO_ACTION_CONTRACT_VERSION).toBe(1);
		expect(DITTO_ACTION_OPERATION_TYPE).toBe("agent_git");
	});

	it("classifies the exact Git action origin as ditto_action", () => {
		expect(classifyDittoActionRequest(gitActionRequest())).toEqual({
			kind: "ditto_action",
			host: "ditto.internal",
		});
	});

	it("classifies host, path, method, scheme, port, and query misses as near-miss", () => {
		expect(
			classifyDittoActionRequest(
				new Request("https://ditto.internal/v1/git-action", { method: "POST" }),
			).kind,
		).toBe("ditto_action_near_miss");
		expect(
			classifyDittoActionRequest(
				new Request("http://ditto.internal:8080/v1/git-action", {
					method: "POST",
				}),
			).kind,
		).toBe("ditto_action_near_miss");
		expect(
			classifyDittoActionRequest(
				new Request("http://ditto.internal/v1/other", { method: "POST" }),
			).kind,
		).toBe("ditto_action_near_miss");
		expect(
			classifyDittoActionRequest(new Request(DITTO_GIT_ACTION_ORIGIN)).kind,
		).toBe("ditto_action_near_miss");
		expect(
			classifyDittoActionRequest(
				new Request("http://ditto.internal/v1/git-action?x=1", {
					method: "POST",
				}),
			).kind,
		).toBe("ditto_action_near_miss");
		expect(
			classifyDittoActionRequest(
				new Request("https://actions.ditto.internal/git"),
			).kind,
		).toBe("ditto_action_near_miss");
	});

	it("classifies unrelated hosts as other", () => {
		expect(
			classifyDittoActionRequest(new Request("https://example.com/")).kind,
		).toBe("other");
		expect(
			classifyDittoActionRequest(
				new Request("https://github.com/acme/app.git/info/refs"),
			).kind,
		).toBe("other");
	});

	it("validates push, status, and openPullRequest bodies", async () => {
		await expect(
			validateDittoActionRequest(
				gitActionRequest({ body: { action: "push" } }),
				BOUND,
			),
		).resolves.toEqual({ ok: true, body: { action: "push" } });
		await expect(
			validateDittoActionRequest(
				gitActionRequest({ body: { action: "status" } }),
				BOUND,
			),
		).resolves.toEqual({ ok: true, body: { action: "status" } });
		await expect(
			validateDittoActionRequest(
				gitActionRequest({
					body: {
						action: "openPullRequest",
						title: "Add page",
						body: "Why it changed",
						baseBranch: "main",
					},
				}),
				BOUND,
			),
		).resolves.toEqual({
			ok: true,
			body: {
				action: "openPullRequest",
				title: "Add page",
				body: "Why it changed",
				baseBranch: "main",
			},
		});
	});

	it("rejects merge, close, identity fields, and extra keys", async () => {
		expect(
			await validateDittoActionRequest(
				gitActionRequest({ body: { action: "merge" } }),
				BOUND,
			),
		).toMatchObject({ ok: false, code: "invalid_action" });
		expect(
			await validateDittoActionRequest(
				gitActionRequest({ body: { action: "close" } }),
				BOUND,
			),
		).toMatchObject({ ok: false, code: "invalid_action" });
		expect(
			await validateDittoActionRequest(
				gitActionRequest({
					body: { action: "push", sessionId: "sess-1" },
				}),
				BOUND,
			),
		).toMatchObject({ ok: false, code: "unknown_field" });
		expect(
			await validateDittoActionRequest(
				gitActionRequest({
					body: { action: "push", title: "nope" },
				}),
				BOUND,
			),
		).toMatchObject({ ok: false, code: "unknown_field" });
		expect(
			await validateDittoActionRequest(
				gitActionRequest({
					body: {
						action: "openPullRequest",
						branch: "attacker",
					},
				}),
				BOUND,
			),
		).toMatchObject({ ok: false, code: "unknown_field" });
	});

	it("rejects duplicate JSON keys, malformed JSON, and oversized bodies", async () => {
		expect(
			await validateDittoActionRequest(
				gitActionRequest({
					rawBody: '{"action":"push","action":"status"}',
				}),
				BOUND,
			),
		).toMatchObject({ ok: false, code: "duplicate_field" });
		expect(
			await validateDittoActionRequest(
				gitActionRequest({ rawBody: "{not json" }),
				BOUND,
			),
		).toMatchObject({ ok: false, code: "malformed_json" });
		expect(
			await validateDittoActionRequest(
				gitActionRequest({
					rawBody: `{"action":"push","pad":"${"x".repeat(MAX_DITTO_ACTION_REQUEST_BODY_BYTES)}"}`,
				}),
				BOUND,
			),
		).toMatchObject({ ok: false, code: "body_too_large" });
	});

	it("rejects authorization and other forbidden headers", async () => {
		expect(
			await validateDittoActionRequest(
				gitActionRequest({
					headers: { authorization: "Bearer stolen" },
				}),
				BOUND,
			),
		).toMatchObject({ ok: false, code: "forbidden_header" });
		expect(
			await validateDittoActionRequest(
				gitActionRequest({
					headers: { cookie: "x=1" },
				}),
				BOUND,
			),
		).toMatchObject({ ok: false, code: "forbidden_header" });
		expect(
			await validateDittoActionRequest(
				gitActionRequest({
					headers: { "x-forwarded-for": "1.1.1.1" },
				}),
				BOUND,
			),
		).toMatchObject({ ok: false, code: "forbidden_header" });
	});

	it("wraps a bounded redacted success result", async () => {
		const secret = "proj-fixture-secret-value-01";
		const response = wrapDittoActionResult(
			{ pushed: true, note: `token=${secret}` },
			[secret],
		);
		expect(response.status).toBe(200);
		const body: unknown = await response.json();
		const text = JSON.stringify(body);
		expect(text).not.toContain(secret);
		expect(text).toContain("[REDACTED]");
		expect(body).toMatchObject({ ok: true, result: { pushed: true } });
	});

	it("wraps handler failures as a generic sandbox-visible error", async () => {
		const secret = "proj-fixture-secret-value-01";
		const response = wrapDittoActionError(409, [secret]);
		expect(response.status).toBe(409);
		const body = (await response.json()) as {
			ok: boolean;
			error: string;
		};
		expect(body).toEqual({ ok: false, error: "Git action failed." });
		expect(JSON.stringify(body)).not.toContain(secret);
	});
});
