import { describe, expect, it, vi } from "vitest";

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
});
