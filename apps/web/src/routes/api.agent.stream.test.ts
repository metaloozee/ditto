import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * Full POST handler import pulls `cloudflare:workers` and TanStack route
 * bootstrap. Mock those modules and capture the handler; lifecycle is
 * exercised via injectable prepare/execute mocks plus source-shape checks.
 */

const prepareAgentRunMock = vi.hoisted(() => vi.fn());
const executeAgentRunMock = vi.hoisted(() => vi.fn());
const createAuthMock = vi.hoisted(() => vi.fn());
const createDbMock = vi.hoisted(() => vi.fn());
const encodeSseEventMock = vi.hoisted(() =>
	vi.fn((event: string, data: unknown) => {
		return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	}),
);

const routeOptions = vi.hoisted(() => ({
	current: null as null | {
		server: {
			handlers: {
				POST: (ctx: { request: Request }) => Promise<Response>;
			};
		};
	},
}));

vi.mock("cloudflare:workers", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret",
		OPENCODE_API_KEY: "sk-test",
		AI_CREDENTIALS_ENCRYPTION_KEY: "ai-credentials-encryption-key-test-aaaa",
	},
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute:
		(_path: string) =>
		(options: {
			server: {
				handlers: {
					POST: (ctx: { request: Request }) => Promise<Response>;
				};
			};
		}) => {
			routeOptions.current = options;
			return options;
		},
}));

vi.mock("#/db", () => ({
	createDb: createDbMock,
}));

vi.mock("#/lib/auth", () => ({
	createAuth: createAuthMock,
}));

vi.mock("#/lib/agent-run-service", () => ({
	agentStreamBodySchema: z.object({
		projectId: z.string().min(1),
		sessionId: z.string().min(1).optional(),
		message: z.string().trim().min(1),
		model: z.string().min(1),
	}),
	prepareAgentRun: prepareAgentRunMock,
	executeAgentRun: executeAgentRunMock,
}));

vi.mock("#/lib/agent-stream-protocol", () => ({
	encodeSseEvent: encodeSseEventMock,
}));

await import("./api.agent.stream");

function getPostHandler() {
	const handler = routeOptions.current?.server.handlers.POST;
	if (!handler) {
		throw new Error("POST handler was not captured from createFileRoute");
	}
	return handler;
}

function authed() {
	createAuthMock.mockReturnValue({
		api: {
			getSession: vi.fn().mockResolvedValue({
				user: { id: "user-1" },
			}),
		},
	});
}

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function postJson(body: unknown): Promise<Response> {
	return getPostHandler()({
		request: new Request("http://localhost/api/agent/stream", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	});
}

const STREAM_BODY = {
	projectId: "proj-1",
	message: "hi",
	model: "opencode/deepseek-v4-flash-free",
} as const;

function readyPrepare() {
	prepareAgentRunMock.mockResolvedValue({
		kind: "ready",
		context: {
			sessionId: "sess-1",
			assistantMessageId: "asst-1",
		},
	});
}

async function readFirstChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
	const first = await reader.read();
	expect(first.done).toBe(false);
	expect(first.value).toBeInstanceOf(Uint8Array);
	return first.value;
}

function bodyReader(
	response: Response,
): ReadableStreamDefaultReader<Uint8Array> {
	const body = response.body;
	expect(body).not.toBeNull();
	if (!body) {
		throw new Error("expected response body");
	}
	return body.getReader();
}

