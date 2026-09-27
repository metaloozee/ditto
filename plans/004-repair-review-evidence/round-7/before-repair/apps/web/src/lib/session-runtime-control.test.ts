import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createSessionRuntimeFixture,
	sessionRuntimeRouteHarness,
} from "#/test/session-runtime-fixture";
import type { SnapshotV1 } from "../../../../packages/runtime-contracts/src/runtime.js";
import {
	type CoordinatorSql,
	terminationEvidencePresent,
} from "../../../runtime/src/journal.js";

vi.mock("cloudflare:workers", () => ({
	env: {},
	WorkerEntrypoint: class WorkerEntrypoint {
		ctx: unknown;
		env: unknown;
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));
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

function effectBody(
	created: ReturnType<typeof createSessionRuntimeFixture>,
	runId: string,
) {
	return {
		version: 1 as const,
		runId,
		assistantEntryId: (
			created.observeReceipt(runId) as { assistantMessageId: string }
		).assistantMessageId,
		toolCallId: "tool-1",
		attempt: 1,
		executorIncarnationId: "synthetic-exec-1",
		runEpoch: 1,
		lifecycleGeneration: 1,
		deadline: created.now() + 60_000,
		arguments: { operation: "synthetic" },
		outcomePolicy: "never_retry" as const,
		state: "prepared" as const,
	};
}

function insertStopObservation(
	coord: { sql: CoordinatorSql },
	created: ReturnType<typeof createSessionRuntimeFixture>,
	patch: {
		id?: string;
		identity?: string;
		className?: string;
		incarnation?: string;
		generation?: number;
		epoch?: number;
		result?: string;
	} = {},
) {
	const row = {
		id: "synthetic-stop-observation",
		source: "platform",
		identity: "identity-sess-1",
		className: "Sandbox",
		incarnation: "synthetic-exec-1",
		generation: 1,
		epoch: 1,
		result: "terminated",
		...patch,
	};
	coord.sql.query(
		`INSERT INTO process_observations (
			observation_id, source, identity, class, incarnation, lifecycle_generation,
			observed_run_epoch, observed_at, termination_result
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.id,
		row.source,
		row.identity,
		row.className,
		row.incarnation,
		row.generation,
		row.epoch,
		created.now(),
		row.result,
	);
	return {
		identity: row.identity,
		incarnation: row.incarnation,
		lifecycleGeneration: row.generation,
		epoch: row.epoch,
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
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
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
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		const key = {
			runId,
			assistantEntryId: (
				created.observeReceipt(runId) as { assistantMessageId: string }
			).assistantMessageId,
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

	it("T07 cancellation of missing N advances N+1 without delivering N", async () => {
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
		const coord = await created.ensureCoordinator({ sessionId: "sess-1" });
		await coord.acceptCommand({ commandId: secondId, ownerVersion: 1 });
		await coord.acceptCommand({
			commandId: (canceled.body as { commandId: string }).commandId,
			ownerVersion: 1,
		});
		const snapshot = (
			await created.asUser("user-1").observe({
				projectId: "proj-1",
				sessionId: "sess-1",
			})
		).body as { snapshot: SnapshotV1 };
		expect(
			snapshot.snapshot.commandStates.find((row) => row.id === secondId)
				?.status,
		).toBe("consumed");
		expect(snapshot.snapshot.runStates.map((row) => row.id)).toEqual([
			secondId,
		]);
	});

	it("uncooperative Stop stays stopping and blocks a replacement writer", async () => {
		const created = fixture();
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "synthetic-exec-1",
		});
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
			executorIncarnationId: "synthetic-exec-1",
			runEpoch: 1,
			lifecycleGeneration: 1,
			deadline: 1_700_000_000_000 + 60_000,
			arguments: { operation: "synthetic" },
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
		const observed = await created.asUser("user-1").observe({
			projectId: "proj-1",
			sessionId: "sess-1",
		});
		const snapshot = (observed.body as { snapshot: SnapshotV1 }).snapshot;
		expect(snapshot.runStates[0]?.status).toBe("stopping");
		const next = await created
			.asUser("user-1")
			.command(promptBody({ idempotencyKey: "next" }));
		await created.deliver();
		await expect(
			coord.admitEffect({
				version: 1,
				runId: (next.body as { commandId: string }).commandId,
				assistantEntryId: "asst-next",
				toolCallId: "tool-1",
				attempt: 1,
				executorIncarnationId: "synthetic-exec-1",
				runEpoch: 2,
				lifecycleGeneration: 1,
				deadline: 1_700_000_000_000 + 60_000,
				arguments: { operation: "synthetic" },
				outcomePolicy: "never_retry",
				state: "prepared",
			}),
		).rejects.toMatchObject({ code: expect.any(String) });
	});

	it("Stop settles after the last admitted effect records its result", async () => {
		let now = 1_700_000_000_000;
		const created = createSessionRuntimeFixture({ now: () => now });
		fixtures.push(created);
		created.seedTrustedSession();
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		const effect = {
			version: 1 as const,
			runId,
			assistantEntryId: (
				created.observeReceipt(runId) as { assistantMessageId: string }
			).assistantMessageId,
			toolCallId: "tool-1",
			attempt: 1,
			executorIncarnationId: "exec-1",
			runEpoch: 1,
			lifecycleGeneration: 1,
			deadline: now + 60_000,
			arguments: { operation: "synthetic" },
			outcomePolicy: "never_retry" as const,
			state: "prepared" as const,
		};
		await coord.admitEffect(effect);
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: runId,
		});
		await created.deliver();
		await coord.recordEffectResult({
			...effect,
			result: { synthetic: "done" },
		});
		now += 1001;
		await coord.reconcile();
		now += 60_001;
		await coord.reconcile();
		const state = coord
			.readSnapshot()
			.runStates.find((row) => row.id === runId)?.status;
		const assistants = (
			created.observeMessages("sess-1") as {
				role: string;
				status: string;
			}[]
		)
			.filter((message) => message.role === "assistant")
			.map((message) => message.status);
		expect(state).toBe("canceled");
		expect(assistants.every((status) => status !== "pending")).toBe(true);
	});

	it("timeout and failed observations are not successful stop evidence", async () => {
		const created = fixture();
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "synthetic-exec-1",
		});
		await created.asUser("user-1").command(promptBody());
		await created.deliver();
		const coord = created.coordinator("sess-1");
		for (const result of ["timeout", "failed"] as const) {
			const match = insertStopObservation(coord, created, {
				id: `synthetic-${result}`,
				result,
			});
			expect(terminationEvidencePresent(coord.sql, match)).toBe(false);
		}
		expect(coord.readSnapshot().runStates[0]?.status).toBe("queued");
	});

	it("exact stable executor identity termination settles Stop and keeps canceled", async () => {
		let now = 1_700_000_000_000;
		const created = createSessionRuntimeFixture({ now: () => now });
		fixtures.push(created);
		created.seedTrustedSession();
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "synthetic-exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		await coord.admitEffect(effectBody(created, runId));
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: runId,
		});
		await created.deliver();
		const match = insertStopObservation(coord, created);
		expect(terminationEvidencePresent(coord.sql, match)).toBe(true);
		await coord.reconcile();
		const assistants = (
			created.observeMessages("sess-1") as {
				role: string;
				status: string;
			}[]
		)
			.filter((message) => message.role === "assistant")
			.map((message) => message.status);
		expect(
			coord.readSnapshot().runStates.find((row) => row.id === runId)?.status,
		).toBe("canceled");
		expect(assistants.every((status) => status !== "pending")).toBe(true);
		expect(
			coord.sql.query<{ state: string }>(
				"SELECT state FROM effects WHERE run_id = ?",
				runId,
			)[0]?.state,
		).toBe("admitted");
		now += 61_000;
		await coord.reconcile();
		expect(
			coord.readSnapshot().runStates.find((row) => row.id === runId)?.status,
		).toBe("canceled");
	});

	it("wrong identity or controller class cannot settle Stop", async () => {
		const created = fixture();
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "synthetic-exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		await coord.admitEffect(effectBody(created, runId));
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: runId,
		});
		await created.deliver();
		insertStopObservation(coord, created, {
			id: "wrong-identity",
			identity: "other-identity",
		});
		insertStopObservation(coord, created, {
			id: "wrong-class",
			className: "SessionRuntime",
		});
		await coord.reconcile();
		expect(
			coord.readSnapshot().runStates.find((row) => row.id === runId)?.status,
		).toBe("stopping");
	});

	it("unresolved Stop retries stay in the future after the effect deadline", async () => {
		let now = 1_700_000_000_000;
		const created = createSessionRuntimeFixture({ now: () => now });
		fixtures.push(created);
		created.seedTrustedSession();
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "synthetic-exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		await coord.admitEffect(effectBody(created, runId));
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: runId,
		});
		await created.deliver();
		now += 61_000;
		const deltas: Array<number | null> = [];
		for (let index = 0; index < 3; index += 1) {
			const result = await coord.reconcile();
			deltas.push(
				result.nextDeadlineAt === null ? null : result.nextDeadlineAt - now,
			);
			now += 100;
		}
		expect(
			coord.readSnapshot().runStates.find((row) => row.id === runId)?.status,
		).toBe("stopping");
		expect(deltas.every((delta) => delta !== null && delta > 0)).toBe(true);
	});

	it("Stop cannot exempt an interrupted run from its recovery deadline", async () => {
		let now = 1_700_000_000_000;
		const created = createSessionRuntimeFixture({ now: () => now });
		fixtures.push(created);
		created.seedTrustedSession();
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "synthetic-exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		await coord.admitEffect(effectBody(created, runId));
		const first = await coord.recordInterruption(runId);
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: runId,
		});
		await created.deliver();
		now = first.recoveryDeadlineAt + 1;
		await coord.reconcile();
		const row = coord.sql.query<{
			state: string;
			blocked_review_reason: string | null;
			recovery_deadline_at: number | null;
		}>(
			"SELECT state, blocked_review_reason, recovery_deadline_at FROM runs WHERE run_id = ?",
			runId,
		)[0];
		expect(row?.state).toBe("failed");
		expect(row?.blocked_review_reason).toBe("recovery_deadline_expired");
		expect(Number(row?.recovery_deadline_at)).toBe(first.recoveryDeadlineAt);
		expect(
			Number(
				coord.sql.query<{ n: number }>(
					"SELECT count(*) AS n FROM effects WHERE run_id = ? AND state IN ('admitted', 'outcome_unknown')",
					runId,
				)[0]?.n ?? 0,
			),
		).toBe(1);
		const assistants = (
			created.observeMessages("sess-1") as {
				role: string;
				status: string;
			}[]
		)
			.filter((message) => message.role === "assistant")
			.map((message) => message.status);
		expect(assistants.every((status) => status !== "pending")).toBe(true);
		await expect(
			coord.admitEffect({
				...effectBody(created, runId),
				toolCallId: "must-not-restart",
			}),
		).rejects.toMatchObject({ code: expect.any(String) });
	});
});
