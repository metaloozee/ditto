import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlRequest } from "./control-channel.js";
import type { RunnerOut } from "./protocol.js";

const mocks = vi.hoisted(() => ({
	createAgentSession: vi.fn(),
	startControlServer: vi.fn(),
	resolveRunnerModel: vi.fn(),
	controlHandler: undefined as
		| ((request: ControlRequest) => Promise<unknown>)
		| undefined,
	close: vi.fn(async () => undefined),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	createAgentSession: mocks.createAgentSession,
	defineTool: (tool: unknown) => tool,
	SessionManager: { open: () => ({}) },
	SettingsManager: { inMemory: (settings: unknown) => settings },
}));

vi.mock("./runner-model.js", () => ({
	resolveRunnerModel: mocks.resolveRunnerModel,
}));

vi.mock("./control-channel.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./control-channel.js")>();
	return {
		...actual,
		startControlServer: mocks.startControlServer,
	};
});

import { runAgent } from "./run-agent.js";

type SessionHarness = ReturnType<typeof makeSession>;

function makeSession() {
	let subscriber: ((event: unknown) => void) | undefined;
	let resolvePrompt: (() => void) | undefined;
	const order: string[] = [];
	const session = {
		isStreaming: true,
		messages: [],
		subscribe: vi.fn((callback: (event: unknown) => void) => {
			subscriber = callback;
			return vi.fn();
		}),
		prompt: vi.fn(async () => {
			subscriber?.({
				type: "message_start",
				message: { role: "user", content: "initial" },
			});
			await new Promise<void>((resolve) => {
				resolvePrompt = resolve;
			});
		}),
		followUp: vi.fn(async () => undefined),
		steer: vi.fn(),
		clearQueue: vi.fn(() => {
			order.push("clearQueue");
			return { steering: [], followUp: ["second"] };
		}),
		abort: vi.fn(async () => {
			order.push("abort");
			resolvePrompt?.();
		}),
		dispose: vi.fn(),
	};
	return {
		session,
		order,
		emit: (event: unknown) => subscriber?.(event),
		finish: () => resolvePrompt?.(),
	};
}

async function beginRun(
	harness: SessionHarness,
	overrides: Partial<Parameters<typeof runAgent>[0]> = {},
) {
	mocks.createAgentSession.mockResolvedValue({ session: harness.session });
	const events: RunnerOut[] = [];
	const result = runAgent({
		runId: "run-1",
		cwd: path.join(os.tmpdir(), "ditto-run-agent-test"),
		conversationId: "session-1",
		modelSpecifier: "provider/model",
		prompt: "initial",
		agentDir: path.join(os.tmpdir(), "ditto-run-agent-test", "agent"),
		sessionsDir: path.join(os.tmpdir(), "ditto-run-agent-test", "sessions"),
		onEvent: (event) => events.push(event),
		...overrides,
	});
	await vi.waitFor(() => expect(mocks.controlHandler).toBeTypeOf("function"));
	await vi.waitFor(() =>
		expect(harness.session.prompt).toHaveBeenCalledTimes(1),
	);
	return { result, events };
}

const followUp = (requestId: string, text: string): ControlRequest => ({
	action: "follow_up",
	requestId,
	runId: "run-1",
	sessionId: "session-1",
	model: "provider/model",
	text,
	userMessageId: `user-${requestId}`,
	assistantMessageId: `assistant-${requestId}`,
});

