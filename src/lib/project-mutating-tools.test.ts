import { beforeEach, describe, expect, it, vi } from "vitest";

const sandbox = {
	writeFile: vi.fn(async () => {}),
	readFile: vi.fn(async () => ({ isBinary: false, content: "before" })),
	exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
};
const getSandboxMock = vi.hoisted(() => vi.fn(() => sandbox));

vi.mock("cloudflare:workers", () => ({
	DurableObject: class DurableObject {},
}));

vi.mock("@cloudflare/sandbox", () => ({
	getSandbox: getSandboxMock,
}));

const { createMutatingProjectTools, resolveWorkspacePath } = await import(
	"../../.flue/lib/project-mutating-tools"
);
const projectCoder = await import("../../.flue/agents/project-coder");

function createEnv(state: unknown) {
	const fetch = vi.fn(async () => Response.json(state));
	return {
		fetch,
		env: {
			Sandbox: {},
			ProjectCoordinator: {
				idFromName: vi.fn((name: string) => name),
				get: vi.fn(() => ({ fetch })),
			},
		},
	};
}

function activeLeaseState() {
	return {
		projectId: "project-1",
		mutationLease: {
			projectId: "project-1",
			runId: "run-1",
			sessionId: "session-1",
			userId: "user-1",
			mode: "mutating",
			capabilities: "mutating",
			fencingToken: 7,
			admittedAt: "2026-07-04T00:00:00.000Z",
			expiresAt: "2099-01-01T00:00:00.000Z",
		},
		activeReadOnlyRuns: [],
		nextFencingToken: 8,
	};
}

function expiredLeaseState() {
	return {
		projectId: "project-1",
		mutationLease: {
			projectId: "project-1",
			runId: "run-1",
			sessionId: "session-1",
			userId: "user-1",
			mode: "mutating",
			capabilities: "mutating",
			fencingToken: 7,
			admittedAt: "2026-07-04T00:00:00.000Z",
			expiresAt: "1970-01-01T00:00:00.000Z",
		},
		activeReadOnlyRuns: [],
		nextFencingToken: 8,
	};
}

function toolsFor(state = activeLeaseState()) {
	const { env, fetch } = createEnv(state);
	const tools = createMutatingProjectTools(env as never, {
		projectId: "project-1",
		sessionId: "session-1",
		runId: "run-1",
		sandboxId: "sandbox-1",
		fencingToken: 7,
	});
	return { tools, fetch };
}

function tool(tools: Array<{ name: string }>, name: string) {
	const found = tools.find((candidate) => candidate.name === name) as
		| { execute(args: unknown): Promise<unknown> }
		| undefined;
	if (!found) {
		throw new Error(`Missing tool ${name}.`);
	}
	return found;
}

describe("mutating Flue project tools", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("keeps mutating tools out of the read-only agent definition", async () => {
		const config = await projectCoder.default.initialize({
			id: "project-1:sandbox-1",
			env: { Sandbox: {} as never },
			payload: undefined,
		});

		expect(config.tools?.map((candidate) => candidate.name)).not.toContain(
			"write_file",
		);
		expect(config.tools?.map((candidate) => candidate.name)).not.toContain(
			"run_mutating_command",
		);
	});

	it("uses the mutating workflow payload sandbox id instead of the Flue run id", async () => {
		const binding = {};
		await projectCoder.default.initialize({
			id: "flue-workflow-run-id",
			env: { Sandbox: binding as never },
			payload: {
				projectId: "payload-project",
				sessionId: "session-1",
				runId: "ditto-run-1",
				userId: "user-1",
				sandboxId: "payload-sandbox",
				message: "make a change",
				modelSpecifier: "anthropic/claude-sonnet-4-6",
				fencingToken: 7,
			},
		});

		expect(getSandboxMock).toHaveBeenCalledWith(binding, "payload-sandbox");
	});

	it("keeps the merged mutating toolset free of duplicate tool names", async () => {
		const binding = {};
		const payload = {
			projectId: "project-1",
			sessionId: "session-1",
			runId: "run-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
			message: "make a change",
			modelSpecifier: "anthropic/claude-sonnet-4-6",
			fencingToken: 7,
		};
		const config = await projectCoder.default.initialize({
			id: "flue-workflow-run-id",
			env: { Sandbox: binding as never },
			payload,
		});
		const { env } = createEnv(activeLeaseState());
		const mergedNames = [
			...(config.tools?.map((candidate) => candidate.name) ?? []),
			...createMutatingProjectTools(env as never, payload).map(
				(candidate) => candidate.name,
			),
		];

		expect(new Set(mergedNames).size).toBe(mergedNames.length);
	});

	it("rejects path traversal", () => {
		expect(() => resolveWorkspacePath("../secret.txt")).toThrow(
			"Path traversal is not allowed.",
		);
		expect(() => resolveWorkspacePath("/workspace/file.txt")).toThrow(
			"Path must be relative.",
		);
	});

	it("rejects non-allowlisted commands through schema validation", () => {
		const { tools } = toolsFor();
		const commandTool = tool(tools, "run_mutating_command");

		return expect(
			commandTool.execute({
				command: "rm -rf /workspace",
			}),
		).rejects.toThrow();
	});

	it("checks the coordinator lease before writing", async () => {
		const { tools, fetch } = toolsFor();
		const calls: string[] = [];
		fetch.mockImplementationOnce(async () => {
			calls.push("lease");
			return Response.json(activeLeaseState());
		});
		sandbox.writeFile.mockImplementationOnce(async () => {
			calls.push("write");
		});

		await tool(tools, "write_file").execute({
			path: "src/example.ts",
			content: "after",
		});

		expect(calls).toEqual(["lease", "write"]);
		expect(sandbox.writeFile).toHaveBeenCalledWith(
			"/workspace/src/example.ts",
			"after",
		);
	});

	it("rejects stale fencing tokens before writing", async () => {
		const { tools } = toolsFor({
			...activeLeaseState(),
			mutationLease: {
				...activeLeaseState().mutationLease,
				fencingToken: 8,
			},
		});

		await expect(
			tool(tools, "write_file").execute({
				path: "src/example.ts",
				content: "after",
			}),
		).rejects.toThrow("Mutating lease fencing token mismatch.");
	});

	it("rejects an expired lease before writing", async () => {
		const { tools, fetch } = toolsFor(expiredLeaseState());
		const calls: string[] = [];
		fetch.mockImplementationOnce(async () => {
			calls.push("lease");
			return Response.json(expiredLeaseState());
		});
		sandbox.writeFile.mockImplementationOnce(async () => {
			calls.push("write");
		});

		await expect(
			tool(tools, "write_file").execute({
				path: "src/example.ts",
				content: "after",
			}),
		).rejects.toThrow("Mutating lease has expired.");

		expect(calls).toEqual(["lease"]);
		expect(sandbox.writeFile).not.toHaveBeenCalled();
	});
});
