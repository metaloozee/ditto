import { describe, expect, it } from "vitest";
import {
	acquireMutatingProjectLockProjection,
	clearProjectLockProjection,
} from "./project-lock-projection";

describe("project lock projection", () => {
	it("builds mutating acquire values with the coordinator fencing token", () => {
		const now = new Date("2026-07-04T12:00:00.000Z");

		expect(
			acquireMutatingProjectLockProjection({
				runId: "run-1",
				fencingToken: 11,
				now,
			}),
		).toEqual({
			lockStatus: "mutating",
			lockHolderRunId: "run-1",
			lockFencingToken: 11,
			lockUpdatedAt: now,
		});
	});

	it("builds free values when clearing the lock", () => {
		const now = new Date("2026-07-04T12:01:00.000Z");

		expect(clearProjectLockProjection(now)).toEqual({
			lockStatus: "free",
			lockHolderRunId: null,
			lockFencingToken: null,
			lockUpdatedAt: now,
		});
	});
});
