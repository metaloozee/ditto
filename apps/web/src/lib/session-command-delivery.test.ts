import { describe, expect, it, vi } from "vitest";
import { deliverSessionCommands } from "#/lib/session-command-delivery";
import {
	SessionRuntimeHandoffError,
	withSessionRuntimeCallTimeout,
} from "#/lib/session-runtime-client";
import {
	expireQueuedWork,
	failWork,
	reclaimExpiredWorkLeases,
} from "#/lib/workspace-runtime-capacity";
import {
	createSessionRuntimeFixture,
	sessionRuntimeRouteHarness,
} from "#/test/session-runtime-fixture";

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
vi.mock("#/lib/workspace-recovery", () => ({
	enqueueDuePreviewCheckpoints: async () => undefined,
	hasRecoveryArchives: async () => false,
	restore: async () => undefined,
}));
vi.mock("#/lib/sandbox-archive", () => ({
	retryArchiveCleanup: async () => undefined,
	restoreArchive: async () => undefined,
	ARCHIVE_FORMAT_VERSION: 1,
	ARCHIVE_COMPATIBILITY_KEY: "ditto-workspace-archive-v1",
}));
vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: async () => ({}),
	configureDittoGitIdentity: async () => undefined,
	getProjectSandboxState: async () => ({ status: "healthy" }),
	destroySandbox: async () => undefined,
}));
vi.mock("#/lib/sandbox-authority", () => ({
	createSandboxAuthority: () => ({}),
	SandboxAuthorityError: class extends Error {},
}));
vi.mock("#/lib/github-app", () => ({
	getGitHubApp: () => ({ getInstallationOctokit: async () => ({}) }),
}));
vi.mock("#/lib/privileged-git", () => ({
	fetchGitHubBranchBrokered: async () => undefined,
}));
vi.mock("#/lib/project-env-vars", () => ({
	decryptEnvVars: () => [],
}));
vi.mock("#/lib/session-workspace-lock", () => ({
	withSessionWorkspaceLock: async ({ run }: { run: () => Promise<unknown> }) =>
		await run(),
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
		const work = fixture.observeWork(commandId) as {
			status: string;
			deliveryState: string;
			commandId: string;
		};
		expect(work).toMatchObject({
			status: "queued",
			deliveryState: "delivered",
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

	it("T05 accepted handoff leaves the undelivered backlog and later work progresses", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const ids: string[] = [];
		for (let n = 0; n < 26; n++) {
			const result = await fixture
				.asUser("user-1")
				.command(promptBody({ idempotencyKey: `k-${n}`, text: `hello ${n}` }));
			ids.push((result.body as { commandId: string }).commandId);
		}
		await fixture.deliver();
		await fixture.deliver();
		const outbound = fixture.outbound.filter(
			(call) => call.method === "deliver",
		);
		expect(outbound.some((call) => call.input.commandId === ids[25])).toBe(
			true,
		);
		expect(new Set(outbound.map((call) => call.input.commandId)).size).toBe(26);
		expect(
			fixture.sqlite
				.prepare(
					"SELECT deliveryState, count(*) AS n FROM workspace_runtime_work GROUP BY deliveryState",
				)
				.all(),
		).toEqual([{ deliveryState: "delivered", n: 26 }]);
	});

	it("T06 delivery-only: lost acknowledgment redelivers the same command ids", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const admitted = await fixture.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		fixture.loseNextAcknowledgment();
		await fixture.deliver();
		expect(
			(fixture.observeWork(commandId) as { deliveryState: string })
				.deliveryState,
		).toBe("pending");
		fixture.sqlite.exec(
			"UPDATE workspace_runtime_work SET deliveryLeaseExpiresAt = 0",
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
		expect((admitted.body as { status: string }).status).toBe("admitted");
		expect(
			(fixture.observeWork(commandId) as { deliveryState: string })
				.deliveryState,
		).toBe("delivered");
	});

	it("T06 delivery-only: retries a missing predecessor before a later command", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const first = await fixture.asUser("user-1").command(promptBody());
		const second = await fixture
			.asUser("user-1")
			.command(promptBody({ idempotencyKey: "key-2", text: "again" }));
		const firstId = (first.body as { commandId: string }).commandId;
		const secondId = (second.body as { commandId: string }).commandId;
		let predecessorReady = false;
		fixture.setDeliverImpl(async (input) => {
			if (!predecessorReady) {
				throw new SessionRuntimeHandoffError(
					"missing_predecessor",
					"missing_predecessor",
				);
			}
			const row = fixture.sqlite
				.prepare(
					`SELECT sc.commandSeq AS commandSeq, k.receiptId AS receiptId
					 FROM session_commands sc
					 JOIN session_command_keys k ON k.commandId = sc.id
					 WHERE sc.id = ?`,
				)
				.get(input.commandId) as { commandSeq: number; receiptId: string };
			return {
				version: 1,
				commandId: input.commandId,
				ownerVersion: input.ownerVersion,
				acceptedPosition: row.commandSeq,
				receiptId: row.receiptId,
			};
		});
		await fixture.deliver({ maxDeliveries: 2 });
		expect(
			fixture.outbound
				.filter((call) => call.method === "deliver")
				.map((call) => call.input.commandId),
		).toEqual([firstId]);
		expect(
			(fixture.observeWork(firstId) as { deliveryState: string }).deliveryState,
		).toBe("pending");
		expect(
			(fixture.observeWork(secondId) as { deliveryState: string })
				.deliveryState,
		).toBe("pending");
		predecessorReady = true;
		fixture.sqlite.exec(
			"UPDATE workspace_runtime_work SET deliveryLeaseExpiresAt = 0",
		);
		await fixture.deliver({ maxDeliveries: 2 });
		expect(
			fixture.outbound
				.filter((call) => call.method === "deliver")
				.map((call) => call.input.commandId),
		).toEqual([firstId, firstId, secondId]);
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

	it("T07 delivery-only: priority Stop bypasses an ordinary missing predecessor", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const first = await fixture.asUser("user-1").command(promptBody());
		await fixture.asUser("user-1").command({
			version: 1,
			idempotencyKey: "stop-1",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "sess-1",
			targetRunId: "run-1",
		});
		fixture.setDeliverImpl(async () => {
			throw new SessionRuntimeHandoffError(
				"missing_predecessor",
				"missing_predecessor",
			);
		});
		await fixture.deliver({ maxDeliveries: 4 });
		expect(fixture.outbound.some((call) => call.method === "control")).toBe(
			true,
		);
		expect(
			(
				fixture.observeWork(
					(first.body as { commandId: string }).commandId,
				) as { deliveryState: string }
			).deliveryState,
		).toBe("pending");
	});

	it("rejects invalid acknowledgments and keeps the command deliverable", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const admitted = await fixture.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		fixture.setDeliverImpl(async () => ({
			version: 1,
			commandId: "other",
			ownerVersion: 1,
			acceptedPosition: 1,
			receiptId: "r1",
		}));
		await fixture.deliver();
		expect(
			(fixture.observeWork(commandId) as { deliveryState: string })
				.deliveryState,
		).toBe("pending");
	});

	it("computes retry backoff after a failed attempt and bounds jitter", async () => {
		let clock = 1_700_000_000_000;
		const fixture = createSessionRuntimeFixture({
			now: () => clock,
			random: () => 0.5,
		});
		fixture.seedTrustedSession();
		await fixture.asUser("user-1").command(promptBody());
		const attemptsAt: number[] = [];
		fixture.setDeliverImpl(async () => {
			attemptsAt.push(clock);
			clock += 4_900;
			throw new Error("synthetic transport outage");
		});
		await deliverSessionCommands({
			db: fixture.db,
			runtime: fixture.runtime,
			clock: { now: () => clock, random: () => 0.5 },
			budget: { maxDeliveries: 2 },
		});
		expect(attemptsAt).toHaveLength(1);
		const firstAttemptAt = attemptsAt[0];
		expect(firstAttemptAt).toEqual(expect.any(Number));
		if (typeof firstAttemptAt !== "number") {
			throw new Error("missing attempt timestamp");
		}
		const nextAt = (
			fixture.sqlite
				.prepare(
					"SELECT deliveryLeaseExpiresAt AS nextAt FROM workspace_runtime_work",
				)
				.get() as { nextAt: number }
		).nextAt;
		const delay = nextAt - firstAttemptAt - 4_900;
		expect(delay).toBeGreaterThanOrEqual(1_000);
		expect(delay).toBeLessThanOrEqual(60_000);
	});

	it("times out a slow service call with an actual async timer", async () => {
		await expect(
			withSessionRuntimeCallTimeout(
				() => new Promise((resolve) => setTimeout(resolve, 50)),
				10,
			),
		).rejects.toMatchObject({ code: "runtime_timeout" });
	});

	it("stale lease callbacks cannot accept after takeover", async () => {
		let resolveFirst: ((value: unknown) => void) | undefined;
		const firstCall = new Promise((resolve) => {
			resolveFirst = resolve;
		});
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const admitted = await fixture.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		let calls = 0;
		fixture.setDeliverImpl(async (input) => {
			calls += 1;
			if (calls === 1) {
				await firstCall;
				return {
					version: 1,
					commandId: input.commandId,
					ownerVersion: input.ownerVersion,
					acceptedPosition: 99,
					receiptId: "stale",
				};
			}
			const row = fixture.sqlite
				.prepare(
					`SELECT sc.commandSeq AS commandSeq, k.receiptId AS receiptId
					 FROM session_commands sc
					 JOIN session_command_keys k ON k.commandId = sc.id
					 WHERE sc.id = ?`,
				)
				.get(input.commandId) as { commandSeq: number; receiptId: string };
			return {
				version: 1,
				commandId: input.commandId,
				ownerVersion: input.ownerVersion,
				acceptedPosition: row.commandSeq,
				receiptId: row.receiptId,
			};
		});
		const firstPass = fixture.deliver({ maxDeliveries: 1 });
		await new Promise((resolve) => setTimeout(resolve, 10));
		fixture.sqlite.exec(
			"UPDATE workspace_runtime_work SET deliveryState = 'pending', deliveryLeaseToken = NULL, deliveryLeaseExpiresAt = 0",
		);
		await fixture.deliver({ maxDeliveries: 1 });
		resolveFirst?.(undefined);
		await firstPass;
		expect(
			(fixture.observeWork(commandId) as { deliveryState: string })
				.deliveryState,
		).toBe("delivered");
		expect(calls).toBe(2);
	});

	it("delivery storage faults leave work pending without settling messages", async () => {
		const fixture = createSessionRuntimeFixture({
			failStatement: (sql) =>
				/^\s*update\s+"workspace_runtime_work"/i.test(sql) &&
				sql.includes("deliveryAttempts"),
		});
		fixture.seedTrustedSession();
		const admitted = await fixture.asUser("user-1").command(promptBody());
		await expect(fixture.deliver()).rejects.toThrow(
			/storage fault|Failed query/,
		);
		expect(fixture.sqlite.prepare("SELECT status FROM messages").all()).toEqual(
			expect.arrayContaining([{ status: "complete" }, { status: "pending" }]),
		);
		expect(
			(
				fixture.observeWork(
					(admitted.body as { commandId: string }).commandId,
				) as { deliveryState: string }
			).deliveryState,
		).not.toBe("delivered");
	});

	it("pass budget includes delayed persisted handoff reads before the transport call", async () => {
		let delayArmed = false;
		let readDelayCount = 0;
		const fixture = createSessionRuntimeFixture({
			now: Date.now,
			failStatement: (query) => {
				if (
					delayArmed &&
					/^select/i.test(query) &&
					query.includes('inner join "workspace_sessions"') &&
					query.includes('inner join "session_command_keys"')
				) {
					delayArmed = false;
					readDelayCount += 1;
					Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
				}
				return false;
			},
		});
		fixture.seedTrustedSession();
		const admitted = await fixture.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		fixture.setDeliverImpl(async (input) => {
			await new Promise((resolve) => setTimeout(resolve, 80));
			const row = fixture.sqlite
				.prepare(
					`SELECT sc.commandSeq AS commandSeq, k.receiptId AS receiptId
					 FROM session_commands sc
					 JOIN session_command_keys k ON k.commandId = sc.id
					 WHERE sc.id = ?`,
				)
				.get(input.commandId) as { commandSeq: number; receiptId: string };
			return {
				version: 1,
				commandId: input.commandId,
				ownerVersion: input.ownerVersion,
				acceptedPosition: row.commandSeq,
				receiptId: row.receiptId,
			};
		});
		delayArmed = true;
		const began = Date.now();
		await fixture.deliver({ maxMs: 100, maxDeliveries: 1 });
		const elapsed = Date.now() - began;
		expect(readDelayCount).toBe(1);
		expect(
			(fixture.observeWork(commandId) as { deliveryState: string })
				.deliveryState,
		).not.toBe("delivered");
		expect(elapsed).toBeLessThan(140);
		await new Promise((resolve) => setTimeout(resolve, 100));
	});

	it("expired lease-renewal budget does not start an RPC", async () => {
		let clock = 1_700_000_000_000;
		let delayRenewal = false;
		let renewalDelayCount = 0;
		const fixture = createSessionRuntimeFixture({
			now: () => clock,
			failStatement: (query) => {
				if (
					delayRenewal &&
					/^update "workspace_runtime_work" set "deliveryLeaseExpiresAt"/i.test(
						query,
					)
				) {
					delayRenewal = false;
					renewalDelayCount += 1;
					clock += 120;
				}
				return false;
			},
		});
		fixture.seedTrustedSession();
		const admitted = await fixture.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		delayRenewal = true;
		await fixture.deliver({ maxMs: 100, maxDeliveries: 1 });
		expect(renewalDelayCount).toBe(1);
		expect(
			fixture.outbound.filter((call) => call.method === "deliver"),
		).toHaveLength(0);
		expect(
			(
				fixture.sqlite
					.prepare(
						"SELECT deliveryState AS deliveryState, deliveryAttempts AS deliveryAttempts FROM workspace_runtime_work WHERE commandId = ?",
					)
					.get(commandId) as {
					deliveryState: string;
					deliveryAttempts: number;
				}
			).deliveryAttempts,
		).toBe(0);
	});

	it("partial lease-renewal budget still starts a remaining-bounded RPC", async () => {
		let clock = 1_700_000_000_000;
		let delayRenewal = false;
		const fixture = createSessionRuntimeFixture({
			now: () => clock,
			failStatement: (query) => {
				if (
					delayRenewal &&
					/^update "workspace_runtime_work" set "deliveryLeaseExpiresAt"/i.test(
						query,
					)
				) {
					delayRenewal = false;
					clock += 30;
				}
				return false;
			},
		});
		fixture.seedTrustedSession();
		const admitted = await fixture.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		delayRenewal = true;
		await fixture.deliver({ maxMs: 100, maxDeliveries: 1 });
		expect(
			fixture.outbound.filter((call) => call.method === "deliver"),
		).toEqual([{ method: "deliver", input: { commandId, ownerVersion: 1 } }]);
		expect(
			(fixture.observeWork(commandId) as { deliveryState: string })
				.deliveryState,
		).toBe("delivered");
	});

	it("T06 delivery-only: a missing predecessor on one workspace does not starve another, including a backlog past the candidate window and a priority Stop", async () => {
		let clock = 1_700_000_000_000;
		const fixture = createSessionRuntimeFixture({
			now: () => clock,
			random: () => 0.5,
		});
		fixture.seedTrustedSession({ sessionId: "a" });
		fixture.seedTrustedSession({ sessionId: "b" });
		const blocked: string[] = [];
		for (let n = 0; n < 10; n++) {
			const result = await fixture.asUser("user-1").command(
				promptBody({
					sessionId: "a",
					idempotencyKey: `a-${n}`,
					text: `blocked ${n}`,
				}),
			);
			blocked.push((result.body as { commandId: string }).commandId);
		}
		const b1 = await fixture.asUser("user-1").command(
			promptBody({
				sessionId: "b",
				idempotencyKey: "b-1",
				text: "healthy 1",
			}),
		);
		const b2 = await fixture.asUser("user-1").command(
			promptBody({
				sessionId: "b",
				idempotencyKey: "b-2",
				text: "healthy 2",
			}),
		);
		const stop = await fixture.asUser("user-1").command({
			version: 1,
			idempotencyKey: "a-stop",
			kind: "stop",
			projectId: "proj-1",
			sessionId: "a",
			targetRunId: "run-a",
		});
		const firstBlocked = blocked[0];
		const secondBlocked = blocked[1];
		if (!firstBlocked || !secondBlocked) {
			throw new Error("missing blocked commands");
		}
		fixture.setDeliverImpl(async (input) => {
			if (input.commandId === firstBlocked) {
				throw new SessionRuntimeHandoffError(
					"runtime_unavailable",
					"synthetic unavailable",
				);
			}
			if (blocked.includes(input.commandId)) {
				throw new SessionRuntimeHandoffError(
					"missing_predecessor",
					"synthetic missing predecessor",
				);
			}
			const row = fixture.sqlite
				.prepare(
					`SELECT sc.commandSeq AS commandSeq, k.receiptId AS receiptId
					 FROM session_commands sc
					 JOIN session_command_keys k ON k.commandId = sc.id
					 WHERE sc.id = ?`,
				)
				.get(input.commandId) as { commandSeq: number; receiptId: string };
			return {
				version: 1,
				commandId: input.commandId,
				ownerVersion: input.ownerVersion,
				acceptedPosition: row.commandSeq,
				receiptId: row.receiptId,
			};
		});
		for (let pass = 0; pass < 3; pass++) {
			await fixture.deliver();
			clock += 60_000;
		}
		const b1Id = (b1.body as { commandId: string }).commandId;
		const b2Id = (b2.body as { commandId: string }).commandId;
		const stopId = (stop.body as { commandId: string }).commandId;
		expect(
			(fixture.observeWork(b1Id) as { deliveryState: string }).deliveryState,
		).toBe("delivered");
		expect(
			(fixture.observeWork(b2Id) as { deliveryState: string }).deliveryState,
		).toBe("delivered");
		expect(
			(fixture.observeWork(stopId) as { deliveryState: string }).deliveryState,
		).toBe("delivered");
		expect(
			(fixture.observeWork(firstBlocked) as { deliveryState: string })
				.deliveryState,
		).toBe("pending");
	});

	it("production scheduled dispatch delivers through the shared resolver", async () => {
		const fixture = createSessionRuntimeFixture();
		fixture.seedTrustedSession();
		const admitted = await fixture.asUser("user-1").command(promptBody());
		const commandId = (admitted.body as { commandId: string }).commandId;
		await fixture.scheduledDrain();
		expect(
			fixture.outbound.filter((call) => call.method === "deliver"),
		).toEqual([{ method: "deliver", input: { commandId, ownerVersion: 1 } }]);
		expect(
			(fixture.observeWork(commandId) as { deliveryState: string })
				.deliveryState,
		).toBe("delivered");
		expect(
			(
				fixture.sqlite
					.prepare(
						"SELECT status FROM workspace_runtime_work WHERE commandId = ?",
					)
					.get(commandId) as { status: string }
			).status,
		).toBe("queued");
	});
});
