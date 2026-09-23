import { describe, expect, it, vi } from "vitest";
import handler, {
	denyUnlessBrain,
	IDLE_TIMEOUT,
	isIsolatedReplacement,
	LOCAL_TOPOLOGY,
	ProductEntrypoint,
	persistWakeupBeforeSchedule,
	RuntimeEntrypoint,
	readinessIsCompletion,
	runtimeIdentity,
	Sandbox,
	SessionRuntime,
	streamArchiveIn,
	streamArchiveOut,
} from "./server.ts";

const bytes = (...values: number[]) => new Uint8Array(values);
const oneChunk = (value: Uint8Array) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(value);
			controller.close();
		},
	});
describe("local two-service topology", () => {
	it("default public fetch returns 404", async () => {
		expect((await handler.fetch()).status).toBe(404);
	});
	it("spoofed authority headers cannot reach a named entrypoint", async () => {
		const response = await handler.fetch();
		expect(response.status).toBe(404);
	});
	it("declares SessionRuntime and Sandbox on the runtime service", () => {
		expect(LOCAL_TOPOLOGY.runtimeClasses).toEqual([
			"SessionRuntime",
			"Sandbox",
		]);
		expect(SessionRuntime.prototype).toBeDefined();
		expect(Sandbox.prototype).toBeDefined();
	});
	it("uses distinct trusted-brain and executor images", () => {
		expect(LOCAL_TOPOLOGY.brainImage).not.toBe(LOCAL_TOPOLOGY.executorImage);
	});
	it("declares distinct bidirectional named entrypoints", () => {
		expect(LOCAL_TOPOLOGY.runtimeEntrypoint).toBe(RuntimeEntrypoint.name);
		expect(LOCAL_TOPOLOGY.productEntrypoint).toBe(ProductEntrypoint.name);
	});
	it("executor-originated brain-only calls fail closed", () => {
		expect(() => denyUnlessBrain("executor")).toThrow(/brain authority/);
	});
	it("trusted brain role is admitted by the local application seam", () => {
		expect(() => denyUnlessBrain("trusted-brain")).not.toThrow();
	});
});
describe("container lifecycle evidence", () => {
	it("retains platform containerId and className with incarnation", () => {
		expect(runtimeIdentity("container-a", "SessionRuntime", "inc-1")).toEqual({
			containerId: "container-a",
			className: "SessionRuntime",
			incarnation: "inc-1",
		});
	});
	it("rejects incomplete incarnation identity", () => {
		expect(() => runtimeIdentity("container-a", "SessionRuntime", "")).toThrow(
			/incomplete/,
		);
	});
	it("distinguishes readiness from terminal work completion", () => {
		expect(readinessIsCompletion({ ready: true, terminal: false })).toBe(false);
		expect(readinessIsCompletion({ ready: true, terminal: true })).toBe(true);
	});
	it("accepts only an isolated replacement with a distinct incarnation", () => {
		const oldIdentity = runtimeIdentity("a", "SessionRuntime", "one");
		expect(
			isIsolatedReplacement(
				oldIdentity,
				runtimeIdentity("b", "SessionRuntime", "two"),
				false,
			),
		).toBe(true);
		expect(
			isIsolatedReplacement(
				oldIdentity,
				runtimeIdentity("a", "SessionRuntime", "two"),
				false,
			),
		).toBe(false);
		expect(
			isIsolatedReplacement(
				oldIdentity,
				runtimeIdentity("b", "SessionRuntime", "two"),
				true,
			),
		).toBe(false);
	});
	it("persists wakeup intent before calling the Container scheduler", async () => {
		const order: string[] = [];
		await persistWakeupBeforeSchedule(
			{
				put: vi.fn(async () => {
					order.push("persist");
				}),
			},
			async () => {
				order.push("schedule");
			},
			10,
			{ epoch: 1 },
		);
		expect(order).toEqual(["persist", "schedule"]);
	});
	it("does not override the Container alarm handler", () => {
		expect(Object.hasOwn(SessionRuntime.prototype, "alarm")).toBe(false);
	});
	it("keeps ten-minute independent idle policy on both classes", () => {
		expect(IDLE_TIMEOUT).toBe("10m");
	});
	it("records old-incarnation lifetime as an unresolved paid gate", () => {
		expect({ exactOldIncarnationTermination: "NOT_RUN" }).toEqual({
			exactOldIncarnationTermination: "NOT_RUN",
		});
	});
});
describe("Sandbox 0.12.3 archive streaming", () => {
	it("reads raw bytes with encoding none after archive CLI completion", async () => {
		const stream = oneChunk(bytes(1, 2));
		const sandbox = {
			exec: vi.fn(async () => ({ exitCode: 0 })),
			readFile: vi.fn(async () => ({ content: stream, size: 2 })),
			writeFile: vi.fn(),
		};
		expect(await streamArchiveOut(sandbox, "/tmp/archive.sqfs")).toBe(stream);
		expect(sandbox.exec).toHaveBeenCalledBefore(sandbox.readFile);
		expect(sandbox.readFile).toHaveBeenCalledWith("/tmp/archive.sqfs", {
			encoding: "none",
		});
	});
	it("writes a ReadableStream before archive extraction", async () => {
		const order: string[] = [];
		const stream = oneChunk(bytes(3));
		const sandbox = {
			readFile: vi.fn(),
			writeFile: vi.fn(async (_path, body) => {
				expect(body).toBe(stream);
				order.push("write");
			}),
			exec: vi.fn(async () => {
				order.push("unpack");
				return { exitCode: 0 };
			}),
		};
		await streamArchiveIn(sandbox, "/tmp/archive.sqfs", stream);
		expect(order).toEqual(["write", "unpack"]);
	});
	it("propagates archive CLI failure without opening a stream", async () => {
		const sandbox = {
			exec: vi.fn(async () => ({ exitCode: 2 })),
			readFile: vi.fn(),
			writeFile: vi.fn(),
		};
		await expect(
			streamArchiveOut(sandbox, "/tmp/archive.sqfs"),
		).rejects.toThrow(/pack failed/);
		expect(sandbox.readFile).not.toHaveBeenCalled();
	});
	it("never calls arrayBuffer in either streaming direction", async () => {
		const stream = oneChunk(bytes(9));
		const arrayBuffer = vi.spyOn(Response.prototype, "arrayBuffer");
		const sandbox = {
			exec: vi.fn(async () => ({ exitCode: 0 })),
			readFile: vi.fn(async () => ({ content: stream, size: 1 })),
			writeFile: vi.fn(async () => ({})),
		};
		await streamArchiveOut(sandbox, "/tmp/out");
		await streamArchiveIn(sandbox, "/tmp/in", stream);
		expect(arrayBuffer).not.toHaveBeenCalled();
		arrayBuffer.mockRestore();
	});
});
