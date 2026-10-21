import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EXEC_VALUES_ENV, initializeExecutor } from "./tool-exec.js";

const SYNTHETIC = "synthetic-project-value-015";
let base: string;
const saved = { argv: process.argv, env: { ...process.env } };

beforeEach(async () => {
	base = fs.mkdtempSync(path.join(os.tmpdir(), "ditto-exec-cli-"));
	fs.mkdirSync(path.join(base, "workspace"));
	await initializeExecutor(path.join(base, "state"), {
		workspaceSessionId: "session",
		generation: 1,
	});
	vi.resetModules();
});
afterEach(() => {
	process.argv = saved.argv;
	process.env = { ...saved.env };
	vi.restoreAllMocks();
	fs.rmSync(base, { recursive: true, force: true });
});

/** Runs the CLI module in-process, as `ditto-exec run <file>` would. */
async function run(command: string, transport: string) {
	const file = path.join(base, "request.json");
	fs.writeFileSync(
		file,
		JSON.stringify({
			version: 1,
			operationId: `op-${Math.random()}`,
			workspaceSessionId: "session",
			executorGeneration: 1,
			epoch: 1,
			deadlineAt: Date.now() + 30_000,
			tool: "bash",
			arguments: { command },
		}),
	);
	process.argv = ["node", "ditto-exec", "run", file];
	process.env.DITTO_EXEC_ROOT = path.join(base, "workspace");
	process.env.DITTO_EXEC_STATE = path.join(base, "state");
	process.env[EXEC_VALUES_ENV] = transport;
	const written: string[] = [];
	vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		written.push(String(chunk));
		return true;
	});
	await import("./tool-exec-cli.js");
	// The transport variable is gone before any tool runs.
	expect(process.env[EXEC_VALUES_ENV]).toBeUndefined();
	await vi.waitFor(() => expect(written).toHaveLength(1), { timeout: 10_000 });
	return JSON.parse(written[0]!) as Record<string, unknown>;
}

it("removes the transport variable first and gives values only to the shell child", async () => {
	const outcome = await run(
		`printf '%s' "$API_TOKEN" > got; printf '%s|%s' "$API_TOKEN" "\${${EXEC_VALUES_ENV}:-absent}"`,
		JSON.stringify({ API_TOKEN: SYNTHETIC }),
	);
	expect(outcome).toMatchObject({
		status: "completed",
		isError: false,
		text: "[REDACTED]|absent",
	});
	expect(fs.readFileSync(path.join(base, "workspace", "got"), "utf8")).toBe(
		SYNTHETIC,
	);
});

it("refuses the operation as known when the transport is malformed, without running it", async () => {
	const outcome = await run("touch ran", "{not json");
	expect(outcome).toMatchObject({
		status: "rejected",
		reason: "invalid",
		message: "Malformed project values",
	});
	expect(fs.existsSync(path.join(base, "workspace", "ran"))).toBe(false);
});
