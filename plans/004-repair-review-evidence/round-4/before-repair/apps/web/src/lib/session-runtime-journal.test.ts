import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductEntrypoint } from "#/lib/session-runtime-product";
import { createSqliteD1 } from "#/lib/sqlite-d1-test-utils";
import {
	createSessionRuntimeFixture,
	sessionRuntimeRouteHarness,
} from "#/test/session-runtime-fixture";
import type { SnapshotV1 } from "../../../../packages/runtime-contracts/src/runtime.js";
import { createNodeSqliteAdapter } from "../../../runtime/src/journal.js";
import { applyProductProjectionBatch } from "../../../runtime/src/product-projector.js";
import type { ProductAdapters } from "../../../runtime/src/session-runtime.js";

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

function continuationInput(
	runId: string,
	snapshot: unknown,
	extra: Record<string, unknown> = {},
) {
	return {
		expectedPosition: 0,
		snapshot,
		runId,
		brainIncarnationId: "synthetic-brain-1",
		lifecycleGeneration: 1,
		ownerVersion: 1,
		runEpoch: 1,
		...extra,
	};
}

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
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
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
		const first = await created.coordinator("sess-1").recordInterruption(runId);
		now += 60_000;
		const second = await created
			.coordinator("sess-1")
			.recordInterruption(runId);
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
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		await expect(
			coord.commitContinuation(
				continuationInput(runId, { n: 1 }, { expectedPosition: 4 }),
			),
		).rejects.toMatchObject({ code: "position_conflict" });
		const committed = await coord.commitContinuation(
			continuationInput(runId, { n: 1 }),
		);
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
		expect(
			(
				created.sqlite
					.prepare("SELECT status FROM messages WHERE role = 'assistant'")
					.get() as { status: string }
			).status,
		).toBe("pending");
	});

	it("actual continuation persistence failure latches later effect admission", async () => {
		const created = fixture();
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		const original = coord.sql.query.bind(coord.sql);
		let inject = true;
		coord.sql.query = (sql: string, ...args: never[]) => {
			if (inject && /INSERT INTO continuations/.test(sql)) {
				inject = false;
				throw new Error("synthetic persistence failure");
			}
			return original(sql, ...args);
		};
		await expect(
			coord.commitContinuation(continuationInput(runId, { n: 1 })),
		).rejects.toMatchObject({ code: "fatal_latch" });
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
		).rejects.toMatchObject({
			code: expect.stringMatching(/fatal_latch|canonical_restore_failed/),
		});
	});

	it("tampered retained command ciphertext fails closed before effect admission", async () => {
		const created = fixture({ persistentJournal: true });
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		created
			.coordinator("sess-1")
			.sql.query(
				"UPDATE commands SET ciphertext = 'invalid-authenticated-record'",
			);
		await created.restartJournals();
		await expect(
			created.coordinator("sess-1").admitEffect({
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
		).rejects.toMatchObject({ code: "canonical_restore_failed" });
	});

	it("ProductEntrypoint reconstructs an admitted command from D1", async () => {
		const created = fixture();
		const admitted = await created.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		const entry = new ProductEntrypoint(
			{} as never,
			{ DB: createSqliteD1(created.sqlite) } as Env,
		);
		const reconstructed = await entry.reconstructCommand(commandId);
		expect(reconstructed?.command.commandId).toBe(commandId);
		expect(reconstructed?.command.workspaceSessionId).toBe("sess-1");
	});

	it("large committed continuation round-trips after restart", async () => {
		const created = fixture({ persistentJournal: true });
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const payload = { synthetic: "x".repeat(40_000) };
		await created
			.coordinator("sess-1")
			.commitContinuation(continuationInput(runId, payload));
		await created.restartJournals();
		const restored = await created
			.coordinator("sess-1")
			.readCanonicalContinuation(1, {
				brainIncarnationId: "synthetic-brain-1",
				runId,
				lifecycleGeneration: 1,
			});
		expect((restored as { synthetic: string }).synthetic).toBe(
			payload.synthetic,
		);
	});

	it("ProductEntrypoint routes acceptance and observation to one workspace without starts", async () => {
		const { SessionCoordinator } = await import(
			"../../../runtime/src/session-runtime.js"
		);
		const { parseRuntimeKeyring } = await import(
			"../../../runtime/src/runtime-crypto.js"
		);
		const created = fixture();
		const admitted = await created.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		const product = new ProductEntrypoint(
			{} as never,
			{ DB: createSqliteD1(created.sqlite) } as Env,
		);
		const sqlite = new DatabaseSync(":memory:");
		const adapter = createNodeSqliteAdapter(sqlite);
		const starts = 0;
		const keyring = await parseRuntimeKeyring({
			currentVersion: "v1",
			keys: { v1: "07".repeat(32) },
		});
		const instance = new SessionCoordinator({
			sql: adapter,
			keyring,
			adapters: {
				reconstructCommand: (id) => product.reconstructCommand(id),
				readCurrentAuthority: (input) => product.readCurrentAuthority(input),
				readExecutionPrerequisites: (input) =>
					product.readExecutionPrerequisites(input),
				applyProjections: (payloads, now) =>
					product.applyProjections(payloads, now),
			},
			scheduler: {
				schedule: async () => undefined,
			},
			clock: { now: created.now },
			identity: {
				ownerId: "user-1",
				workspaceSessionId: "sess-1",
				projectId: "proj-1",
			},
		});
		instance.initialize();
		const routes: string[] = [];
		const workspace = {
			getByName(name: string) {
				routes.push(name);
				return instance;
			},
		};
		const deliver = async (input: {
			commandId: string;
			ownerVersion: number;
		}) => {
			const sessionId = await product.resolveWorkspaceSessionId(
				input.commandId,
			);
			if (!sessionId) throw new Error("command_missing");
			return workspace.getByName(sessionId).acceptCommand(input);
		};
		const readSnapshot = async (input: { sessionId: string }) =>
			workspace.getByName(input.sessionId).readSnapshot();
		const first = await deliver({ commandId, ownerVersion: 1 });
		const second = await deliver({ commandId, ownerVersion: 1 });
		const snapshot = await readSnapshot({ sessionId: "sess-1" });
		expect(first.commandId).toBe(commandId);
		expect(second.receiptId).toBe(first.receiptId);
		expect(snapshot.runStates).toHaveLength(1);
		expect(routes.every((name) => name === "sess-1")).toBe(true);
		expect(starts).toBe(0);
		sqlite.close();
	});

	it("command projection CAS cannot regress a newer sequence", async () => {
		const created = fixture();
		const admitted = await created.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		const d1 = createSqliteD1(created.sqlite);
		const payload = {
			targetKind: "command" as const,
			targetId: commandId,
			workspaceSessionId: "sess-1",
			userId: "user-1",
			projectId: "proj-1",
			ownerVersion: 1,
			commandId,
			runId: commandId,
		};
		await applyProductProjectionBatch(
			d1,
			[{ ...payload, coordinatorSeq: 10, expectedSourceStatus: "0" }],
			created.now(),
		);
		const second = await applyProductProjectionBatch(
			d1,
			[{ ...payload, coordinatorSeq: 9, expectedSourceStatus: "10" }],
			created.now(),
		);
		const version = (
			created.sqlite
				.prepare(
					"SELECT executionProjectionVersion FROM session_commands WHERE id = ?",
				)
				.get(commandId) as { executionProjectionVersion: number }
		).executionProjectionVersion;
		expect(version).toBe(10);
		expect(second[0]?.classification).not.toBe("applied");
	});

	it("rejected owner or run envelopes leave pending message cursors unchanged", async () => {
		const created = fixture();
		const admitted = await created.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		await created.coordinator("sess-1").reconcile();
		const assistant = (
			created.observeReceipt(commandId) as { assistantMessageId: string }
		).assistantMessageId;
		const d1 = createSqliteD1(created.sqlite);
		const base = {
			targetKind: "message" as const,
			targetId: assistant,
			workspaceSessionId: "sess-1",
			userId: "user-1",
			projectId: "proj-1",
			ownerVersion: 1,
			commandId,
			runId: commandId,
			status: "failed",
		};
		const wrongOwner = await applyProductProjectionBatch(
			d1,
			[{ ...base, coordinatorSeq: 50, ownerVersion: 99 }],
			created.now(),
		);
		const ownerCursor = created.sqlite
			.prepare(
				"SELECT runtimeOwnerVersion FROM runtime_projection_cursors WHERE targetId = ?",
			)
			.get(assistant) as { runtimeOwnerVersion: number } | undefined;
		expect(ownerCursor).toBeUndefined();
		expect(
			(
				created.sqlite
					.prepare("SELECT status FROM messages WHERE id = ?")
					.get(assistant) as { status: string }
			).status,
		).toBe("pending");
		expect(wrongOwner[0]?.classification).not.toBe("already_applied");
		const wrongRun = await applyProductProjectionBatch(
			d1,
			[{ ...base, coordinatorSeq: 50, runId: "wrong-run" }],
			created.now(),
		);
		const runCursor = created.sqlite
			.prepare(
				"SELECT coordinatorSeq FROM runtime_projection_cursors WHERE targetId = ?",
			)
			.get(assistant) as { coordinatorSeq: number } | undefined;
		expect(runCursor).toBeUndefined();
		expect(wrongRun[0]?.classification).toBe("blocked_membership");
	});

	it("session recovery pointers CAS typed values and ignore untyped envelopes", async () => {
		const created = fixture();
		created.sqlite
			.prepare(
				`INSERT INTO runtime_checkpoint_pointers (
					sessionId, runtimeOwnerVersion, currentPairId, previousPairId,
					mutationGeneration, updatedAt
				) VALUES ('sess-1', 1, NULL, NULL, 1, 0)`,
			)
			.run();
		const d1 = createSqliteD1(created.sqlite);
		const untyped = await applyProductProjectionBatch(
			d1,
			[
				{
					targetKind: "session",
					targetId: "sess-1",
					workspaceSessionId: "sess-1",
					userId: "user-1",
					projectId: "proj-1",
					ownerVersion: 1,
					coordinatorSeq: 1,
					status: "recovery_pending",
					expectedSourceStatus: "healthy",
				},
			],
			created.now(),
		);
		expect(untyped[0]?.classification).toBe("blocked_membership");
		const applied = await applyProductProjectionBatch(
			d1,
			[
				{
					targetKind: "session",
					targetId: "sess-1",
					workspaceSessionId: "sess-1",
					userId: "user-1",
					projectId: "proj-1",
					ownerVersion: 1,
					coordinatorSeq: 4,
					currentPairId: "pair-current",
					previousPairId: null,
					mutationGeneration: 2,
					expectedMutationGeneration: 1,
				},
			],
			created.now(),
		);
		expect(applied[0]?.classification).toBe("applied");
		const pointer = created.sqlite
			.prepare(
				"SELECT currentPairId, mutationGeneration FROM runtime_checkpoint_pointers WHERE sessionId = 'sess-1'",
			)
			.get() as { currentPairId: string; mutationGeneration: number };
		expect(pointer.currentPairId).toBe("pair-current");
		expect(pointer.mutationGeneration).toBe(2);
		const regress = await applyProductProjectionBatch(
			d1,
			[
				{
					targetKind: "session",
					targetId: "sess-1",
					workspaceSessionId: "sess-1",
					userId: "user-1",
					projectId: "proj-1",
					ownerVersion: 1,
					coordinatorSeq: 3,
					currentPairId: "pair-old",
					previousPairId: null,
					mutationGeneration: 1,
					expectedMutationGeneration: 2,
				},
			],
			created.now(),
		);
		expect(regress[0]?.classification).not.toBe("applied");
		expect(
			(
				created.sqlite
					.prepare(
						"SELECT currentPairId FROM runtime_checkpoint_pointers WHERE sessionId = 'sess-1'",
					)
					.get() as { currentPairId: string }
			).currentPairId,
		).toBe("pair-current");
	});

	it("projection failure and leftover backlog keep a future reconcile deadline", async () => {
		const created = fixture();
		const admitted = await created.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		await created.coordinator("sess-1").reconcile();
		await created.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: commandId,
		});
		await created.deliver();
		const coord = created.coordinator("sess-1");
		(
			coord as unknown as { adapters: ProductAdapters }
		).adapters.applyProjections = async () => {
			throw new Error("synthetic D1 unavailable");
		};
		created.scheduled.length = 0;
		const failed = await coord.reconcile();
		const pending = Number(
			coord.sql.query(
				"SELECT count(*) AS n FROM projections WHERE state = 'pending'",
			)[0]?.n ?? 0,
		);
		expect(pending).toBeGreaterThan(0);
		expect(failed.nextDeadlineAt).not.toBeNull();
		expect(created.scheduled.length).toBeGreaterThan(0);
	});

	it("a missing predecessor re-arms after its due gap wakeup fires", async () => {
		let now = 1_700_000_000_000;
		const created = createSessionRuntimeFixture({ now: () => now });
		fixtures.push(created);
		created.seedTrustedSession();
		await created.asUser("user-1").command(promptBody());
		const later = await created
			.asUser("user-1")
			.command(promptBody({ idempotencyKey: "gap" }));
		const commandId = (later.body as { commandId: string }).commandId;
		const coord = await created.ensureCoordinator({ sessionId: "sess-1" });
		await coord.acceptCommand({ commandId, ownerVersion: 1 });
		const first = await coord.reconcile();
		expect(first.nextDeadlineAt).not.toBeNull();
		now = first.nextDeadlineAt as number;
		const next = await coord.reconcile();
		expect(next.nextDeadlineAt).not.toBeNull();
		expect(next.nextDeadlineAt).toBeGreaterThan(now);
	});

	it("new activations revalidate previously checked ciphertext and suffixes", async () => {
		const created = fixture({ persistentJournal: true });
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		await created.restartJournals();
		await created.coordinator("sess-1").ensureCanonicalRestore();
		created
			.coordinator("sess-1")
			.sql.query(
				"UPDATE commands SET ciphertext = 'tampered-after-previous-validation'",
			);
		await created.restartJournals();
		await expect(
			created.coordinator("sess-1").admitEffect({
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
		).rejects.toMatchObject({ code: "canonical_restore_failed" });
	});

	it("restore validates continuation 201 and budget-exhausted suffixes stay incomplete", async () => {
		const created = fixture({ persistentJournal: true });
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const coord = created.coordinator("sess-1");
		for (let position = 0; position < 201; position += 1) {
			await coord.commitContinuation(
				continuationInput(
					runId,
					{ n: position },
					{ expectedPosition: position },
				),
			);
		}
		coord.sql.query(
			"UPDATE continuations SET ciphertext = 'tampered-tail' WHERE position = 201",
		);
		await created.restartJournals();
		await expect(
			created.coordinator("sess-1").admitEffect({
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
		).rejects.toMatchObject({ code: "canonical_restore_failed" });

		const budget = fixture({ persistentJournal: true });
		const budgetCoord = await budget.ensureCoordinator({ sessionId: "sess-1" });
		let lastId = "";
		for (let index = 0; index < 26; index += 1) {
			const row = await budget
				.asUser("user-1")
				.command(promptBody({ idempotencyKey: `restore-${index}` }));
			lastId = (row.body as { commandId: string }).commandId;
			await budgetCoord.acceptCommand({ commandId: lastId, ownerVersion: 1 });
		}
		budgetCoord.sql.query(
			"UPDATE commands SET ciphertext = 'tampered-unchecked-suffix' WHERE command_id = ?",
			lastId,
		);
		await budget.restartJournals();
		const restored = budget.coordinator("sess-1");
		let tick = 0;
		restored.clock.now = () => 1_700_000_000_000 + 6_000 * tick++;
		await expect(restored.ensureCanonicalRestore()).rejects.toMatchObject({
			code: "canonical_restore_failed",
		});
		expect(restored.canonicalRestore).not.toBe("ok");
	});

	it("current brain pointer and archived consumption close ordinary execution", async () => {
		const created = fixture();
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		created.sqlite.exec(
			"UPDATE workspace_sessions SET brainIdentityId = 'different-current-brain'",
		);
		await expect(
			created
				.coordinator("sess-1")
				.commitContinuation(continuationInput(runId, { n: 1 })),
		).rejects.toMatchObject({ code: expect.any(String) });

		const archived = fixture();
		const first = await archived.asUser("user-1").command(promptBody());
		const second = await archived
			.asUser("user-1")
			.command(promptBody({ idempotencyKey: "later" }));
		const coord = await archived.ensureCoordinator({ sessionId: "sess-1" });
		await coord.acceptCommand({
			commandId: (second.body as { commandId: string }).commandId,
			ownerVersion: 1,
		});
		archived.sqlite.exec("UPDATE workspace_sessions SET status = 'archived'");
		await coord.acceptCommand({
			commandId: (first.body as { commandId: string }).commandId,
			ownerVersion: 1,
		});
		expect(
			coord
				.readSnapshot()
				.runStates.filter((row) =>
					["queued", "starting", "running"].includes(row.status),
				),
		).toHaveLength(0);
	});

	it("failed command acceptance latches later effects in an existing run", async () => {
		const created = fixture();
		created.seedTrustedExecutionEvidence({
			executorIncarnationId: "exec-1",
		});
		const admitted = await created.asUser("user-1").command(promptBody());
		const runId = (admitted.body as { commandId: string }).commandId;
		await created.deliver();
		const next = await created
			.asUser("user-1")
			.command(promptBody({ idempotencyKey: "new-command" }));
		const coord = created.coordinator("sess-1");
		const query = coord.sql.query.bind(coord.sql);
		let hit = false;
		coord.sql.query = (sql: string, ...args: never[]) => {
			if (!hit && /INSERT INTO commands/.test(sql)) {
				hit = true;
				throw new Error("synthetic command write failure");
			}
			return query(sql, ...args);
		};
		await expect(
			coord.acceptCommand({
				commandId: (next.body as { commandId: string }).commandId,
				ownerVersion: 1,
			}),
		).rejects.toMatchObject({ code: "fatal_latch" });
		expect(hit).toBe(true);
		await expect(
			coord.admitEffect({
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
				arguments: { path: "x" },
				outcomePolicy: "never_retry",
				state: "prepared",
			}),
		).rejects.toMatchObject({
			code: expect.stringMatching(/fatal_latch|canonical_restore_failed/),
		});
	});
});
