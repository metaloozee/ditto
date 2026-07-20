import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_WORKTREE_CWD = "/workspace/.ditto/worktrees/conv-1";

const getProjectSandboxMock = vi.hoisted(() => vi.fn());
const parseSSEStreamMock = vi.hoisted(() => vi.fn());
const withSessionWorkspaceLockMock = vi.hoisted(() =>
	vi.fn(async ({ run }: { run: () => Promise<unknown> }) => await run()),
);

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
}));

vi.mock("#/lib/session-workspace-lock", () => ({
	withSessionWorkspaceLock: withSessionWorkspaceLockMock,
}));

vi.mock("@cloudflare/sandbox", () => ({
	parseSSEStream: parseSSEStreamMock,
}));

const { appendRollingTail, runAgentInSandbox, STDERR_TAIL_MAX_CHARS } =
	await import("./agent-run");

function makeEnv(): Env {
	return {
		OPENCODE_API_KEY: "sk-test-key-12345678901234567890",
		AI_CREDENTIALS_ENCRYPTION_KEY: "ai-credentials-encryption-key-test-aaaa",
		BETTER_AUTH_SECRET: "test-better-auth-secret-min-length",
		BETTER_AUTH_URL: "http://localhost:5173",
	} as Env;
}

const RUNTIME_CREDENTIAL_JSON = JSON.stringify({
	type: "api_key",
	key: "sk-test-key-12345678901234567890",
});

