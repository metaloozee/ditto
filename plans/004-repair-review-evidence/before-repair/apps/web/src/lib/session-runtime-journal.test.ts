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
		text: "hello secret transcript",
		...overrides,
	};
}

const fixtures: ReturnType<typeof createSessionRuntimeFixture>[] = [];

function fixture(options?: { persistentJournal?: boolean }) {
	const created = createSessionRuntimeFixture(options);
	fixtures.push(created);
	created.seedTrustedSession();
	return created;
}

afterEach(() => {
	for (const created of fixtures) created.dispose();
	fixtures.length = 0;
});

describe("session runtime journal", () => {
	it("persists acceptance across journal restart without duplicate runs", async () => {
		const created = fixture({ persistentJournal: true });
		const admitted = await created.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const before = created.coordinator("sess-1").readSnapshot();
		expect(before.runStates).toHaveLength(1);
		expect(before.runStates[0]?.id).toBe(commandId);
		await created.restartJournals();
		const after = created.coordinator("sess-1").readSnapshot();
		expect(after.runStates).toEqual(before.runStates);
		expect(after.commandStates[0]?.status).toBe("consumed");
		await created.deliver();
		expect(created.coordinator("sess-1").readSnapshot().runStates).toHaveLength(
			1,
		);
	});

	it("writes encrypted canonical content and no plaintext transcript", async () => {
		const created = fixture({ persistentJournal: true });
		await created.asUser("user-1").command(promptBody());
		await created.deliver();
		const bytes = created.journalBytes("sess-1");
		expect(bytes.includes(Buffer.from("hello secret transcript"))).toBe(false);
		const row = created
			.coordinator("sess-1")
			.sql.query<{ ciphertext: string }>(
				"SELECT ciphertext FROM commands LIMIT 1",
			)[0];
		expect(row?.ciphertext).toContain("aes-256-gcm");
		expect(row?.ciphertext).not.toContain("hello secret transcript");
		for (const entry of created.logs) {
			expect(JSON.stringify(entry)).not.toContain("hello secret transcript");
		}
	});

	it("T25 fails D1 through terminal settlement then retries the same projection", async () => {
		let failMessages = true;
		const created = createSessionRuntimeFixture({
			failStatement: (sql) => failMessages && sql.includes("UPDATE messages"),
		});
		fixtures.push(created);
		created.seedTrustedSession();
		const admitted = await created.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: commandId,
		});
		await created.deliver();
		await created.coordinator("sess-1").reconcile();
		const snapshot = created.coordinator("sess-1").readSnapshot() as SnapshotV1;
		expect(snapshot.runStates[0]?.status).toBe("canceled");
		expect(snapshot.projectionLag).toBeGreaterThan(0);
		expect(
			created.sqlite
				.prepare("SELECT status FROM messages WHERE role = 'assistant'")
				.get() as { status: string },
		).toEqual({ status: "pending" });
		failMessages = false;
		await created.coordinator("sess-1").reconcile();
		expect(
			(
				created.sqlite
					.prepare("SELECT status FROM messages WHERE role = 'assistant'")
					.get() as { status: string }
			).status,
		).toBe("failed");
		expect(created.coordinator("sess-1").readSnapshot().projectionLag).toBe(0);
	});

	it("settles old run A after run B advances the epoch", async () => {
		const created = fixture();
		const first = await created.asUser("user-1").command(promptBody());
		const runA = (first.body as { commandId: string }).commandId;
		await created.deliver();
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-a",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: runA,
		});
		await created.deliver();
		const second = await created
			.asUser("user-1")
			.command(promptBody({ idempotencyKey: "key-2", text: "later" }));
		const runB = (second.body as { commandId: string }).commandId;
		await created.deliver();
		await created.coordinator("sess-1").reconcile();
		const snapshot = created.coordinator("sess-1").readSnapshot();
		expect(snapshot.runStates.find((run) => run.id === runA)?.status).toBe(
			"canceled",
		);
		expect(snapshot.runStates.find((run) => run.id === runB)?.status).toBe(
			"queued",
		);
		const assistantA = (
			created.observeReceipt(runA) as { assistantMessageId: string }
		).assistantMessageId;
		const assistantB = (
			created.observeReceipt(runB) as { assistantMessageId: string }
		).assistantMessageId;
		const statuses = created.sqlite
			.prepare("SELECT id, status FROM messages WHERE role = 'assistant'")
			.all() as { id: string; status: string }[];
		expect(statuses.find((row) => row.id === assistantA)?.status).toBe(
			"failed",
		);
		expect(statuses.find((row) => row.id === assistantB)?.status).toBe(
			"pending",
		);
	});

	it("does not rewrite a completed assistant failed", async () => {
		const created = fixture();
		const admitted = await created.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		const assistantId = (
			created.observeReceipt(commandId) as { assistantMessageId: string }
		).assistantMessageId;
		created.sqlite
			.prepare("UPDATE messages SET status = 'complete' WHERE id = ?")
			.run(assistantId);
		await created.deliver();
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: commandId,
		});
		await created.deliver();
		await created.coordinator("sess-1").reconcile();
		expect(
			(
				created.sqlite
					.prepare("SELECT status FROM messages WHERE id = ?")
					.get(assistantId) as { status: string }
			).status,
		).toBe("complete");
	});

	it("latches fatal persistence and admits no later effects", async () => {
		const created = fixture();
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		coord.forceFatalLatch();
		await expect(
			coord.admitEffect({
				version: 1,
				runId,
				assistantEntryId: "asst-1",
				toolCallId: "tool-1",
				attempt: 1,
				executorIncarnationId: "exec-1",
				runEpoch: 1,
				lifecycleGeneration: 1,
				deadline: 1_700_000_000_000 + 60_000,
				arguments: { path: "x" },
				outcomePolicy: "never_retry",
				state: "prepared",
			}),
		).rejects.toMatchObject({ code: "fatal_latch" });
	});

	it("keeps the first interruption recovery deadline fixed", async () => {
		let now = 1_700_000_000_000;
		const created = createSessionRuntimeFixture({ now: () => now });
		fixtures.push(created);
		created.seedTrustedSession();
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const first = created.coordinator("sess-1").recordInterruption(runId);
		now += 60_000;
		const second = created.coordinator("sess-1").recordInterruption(runId);
		expect(second.recoveryDeadlineAt).toBe(first.recoveryDeadlineAt);
		expect(second.firstInterruptionAt).toBe(first.firstInterruptionAt);
		now = first.recoveryDeadlineAt + 1;
		await created.coordinator("sess-1").reconcile();
		expect(
			created.coordinator("sess-1").readSnapshot().runStates[0]?.status,
		).toBe("failed");
	});

	it("rejects continuation position conflicts and commits the next position", async () => {
		const created = fixture();
		await created.asUser("user-1").command(promptBody());
		await created.deliver();
		const coord = created.coordinator("sess-1");
		await expect(
			coord.commitContinuation({ expectedPosition: 4, snapshot: { n: 1 } }),
		).rejects.toMatchObject({ code: "position_conflict" });
		const committed = await coord.commitContinuation({
			expectedPosition: 0,
			snapshot: { n: 1 },
		});
		expect(committed.position).toBe(1);
		expect(coord.readSnapshot().checkpointPosition).toBe(1);
	});

	it("T26 snapshot observation does not increment container wake count", async () => {
		const created = fixture();
		await created.asUser("user-1").command(promptBody());
		await created.deliver();
		const observed = await created.asUser("user-1").observe({
			projectId: "proj-1",
			sessionId: "sess-1",
		});
		expect(observed.status).toBe(200);
		const body = observed.body as {
			snapshot: SnapshotV1;
			correlationId: string;
		};
		expect(body.correlationId).toEqual(expect.any(String));
		expect(body.snapshot.sessionId).toBe("sess-1");
		expect(created.coordinator("sess-1").containerWakeCount).toBe(0);
		expect(JSON.stringify(body)).not.toContain("hello secret transcript");
	});

	it("classifies deleted session projection as a no-op", async () => {
		const created = fixture();
		const admitted = await created.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: commandId,
		});
		await created.deliver();
		created.sqlite.exec(
			"INSERT INTO runtime_deleted_target_fences (targetKind, targetId, lastOwnerVersion, deletedAt) VALUES ('workspace_session', 'sess-1', 1, 1)",
		);
		await created.coordinator("sess-1").reconcile();
		expect(
			created.sqlite
				.prepare("SELECT count(*) AS n FROM messages WHERE role = 'assistant'")
				.get() as { n: number },
		).toEqual({ n: 1 });
	});
});
