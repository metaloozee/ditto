import { describe, expect, it, vi } from "vitest";
import { createDeltaBatcher } from "./agent-delta-batcher";

/**
 * Explicit fake schedule: records callbacks; tests flush them manually.
 * Never asserts wall-clock timing.
 */
function createFakeSchedule() {
	const pending: Array<() => void> = [];
	const schedule = (cb: () => void) => {
		pending.push(cb);
		let cancelled = false;
		return () => {
			cancelled = true;
			const index = pending.indexOf(cb);
			if (index >= 0) {
				pending.splice(index, 1);
			}
			void cancelled;
		};
	};
	return {
		schedule,
		flushNext: () => {
			const cb = pending.shift();
			cb?.();
		},
		pendingCount: () => pending.length,
	};
}

describe("createDeltaBatcher", () => {
	it("merges contiguous pushes into one flush", () => {
		const onFlush = vi.fn();
		const fake = createFakeSchedule();
		const batcher = createDeltaBatcher({
			onFlush,
			schedule: fake.schedule,
		});

		batcher.push("Hel");
		batcher.push("lo");
		batcher.push("!");
		expect(onFlush).not.toHaveBeenCalled();
		expect(fake.pendingCount()).toBe(1);

		fake.flushNext();
		expect(onFlush).toHaveBeenCalledTimes(1);
		expect(onFlush).toHaveBeenCalledWith("Hello!");
		expect(fake.pendingCount()).toBe(0);
	});

	it("many token chunks become a bounded number of flushes", () => {
		const onFlush = vi.fn();
		const fake = createFakeSchedule();
		const batcher = createDeltaBatcher({
			onFlush,
			schedule: fake.schedule,
		});

		const tokens = Array.from({ length: 1000 }, (_, i) => `t${i}`);
		for (const token of tokens) {
			batcher.push(token);
		}
		// One scheduled flush for the whole contiguous burst.
		expect(fake.pendingCount()).toBe(1);
		fake.flushNext();
		expect(onFlush).toHaveBeenCalledTimes(1);
		expect(onFlush.mock.calls[0]?.[0]).toBe(tokens.join(""));

		// Second burst after the first flush schedules another.
		batcher.push("more");
		batcher.push("text");
		expect(fake.pendingCount()).toBe(1);
		fake.flushNext();
		expect(onFlush).toHaveBeenCalledTimes(2);
		expect(onFlush.mock.calls[1]?.[0]).toBe("moretext");
		expect(onFlush.mock.calls.map((c) => c[0] as string).join("")).toBe(
			`${tokens.join("")}moretext`,
		);
	});

	it("sync flush before a tool-like boundary splits batches", () => {
		const flushes: string[] = [];
		const fake = createFakeSchedule();
		const batcher = createDeltaBatcher({
			onFlush: (delta) => flushes.push(delta),
			schedule: fake.schedule,
		});

		batcher.push("before ");
		batcher.push("tool");
		// Caller flushes before emitting a non-text event.
		batcher.flush();
		expect(flushes).toEqual(["before tool"]);
		expect(fake.pendingCount()).toBe(0);

		batcher.push(" after");
		batcher.flush();
		expect(flushes).toEqual(["before tool", " after"]);
		expect(flushes.join("")).toBe("before tool after");
	});

	it("dispose flushes remaining tail and does not drop text", () => {
		const onFlush = vi.fn();
		const fake = createFakeSchedule();
		const batcher = createDeltaBatcher({
			onFlush,
			schedule: fake.schedule,
		});

		batcher.push("tail");
		batcher.dispose();
		expect(onFlush).toHaveBeenCalledTimes(1);
		expect(onFlush).toHaveBeenCalledWith("tail");
		expect(fake.pendingCount()).toBe(0);

		// Post-dispose pushes are ignored.
		batcher.push("lost");
		batcher.flush();
		expect(onFlush).toHaveBeenCalledTimes(1);
	});

	it("flush is a no-op when nothing is pending", () => {
		const onFlush = vi.fn();
		const batcher = createDeltaBatcher({
			onFlush,
			schedule: createFakeSchedule().schedule,
		});
		batcher.flush();
		expect(onFlush).not.toHaveBeenCalled();
	});

	it("ignores empty deltas", () => {
		const onFlush = vi.fn();
		const fake = createFakeSchedule();
		const batcher = createDeltaBatcher({
			onFlush,
			schedule: fake.schedule,
		});
		batcher.push("");
		expect(fake.pendingCount()).toBe(0);
		batcher.flush();
		expect(onFlush).not.toHaveBeenCalled();
	});
});