describe("runAgentInSandbox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("writes job JSON, streams runner output, and does not create backups itself", async () => {
		const writeFile = vi.fn().mockResolvedValue(undefined);
		const mkdir = vi.fn().mockResolvedValue(undefined);
		const execStream = vi.fn().mockResolvedValue(new ReadableStream());
		const deleteSession = vi.fn().mockResolvedValue(undefined);
		const createSession = vi.fn().mockResolvedValue({
			id: "agent-conv-1",
			writeFile,
			mkdir,
			execStream,
		});

		getProjectSandboxMock.mockReturnValue({
			createSession,
			deleteSession,
		});

		parseSSEStreamMock.mockImplementation(async function* () {
			yield {
				type: "stdout",
				timestamp: new Date().toISOString(),
				data: `${JSON.stringify({ v: 1, kind: "assistant_delta", delta: "Hello" })}\n`,
			};
			yield {
				type: "complete",
				timestamp: new Date().toISOString(),
				exitCode: 0,
			};
		});

		const onRunnerMessage = vi.fn();
		const result = await runAgentInSandbox({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
			userId: "user-1",
			conversationId: "conv-1",
			runId: "run-1",
			cwd: SESSION_WORKTREE_CWD,
			model: "opencode/gpt-4.1",
			runtimeCredentialJson: RUNTIME_CREDENTIAL_JSON,
			prompt: "do the thing",
			envVars: [{ key: "DATABASE_URL", value: "postgres://secret" }],
			onRunnerMessage,
		});
		expect(withSessionWorkspaceLockMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sandboxId: "sandbox-1",
				sessionId: "conv-1",
			}),
		);

		expect(createSession).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "agent-conv-1",
				cwd: SESSION_WORKTREE_CWD,
				env: expect.objectContaining({
					DATABASE_URL: "postgres://secret",
					DITTO_PI_CREDENTIAL: RUNTIME_CREDENTIAL_JSON,
					DITTO_GIT_CALLBACK_URL: "http://localhost:5173/api/agent/git",
					DITTO_GIT_CALLBACK_TOKEN: expect.any(String),
					GIT_AUTHOR_NAME: "Ditto",
					GIT_AUTHOR_EMAIL: "ditto@users.noreply.github.com",
					GIT_COMMITTER_NAME: "Ditto",
					GIT_COMMITTER_EMAIL: "ditto@users.noreply.github.com",
				}),
			}),
		);
		expect(writeFile).toHaveBeenCalledWith(
			expect.stringMatching(/\/workspace\/\.ditto\/jobs\/.+\.json$/),
			JSON.stringify({
				runId: "run-1",
				conversationId: "conv-1",
				model: "opencode/gpt-4.1",
				prompt: "do the thing",
				cwd: SESSION_WORKTREE_CWD,
			}),
		);
		expect(execStream).toHaveBeenCalledWith(
			expect.stringContaining(
				"node /opt/ditto-runner/dist/cli.js --job '/workspace/.ditto/jobs/",
			),
			expect.objectContaining({ cwd: SESSION_WORKTREE_CWD }),
		);
		expect(onRunnerMessage).toHaveBeenCalledWith({
			v: 1,
			kind: "assistant_delta",
			delta: "Hello",
		});
		expect(deleteSession).toHaveBeenCalledWith("agent-conv-1");
		expect(result).toEqual({
			ok: true,
			assistantText: "Hello",
		});
		expect(result).not.toHaveProperty("backupStored");
		expect(result).not.toHaveProperty("backup");
		expect(result).not.toHaveProperty("backupError");
	});

	it("includes optional thinkingLevel in job JSON", async () => {
		const writeFile = vi.fn().mockResolvedValue(undefined);
		const mkdir = vi.fn().mockResolvedValue(undefined);
		const execStream = vi.fn().mockResolvedValue(new ReadableStream());
		const deleteSession = vi.fn().mockResolvedValue(undefined);
		const createSession = vi.fn().mockResolvedValue({
			id: "agent-conv-1",
			writeFile,
			mkdir,
			execStream,
		});

		getProjectSandboxMock.mockReturnValue({
			createSession,
			deleteSession,
		});

		parseSSEStreamMock.mockImplementation(async function* () {
			yield {
				type: "complete",
				timestamp: new Date().toISOString(),
				exitCode: 0,
			};
		});

		await runAgentInSandbox({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
			userId: "user-1",
			conversationId: "conv-1",
			runId: "run-1",
			cwd: SESSION_WORKTREE_CWD,
			model: "opencode/gpt-4.1",
			thinkingLevel: "high",
			runtimeCredentialJson: RUNTIME_CREDENTIAL_JSON,
			prompt: "do the thing",
			onRunnerMessage: vi.fn(),
		});

		expect(writeFile).toHaveBeenCalledWith(
			expect.stringMatching(/\/workspace\/\.ditto\/jobs\/.+\.json$/),
			JSON.stringify({
				runId: "run-1",
				conversationId: "conv-1",
				model: "opencode/gpt-4.1",
				prompt: "do the thing",
				cwd: SESSION_WORKTREE_CWD,
				thinkingLevel: "high",
			}),
		);
	});

	it("flushes held assistant text before tool events", async () => {
		const writeFile = vi.fn().mockResolvedValue(undefined);
		const mkdir = vi.fn().mockResolvedValue(undefined);
		const execStream = vi.fn().mockResolvedValue(new ReadableStream());
		const deleteSession = vi.fn().mockResolvedValue(undefined);
		const createSession = vi.fn().mockResolvedValue({
			id: "agent-conv-order",
			writeFile,
			mkdir,
			execStream,
		});

		getProjectSandboxMock.mockReturnValue({ createSession, deleteSession });
		parseSSEStreamMock.mockImplementation(async function* () {
			const lines = [
				{ v: 1, kind: "assistant_delta", delta: "BEFORE " },
				{
					v: 1,
					kind: "agent_event",
					event: {
						type: "tool_execution_start",
						toolCallId: "tool-1",
						toolName: "read",
					},
				},
				{
					v: 1,
					kind: "agent_event",
					event: {
						type: "tool_execution_end",
						toolCallId: "tool-1",
						toolName: "read",
						isError: false,
					},
				},
				{ v: 1, kind: "assistant_delta", delta: "AFTER" },
				{
					v: 1,
					kind: "done",
					sessionId: "conv-order",
					assistantText: "BEFORE AFTER",
					ok: true,
				},
			];
			yield {
				type: "stdout",
				timestamp: new Date().toISOString(),
				data: `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
			};
			yield {
				type: "complete",
				timestamp: new Date().toISOString(),
				exitCode: 0,
			};
		});

		const onRunnerMessage = vi.fn();
		await runAgentInSandbox({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
			userId: "user-1",
			conversationId: "conv-order",
			runId: "run-order",
			cwd: SESSION_WORKTREE_CWD,
			model: "opencode/gpt-4.1",
			runtimeCredentialJson: RUNTIME_CREDENTIAL_JSON,
			prompt: "check order",
			onRunnerMessage,
		});

		const sequence = onRunnerMessage.mock.calls.map(([message]) => {
			if (message.kind === "assistant_delta") return `text:${message.delta}`;
			if (message.kind === "agent_event") return `tool:${message.event.type}`;
			return message.kind;
		});
		expect(sequence).toEqual([
			"text:BEFORE ",
			"tool:tool_execution_start",
			"tool:tool_execution_end",
			"text:AFTER",
			"done",
		]);
	});

	it("does not pass AbortSignal into sandbox execStream or parseSSEStream", async () => {
		const writeFile = vi.fn().mockResolvedValue(undefined);
		const mkdir = vi.fn().mockResolvedValue(undefined);
		const execStream = vi.fn().mockResolvedValue(new ReadableStream());
		const deleteSession = vi.fn().mockResolvedValue(undefined);
		const createSession = vi.fn().mockResolvedValue({
			id: "agent-conv-2",
			writeFile,
			mkdir,
			execStream,
		});

		getProjectSandboxMock.mockReturnValue({
			createSession,
			deleteSession,
		});

		parseSSEStreamMock.mockImplementation(async function* (
			_stream: ReadableStream,
			signal?: AbortSignal,
		) {
			expect(signal).toBeUndefined();
			yield {
				type: "complete",
				timestamp: new Date().toISOString(),
				exitCode: 0,
			};
		});

		const onRunnerMessage = vi.fn();
		await runAgentInSandbox({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
			userId: "user-1",
			conversationId: "conv-2",
			runId: "run-2",
			cwd: "/workspace/.ditto/worktrees/conv-2",
			model: "opencode/gpt-4.1",
			runtimeCredentialJson: RUNTIME_CREDENTIAL_JSON,
			prompt: "ping",
			onRunnerMessage,
		});

		expect(execStream).toHaveBeenCalledTimes(1);
		const execOptions = execStream.mock.calls[0]?.[1] as Record<
			string,
			unknown
		>;
		expect(execOptions).toEqual({ cwd: "/workspace/.ditto/worktrees/conv-2" });
		expect(execOptions).not.toHaveProperty("signal");
		expect(parseSSEStreamMock).toHaveBeenCalledWith(expect.any(ReadableStream));
		// complete with no runner protocol output should surface an error
		expect(onRunnerMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "error",
				message: "Agent produced no response.",
			}),
		);
	});

	it("appendRollingTail bounds retained length under a multi-MiB stream", () => {
		let tail = "";
		const chunk = "x".repeat(64 * 1024);
		for (let i = 0; i < 40; i += 1) {
			// ~2.5 MiB total across chunks
			tail = appendRollingTail(tail, chunk);
			expect(tail.length).toBeLessThanOrEqual(STDERR_TAIL_MAX_CHARS);
		}
		expect(tail.length).toBe(STDERR_TAIL_MAX_CHARS);
		expect(tail).toBe("x".repeat(STDERR_TAIL_MAX_CHARS));
	});

	it("appendRollingTail keeps the true final characters across chunk boundaries", () => {
		const prefix = "noise-".repeat(2000);
		const suffix = "UNIQUE_TAIL_MARKER_98765";
		let tail = appendRollingTail("", prefix);
		tail = appendRollingTail(tail, suffix);
		expect(tail.length).toBeLessThanOrEqual(STDERR_TAIL_MAX_CHARS);
		expect(tail.endsWith(suffix)).toBe(true);
		expect(tail.slice(-400)).toContain(suffix);
	});

	it("uses only the last 400 stderr chars in exit errors after a huge stream", async () => {
		const writeFile = vi.fn().mockResolvedValue(undefined);
		const mkdir = vi.fn().mockResolvedValue(undefined);
		const execStream = vi.fn().mockResolvedValue(new ReadableStream());
		const deleteSession = vi.fn().mockResolvedValue(undefined);
		const createSession = vi.fn().mockResolvedValue({
			id: "agent-conv-stderr-bound",
			writeFile,
			mkdir,
			execStream,
		});

		getProjectSandboxMock.mockReturnValue({
			createSession,
			deleteSession,
		});

		const marker = "END_OF_STDERR_MARKER_xyz";
		parseSSEStreamMock.mockImplementation(async function* () {
			// Far above the rolling cap; only the tail should appear in the error.
			yield {
				type: "stderr",
				timestamp: new Date().toISOString(),
				data: `${"A".repeat(50_000)}${marker}`,
			};
			yield {
				type: "complete",
				timestamp: new Date().toISOString(),
				exitCode: 7,
			};
		});

		const onRunnerMessage = vi.fn();
		await runAgentInSandbox({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
			userId: "user-1",
			conversationId: "conv-stderr-bound",
			runId: "run-stderr-bound",
			cwd: SESSION_WORKTREE_CWD,
			model: "opencode/gpt-4.1",
			runtimeCredentialJson: RUNTIME_CREDENTIAL_JSON,
			prompt: "fail big",
			onRunnerMessage,
		});

		const errorCall = onRunnerMessage.mock.calls.find(
			(call) => call[0]?.kind === "error",
		);
		const message = errorCall?.[0]?.message as string;
		expect(message).toMatch(/^Agent exited with code 7: /);
		expect(message).toContain(marker);
		// Public surface is still last-400 after trim; not the whole multi-MiB stream.
		const hint = message.slice("Agent exited with code 7: ".length);
		expect(hint.length).toBeLessThanOrEqual(400);
		expect(hint.endsWith(marker)).toBe(true);
		// Leading bulk must not appear.
		expect(message).not.toContain("A".repeat(500));
	});

	it("redacts git callback JWT from stderr error surfaces", async () => {
		let gitCallbackToken = "";
		const writeFile = vi.fn().mockResolvedValue(undefined);
		const mkdir = vi.fn().mockResolvedValue(undefined);
		const execStream = vi.fn().mockResolvedValue(new ReadableStream());
		const deleteSession = vi.fn().mockResolvedValue(undefined);
		const createSession = vi.fn().mockImplementation(async (opts) => {
			gitCallbackToken = opts.env.DITTO_GIT_CALLBACK_TOKEN;
			return { id: "agent-conv-3", writeFile, mkdir, execStream };
		});

		getProjectSandboxMock.mockReturnValue({
			createSession,
			deleteSession,
		});

		parseSSEStreamMock.mockImplementation(async function* () {
			yield {
				type: "stderr",
				timestamp: new Date().toISOString(),
				data: `fatal: auth failed token=${gitCallbackToken}\n`,
			};
			yield {
				type: "complete",
				timestamp: new Date().toISOString(),
				exitCode: 1,
			};
		});

		const onRunnerMessage = vi.fn();
		await runAgentInSandbox({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
			userId: "user-1",
			conversationId: "conv-3",
			runId: "run-3",
			cwd: SESSION_WORKTREE_CWD,
			model: "opencode/gpt-4.1",
			runtimeCredentialJson: RUNTIME_CREDENTIAL_JSON,
			prompt: "fail",
			onRunnerMessage,
		});

		expect(gitCallbackToken.length).toBeGreaterThan(8);
		const errorCall = onRunnerMessage.mock.calls.find(
			(call) => call[0]?.kind === "error",
		);
		expect(errorCall?.[0]).toMatchObject({
			kind: "error",
			message: expect.stringContaining("[REDACTED]"),
		});
		expect(errorCall?.[0]?.message).not.toContain(gitCallbackToken);
	});

	it("redacts project env secrets from assistant_delta (whole and split)", async () => {
		const projectSecret = "postgres://secret-db-url-xyz";
		const writeFile = vi.fn().mockResolvedValue(undefined);
		const mkdir = vi.fn().mockResolvedValue(undefined);
		const execStream = vi.fn().mockResolvedValue(new ReadableStream());
		const deleteSession = vi.fn().mockResolvedValue(undefined);
		const createSession = vi.fn().mockResolvedValue({
			id: "agent-conv-redact-delta",
			writeFile,
			mkdir,
			execStream,
		});

		getProjectSandboxMock.mockReturnValue({
			createSession,
			deleteSession,
		});

		const mid = Math.floor(projectSecret.length / 2);
		parseSSEStreamMock.mockImplementation(async function* () {
			yield {
				type: "stdout",
				timestamp: new Date().toISOString(),
				data: `${JSON.stringify({
					v: 1,
					kind: "assistant_delta",
					delta: `url=${projectSecret.slice(0, mid)}`,
				})}\n`,
			};
			yield {
				type: "stdout",
				timestamp: new Date().toISOString(),
				data: `${JSON.stringify({
					v: 1,
					kind: "assistant_delta",
					delta: `${projectSecret.slice(mid)} done`,
				})}\n`,
			};
			yield {
				type: "stdout",
				timestamp: new Date().toISOString(),
				data: `${JSON.stringify({
					v: 1,
					kind: "done",
					sessionId: "sess",
					assistantText: `url=${projectSecret} done`,
					ok: true,
				})}\n`,
			};
			yield {
				type: "complete",
				timestamp: new Date().toISOString(),
				exitCode: 0,
			};
		});

		const onRunnerMessage = vi.fn();
		const result = await runAgentInSandbox({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
			userId: "user-1",
			conversationId: "conv-redact-delta",
			runId: "run-redact-delta",
			cwd: SESSION_WORKTREE_CWD,
			model: "opencode/gpt-4.1",
			runtimeCredentialJson: RUNTIME_CREDENTIAL_JSON,
			prompt: "echo secret",
			envVars: [{ key: "DATABASE_URL", value: projectSecret }],
			onRunnerMessage,
		});

		const allPayload = JSON.stringify(onRunnerMessage.mock.calls);
		expect(allPayload).not.toContain(projectSecret);
		expect(allPayload).toContain("[REDACTED]");
		expect(result.assistantText).not.toContain(projectSecret);
		expect(result.assistantText).toContain("[REDACTED]");

		const doneCall = onRunnerMessage.mock.calls.find(
			(call) => call[0]?.kind === "done",
		);
		expect(doneCall?.[0]?.assistantText).not.toContain(projectSecret);
		expect(doneCall?.[0]?.assistantText).toContain("[REDACTED]");
	});

	it("redacts nested agent_event tool results containing secrets", async () => {
		const projectSecret = "live-secret-value-123";
		const writeFile = vi.fn().mockResolvedValue(undefined);
		const mkdir = vi.fn().mockResolvedValue(undefined);
		const execStream = vi.fn().mockResolvedValue(new ReadableStream());
		const deleteSession = vi.fn().mockResolvedValue(undefined);
		const createSession = vi.fn().mockResolvedValue({
			id: "agent-conv-redact-event",
			writeFile,
			mkdir,
			execStream,
		});

		getProjectSandboxMock.mockReturnValue({
			createSession,
			deleteSession,
		});

		parseSSEStreamMock.mockImplementation(async function* () {
			yield {
				type: "stdout",
				timestamp: new Date().toISOString(),
				data: `${JSON.stringify({
					v: 1,
					kind: "agent_event",
					event: {
						type: "tool_result",
						toolCallId: "t1",
						toolName: "bash",
						result: {
							stdout: `export KEY=${projectSecret}`,
							args: { cmd: `echo ${projectSecret}` },
						},
					},
				})}\n`,
			};
			yield {
				type: "stdout",
				timestamp: new Date().toISOString(),
				data: `${JSON.stringify({
					v: 1,
					kind: "done",
					sessionId: "sess",
					assistantText: "ok",
					ok: true,
				})}\n`,
			};
			yield {
				type: "complete",
				timestamp: new Date().toISOString(),
				exitCode: 0,
			};
		});

		const onRunnerMessage = vi.fn();
		await runAgentInSandbox({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
			userId: "user-1",
			conversationId: "conv-redact-event",
			runId: "run-redact-event",
			cwd: SESSION_WORKTREE_CWD,
			model: "opencode/gpt-4.1",
			runtimeCredentialJson: RUNTIME_CREDENTIAL_JSON,
			prompt: "run tool",
			envVars: [{ key: "API_TOKEN", value: projectSecret }],
			onRunnerMessage,
		});

		const eventCall = onRunnerMessage.mock.calls.find(
			(call) => call[0]?.kind === "agent_event",
		);
		expect(eventCall?.[0]?.event).toEqual({
			type: "tool_result",
			toolCallId: "t1",
			toolName: "bash",
			result: {
				stdout: "export KEY=[REDACTED]",
				args: { cmd: "echo [REDACTED]" },
			},
		});

		const allPayload = JSON.stringify(onRunnerMessage.mock.calls);
		expect(allPayload).not.toContain(projectSecret);
	});

	it("never surfaces OPENCODE_API_KEY or fixture secrets in any onRunnerMessage payload", async () => {
		const projectSecret = "postgres://secret-db-url-xyz";
		const apiKey = makeEnv().OPENCODE_API_KEY;
		let gitCallbackToken = "";
		const writeFile = vi.fn().mockResolvedValue(undefined);
		const mkdir = vi.fn().mockResolvedValue(undefined);
		const execStream = vi.fn().mockResolvedValue(new ReadableStream());
		const deleteSession = vi.fn().mockResolvedValue(undefined);
		const createSession = vi.fn().mockImplementation(async (opts) => {
			gitCallbackToken = opts.env.DITTO_GIT_CALLBACK_TOKEN;
			return {
				id: "agent-conv-redact-all",
				writeFile,
				mkdir,
				execStream,
			};
		});

		getProjectSandboxMock.mockReturnValue({
			createSession,
			deleteSession,
		});

		parseSSEStreamMock.mockImplementation(async function* () {
			yield {
				type: "stdout",
				timestamp: new Date().toISOString(),
				data: `${JSON.stringify({
					v: 1,
					kind: "assistant_delta",
					delta: `key=${apiKey} db=${projectSecret} jwt=${gitCallbackToken}`,
				})}\n`,
			};
			yield {
				type: "stdout",
				timestamp: new Date().toISOString(),
				data: `${JSON.stringify({
					v: 1,
					kind: "error",
					message: `failed with ${apiKey} and ${projectSecret}`,
				})}\n`,
			};
			yield {
				type: "complete",
				timestamp: new Date().toISOString(),
				exitCode: 1,
			};
		});

		const onRunnerMessage = vi.fn();
		await runAgentInSandbox({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
			userId: "user-1",
			conversationId: "conv-redact-all",
			runId: "run-redact-all",
			cwd: SESSION_WORKTREE_CWD,
			model: "opencode/gpt-4.1",
			runtimeCredentialJson: RUNTIME_CREDENTIAL_JSON,
			prompt: "leak",
			envVars: [{ key: "DATABASE_URL", value: projectSecret }],
			onRunnerMessage,
		});

		const allPayload = JSON.stringify(onRunnerMessage.mock.calls);
		expect(allPayload).not.toContain(apiKey);
		expect(allPayload).not.toContain(projectSecret);
		expect(allPayload).not.toContain(gitCallbackToken);
		expect(allPayload).toContain("[REDACTED]");
	});
});
