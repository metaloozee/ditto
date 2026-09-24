import { describe, expect, it, vi } from "vitest";
import { handleSessionCommandRequest } from "#/lib/session-command";
import {
	createSessionRuntimeFixture,
	sessionRuntimeRouteHarness,
} from "#/test/session-runtime-fixture";
import { RUNTIME_LIMITS } from "../../../../packages/runtime-contracts/src/limits.js";

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
		text: "hello",
		...overrides,
	};
}

const recoveryBodies: Record<string, Record<string, unknown>> = {
	abandon_failed_run: {
		targetRunId: "run-1",
		expectedRecoveryPosition: 2,
	},
	retry_known_safe: {
		targetRunId: "run-1",
		expectedRecoveryPosition: 2,
		safeRetryReason: "safe",
	},
	acknowledge_uncertainty_and_start_new_action: {
		targetRunId: "run-1",
		expectedRecoveryPosition: 2,
		unresolvedOperationIds: ["op-1"],
		uncertaintyAcknowledged: true,
		text: "next",
	},
	restore_checkpoint_acknowledging_loss: {
		committedPairId: "pair-1",
		expectedMutationGeneration: 1,
		expectedRecoveryPosition: 2,
		unbackedLossAcknowledged: true,
	},
	retry_backup: {
		expectedMutationGeneration: 1,
		expectedRecoveryPosition: 2,
	},
	restart_preview: {
		expectedMutationGeneration: 1,
		restartRequested: true,
	},
};

