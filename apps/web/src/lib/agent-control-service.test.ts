import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: vi.fn(),
}));

import { controlAgentRun } from "./agent-control-service";

function makeHarness(
	response: unknown = {
		accepted: true,
		action: "follow_up",
		requestId: "request-1",
		runId: "run-1",
		sessionId: "session-1",
		userMessageId: "user-2",
		assistantMessageId: "assistant-2",
	},
) {
	const writeFile = vi.fn().mockResolvedValue(undefined);
	const deleteFile = vi.fn().mockResolvedValue(undefined);
	const exec = vi.fn().mockResolvedValue({
		success: true,
		stdout: `${JSON.stringify(response)}\n`,
		stderr: "",
		exitCode: 0,
	});
	const shell = {
		id: "control-shell",
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile,
		deleteFile,
		exec,
	};
	const sandbox = {
		createSession: vi.fn().mockResolvedValue(shell),
		deleteSession: vi.fn().mockResolvedValue(undefined),
	};
	const ids = ["request-1", "user-2", "assistant-2"];
	const deps = {
		createId: () => ids.shift() ?? "extra-id",
		loadProjectForUser: vi.fn().mockResolvedValue({
			id: "project-1",
			userId: "user-1",
			status: "ready",
			sandboxId: "sandbox-1",
		}),
		loadOwnedActiveSession: vi.fn().mockResolvedValue({
			id: "session-1",
			projectId: "project-1",
			userId: "user-1",
			status: "active",
		}),
		getProjectSandbox: vi.fn(() => sandbox),
	};
	return { deps, sandbox, shell, writeFile, deleteFile, exec };
}

const followUp = {
	action: "follow_up" as const,
	projectId: "project-1",
	sessionId: "session-1",
	runId: "run-1",
	model: "opencode/deepseek-v4-flash-free" as const,
	message: "do not put this text in the shell command",
};

describe("agent control service", () => {
	beforeEach(() => vi.clearAllMocks());

	it("checks ownership before touching the sandbox", async () => {
		const harness = makeHarness();
		harness.deps.loadProjectForUser.mockResolvedValue(null);
		const result = await controlAgentRun({
			db: {} as never,
			env: {} as Env,
			userId: "foreign-user",
			input: followUp,
			deps: harness.deps as never,
		});
		expect(result).toMatchObject({ kind: "error", status: 404 });
		expect(harness.deps.getProjectSandbox).not.toHaveBeenCalled();
		expect(harness.deps.loadOwnedActiveSession).not.toHaveBeenCalled();
	});

	it("queues a follow-up without inserting D1 rows or shell-interpolating text", async () => {
		const harness = makeHarness();
		const result = await controlAgentRun({
			db: {} as never,
			env: {} as Env,
			userId: "user-1",
			input: followUp,
			deps: harness.deps as never,
		});
		expect(result).toMatchObject({
			kind: "accepted",
			body: {
				requestId: "request-1",
				userMessageId: "user-2",
				assistantMessageId: "assistant-2",
			},
		});
		const job = JSON.parse(harness.writeFile.mock.calls[0][1]);
		expect(job.text).toBe(followUp.message);
		const command = harness.exec.mock.calls[0][0] as string;
		expect(command).toBe(
			"node /opt/ditto-runner/dist/control-cli.js --job '/tmp/ditto-agent-controls/request-1.json'",
		);
		expect(command).not.toContain(followUp.message);
		expect(harness.deleteFile).toHaveBeenCalledTimes(1);
	});

	it("accepts Stop and deletes the temporary job", async () => {
		const harness = makeHarness({
			accepted: true,
			action: "stop",
			requestId: "request-1",
			runId: "run-1",
			sessionId: "session-1",
			removedFollowUpCount: 0,
		});
		const result = await controlAgentRun({
			db: {} as never,
			env: {} as Env,
			userId: "user-1",
			input: {
				action: "stop",
				projectId: "project-1",
				sessionId: "session-1",
				runId: "run-1",
			},
			deps: harness.deps as never,
		});
		expect(result.kind).toBe("accepted");
		expect(harness.deleteFile).toHaveBeenCalledTimes(1);
	});

	it("rejects accepted responses that do not correlate to the generated job", async () => {
		const mismatches = [
			{
				accepted: true,
				action: "follow_up",
				requestId: "wrong-request",
				runId: "run-1",
				sessionId: "session-1",
				userMessageId: "user-2",
				assistantMessageId: "assistant-2",
			},
			{
				accepted: true,
				action: "follow_up",
				requestId: "request-1",
				runId: "wrong-run",
				sessionId: "session-1",
				userMessageId: "user-2",
				assistantMessageId: "assistant-2",
			},
			{
				accepted: true,
				action: "follow_up",
				requestId: "request-1",
				runId: "run-1",
				sessionId: "wrong-session",
				userMessageId: "user-2",
				assistantMessageId: "assistant-2",
			},
			{
				accepted: true,
				action: "follow_up",
				requestId: "request-1",
				runId: "run-1",
				sessionId: "session-1",
				userMessageId: "wrong-user",
				assistantMessageId: "assistant-2",
			},
			{
				accepted: true,
				action: "stop",
				requestId: "request-1",
				runId: "run-1",
				sessionId: "session-1",
				removedFollowUpCount: 0,
			},
			{
				accepted: true,
				action: "follow_up",
				requestId: "request-1",
				runId: "run-1",
				sessionId: "session-1",
				userMessageId: "user-2",
				assistantMessageId: "assistant-2",
				extra: "unexpected",
			},
		];

		for (const response of mismatches) {
			const harness = makeHarness(response);
			const result = await controlAgentRun({
				db: {} as never,
				env: {} as Env,
				userId: "user-1",
				input: followUp,
				deps: harness.deps as never,
			});
			expect(result).toEqual({
				kind: "error",
				status: 409,
				body: { error: "The active agent run is no longer available." },
			});
		}
	});

	it("maps stale and malformed controls to bounded redacted 409 responses", async () => {
		const harness = makeHarness();
		harness.exec.mockResolvedValue({
			success: false,
			stdout: "",
			stderr: "secret provider diagnostic ".repeat(100),
			exitCode: 1,
		});
		const result = await controlAgentRun({
			db: {} as never,
			env: {} as Env,
			userId: "user-1",
			input: followUp,
			deps: harness.deps as never,
		});
		expect(result).toEqual({
			kind: "error",
			status: 409,
			body: { error: "The active agent run is no longer available." },
		});
		expect(JSON.stringify(result)).not.toContain("provider diagnostic");
		expect(harness.deleteFile).toHaveBeenCalledTimes(1);
	});

	it("deletes the temporary job when execution throws", async () => {
		const harness = makeHarness();
		harness.exec.mockRejectedValue(new Error("transport failed"));
		await controlAgentRun({
			db: {} as never,
			env: {} as Env,
			userId: "user-1",
			input: followUp,
			deps: harness.deps as never,
		});
		expect(harness.deleteFile).toHaveBeenCalledTimes(1);
		expect(harness.sandbox.deleteSession).toHaveBeenCalledWith("control-shell");
	});

	it("does not import or invoke the workspace lock", async () => {
		const fs = await import("node:fs/promises");
		const source = await fs.readFile(
			new URL("./agent-control-service.ts", import.meta.url),
			"utf8",
		);
		expect(source).not.toContain("withSessionWorkspaceLock");
	});
});