describe("runAgent live controls", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.controlHandler = undefined;
		mocks.resolveRunnerModel.mockResolvedValue({
			modelRuntime: { getModel: vi.fn() },
			model: { provider: "provider", id: "model" },
			provider: "provider",
			modelId: "model",
		});
		mocks.startControlServer.mockImplementation(async (options) => {
			mocks.controlHandler = options.handle;
			return { socketPath: "/tmp/test.sock", close: mocks.close };
		});
		delete process.env.OPENCODE_API_KEY;
		delete process.env.DITTO_PI_CREDENTIAL;
	});

	it("passes resolved modelRuntime into createAgentSession without auth.json", async () => {
		const harness = makeSession();
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ditto-agent-"));
		const modelRuntime = { getModel: vi.fn() };
		const model = { provider: "provider", id: "model" };
		mocks.resolveRunnerModel.mockResolvedValue({
			modelRuntime,
			model,
			provider: "provider",
			modelId: "model",
		});
		const { result } = await beginRun(harness, { agentDir });
		harness.finish();
		await result;

		expect(mocks.resolveRunnerModel).toHaveBeenCalledWith("provider/model");
		expect(mocks.createAgentSession).toHaveBeenCalledWith(
			expect.objectContaining({
				modelRuntime,
				model,
			}),
		);
		expect(
			mocks.createAgentSession.mock.calls[0][0].authStorage,
		).toBeUndefined();
		expect(
			mocks.createAgentSession.mock.calls[0][0].modelRegistry,
		).toBeUndefined();
		expect(fs.existsSync(path.join(agentDir, "auth.json"))).toBe(false);
	});

	it("fails cleanly for unknown models without creating auth.json", async () => {
		mocks.resolveRunnerModel.mockResolvedValue({
			error: "Unknown model: provider/missing",
		});
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ditto-agent-"));
		const events: RunnerOut[] = [];
		const result = await runAgent({
			runId: "run-1",
			cwd: path.join(os.tmpdir(), "ditto-run-agent-test"),
			conversationId: "session-1",
			modelSpecifier: "provider/missing",
			prompt: "initial",
			agentDir,
			sessionsDir: path.join(os.tmpdir(), "ditto-run-agent-test", "sessions"),
			onEvent: (event) => events.push(event),
		});
		expect(result.ok).toBe(false);
		expect(events.some((e) => e.kind === "error")).toBe(true);
		expect(mocks.createAgentSession).not.toHaveBeenCalled();
		expect(fs.existsSync(path.join(agentDir, "auth.json"))).toBe(false);
	});

	it("queues follow-ups through followUp and starts metadata FIFO", async () => {
		const harness = makeSession();
		const { result, events } = await beginRun(harness);
		await mocks.controlHandler?.(followUp("1", "first"));
		await mocks.controlHandler?.(followUp("2", "second"));
		harness.emit({
			type: "message_start",
			message: { role: "user", content: "first" },
		});
		harness.emit({
			type: "message_start",
			message: { role: "user", content: [{ type: "text", text: "second" }] },
		});
		harness.finish();
		await result;
		expect(harness.session.followUp).toHaveBeenNthCalledWith(1, "first");
		expect(harness.session.followUp).toHaveBeenNthCalledWith(2, "second");
		expect(harness.session.prompt).toHaveBeenCalledTimes(1);
		expect(harness.session.steer).not.toHaveBeenCalled();
		expect(
			events
				.filter((event) => event.kind === "control_event")
				.map((event) => event.kind === "control_event" && event.event.type),
		).toEqual(["follow_up_started", "follow_up_started"]);
		expect(mocks.close).toHaveBeenCalledTimes(1);
	});

	it("clears pending follow-ups before abort and suppresses generic Stop errors", async () => {
		const harness = makeSession();
		const largeQueuedText = "x".repeat(32_000);
		harness.session.clearQueue.mockImplementation(() => {
			harness.order.push("clearQueue");
			return { steering: [], followUp: [largeQueuedText, largeQueuedText] };
		});
		const { result, events } = await beginRun(harness);
		await mocks.controlHandler?.(followUp("1", "first"));
		await mocks.controlHandler?.(followUp("2", "second"));
		harness.emit({
			type: "message_start",
			message: { role: "user", content: "first" },
		});
		const stop = await mocks.controlHandler?.({
			action: "stop",
			requestId: "stop-1",
			runId: "run-1",
			sessionId: "session-1",
		});
		expect(stop).toMatchObject({
			accepted: true,
			action: "stop",
			removedFollowUpCount: 2,
		});
		expect(JSON.stringify(stop)).not.toContain(largeQueuedText);
		expect(JSON.stringify(stop).length).toBeLessThan(1_000);
		expect(harness.order).toEqual(["clearQueue", "abort"]);
		await expect(
			mocks.controlHandler?.(followUp("3", "after stop")),
		).resolves.toMatchObject({ accepted: false });
		await result;
		expect(
			events.filter(
				(event) =>
					event.kind === "control_event" &&
					event.event.type === "follow_up_cancelled",
			),
		).toHaveLength(1);
		expect(events.some((event) => event.kind === "error")).toBe(false);
		expect(events.at(-1)).toMatchObject({ kind: "done", ok: false });
		expect(mocks.close).toHaveBeenCalledTimes(1);
	});

	it("closes the control socket after prompt failure", async () => {
		const harness = makeSession();
		harness.session.prompt.mockRejectedValueOnce(new Error("provider failed"));
		const { result, events } = await beginRun(harness);
		await result;
		expect(mocks.close).toHaveBeenCalledTimes(1);
		expect(events.some((event) => event.kind === "error")).toBe(true);
	});
});