describe("session command admission", () => {
	it("T01 mocked-auth captured handler rejects unowned, archived, migrating, blocked, and deleting targets with no rows or upstream work", async () => {
		const unowned = createSessionRuntimeFixture();
		unowned.seedProject({ userId: "owner-1" });
		const unownedResult = await unowned
			.asUser("intruder")
			.command(promptBody());
		expect(unownedResult.status).toBe(404);
		expect(unowned.counts()).toEqual({
			sessions: 0,
			messages: 0,
			commands: 0,
			keys: 0,
			work: 0,
		});
		expect(
			unowned.outbound.filter((call) => call.method !== "modelConfiguration"),
		).toEqual([]);

		const archived = createSessionRuntimeFixture();
		archived.seedTrustedSession({ status: "archived" });
		const archivedResult = await archived
			.asUser("user-1")
			.command(promptBody({ sessionId: "sess-1" }));
		expect(archivedResult.status).toBe(409);
		expect(archived.counts()).toEqual({
			sessions: 1,
			messages: 0,
			commands: 0,
			keys: 0,
			work: 0,
		});

		const migrating = createSessionRuntimeFixture();
		migrating.seedProject();
		migrating.sqlite.exec(
			`INSERT INTO workspace_sessions (id, projectId, userId, status, runtimeOwner, runtimeOwnerVersion)
			 VALUES ('sess-1', 'proj-1', 'user-1', 'active', 'migrating', 2)`,
		);
		const migratingResult = await migrating
			.asUser("user-1")
			.command(promptBody({ sessionId: "sess-1" }));
		expect(migratingResult).toMatchObject({
			status: 409,
			body: { category: "upgrade_recovery" },
		});
		expect(migrating.counts().commands).toBe(0);

		const blocked = createSessionRuntimeFixture();
		blocked.seedProject();
		blocked.sqlite.exec(
			`INSERT INTO workspace_sessions (id, projectId, userId, status, runtimeOwner, runtimeOwnerVersion)
			 VALUES ('sess-1', 'proj-1', 'user-1', 'active', 'blocked', 2)`,
		);
		const blockedResult = await blocked
			.asUser("user-1")
			.command(promptBody({ sessionId: "sess-1" }));
		expect(blockedResult).toMatchObject({
			status: 409,
			body: { category: "runtime_blocked" },
		});
		expect(blocked.counts().commands).toBe(0);

		const deleting = createSessionRuntimeFixture();
		deleting.seedProject({ status: "deleting" });
		const deletingResult = await deleting
			.asUser("user-1")
			.command(promptBody());
		expect(deletingResult.status).toBe(409);
		expect(deleting.counts()).toEqual({
			sessions: 0,
			messages: 0,
			commands: 0,
			keys: 0,
			work: 0,
		});
		expect(deleting.outbound.some((call) => call.method === "deliver")).toBe(
			false,
		);
	});

	it("T01 default production handlers do not create trusted sessions from a browser version field", async () => {
		for (const path of ["stream", "control"] as const) {
			const fixture = createSessionRuntimeFixture();
			fixture.seedProject();
			const result = await fixture.asUser("user-1").command(promptBody(), {
				path,
				trustedAdmissionEligible: false,
			});
			expect(result.status).not.toBe(202);
			expect(fixture.counts()).toEqual({
				sessions: 0,
				messages: 0,
				commands: 0,
				keys: 0,
				work: 0,
			});
			expect(
				fixture.sqlite
					.prepare("SELECT runtimeOwner FROM workspace_sessions")
					.get(),
			).toBeUndefined();
		}
	});

	it("T02 mocked-auth captured handler rejects missing model config and invalid thinking before prompt side effects", async () => {
		const missing = createSessionRuntimeFixture({ modelConfigured: false });
		missing.seedProject();
		const missingResult = await missing.asUser("user-1").command(promptBody());
		expect(missingResult).toMatchObject({
			status: 409,
			body: { code: "model_unconfigured" },
		});
		expect(missing.counts()).toEqual({
			sessions: 0,
			messages: 0,
			commands: 0,
			keys: 0,
			work: 0,
		});
		expect(missing.outbound).toEqual([{ method: "modelConfiguration" }]);

		const invalid = createSessionRuntimeFixture();
		invalid.seedProject();
		const invalidResult = await invalid
			.asUser("user-1")
			.command(promptBody({ thinkingLevel: "medium" }));
		expect(invalidResult.status).toBe(400);
		expect(invalid.counts()).toEqual({
			sessions: 0,
			messages: 0,
			commands: 0,
			keys: 0,
			work: 0,
		});
		expect(invalid.outbound).toEqual([]);
	});

	it("T02 rejects incompatible runtime protocol before prompt writes", async () => {
		const fixture = createSessionRuntimeFixture({ protocolVersion: 2 });
		fixture.seedTrustedSession();
		const result = await fixture
			.asUser("user-1")
			.command(promptBody({ sessionId: "sess-1" }));
		expect(result.status).not.toBe(202);
		expect(fixture.counts().commands).toBe(0);
		expect(fixture.counts().messages).toBe(0);
	});

	it("T03 admits a first trusted prompt atomically and replays the original session", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedProject();
		const first = await fixture.asUser("user-1").command(promptBody());
		expect(first.status).toBe(202);
		const receipt = first.body as {
			commandId: string;
			workspaceSessionId: string;
			commandSeq: number;
			status: string;
		};
		expect(receipt.status).toBe("admitted");
		expect(receipt.commandSeq).toBe(1);
		expect(fixture.counts()).toEqual({
			sessions: 1,
			messages: 2,
			commands: 1,
			keys: 1,
			work: 1,
		});
		expect(fixture.observeReceipt(receipt.commandId)).toMatchObject({
			commandId: receipt.commandId,
			commandSeq: 1,
		});
		const retry = await fixture.asUser("user-1").command(promptBody());
		expect(retry.status).toBe(202);
		expect(retry.body).toMatchObject({
			commandId: receipt.commandId,
			workspaceSessionId: receipt.workspaceSessionId,
			commandSeq: 1,
			status: "admitted",
		});
		expect(fixture.counts()).toEqual({
			sessions: 1,
			messages: 2,
			commands: 1,
			keys: 1,
			work: 1,
		});
		const omittedThinking = await fixture
			.asUser("user-1")
			.command(promptBody({ thinkingLevel: "high" }));
		expect(omittedThinking.body).toMatchObject({
			commandId: receipt.commandId,
		});
		fixture.setModelConfigured(false);
		const afterOutage = await fixture.asUser("user-1").command(promptBody());
		expect(afterOutage.body).toMatchObject({ commandId: receipt.commandId });
	});

	it("T03 rejects a conflicting payload for the same key", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedProject();
		expect((await fixture.asUser("user-1").command(promptBody())).status).toBe(
			202,
		);
		const conflict = await fixture
			.asUser("user-1")
			.command(promptBody({ text: "different" }));
		expect(conflict).toMatchObject({
			status: 409,
			body: { category: "conflict" },
		});
		expect(fixture.counts().commands).toBe(1);
	});

	it("T03 persists thinking settings so CommandV1 can be reconstructed after request loss", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const levels = ["off", "high", "max", undefined] as const;
		const ids: string[] = [];
		for (const [index, level] of levels.entries()) {
			const result = await fixture.asUser("user-1").command(
				promptBody({
					idempotencyKey: `think-${index}`,
					sessionId: "sess-1",
					text: `hello ${index}`,
					...(level ? { thinkingLevel: level } : {}),
				}),
			);
			expect(result.status).toBe(202);
			ids.push((result.body as { commandId: string }).commandId);
		}
		for (const [index, level] of levels.entries()) {
			const commandId = ids[index];
			if (!commandId) throw new Error("missing command id");
			const reconstructed = await fixture.reconstructCommand(commandId);
			expect(reconstructed).toMatchObject({
				kind: "prompt",
				thinkingLevel: level ?? "high",
				text: `hello ${index}`,
			});
			const retry = await fixture.asUser("user-1").command(
				promptBody({
					idempotencyKey: `think-${index}`,
					sessionId: "sess-1",
					text: `hello ${index}`,
					...(level ? { thinkingLevel: level } : {}),
				}),
			);
			expect(retry.body).toMatchObject({ commandId });
		}
	});

	it("T03 normalizes trim-equivalent text and rejects whitespace-only prompts and follow-ups", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const first = await fixture
			.asUser("user-1")
			.command(promptBody({ sessionId: "sess-1" }));
		expect(first.status).toBe(202);
		const equivalent = await fixture
			.asUser("user-1")
			.command(promptBody({ sessionId: "sess-1", text: "  hello  " }));
		expect(equivalent.status).toBe(202);
		expect(equivalent.body).toMatchObject({
			commandId: (first.body as { commandId: string }).commandId,
		});
		const blank = await fixture.asUser("user-1").command(
			promptBody({
				sessionId: "sess-1",
				idempotencyKey: "blank",
				text: "   ",
			}),
		);
		expect(blank.status).toBe(400);
		const interior = await fixture.asUser("user-1").command(
			promptBody({
				sessionId: "sess-1",
				idempotencyKey: "interior",
				text: "hello  world",
			}),
		);
		expect(interior.status).toBe(202);
		const reconstructed = await fixture.reconstructCommand(
			(interior.body as { commandId: string }).commandId,
		);
		expect(reconstructed).toMatchObject({ text: "hello  world" });
		const followBlank = await fixture.asUser("user-1").command({
			version: 1,
			idempotencyKey: "follow-blank",
			kind: "follow_up",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: "run-1",
			text: "\n\t",
		});
		expect(followBlank.status).toBe(400);
	});

	it("reconstruction keeps the accepted owner version after a later session transition", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const admitted = await fixture
			.asUser("user-1")
			.command(promptBody({ sessionId: "sess-1" }));
		const commandId = (admitted.body as { commandId: string }).commandId;
		fixture.sqlite.exec(
			"UPDATE workspace_sessions SET runtimeOwnerVersion = 3",
		);
		const reconstructed = await fixture.reconstructCommand(commandId);
		expect(reconstructed).toMatchObject({
			runtimeOwnerVersion: 1,
			thinkingLevel: "high",
		});
	});

	it("reconstruction fails closed on missing, malformed, or mismatched prompt settings", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const admitted = await fixture.asUser("user-1").command(
			promptBody({
				sessionId: "sess-1",
				thinkingLevel: "max",
			}),
		);
		const commandId = (admitted.body as { commandId: string }).commandId;
		const receipt = fixture.observeReceipt(commandId) as {
			userMessageId: string;
			assistantMessageId: string;
		};
		const original = await fixture.reconstructCommand(commandId);
		expect(original).toMatchObject({
			thinkingLevel: "max",
			text: "hello",
		});

		fixture.sqlite.exec("UPDATE workspace_runtime_work SET payload = '{}' ");
		expect(await fixture.reconstructCommand(commandId)).toBeNull();

		fixture.sqlite.exec(
			"UPDATE workspace_runtime_work SET payload = 'not-json'",
		);
		expect(await fixture.reconstructCommand(commandId)).toBeNull();

		fixture.sqlite.exec(
			`UPDATE workspace_runtime_work SET payload = '${JSON.stringify({ commandKind: "stop", thinkingLevel: "max" })}'`,
		);
		expect(await fixture.reconstructCommand(commandId)).toBeNull();

		fixture.sqlite.exec(
			`UPDATE workspace_runtime_work SET payload = '${JSON.stringify({ commandKind: "prompt", thinkingLevel: "medium" })}'`,
		);
		expect(await fixture.reconstructCommand(commandId)).toBeNull();

		fixture.sqlite.exec(
			`UPDATE workspace_runtime_work SET payload = '${JSON.stringify({ commandKind: "prompt", thinkingLevel: "max" })}'`,
		);
		fixture.sqlite
			.prepare("DELETE FROM messages WHERE id = ?")
			.run(receipt.userMessageId);
		expect(await fixture.reconstructCommand(commandId)).toBeNull();

		fixture.sqlite.exec("DELETE FROM workspace_runtime_work");
		expect(await fixture.reconstructCommand(commandId)).toBeNull();
	});

	it("T04 rolls back when any batch statement fails", async () => {
		for (let failBatchAt = 0; failBatchAt < 9; failBatchAt++) {
			const fixture = createSessionRuntimeFixture({ failBatchAt });
			fixture.seedProject();
			await expect(
				fixture.asUser("user-1").command(promptBody()),
			).rejects.toThrow(/injected failure/);
			expect(fixture.counts()).toEqual({
				sessions: 0,
				messages: 0,
				commands: 0,
				keys: 0,
				work: 0,
			});
		}
	});

	it("T04 concurrent same-key submissions create one command", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedProject();
		const [a, b] = await Promise.all([
			fixture.asUser("user-1").command(promptBody()),
			fixture.asUser("user-1").command(promptBody()),
		]);
		expect(a.status).toBe(202);
		expect(b.status).toBe(202);
		expect(a.body).toMatchObject({
			commandId: (b.body as { commandId: string }).commandId,
			workspaceSessionId: (b.body as { workspaceSessionId: string })
				.workspaceSessionId,
		});
		expect(fixture.counts()).toEqual({
			sessions: 1,
			messages: 2,
			commands: 1,
			keys: 1,
			work: 1,
		});
	});

	it("does not recreate a deleted first-session target from the same key", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedProject();
		const admitted = await fixture.asUser("user-1").command(promptBody());
		const sessionId = (admitted.body as { workspaceSessionId: string })
			.workspaceSessionId;
		fixture.sqlite
			.prepare(
				"INSERT INTO runtime_deleted_target_fences (targetKind, targetId, lastOwnerVersion, deletedAt) VALUES ('workspace_session', ?, 1, 1)",
			)
			.run(sessionId);
		fixture.sqlite
			.prepare("DELETE FROM workspace_sessions WHERE id = ?")
			.run(sessionId);
		const retry = await fixture.asUser("user-1").command(promptBody());
		expect(retry).toMatchObject({
			status: 409,
			body: { category: "deleted" },
		});
		expect(
			fixture.sqlite
				.prepare("SELECT count(*) AS n FROM workspace_sessions")
				.get(),
		).toEqual({ n: 0 });
	});

	it("admits follow_up, stop, and cancel without legacy control execution", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const prompt = await fixture
			.asUser("user-1")
			.command(promptBody({ sessionId: "sess-1" }));
		expect(prompt.status).toBe(202);
		const follow = await fixture.asUser("user-1").command({
			version: 1,
			idempotencyKey: "follow-1",
			kind: "follow_up",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: "run-1",
			text: "next",
		});
		expect(follow.status).toBe(202);
		expect(follow.body).toMatchObject({ commandSeq: 2, status: "admitted" });
		expect(fixture.counts().messages).toBe(4);
		fixture.setModelConfigured(false);
		const stop = await fixture.asUser("user-1").command(
			{
				version: 1,
				idempotencyKey: "stop-1",
				kind: "stop",
				projectId: "proj-1",
				sessionId: "sess-1",
				targetRunId: "run-1",
			},
			{ path: "control" },
		);
		expect(stop).toMatchObject({
			status: 202,
			body: { stopState: "recorded", status: "admitted" },
		});
		const cancel = await fixture.asUser("user-1").command({
			version: 1,
			idempotencyKey: "cancel-1",
			kind: "cancel",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetCommandId: (prompt.body as { commandId: string }).commandId,
		});
		expect(cancel.status).toBe(202);
		expect(fixture.outbound.some((call) => call.method === "deliver")).toBe(
			false,
		);
		expect(fixture.outbound.some((call) => call.method === "control")).toBe(
			false,
		);
	});

	it("parses recovery kinds but rejects their admission", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		for (const [kind, extra] of Object.entries(recoveryBodies)) {
			const result = await fixture.asUser("user-1").command({
				version: 1,
				idempotencyKey: `recover-${kind}`,
				kind,
				projectId: "proj-1",
				sessionId: "sess-1",
				...extra,
			});
			expect(result).toMatchObject({
				status: 409,
				body: { code: "unimplemented_command" },
			});
		}
		expect(fixture.counts()).toEqual({
			sessions: 1,
			messages: 0,
			commands: 0,
			keys: 0,
			work: 0,
		});
	});

	it("captured handlers reject duplicate, escaped duplicate, oversized, unknown version, and authority fields", async () => {
		for (const path of ["stream", "control"] as const) {
			const fixture = createSessionRuntimeFixture();
			fixture.seedTrustedSession();
			const duplicate = JSON.stringify(
				promptBody({ sessionId: "sess-1" }),
			).replace('"version":1', '"version":2,"version":1');
			const duplicateResult = await fixture
				.asUser("user-1")
				.command({}, { path, raw: duplicate });
			expect(duplicateResult.status).toBe(400);
			expect(fixture.counts().commands).toBe(0);

			const escaped = `{"version":1,"idempotencyKey":"esc","kind":"prompt","projectId":"proj-1","sessionId":"sess-1","text":"hello","\\u0076ersion":2}`;
			const escapedResult = await fixture
				.asUser("user-1")
				.command({}, { path, raw: escaped });
			expect(escapedResult.status).toBe(400);

			const unknownVersion = await fixture.asUser("user-1").command(
				{
					...promptBody({ sessionId: "sess-1" }),
					version: 2,
				},
				{ path },
			);
			expect(unknownVersion.status).toBe(400);

			const authority = await fixture.asUser("user-1").command(
				{
					...promptBody({ sessionId: "sess-1" }),
					userId: "attacker",
				},
				{ path },
			);
			expect(authority.status).toBe(400);

			const oversized = `${" ".repeat(RUNTIME_LIMITS.commandBodyBytes + 8)}{"version":1}`;
			const oversizedResult = await fixture
				.asUser("user-1")
				.command({}, { path, raw: oversized });
			expect(oversizedResult.status).toBe(400);
			const invalidUtf8 = await fixture
				.asUser("user-1")
				.command({}, { path, bytes: new Uint8Array([0xff, 0xfe, 0xfd]) });
			expect(invalidUtf8.status).toBe(400);
			expect(fixture.counts().commands).toBe(0);
		}
	});
});

describe("session command request classification", () => {
	it("does not fall through to legacy execution for malformed versioned bodies", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedProject();
		const result = await fixture
			.asUser("user-1")
			.command({}, { raw: '{"version":1,}' });
		expect(result.status).toBe(400);
		expect(fixture.counts().commands).toBe(0);
	});

	it("service protocol mismatch still fails closed without rows", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const result = await handleSessionCommandRequest({
			db: fixture.db,
			runtime: {
				modelConfiguration: async () => ({
					configured: true,
					protocolVersion: 2,
				}),
				deliver: async () => {
					throw new Error("unused");
				},
				control: async () => {
					throw new Error("unused");
				},
			},
			authenticatedUserId: "user-1",
			body: promptBody({ sessionId: "sess-1" }),
		});
		expect(result.status).not.toBe(202);
		expect(fixture.counts().commands).toBe(0);
	});
});
