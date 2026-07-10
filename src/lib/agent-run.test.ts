import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_WORKTREE_CWD = "/workspace/.ditto/worktrees/conv-1";

const getProjectSandboxMock = vi.hoisted(() => vi.fn());
const backupSandboxWorkspaceMock = vi.hoisted(() => vi.fn());
const parseSSEStreamMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
	backupSandboxWorkspace: backupSandboxWorkspaceMock,
}));

vi.mock("@cloudflare/sandbox", () => ({
	parseSSEStream: parseSSEStreamMock,
}));

const { runAgentInSandbox } = await import("./agent-run");

function makeEnv(): Env {
	return {
		OPENCODE_API_KEY: "sk-test-key-12345678901234567890",
		BETTER_AUTH_SECRET: "test-better-auth-secret-min-length",
		BETTER_AUTH_URL: "http://localhost:5173",
	} as Env;
}

describe("runAgentInSandbox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("writes job JSON, streams runner output, and backs up workspace", async () => {
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

		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "backup-1",
			dir: "/workspace",
		});

		const onRunnerMessage = vi.fn();
		const result = await runAgentInSandbox({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
			userId: "user-1",
			conversationId: "conv-1",
			cwd: SESSION_WORKTREE_CWD,
			model: "opencode/gpt-4.1",
			prompt: "do the thing",
			onRunnerMessage,
		});

		expect(createSession).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "agent-conv-1",
				cwd: SESSION_WORKTREE_CWD,
				env: expect.objectContaining({
					OPENCODE_API_KEY: makeEnv().OPENCODE_API_KEY,
					DITTO_GIT_CALLBACK_URL: "http://localhost:5173/api/agent/git",
					DITTO_GIT_CALLBACK_TOKEN: expect.any(String),
				}),
			}),
		);
		expect(writeFile).toHaveBeenCalledWith(
			expect.stringMatching(/\/workspace\/\.ditto\/jobs\/.+\.json$/),
			JSON.stringify({
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
		expect(backupSandboxWorkspaceMock).toHaveBeenCalledWith({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
		});
		expect(deleteSession).toHaveBeenCalledWith("agent-conv-1");
		expect(result).toMatchObject({
			ok: true,
			assistantText: "Hello",
			backupStored: true,
		});
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

		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "backup-2",
			dir: "/workspace",
		});

		const onRunnerMessage = vi.fn();
		await runAgentInSandbox({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			projectId: "project-1",
			userId: "user-1",
			conversationId: "conv-2",
			cwd: "/workspace/.ditto/worktrees/conv-2",
			model: "opencode/gpt-4.1",
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
});
