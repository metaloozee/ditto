import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	sendControlRequest,
	socketPathForRun,
	startControlServer,
	type ControlRequest,
} from "./control-channel.js";
import { parseControlCliArgs, parseControlJob } from "./control-cli.js";

const followUp = (overrides: Partial<ControlRequest> = {}) =>
	({
		action: "follow_up",
		requestId: "req-1",
		runId: "run-1",
		sessionId: "session-1",
		model: "provider/model",
		text: "Please continue",
		userMessageId: "user-2",
		assistantMessageId: "assistant-2",
		...overrides,
	}) as ControlRequest;

describe("runner control channel", () => {
	it("round-trips a follow-up over a Unix socket", async () => {
		const server = await startControlServer({
			runId: "run-1",
			sessionId: "session-1",
			handle: async (request) => ({
				accepted: true,
				action: "follow_up",
				requestId: request.requestId,
				runId: request.runId,
				sessionId: request.sessionId,
				userMessageId: "user-2",
				assistantMessageId: "assistant-2",
			}),
		});
		try {
			await expect(sendControlRequest(followUp())).resolves.toMatchObject({
				accepted: true,
				action: "follow_up",
				requestId: "req-1",
			});
		} finally {
			await server.close();
		}
	});

	it("serializes concurrent commands in arrival order", async () => {
		const order: string[] = [];
		const server = await startControlServer({
			runId: "run-1",
			sessionId: "session-1",
			handle: async (request) => {
				order.push(`start:${request.requestId}`);
				await new Promise((resolve) => setTimeout(resolve, 10));
				order.push(`end:${request.requestId}`);
				return {
					accepted: true,
					action: "follow_up",
					requestId: request.requestId,
					runId: request.runId,
					sessionId: request.sessionId,
					userMessageId: "user-2",
					assistantMessageId: "assistant-2",
				};
			},
		});
		try {
			await Promise.all([
				sendControlRequest(followUp({ requestId: "first" })),
				sendControlRequest(followUp({ requestId: "second" })),
			]);
			expect(order).toEqual([
				"start:first",
				"end:first",
				"start:second",
				"end:second",
			]);
		} finally {
			await server.close();
		}
	});

	it("rejects malformed, oversized, and mismatched requests", async () => {
		const socketPath = path.join(os.tmpdir(), `ditto-test-${process.pid}.sock`);
		const server = await startControlServer({
			runId: "run-1",
			sessionId: "session-1",
			socketPath,
			handle: async () => {
				throw new Error("must not run");
			},
		});
		try {
			await expect(
				sendControlRequest(followUp({ runId: "wrong" }), { socketPath }),
			).resolves.toMatchObject({ accepted: false });
			expect(() => parseControlJob("not json")).toThrow("valid JSON");
			expect(() =>
				parseControlJob(
					JSON.stringify(followUp({ text: "x".repeat(70_000) })),
				),
			).toThrow("Invalid follow-up");
		} finally {
			await server.close();
		}
	});

	it("unlinks stale sockets before listen and after close", async () => {
		const socketPath = path.join(os.tmpdir(), `ditto-stale-${process.pid}.sock`);
		fs.writeFileSync(socketPath, "stale");
		const server = await startControlServer({
			runId: "run-1",
			sessionId: "session-1",
			socketPath,
			handle: async () => ({ accepted: false, message: "unused" }),
		});
		expect(fs.statSync(socketPath).isSocket()).toBe(true);
		await server.close();
		expect(fs.existsSync(socketPath)).toBe(false);
	});

	it("derives a short normalized socket path", () => {
		const socketPath = socketPathForRun("../unsafe/".repeat(20));
		expect(socketPath).toMatch(/^\/tmp\/ditto-agent-[a-f0-9]{32}\.sock$/);
		expect(socketPath.length).toBeLessThan(100);
	});

	it("CLI accepts user text only through the job file", () => {
		expect(parseControlCliArgs(["--job", "/tmp/job.json"])).toEqual({
			jobPath: "/tmp/job.json",
		});
		expect(parseControlCliArgs(["--job", "/tmp/job.json", "secret"])).toEqual({
			error: "Usage: control-cli --job <path>",
		});
		expect(parseControlJob(JSON.stringify(followUp())).action).toBe("follow_up");
	});
});
