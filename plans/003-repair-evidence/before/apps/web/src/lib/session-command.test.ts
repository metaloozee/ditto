import { describe, expect, it } from "vitest";
import { createSessionRuntimeFixture } from "#/test/session-runtime-fixture";

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

describe("session command admission", () => {
	it("T01 mocked-auth rejects unowned, archived, migrating, blocked, and deleting targets with no rows or upstream work", async () => {
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

	it("T02 mocked-auth rejects missing model config and invalid thinking before prompt side effects", async () => {
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
		const stop = await fixture.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: "run-1",
		});
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
		const result = await fixture.asUser("user-1").command({
			version: 1,
			idempotencyKey: "recover-1",
			kind: "abandon_failed_run",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: "run-1",
			expectedRecoveryPosition: 2,
		});
		expect(result).toMatchObject({
			status: 409,
			body: { code: "unimplemented_command" },
		});
		expect(fixture.counts()).toEqual({
			sessions: 1,
			messages: 0,
			commands: 0,
			keys: 0,
			work: 0,
		});
	});
});
