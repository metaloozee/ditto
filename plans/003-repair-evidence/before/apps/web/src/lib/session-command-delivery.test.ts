import { describe, expect, it } from "vitest";
import {
	expireQueuedWork,
	failWork,
	reclaimExpiredWorkLeases,
} from "#/lib/workspace-runtime-capacity";
import { createSessionRuntimeFixture } from "#/test/session-runtime-fixture";

function promptBody(overrides: Record<string, unknown> = {}) {
	return {
		version: 1,
		idempotencyKey: "key-1",
		kind: "prompt",
		projectId: "proj-1",
		sessionId: "sess-1",
		text: "hello",
		...overrides,
	};
}

describe("session command delivery", () => {
	it("T05 delivers persisted command ids without legacy expiry, failWork, or capacity release", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const admitted = await fixture.asUser("user-1").command(promptBody());
		expect(admitted.status).toBe(202);
		const commandId = (admitted.body as { commandId: string }).commandId;
		await fixture.deliver();
		expect(
			fixture.outbound.filter((call) => call.method === "deliver"),
		).toEqual([{ method: "deliver", input: { commandId, ownerVersion: 1 } }]);
		const work = fixture.sqlite
			.prepare(
				"SELECT status, deliveryState, commandId FROM workspace_runtime_work WHERE commandId = ?",
			)
			.get(commandId) as {
			status: string;
			deliveryState: string;
			commandId: string;
		};
		expect(work).toMatchObject({
			status: "queued",
			deliveryState: "pending",
			commandId,
		});
		await expireQueuedWork({ db: fixture.db, nowMs: fixture.now() });
		await reclaimExpiredWorkLeases({ db: fixture.db, nowMs: fixture.now() });
		await failWork({
			db: fixture.db,
			workId: (
				fixture.sqlite
					.prepare("SELECT id FROM workspace_runtime_work WHERE commandId = ?")
					.get(commandId) as { id: string }
			).id,
			reasonCode: "should_not_apply",
		});
		expect(
			fixture.sqlite
				.prepare(
					"SELECT status, reasonCode FROM workspace_runtime_work WHERE commandId = ?",
				)
				.get(commandId),
		).toEqual({ status: "queued", reasonCode: null });
		expect(fixture.sqlite.prepare("SELECT status FROM messages").all()).toEqual(
			expect.arrayContaining([{ status: "complete" }, { status: "pending" }]),
		);
	});

	it("T06 delivery-only: lost acknowledgment redelivers the same command ids", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const admitted = await fixture.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		await fixture.deliver();
		fixture.sqlite.exec(
			"UPDATE workspace_runtime_work SET deliveryLeaseExpiresAt = 0 WHERE commandId IS NOT NULL",
		);
		await fixture.deliver();
		const deliveries = fixture.outbound.filter(
			(call) => call.method === "deliver",
		);
		expect(deliveries).toHaveLength(2);
		expect(deliveries[0]).toEqual(deliveries[1]);
		expect(deliveries[0]).toEqual({
			method: "deliver",
			input: { commandId, ownerVersion: 1 },
		});
		expect((admitted.body as { status: string }).status === "admitted").toBe(
			true,
		);
	});

	it("T06 delivery-only: retries a missing predecessor before a later command", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const first = await fixture.asUser("user-1").command(promptBody());
		const second = await fixture
			.asUser("user-1")
			.command(promptBody({ idempotencyKey: "key-2", text: "again" }));
		await fixture.deliver({ maxDeliveries: 1 });
		const firstId = (first.body as { commandId: string }).commandId;
		const secondId = (second.body as { commandId: string }).commandId;
		expect(
			fixture.outbound.filter((call) => call.method === "deliver"),
		).toEqual([
			{ method: "deliver", input: { commandId: firstId, ownerVersion: 1 } },
		]);
		fixture.sqlite.exec(
			"UPDATE workspace_runtime_work SET deliveryLeaseExpiresAt = 0",
		);
		await fixture.deliver({ maxDeliveries: 2 });
		const deliveredIds = fixture.outbound
			.filter((call) => call.method === "deliver")
			.map((call) => (call.method === "deliver" ? call.input.commandId : ""));
		expect(deliveredIds[0]).toBe(firstId);
		expect(deliveredIds).toContain(secondId);
	});

	it("T07 delivery-only: delivers persisted cancellation and stop without mutating terminal execution state", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const prompt = await fixture.asUser("user-1").command(promptBody());
		const commandId = (prompt.body as { commandId: string }).commandId;
		await fixture.asUser("user-1").command({
			version: 1,
			idempotencyKey: "cancel-1",
			kind: "cancel",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetCommandId: commandId,
		});
		await fixture.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: "run-1",
		});
		await fixture.deliver({ maxDeliveries: 10 });
		expect(fixture.outbound.some((call) => call.method === "control")).toBe(
			true,
		);
		expect(
			fixture.outbound.some(
				(call) =>
					call.method === "deliver" && call.input.commandId !== commandId,
			),
		).toBe(true);
		expect(
			fixture.sqlite.prepare("SELECT status FROM messages ORDER BY role").all(),
		).toEqual([{ status: "pending" }, { status: "complete" }]);
		expect(
			fixture.sqlite
				.prepare("SELECT status FROM workspace_runtime_work GROUP BY status")
				.all(),
		).toEqual([{ status: "queued" }]);
	});
});