describe("api.agent.stream POST adapter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDbMock.mockReturnValue({});
		authed();
	});

	it("returns 401 when unauthenticated", async () => {
		createAuthMock.mockReturnValue({
			api: { getSession: vi.fn().mockResolvedValue(null) },
		});

		const response = await getPostHandler()({
			request: new Request("http://localhost/api/agent/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					projectId: "p1",
					message: "hi",
					model: "opencode/deepseek-v4-flash-free",
				}),
			}),
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
		expect(prepareAgentRunMock).not.toHaveBeenCalled();
	});

	it("returns 400 for invalid JSON body", async () => {
		const response = await getPostHandler()({
			request: new Request("http://localhost/api/agent/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{not-json",
			}),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid JSON body." });
	});

	it("returns 400 for malformed request body", async () => {
		const response = await postJson({ projectId: "p1" });
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe("Invalid request.");
		expect(prepareAgentRunMock).not.toHaveBeenCalled();
	});

	it("maps prepareAgentRun errors to HTTP responses", async () => {
		prepareAgentRunMock.mockResolvedValue({
			kind: "error",
			status: 409,
			body: { error: "Failed to prepare session worktree." },
		});

		const response = await postJson({
			projectId: "proj-1",
			message: "hi",
			model: "opencode/deepseek-v4-flash-free",
		});

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: "Failed to prepare session worktree.",
		});
		expect(executeAgentRunMock).not.toHaveBeenCalled();
	});

	it("encodes SSE events from executeAgentRun in order", async () => {
		readyPrepare();

		executeAgentRunMock.mockImplementation(async ({ emit }) => {
			emit({
				event: "meta",
				data: {
					sessionId: "sess-1",
					userMessageId: "u1",
					assistantMessageId: "asst-1",
					createdSession: false,
					sandboxState: "ready",
				},
			});
			emit({ event: "delta", data: { delta: "Hi" } });
			emit({
				event: "done",
				data: {
					ok: true,
					assistantMessageId: "asst-1",
					content: "Hi",
				},
			});
		});

		const response = await postJson({
			projectId: "proj-1",
			message: "hi",
			model: "opencode/deepseek-v4-flash-free",
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/event-stream");
		const text = await response.text();
		expect(text).toContain("event: meta");
		expect(text).toContain("event: delta");
		expect(text).toContain("event: done");
		const metaAt = text.indexOf("event: meta");
		const deltaAt = text.indexOf("event: delta");
		const doneAt = text.indexOf("event: done");
		expect(metaAt).toBeGreaterThanOrEqual(0);
		expect(deltaAt).toBeGreaterThan(metaAt);
		expect(doneAt).toBeGreaterThan(deltaAt);
	});
});

