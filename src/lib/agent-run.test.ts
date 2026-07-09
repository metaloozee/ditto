import { beforeEach, describe, expect, it, vi } from "vitest";

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
			conversationId: "conv-1",
			model: "opencode/gpt-4.1",
			prompt: "do the thing",
			onRunnerMessage,
		});

		expect(createSession).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "agent-conv-1",
				cwd: "/workspace",
			}),
		);
		expect(writeFile).toHaveBeenCalledWith(
			expect.stringMatching(/\/workspace\/\.ditto\/jobs\/.+\.json$/),
			JSON.stringify({
				conversationId: "conv-1",
				model: "opencode/gpt-4.1",
				prompt: "do the thing",
				cwd: "/workspace",
			}),
		);
		expect(execStream).toHaveBeenCalledWith(
			expect.stringContaining(
				"node /opt/ditto-runner/dist/cli.js --job '/workspace/.ditto/jobs/",
			),
			expect.objectContaining({ cwd: "/workspace" }),
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
});
