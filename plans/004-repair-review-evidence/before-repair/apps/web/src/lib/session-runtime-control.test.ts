import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createSessionRuntimeFixture,
	sessionRuntimeRouteHarness,
} from "#/test/session-runtime-fixture";
import type { SnapshotV1 } from "../../../../packages/runtime-contracts/src/runtime.js";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: unknown) => options,
}));
vi.mock("#/db", () => ({
	createDb: () => {
		if (!sessionRuntimeRouteHarness.db) {
			throw new Error("fixture db missing");
		}
		return sessionRuntimeRouteHarness.db;
	},
}));
vi.mock("#/lib/auth", () => ({
	createAuth: () => ({
		api: {
			getSession: async () =>
				sessionRuntimeRouteHarness.userId
					? { user: { id: sessionRuntimeRouteHarness.userId } }
					: null,
		},
	}),
}));
vi.mock("#/lib/agent-run-service", () => ({
	prepareAgentRun: () => {
		throw new Error("Unexpected legacy invocation");
	},
	executeAgentRun: () => {
		throw new Error("Unexpected legacy invocation");
	},
	agentStreamBodySchema: {
		safeParse: () => {
			throw new Error("Unexpected legacy invocation");
		},
	},
}));
vi.mock("#/lib/agent-control-service", () => ({
	controlAgentRun: () => {
		throw new Error("Unexpected legacy invocation");
	},
	agentControlBodySchema: {
		safeParse: () => {
			throw new Error("Unexpected legacy invocation");
		},
	},
}));

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

const fixtures: ReturnType<typeof createSessionRuntimeFixture>[] = [];

function fixture() {
	const created = createSessionRuntimeFixture();
	fixtures.push(created);
	created.seedTrustedSession();
	return created;
}

afterEach(() => {
	for (const created of fixtures) created.dispose();
	fixtures.length = 0;
});