describe("api.agent.stream disconnect delivery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDbMock.mockReturnValue({});
		authed();
		readyPrepare();
	});

	it("detaches during text without stopping execution markers", async () => {
		const phaseReached = deferred();
		const release = deferred();
		const executionFinished = deferred();
		const markers: string[] = [];
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		executeAgentRunMock.mockImplementation(async ({ emit }) => {
			try {
				emit({
					event: "meta",
					data: {
						sessionId: "sess-1",
						userMessageId: "u1",
						assistantMessageId: "asst-1",
						createdSession: false,
						sandboxState: "ready",
					},
				});
				emit({ event: "delta", data: { delta: "Hi" } });
				phaseReached.resolve();
				await release.promise;
				emit({ event: "delta", data: { delta: " there" } });
				markers.push("terminal-persistence");
				markers.push("backup");
				emit({
					event: "done",
					data: {
						ok: true,
						assistantMessageId: "asst-1",
						content: "Hi there",
					},
				});
				executionFinished.resolve();
			} catch (error) {
				executionFinished.reject(error);
				throw error;
			}
		});

		const response = await postJson(STREAM_BODY);
		const reader = bodyReader(response);
		await phaseReached.promise;
		await readFirstChunk(reader);

		const encodeCountAtCancel = encodeSseEventMock.mock.calls.length;
		const cancellation = reader.cancel("navigation");
		release.resolve();

		await expect(cancellation).resolves.toBeUndefined();
		await expect(executionFinished.promise).resolves.toBeUndefined();
		expect(markers).toEqual(["terminal-persistence", "backup"]);
		expect(encodeSseEventMock.mock.calls.length).toBe(encodeCountAtCancel);
		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("detaches during tool progress without stopping execution markers", async () => {
		const phaseReached = deferred();
		const release = deferred();
		const executionFinished = deferred();
		const markers: string[] = [];
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		executeAgentRunMock.mockImplementation(async ({ emit }) => {
			try {
				emit({
					event: "meta",
					data: {
						sessionId: "sess-1",
						userMessageId: "u1",
						assistantMessageId: "asst-1",
						createdSession: false,
						sandboxState: "ready",
					},
				});
				emit({
					event: "agent",
					data: {
						type: "tool_execution_start",
						toolCallId: "tool-1",
						toolName: "bash",
					},
				});
				phaseReached.resolve();
				await release.promise;
				emit({
					event: "agent",
					data: {
						type: "tool_execution_update",
						toolCallId: "tool-1",
						toolName: "bash",
					},
				});
				emit({
					event: "agent",
					data: {
						type: "tool_execution_end",
						toolCallId: "tool-1",
						toolName: "bash",
					},
				});
				markers.push("terminal-persistence");
				markers.push("backup");
				emit({
					event: "done",
					data: {
						ok: true,
						assistantMessageId: "asst-1",
						content: "",
					},
				});
				executionFinished.resolve();
			} catch (error) {
				executionFinished.reject(error);
				throw error;
			}
		});

		const response = await postJson(STREAM_BODY);
		const reader = bodyReader(response);
		await phaseReached.promise;
		await readFirstChunk(reader);

		const encodeCountAtCancel = encodeSseEventMock.mock.calls.length;
		const cancellation = reader.cancel("navigation");
		release.resolve();

		await expect(cancellation).resolves.toBeUndefined();
		await expect(executionFinished.promise).resolves.toBeUndefined();
		expect(markers).toEqual(["terminal-persistence", "backup"]);
		expect(encodeSseEventMock.mock.calls.length).toBe(encodeCountAtCancel);
		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("detaches at queued follow-up boundary without stopping execution markers", async () => {
		const phaseReached = deferred();
		const release = deferred();
		const executionFinished = deferred();
		const markers: string[] = [];
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		executeAgentRunMock.mockImplementation(async ({ emit }) => {
			try {
				emit({
					event: "meta",
					data: {
						sessionId: "sess-1",
						userMessageId: "u1",
						assistantMessageId: "asst-1",
						createdSession: false,
						sandboxState: "ready",
					},
				});
				emit({ event: "delta", data: { delta: "first" } });
				phaseReached.resolve();
				await release.promise;
				emit({
					event: "agent",
					data: { type: "turn_done", assistantMessageId: "asst-1" },
				});
				emit({
					event: "agent",
					data: {
						type: "turn_start",
						userMessageId: "u2",
						assistantMessageId: "asst-2",
					},
				});
				markers.push("follow-up-terminal-persistence");
				markers.push("backup");
				emit({
					event: "done",
					data: {
						ok: true,
						assistantMessageId: "asst-2",
						content: "second",
					},
				});
				executionFinished.resolve();
			} catch (error) {
				executionFinished.reject(error);
				throw error;
			}
		});

		const response = await postJson(STREAM_BODY);
		const reader = bodyReader(response);
		await phaseReached.promise;
		await readFirstChunk(reader);

		const encodeCountAtCancel = encodeSseEventMock.mock.calls.length;
		const cancellation = reader.cancel("navigation");
		release.resolve();

		await expect(cancellation).resolves.toBeUndefined();
		await expect(executionFinished.promise).resolves.toBeUndefined();
		expect(markers).toEqual(["follow-up-terminal-persistence", "backup"]);
		expect(encodeSseEventMock.mock.calls.length).toBe(encodeCountAtCancel);
		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("detaches during terminal settlement without skipping persistence or backup", async () => {
		const phaseReached = deferred();
		const release = deferred();
		const executionFinished = deferred();
		const markers: string[] = [];
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		executeAgentRunMock.mockImplementation(async ({ emit }) => {
			try {
				emit({
					event: "meta",
					data: {
						sessionId: "sess-1",
						userMessageId: "u1",
						assistantMessageId: "asst-1",
						createdSession: false,
						sandboxState: "ready",
					},
				});
				emit({ event: "delta", data: { delta: "Hi" } });
				markers.push("terminal-persistence-started");
				phaseReached.resolve();
				await release.promise;
				markers.push("terminal-persistence-complete");
				markers.push("backup");
				emit({
					event: "done",
					data: {
						ok: true,
						assistantMessageId: "asst-1",
						content: "Hi",
					},
				});
				executionFinished.resolve();
			} catch (error) {
				executionFinished.reject(error);
				throw error;
			}
		});

		const response = await postJson(STREAM_BODY);
		const reader = bodyReader(response);
		await phaseReached.promise;
		await readFirstChunk(reader);

		const encodeCountAtCancel = encodeSseEventMock.mock.calls.length;
		const cancellation = reader.cancel("navigation");
		release.resolve();

		await expect(cancellation).resolves.toBeUndefined();
		await expect(executionFinished.promise).resolves.toBeUndefined();
		expect(markers).toEqual([
			"terminal-persistence-started",
			"terminal-persistence-complete",
			"backup",
		]);
		expect(encodeSseEventMock.mock.calls.length).toBe(encodeCountAtCancel);
		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("errors an attached reader once on unexpected executeAgentRun escape", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const phaseReached = deferred();
		const release = deferred();

		executeAgentRunMock.mockImplementation(async ({ emit }) => {
			emit({
				event: "meta",
				data: {
					sessionId: "sess-1",
					userMessageId: "u1",
					assistantMessageId: "asst-1",
					createdSession: false,
					sandboxState: "ready",
				},
			});
			phaseReached.resolve();
			await release.promise;
			throw new Error("secret-bearing-raw-failure sk-live-xyz");
		});

		const response = await postJson(STREAM_BODY);
		const reader = bodyReader(response);
		// Attach early so stream error does not surface as unhandled rejection.
		const closed = reader.closed.then(
			() => ({ ok: true as const }),
			(error: unknown) => ({ ok: false as const, error }),
		);

		// Start the stream pull without awaiting so start() can reach phaseReached.
		const firstRead = reader.read();
		await phaseReached.promise;
		const first = await firstRead;
		expect(first.done).toBe(false);
		release.resolve();

		let readError: unknown;
		try {
			await reader.read();
		} catch (error) {
			readError = error;
		}
		expect(readError).toBeInstanceOf(Error);
		expect(String(readError)).toContain("agent stream execution failed");
		expect(String(readError)).not.toContain("secret-bearing-raw-failure");
		expect(String(readError)).not.toContain("sk-live-xyz");

		const closedResult = await closed;
		expect(closedResult.ok).toBe(false);
		if (!closedResult.ok) {
			expect(String(closedResult.error)).not.toContain(
				"secret-bearing-raw-failure",
			);
			expect(String(closedResult.error)).not.toContain("sk-live-xyz");
		}

		// Second terminal action must not warn (close after error is a no-op).
		expect(errorSpy).toHaveBeenCalledWith("agent stream execution failed");
		const logged = errorSpy.mock.calls
			.map((call) => call.map(String).join(" "))
			.join("\n");
		expect(logged).not.toContain("secret-bearing-raw-failure");
		expect(logged).not.toContain("sk-live-xyz");
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});
});

describe("api.agent.stream source boundaries", () => {
	it("route is a thin adapter around the run service", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const source = await fs.readFile(
			path.join(import.meta.dirname, "api.agent.stream.ts"),
			"utf8",
		);

		expect(source).toContain("prepareAgentRun");
		expect(source).toContain("executeAgentRun");
		expect(source).toContain("encodeSseEvent");
		expect(source).not.toContain("agent-stream-client");
		expect(source).not.toContain("agent-tool-presentation");
		expect(source).not.toContain("runAgentInSandbox");
		expect(source).not.toContain("ensureSessionWorktree");
		expect(source).not.toContain("persistProjectSandboxBackup");
	});
});
