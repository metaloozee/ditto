import { describe, expect, it, vi } from "vitest";
import {
	buildFlueAgentPath,
	buildFlueStreamPath,
	createFlueDispatchAdapter,
	createServiceBindingDispatchFetch,
	createServiceBindingStreamFetch,
	PROJECT_CODER_AGENT_NAME,
} from "./flue-dispatch-adapter";

describe("flue dispatch adapter", () => {
	it("URL-encodes the agent path", () => {
		expect(
			buildFlueAgentPath({
				agentName: "project coder",
				agentInstanceId: "project/one",
			}),
		).toBe("/agents/project%20coder/project%2Fone");
	});

	it("builds long-poll stream paths with optional cursor", () => {
		expect(
			buildFlueStreamPath({
				agentName: "project-coder",
				agentInstanceId: "project/one",
				offset: "42:7",
			}),
		).toBe("/agents/project-coder/project%2Fone?offset=42%3A7&live=long-poll");
		expect(
			buildFlueStreamPath({
				agentName: "project-coder",
				agentInstanceId: "project-1",
				offset: "42",
				cursor: "cursor/one",
			}),
		).toBe(
			"/agents/project-coder/project-1?offset=42&live=long-poll&cursor=cursor%2Fone",
		);
	});

	it("dispatches prompts to the direct agent route", async () => {
		let request: Request | null = null;
		const dispatchFetch = vi.fn(async (nextRequest: Request) => {
			request = nextRequest;
			return new Response(
				JSON.stringify({ streamUrl: "/stream", offset: "10" }),
				{
					status: 202,
				},
			);
		});
		const adapter = createFlueDispatchAdapter({
			dispatchFetch,
			streamFetch: vi.fn(),
			now: () => new Date("2026-07-03T00:00:00.000Z"),
		});

		const receipt = await adapter.dispatch({
			agentName: PROJECT_CODER_AGENT_NAME,
			agentInstanceId: "project-1",
			message: "Inspect the repo",
		});

		const capturedRequest = assertCapturedRequest(request);
		expect(capturedRequest.method).toBe("POST");
		expect(capturedRequest.url).toBe(
			"https://flue.internal/agents/project-coder/project-1",
		);
		expect(capturedRequest.headers.get("Content-Type")).toBe(
			"application/json",
		);
		expect(await capturedRequest.json()).toEqual({
			message: "Inspect the repo",
		});
		expect(receipt).toEqual({
			agentName: PROJECT_CODER_AGENT_NAME,
			agentInstanceId: "project-1",
			streamUrl: "/stream",
			streamOffset: "10",
			submissionId: null,
			acceptedAt: "2026-07-03T00:00:00.000Z",
		});
	});

	it("preserves a future submission id", async () => {
		const adapter = createFlueDispatchAdapter({
			dispatchFetch: vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							streamUrl: "/stream",
							offset: "10",
							submissionId: "submission-1",
						}),
						{ status: 202 },
					),
			),
			streamFetch: vi.fn(),
		});

		await expect(
			adapter.dispatch({
				agentName: PROJECT_CODER_AGENT_NAME,
				agentInstanceId: "project-1",
				message: "Inspect the repo",
			}),
		).resolves.toMatchObject({ submissionId: "submission-1" });
	});

	it("throws compact errors for failed dispatches", async () => {
		const adapter = createFlueDispatchAdapter({
			dispatchFetch: vi.fn(
				async () =>
					new Response(
						JSON.stringify({ error: { message: `${"x".repeat(1200)}` } }),
						{ status: 503, statusText: "Service Unavailable" },
					),
			),
			streamFetch: vi.fn(),
		});

		await expect(
			adapter.dispatch({
				agentName: PROJECT_CODER_AGENT_NAME,
				agentInstanceId: "project-1",
				message: "Inspect the repo",
			}),
		).rejects.toThrow(`Flue dispatch failed: 503 ${"x".repeat(1000)}`);
	});

	it("redacts JSON error body text before throwing dispatch errors", async () => {
		const secret = `sk-test-${"h".repeat(24)}`;
		const adapter = createFlueDispatchAdapter({
			dispatchFetch: vi.fn(
				async () =>
					new Response(
						JSON.stringify({ error: { message: `bad ${secret}` } }),
						{
							status: 500,
						},
					),
			),
			streamFetch: vi.fn(),
		});

		await expect(
			adapter.dispatch({
				agentName: PROJECT_CODER_AGENT_NAME,
				agentInstanceId: "project-1",
				message: "Inspect the repo",
			}),
		).rejects.toThrow("Flue dispatch failed: 500 bad [REDACTED]");
		await expect(
			adapter.dispatch({
				agentName: PROJECT_CODER_AGENT_NAME,
				agentInstanceId: "project-1",
				message: "Inspect the repo",
			}),
		).rejects.not.toThrow(secret);
	});

	it("redacts JSON error body text before throwing stream poll errors", async () => {
		const secret = `ghs_${"i".repeat(40)}`;
		const adapter = createFlueDispatchAdapter({
			dispatchFetch: vi.fn(),
			streamFetch: vi.fn(
				async () =>
					new Response(
						JSON.stringify({ error: { message: `bad ${secret}` } }),
						{
							status: 502,
						},
					),
			),
		});

		await expect(
			adapter.poll({
				agentName: PROJECT_CODER_AGENT_NAME,
				agentInstanceId: "project-1",
				offset: "10",
			}),
		).rejects.toThrow("Flue stream poll failed: 502 bad [REDACTED]");
		await expect(
			adapter.poll({
				agentName: PROJECT_CODER_AGENT_NAME,
				agentInstanceId: "project-1",
				offset: "10",
			}),
		).rejects.not.toThrow(secret);
	});

	it("polls long-poll stream batches", async () => {
		let request: Request | null = null;
		const streamFetch = vi.fn(async (nextRequest: Request) => {
			request = nextRequest;
			return new Response(
				JSON.stringify([{ type: "text_delta", text: "Hi" }]),
				{
					status: 200,
					headers: {
						"Stream-Next-Offset": "11",
						"Stream-Cursor": "cursor-1",
					},
				},
			);
		});
		const adapter = createFlueDispatchAdapter({
			dispatchFetch: vi.fn(),
			streamFetch,
		});

		const result = await adapter.poll({
			agentName: PROJECT_CODER_AGENT_NAME,
			agentInstanceId: "project-1",
			offset: "10",
		});

		const capturedRequest = assertCapturedRequest(request);
		expect(capturedRequest.method).toBe("GET");
		expect(capturedRequest.url).toBe(
			"https://flue.internal/agents/project-coder/project-1?offset=10&live=long-poll",
		);
		expect(result).toEqual({
			events: [{ type: "text_delta", text: "Hi" }],
			nextOffset: "11",
			cursor: "cursor-1",
			closed: false,
		});
	});

	it("treats 204 stream responses as empty event batches", async () => {
		const adapter = createFlueDispatchAdapter({
			dispatchFetch: vi.fn(),
			streamFetch: vi.fn(
				async () =>
					new Response(null, {
						status: 204,
						headers: { "Stream-Next-Offset": "12" },
					}),
			),
		});

		await expect(
			adapter.poll({
				agentName: PROJECT_CODER_AGENT_NAME,
				agentInstanceId: "project-1",
				offset: "11",
			}),
		).resolves.toEqual({
			events: [],
			nextOffset: "12",
			cursor: null,
			closed: false,
		});
	});

	it("reports closed streams", async () => {
		const adapter = createFlueDispatchAdapter({
			dispatchFetch: vi.fn(),
			streamFetch: vi.fn(
				async () =>
					new Response(JSON.stringify([]), {
						status: 200,
						headers: {
							"Stream-Next-Offset": "13",
							"Stream-Closed": "true",
						},
					}),
			),
		});

		await expect(
			adapter.poll({
				agentName: PROJECT_CODER_AGENT_NAME,
				agentInstanceId: "project-1",
				offset: "12",
			}),
		).resolves.toMatchObject({ closed: true });
	});

	it("wraps service binding fetches structurally", async () => {
		const response = new Response(null, { status: 204 });
		const binding = { fetch: vi.fn(async () => response) };

		await expect(
			createServiceBindingDispatchFetch(binding)(
				new Request("https://example.com"),
			),
		).resolves.toBe(response);
		await expect(
			createServiceBindingStreamFetch(binding)(
				new Request("https://example.com"),
			),
		).resolves.toBe(response);
		expect(binding.fetch).toHaveBeenCalledTimes(2);
	});
});

function assertCapturedRequest(request: Request | null): Request {
	expect(request).toBeInstanceOf(Request);
	if (!(request instanceof Request)) {
		throw new Error("Expected fake fetch to capture a Request");
	}

	return request;
}