describe("session runtime control", () => {
	it("T06 lost acknowledgment after durable acceptance makes one execution decision", async () => {
		const created = fixture();
		const admitted = await created.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		created.loseNextAcknowledgment();
		await created.deliver();
		expect(
			(created.observeWork(commandId) as { deliveryState: string })
				.deliveryState,
		).toBe("pending");
		const snapshot = created.coordinator("sess-1").readSnapshot();
		expect(snapshot.runStates).toHaveLength(1);
		expect(snapshot.commandStates[0]?.status).toBe("consumed");
		created.sqlite.exec(
			"UPDATE workspace_runtime_work SET deliveryLeaseExpiresAt = 0",
		);
		await created.deliver();
		const deliveries = created.outbound.filter(
			(call) => call.method === "deliver",
		);
		expect(deliveries).toHaveLength(2);
		expect(deliveries[0]).toEqual(deliveries[1]);
		expect(
			(created.observeWork(commandId) as { deliveryState: string })
				.deliveryState,
		).toBe("delivered");
		expect(created.coordinator("sess-1").readSnapshot().runStates).toHaveLength(
			1,
		);
	});

	it("T07 delivering N+1 before N does not consume past the gap", async () => {
		const created = fixture();
		const first = await created.asUser("user-1").command(promptBody());
		const second = await created
			.asUser("user-1")
			.command(promptBody({ idempotencyKey: "key-2", text: "again" }));
		const firstId = (first.body as { commandId: string }).commandId;
		const secondId = (second.body as { commandId: string }).commandId;
		const coord = await created.ensureCoordinator({ sessionId: "sess-1" });
		await coord.acceptCommand({ commandId: secondId, ownerVersion: 1 });
		const gapped = coord.readSnapshot();
		expect(
			gapped.commandStates.find((row) => row.id === secondId)?.status,
		).toBe("accepted");
		expect(gapped.runStates.find((row) => row.id === secondId)).toBeUndefined();
		await coord.acceptCommand({ commandId: firstId, ownerVersion: 1 });
		const ordered = coord.readSnapshot();
		expect(
			ordered.commandStates.find((row) => row.id === firstId)?.status,
		).toBe("consumed");
		expect(
			ordered.commandStates.find((row) => row.id === secondId)?.status,
		).toBe("consumed");
		expect(ordered.runStates.map((row) => row.id)).toEqual([firstId, secondId]);
	});

	it("T07 durable cancellation of N allows N+1 to advance", async () => {
		const created = fixture();
		const first = await created.asUser("user-1").command(promptBody());
		const second = await created
			.asUser("user-1")
			.command(promptBody({ idempotencyKey: "key-2", text: "again" }));
		const firstId = (first.body as { commandId: string }).commandId;
		const secondId = (second.body as { commandId: string }).commandId;
		const canceled = await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "cancel-1",
			kind: "cancel",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetCommandId: firstId,
		});
		const cancelId = (canceled.body as { commandId: string }).commandId;
		const coord = await created.ensureCoordinator({ sessionId: "sess-1" });
		await coord.acceptCommand({ commandId: secondId, ownerVersion: 1 });
		expect(
			coord.readSnapshot().commandStates.find((row) => row.id === secondId)
				?.status,
		).toBe("accepted");
		await coord.acceptCommand({ commandId: cancelId, ownerVersion: 1 });
		await coord.acceptCommand({ commandId: firstId, ownerVersion: 1 });
		const snapshot = coord.readSnapshot();
		expect(
			snapshot.commandStates.find((row) => row.id === firstId)?.status,
		).toBe("canceled");
		expect(
			snapshot.commandStates.find((row) => row.id === secondId)?.status,
		).toBe("consumed");
		expect(snapshot.runStates.map((row) => row.id)).toEqual([secondId]);
	});

	it("T08 priority Stop applies under a missing predecessor and does not kill a later run", async () => {
		const created = fixture();
		const first = await created.asUser("user-1").command(promptBody());
		const firstId = (first.body as { commandId: string }).commandId;
		const later = await created
			.asUser("user-1")
			.command(promptBody({ idempotencyKey: "key-2", text: "later" }));
		const laterId = (later.body as { commandId: string }).commandId;
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: firstId,
		});
		const coord = await created.ensureCoordinator({ sessionId: "sess-1" });
		await created.deliver();
		const snapshot = coord.readSnapshot() as SnapshotV1;
		const stop = snapshot.commandStates.find((row) => row.status === "applied");
		expect(stop?.reasonCode).toBe("stop_applied");
		expect(
			snapshot.commandStates.find((row) => row.id === firstId)?.status,
		).toBe("canceled");
		expect(snapshot.runStates.find((row) => row.id === laterId)?.status).toBe(
			"queued",
		);
		expect(
			created.sqlite
				.prepare(
					"SELECT executionProjectionVersion FROM session_commands WHERE id = ?",
				)
				.get(firstId),
		).toBeTruthy();
		const receipt = created.observeReceipt(
			(
				created.sqlite
					.prepare("SELECT id FROM session_commands WHERE kind = 'stop'")
					.get() as { id: string }
			).id,
		) as { kind: string };
		expect(receipt.kind).toBe("stop");
	});

	it("T08 Stop recorded in D1 stays distinct from coordinator applied state", async () => {
		const created = fixture();
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		const stopped = await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: runId,
		});
		expect((stopped.body as { stopState: string }).stopState).toBe("recorded");
		await created.deliver();
		const snapshot = created.coordinator("sess-1").readSnapshot();
		expect(
			snapshot.commandStates.find(
				(row) => row.id === (stopped.body as { commandId: string }).commandId,
			)?.status,
		).toBe("applied");
	});

	it("T15/T16 intro: Stop fences late predecessors and rejects superseded epoch admissions", async () => {
		const created = fixture();
		const first = await created.asUser("user-1").command(promptBody());
		const runId = (first.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		await coord.admitEffect({
			version: 1,
			runId,
			assistantEntryId: (
				created.observeReceipt(runId) as { assistantMessageId: string }
			).assistantMessageId,
			toolCallId: "tool-1",
			attempt: 1,
			executorIncarnationId: "exec-1",
			runEpoch: 1,
			lifecycleGeneration: 1,
			deadline: 1_700_000_000_000 + 60_000,
			arguments: { cmd: "sleep" },
			outcomePolicy: "never_retry",
			state: "prepared",
		});
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: runId,
		});
		await created.deliver();
		await expect(
			coord.admitEffect({
				version: 1,
				runId,
				assistantEntryId: "asst-late",
				toolCallId: "tool-2",
				attempt: 1,
				executorIncarnationId: "exec-1",
				runEpoch: 1,
				lifecycleGeneration: 1,
				deadline: 1_700_000_000_000 + 60_000,
				arguments: { cmd: "again" },
				outcomePolicy: "never_retry",
				state: "prepared",
			}),
		).rejects.toMatchObject({ code: "epoch_mismatch" });
	});

	it("rejects conflicting effect results and keeps identical acknowledgments idempotent", async () => {
		const created = fixture();
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		const key = {
			runId,
			assistantEntryId: "asst-1",
			toolCallId: "tool-1",
			attempt: 1,
		};
		await coord.admitEffect({
			version: 1,
			...key,
			executorIncarnationId: "exec-1",
			runEpoch: 1,
			lifecycleGeneration: 1,
			deadline: 1_700_000_000_000 + 60_000,
			arguments: { n: 1 },
			outcomePolicy: "reconcile",
			state: "prepared",
		});
		await coord.recordEffectResult({ ...key, result: { ok: true } });
		await expect(
			coord.recordEffectResult({ ...key, result: { ok: true } }),
		).resolves.toEqual({ state: "result_recorded" });
		await expect(
			coord.recordEffectResult({ ...key, result: { ok: false } }),
		).rejects.toMatchObject({ code: "effect_conflict" });
	});
});
