import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AuthAttemptRow,
	acquireLease,
	type CredentialRepository,
	type CredentialRow,
	credentialRowMatches,
	LEASE_TTL_MS,
	loadCredential,
	type SafeModel,
	upsertCredential,
} from "#/lib/account-provider-credentials";

const parseSSEStreamMock = vi.hoisted(() => vi.fn());

vi.mock("@cloudflare/sandbox", () => ({
	parseSSEStream: parseSSEStreamMock,
}));

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: vi.fn(),
	destroySandbox: vi.fn(),
}));

const {
	controlProviderAuth,
	listAccountModels,
	ProcessExitUnconfirmedError,
	providerAuthControlBodySchema,
	providerAuthStreamBodySchema,
	resolveOAuthCredential,
	streamProviderAuth,
	terminateAuthProcess,
} = await import("#/lib/provider-auth-service");
const { FALLBACK_MODEL_SPECIFIER } = await import(
	"#/lib/account-provider-credentials"
);
const { classifyAuthUrl } = await import("#/lib/provider-auth-protocol");

const KEY = "ai-credentials-encryption-key-test-aaaa";
const AUTH = "better-auth-secret-distinct-xxxx";
const OPENCODE = "sk-opencode-operator-key-test-01";

function env(): Env {
	return {
		AI_CREDENTIALS_ENCRYPTION_KEY: KEY,
		BETTER_AUTH_SECRET: AUTH,
		OPENCODE_API_KEY: OPENCODE,
	} as Env;
}

const model: SafeModel = {
	providerId: "anthropic",
	modelId: "claude",
	name: "Claude",
};

function createTestRepo(nowMs = 2_000_000): {
	db: CredentialRepository;
	clock: { value: number };
	rows: Map<string, CredentialRow>;
} {
	const rows = new Map<string, CredentialRow>();
	const attempts = new Map<string, AuthAttemptRow>();
	const clock = { value: nowMs };
	const key = (userId: string, providerId: string) =>
		`${userId}\0${providerId}`;
	const nowDate = (ms: number) => new Date(ms);
	const db: CredentialRepository = {
		async getRow(userId, providerId) {
			const row = rows.get(key(userId, providerId));
			return row ? { ...row } : null;
		},
		async listRows(userId) {
			return [...rows.values()]
				.filter((r) => r.userId === userId)
				.map((r) => ({ ...r }));
		},
		async insertRow(row) {
			rows.set(key(row.userId, row.providerId), { ...row });
		},
		async updateRow(where, set) {
			const k = key(where.userId, where.providerId);
			const row = rows.get(k);
			if (!row || !credentialRowMatches(row, where)) return null;
			Object.assign(row, set);
			return { ...row };
		},
		async deleteRow(where) {
			const k = key(where.userId, where.providerId);
			const row = rows.get(k);
			if (!row || row.leaseId !== where.leaseId) return false;
			rows.delete(k);
			return true;
		},
		async clearExpiredLeases(now) {
			for (const row of rows.values()) {
				if (row.leaseExpiresAt && row.leaseExpiresAt.getTime() < now) {
					row.leaseId = null;
					row.leaseExpiresAt = null;
					row.updatedAt = nowDate(now);
				}
			}
		},
		async insertAttempt(row) {
			attempts.set(row.id, { ...row });
		},
		async getAttempt(id, userId) {
			const row = attempts.get(id);
			if (!row || row.userId !== userId) return null;
			return { ...row };
		},
		async updateAttempt(id, set) {
			const row = attempts.get(id);
			if (row) Object.assign(row, set);
		},
		async deleteExpiredAttempts(now) {
			for (const [id, a] of attempts) {
				if (a.expiresAt.getTime() < now) attempts.delete(id);
			}
		},
	};
	return { db, clock, rows };
}

function createFakeProcess(options?: {
	onKill?: (signal?: string) => void;
	exitOnTerm?: boolean;
}) {
	let alive = true;
	const order: string[] = [];
	const waiters: Array<() => void> = [];
	const proc = {
		id: "proc-1",
		kill: async (signal?: string) => {
			order.push(`kill:${signal ?? "default"}`);
			options?.onKill?.(signal);
			if (signal === "SIGKILL" || options?.exitOnTerm !== false) {
				alive = false;
				for (const w of waiters.splice(0)) w();
			}
		},
		waitForExit: async (_timeout?: number) => {
			order.push("waitForExit");
			if (!alive) return { exitCode: 1 };
			await new Promise<void>((resolve, reject) => {
				const t = setTimeout(() => reject(new Error("timeout")), 5);
				waiters.push(() => {
					clearTimeout(t);
					resolve();
				});
			});
			return { exitCode: 1 };
		},
		get alive() {
			return alive;
		},
		order,
	};
	return proc;
}

describe("provider-auth-service", () => {
	let db: CredentialRepository;
	let clock: { value: number };
	let rows: Map<string, CredentialRow>;
	let ids: number;

	beforeEach(() => {
		const t = createTestRepo(2_000_000);
		db = t.db;
		clock = t.clock;
		rows = t.rows;
		ids = 0;
	});

	const createId = () => `id-${++ids}`;

	it("validates stream/control bodies strictly", () => {
		expect(
			providerAuthStreamBodySchema.safeParse({
				providerId: "openai",
				authType: "api_key",
			}).success,
		).toBe(true);
		expect(
			providerAuthStreamBodySchema.safeParse({
				providerId: "openai",
				authType: "api_key",
				extra: true,
			}).success,
		).toBe(false);
		expect(
			providerAuthStreamBodySchema.safeParse({ providerId: "x" }).success,
		).toBe(false);
		const cancel = providerAuthControlBodySchema.safeParse({
			action: "cancel",
			attemptId: "a",
			value: "nope",
		});
		// strict cancel rejects extra value field
		expect(cancel.success).toBe(false);
	});

	it("always includes fallback model and hides needs_relogin models", async () => {
		const models = await listAccountModels({
			db: {} as never,
			userId: "user-a",
			listConnections: async () => [
				{
					providerId: "anthropic",
					status: "connected",
					models: [model],
				},
				{
					providerId: "openai",
					status: "needs_relogin",
					models: [{ providerId: "openai", modelId: "gpt", name: "GPT" }],
				},
			],
		});
		expect(
			models.some(
				(m) => `${m.providerId}/${m.modelId}` === FALLBACK_MODEL_SPECIFIER,
			),
		).toBe(true);
		expect(models.some((m) => m.modelId === "claude")).toBe(true);
		expect(models.some((m) => m.modelId === "gpt")).toBe(false);
	});

	it("streamProviderAuth persists success result into account vault", async () => {
		const events: Array<{ event: string; data: unknown }> = [];
		const result = JSON.stringify({
			credential: { type: "api_key", key: "sk-anthropic-test-key-zzzzzzzz" },
			models: [model],
		});

		await streamProviderAuth({
			db,
			env: env(),
			userId: "user-a",
			input: { providerId: "anthropic", authType: "api_key" },
			emit: (e) => {
				events.push(e);
			},
			deps: { createId, nowMs: () => clock.value },
			runInSandbox: async ({ onLine, setResult }) => {
				setResult(result);
				await onLine(JSON.stringify({ v: 1, kind: "credential_ready" }));
				await onLine(JSON.stringify({ v: 1, kind: "done", ok: true }));
			},
		});

		expect(
			events.some((e) => e.event === "done" && (e.data as { ok: boolean }).ok),
		).toBe(true);
		const loaded = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});
		expect(loaded?.credential).toEqual({
			type: "api_key",
			key: "sk-anthropic-test-key-zzzzzzzz",
		});
		expect(JSON.stringify(events)).not.toContain("sk-anthropic");
	});

	it("streamProviderAuth rejects missing/malformed result even if runner done:true", async () => {
		const events: Array<{ event: string; data: unknown }> = [];
		await streamProviderAuth({
			db,
			env: env(),
			userId: "user-a",
			input: { providerId: "anthropic", authType: "api_key" },
			emit: (e) => {
				events.push(e);
			},
			deps: { createId, nowMs: () => clock.value },
			runInSandbox: async ({ onLine, setResult }) => {
				setResult("{not-json");
				await onLine(JSON.stringify({ v: 1, kind: "credential_ready" }));
				await onLine(JSON.stringify({ v: 1, kind: "done", ok: true }));
			},
		});
		const done = events.filter((e) => e.event === "done");
		expect(done.at(-1)).toMatchObject({ data: { ok: false } });
		expect(events.some((e) => e.event === "error")).toBe(true);
		expect(
			await loadCredential({
				db,
				userId: "user-a",
				providerId: "anthropic",
				encryptionKey: KEY,
			}),
		).toBeNull();
	});

	it("streamProviderAuth rejects missing result file", async () => {
		const events: Array<{ event: string; data: unknown }> = [];
		await streamProviderAuth({
			db,
			env: env(),
			userId: "user-a",
			input: { providerId: "openai", authType: "api_key" },
			emit: (e) => {
				events.push(e);
			},
			deps: { createId, nowMs: () => clock.value },
			runInSandbox: async ({ onLine }) => {
				await onLine(JSON.stringify({ v: 1, kind: "credential_ready" }));
				await onLine(JSON.stringify({ v: 1, kind: "done", ok: true }));
			},
		});
		expect(events.at(-1)).toMatchObject({ event: "done", data: { ok: false } });
	});

	it("production path starts process once and streams logs without an AbortSignal", async () => {
		const startCalls: string[] = [];
		const streamCalls: Array<[string, unknown]> = [];
		const execStreamCalls: string[] = [];
		const lines = [
			JSON.stringify({ v: 1, kind: "progress", message: "working" }),
			JSON.stringify({ v: 1, kind: "done", ok: false }),
		];
		const fakeProc = createFakeProcess({ exitOnTerm: true });
		parseSSEStreamMock.mockImplementation(async function* () {
			for (const line of lines) {
				yield { type: "stdout", data: `${line}\n`, processId: "proc-1" };
			}
			yield { type: "exit", data: "", processId: "proc-1", exitCode: 0 };
		});
		const shell = {
			id: "sess-1",
			mkdir: async () => undefined,
			writeFile: async () => undefined,
			readFile: async () => ({ content: "" }),
			deleteFile: async () => undefined,
			exec: async (cmd: string) => {
				if (cmd.includes("stat")) return { success: true, stdout: "600\n" };
				if (cmd.includes("install") || cmd.includes("chmod")) {
					return { success: true, stdout: "" };
				}
				return { success: true, stdout: "" };
			},
			startProcess: async (cmd: string) => {
				startCalls.push(cmd);
				return fakeProc;
			},
			streamProcessLogs: async (id: string, options?: unknown) => {
				streamCalls.push([id, options]);
				return new ReadableStream({
					start(c) {
						c.close();
					},
				});
			},
			execStream: async (cmd: string) => {
				execStreamCalls.push(cmd);
				return new ReadableStream();
			},
		};

		const events: Array<{ event: string }> = [];
		await streamProviderAuth({
			db,
			env: env(),
			userId: "user-a",
			input: { providerId: "openai", authType: "api_key" },
			emit: (e) => {
				events.push(e);
			},
			deps: {
				createId,
				nowMs: () => clock.value,
				getProjectSandbox: () =>
					({
						createSession: async () => shell,
						deleteSession: async () => undefined,
					}) as never,
				destroySandbox: async () => undefined,
			},
		});

		expect(startCalls).toHaveLength(1);
		expect(streamCalls).toEqual([["proc-1", undefined]]);
		expect(execStreamCalls).toHaveLength(0);
		expect(parseSSEStreamMock).toHaveBeenCalledTimes(1);
	});

	it("terminateAuthProcess does TERM then KILL with await ordering", async () => {
		const order: string[] = [];
		let alive = true;
		const proc = {
			id: "p",
			kill: async (signal?: string) => {
				order.push(`kill:${signal}`);
				if (signal === "SIGKILL") alive = false;
			},
			waitForExit: async () => {
				order.push("wait");
				if (alive) throw new Error("still_alive");
				return { exitCode: 1 };
			},
		};
		await terminateAuthProcess(proc, {
			graceMs: 10,
			onStep: (s) => order.push(s),
		});
		expect(order).toEqual([
			"term",
			"kill:SIGTERM",
			"await_term",
			"wait",
			"kill",
			"kill:SIGKILL",
			"await_kill",
			"wait",
		]);
	});

	it("terminateAuthProcess throws when TERM and KILL waits both fail", async () => {
		const order: string[] = [];
		const proc = {
			id: "immortal",
			kill: async (signal?: string) => {
				order.push(`kill:${signal}`);
			},
			waitForExit: async () => {
				order.push("wait");
				throw new Error("still_alive");
			},
		};
		await expect(
			terminateAuthProcess(proc, {
				graceMs: 5,
				onStep: (s) => order.push(s),
			}),
		).rejects.toBeInstanceOf(ProcessExitUnconfirmedError);
		expect(order).toEqual([
			"term",
			"kill:SIGTERM",
			"await_term",
			"wait",
			"kill",
			"kill:SIGKILL",
			"await_kill",
			"wait",
		]);
	});

	it("terminateAuthProcess returns on TERM-confirmed exit without KILL", async () => {
		const order: string[] = [];
		const proc = {
			id: "p",
			kill: async (signal?: string) => {
				order.push(`kill:${signal}`);
			},
			waitForExit: async () => {
				order.push("wait");
				return { exitCode: 0 };
			},
		};
		await terminateAuthProcess(proc, {
			graceMs: 5,
			onStep: (s) => order.push(s),
		});
		expect(order).toEqual(["term", "kill:SIGTERM", "await_term", "wait"]);
	});

	it("validates device_code verification URLs with host policy", async () => {
		const events: Array<{ event: string; data: unknown }> = [];
		await streamProviderAuth({
			db,
			env: env(),
			userId: "user-a",
			input: { providerId: "openai-codex", authType: "oauth" },
			emit: (e) => {
				events.push(e);
			},
			deps: { createId, nowMs: () => clock.value },
			runInSandbox: async ({ onLine }) => {
				await onLine(
					JSON.stringify({
						v: 1,
						kind: "device_code",
						userCode: "ABCD-EFGH",
						verificationUri: "https://evil.example/device",
					}),
				);
				await onLine(JSON.stringify({ v: 1, kind: "done", ok: false }));
			},
		});
		const device = events.find((e) => e.event === "device_code");
		expect(device).toMatchObject({
			data: {
				verificationUri: "https://evil.example/device",
				clickable: false,
			},
		});
		expect(
			classifyAuthUrl("openai-codex", "https://auth.openai.com/device").kind,
		).toBe("open");
	});

	it("binds Copilot enterprise host exactly (no subdomain)", async () => {
		const events: Array<{ event: string; data: unknown }> = [];
		await streamProviderAuth({
			db,
			env: env(),
			userId: "user-a",
			input: { providerId: "github-copilot", authType: "oauth" },
			emit: (e) => {
				events.push(e);
			},
			deps: { createId, nowMs: () => clock.value },
			runInSandbox: async ({ onLine }) => {
				await onLine(
					JSON.stringify({
						v: 1,
						kind: "attempt_meta",
						enterpriseHost: "acme.ghe.com",
					}),
				);
				await onLine(
					JSON.stringify({
						v: 1,
						kind: "auth_url",
						url: "https://acme.ghe.com/login/device",
					}),
				);
				await onLine(
					JSON.stringify({
						v: 1,
						kind: "auth_url",
						url: "https://evil.acme.ghe.com/login/device",
					}),
				);
				await onLine(
					JSON.stringify({
						v: 1,
						kind: "auth_url",
						url: "https://other.ghe.com/login/device",
					}),
				);
				await onLine(
					JSON.stringify({
						v: 1,
						kind: "auth_url",
						url: "https://github.com/login/device",
					}),
				);
				await onLine(JSON.stringify({ v: 1, kind: "done", ok: false }));
			},
		});
		const urls = events.filter((e) => e.event === "auth_url");
		expect(urls[0]).toMatchObject({ data: { clickable: true } });
		expect(urls[1]).toMatchObject({ data: { clickable: false } });
		expect(urls[2]).toMatchObject({ data: { clickable: false } });
		expect(urls[3]).toMatchObject({ data: { clickable: true } });
	});

	it("resolveOAuthCredential timeout kills process before lease release", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-token-value-xx",
				access: "access-token-value-xx",
				expires: clock.value + 1000,
			},
			models: [model],
			encryptionKey: KEY,
			nowMs: clock.value,
			createId,
		});
		const loaded = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});

		const order: string[] = [];
		const outcome = await resolveOAuthCredential({
			db,
			env: env(),
			userId: "user-a",
			providerId: "anthropic",
			stored: loaded!.credential,
			version: loaded!.version,
			nowMs: () => clock.value,
			createId,
			deps: {
				destroySandbox: async () => {
					order.push("destroy");
				},
			},
			runResolve: async ({ terminate, signal }) => {
				order.push("start");
				// Simulate hanging process that only dies via terminate.
				const hanging = createFakeProcess({
					exitOnTerm: false,
					onKill: (sig) => order.push(`proc_kill:${sig}`),
				});
				// Patch waitForExit to record and only succeed after KILL.
				const originalWait = hanging.waitForExit.bind(hanging);
				hanging.waitForExit = async (t?: number) => {
					order.push("proc_wait");
					if (hanging.alive) {
						// First wait (after TERM) fails; after KILL succeeds.
						if (order.filter((x) => x === "proc_kill:SIGKILL").length > 0) {
							return originalWait(t);
						}
						throw new Error("still_running");
					}
					return { exitCode: 1 };
				};
				await new Promise((r) => setTimeout(r, 5));
				expect(signal.aborted || true).toBe(true);
				order.push("timeout");
				await terminate(hanging as never);
				order.push("terminated");
				return { ok: false, timedOut: true };
			},
		});
		expect(outcome).toEqual({ ok: false, code: "refresh_failed" });
		expect(order.indexOf("timeout")).toBeLessThan(order.indexOf("terminated"));
		expect(order.indexOf("terminated")).toBeLessThan(order.indexOf("destroy"));

		// Lease must be free only after confirmed exit.
		const lease = await acquireLease({
			db,
			userId: "user-a",
			providerId: "anthropic",
			nowMs: clock.value,
			createId: () => "after",
		});
		expect(lease).not.toBeNull();
		const status = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});
		expect(status?.status).toBe("needs_relogin");
	});

	it("unconfirmed kill retains lease; second acquire fails until TTL", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-token-value-xx",
				access: "access-token-value-xx",
				expires: clock.value + 1000,
			},
			models: [model],
			encryptionKey: KEY,
			nowMs: clock.value,
			createId,
		});
		const loaded = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});

		const immortal = {
			id: "immortal",
			kill: async () => undefined,
			waitForExit: async () => {
				throw new Error("still_running");
			},
		};

		const outcome = await resolveOAuthCredential({
			db,
			env: env(),
			userId: "user-a",
			providerId: "anthropic",
			stored: loaded!.credential,
			version: loaded!.version,
			nowMs: () => clock.value,
			createId,
			runResolve: async ({ terminate }) => {
				await terminate(immortal as never);
				return { ok: false, timedOut: true };
			},
		});
		expect(outcome).toEqual({ ok: false, code: "refresh_failed" });

		const status = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});
		expect(status?.status).toBe("connected");
		expect(status?.lastErrorCode).toBeNull();
		const row = rows.get("user-a\0anthropic");
		expect(row?.leaseId).toBeTruthy();

		// Second acquirer blocked while first process may still be alive.
		const blocked = await acquireLease({
			db,
			userId: "user-a",
			providerId: "anthropic",
			nowMs: clock.value,
			createId: () => "second",
		});
		expect(blocked).toBeNull();

		// After lease TTL, recovery acquisition succeeds.
		const recovered = await acquireLease({
			db,
			userId: "user-a",
			providerId: "anthropic",
			nowMs: clock.value + LEASE_TTL_MS + 1,
			createId: () => "recovered",
		});
		expect(recovered).toEqual({
			leaseId: "recovered",
			version: loaded!.version,
		});
	});

	it("TERM-confirmed resolve failure marks needs_relogin and releases lease", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-token-value-xx",
				access: "access-token-value-xx",
				expires: clock.value + 1000,
			},
			models: [model],
			encryptionKey: KEY,
			nowMs: clock.value,
			createId,
		});
		const loaded = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});

		const outcome = await resolveOAuthCredential({
			db,
			env: env(),
			userId: "user-a",
			providerId: "anthropic",
			stored: loaded!.credential,
			version: loaded!.version,
			nowMs: () => clock.value,
			createId,
			runResolve: async ({ terminate }) => {
				const proc = createFakeProcess({ exitOnTerm: true });
				await terminate(proc as never);
				return { ok: false };
			},
		});
		expect(outcome).toEqual({ ok: false, code: "refresh_failed" });
		const status = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});
		expect(status?.status).toBe("needs_relogin");
		const lease = await acquireLease({
			db,
			userId: "user-a",
			providerId: "anthropic",
			nowMs: clock.value,
			createId: () => "after-term",
		});
		expect(lease).not.toBeNull();
	});

	it("stale refresh failure after reconnect does not mark needs_relogin", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-old-token-xx",
				access: "access-old-token-xx",
				expires: clock.value + 1000,
			},
			models: [model],
			encryptionKey: KEY,
			nowMs: clock.value,
			createId,
		});
		const old = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});

		await resolveOAuthCredential({
			db,
			env: env(),
			userId: "user-a",
			providerId: "anthropic",
			stored: old!.credential,
			version: old!.version,
			nowMs: () => clock.value,
			createId,
			runResolve: async () => {
				const row = rows.get("user-a\0anthropic");
				if (row) {
					row.version += 1;
					row.status = "connected";
					row.lastErrorCode = null;
				}
				return { ok: false };
			},
		});
		const final = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});
		expect(final?.status).toBe("connected");
	});

	it("resolve success projects runtime from stored and enforces expiry", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-old-token-xx",
				access: "access-old-token-xx",
				expires: clock.value + 1000,
			},
			models: [model],
			encryptionKey: KEY,
			nowMs: clock.value,
			createId,
		});
		const old = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});
		const outcome = await resolveOAuthCredential({
			db,
			env: env(),
			userId: "user-a",
			providerId: "anthropic",
			stored: old!.credential,
			version: old!.version,
			nowMs: () => clock.value,
			createId,
			runResolve: async () => ({
				ok: true,
				resultJson: JSON.stringify({
					storedCredential: {
						type: "oauth",
						refresh: "refresh-new-token-yy",
						access: "access-new-token-yy",
						expires: clock.value + 3_600_000,
						evilExtra: "should-not-reach-runtime",
					},
					// Runner-supplied near-expiry runtime must be ignored.
					runtimeCredential: {
						type: "oauth",
						refresh: "ditto:no-refresh",
						access: "access-new-token-yy",
						expires: clock.value + 1_000,
					},
				}),
			}),
		});
		expect(outcome.ok).toBe(true);
		if (outcome.ok) {
			expect(outcome.runtime).toMatchObject({
				type: "oauth",
				refresh: "ditto:no-refresh",
				access: "access-new-token-yy",
				expires: clock.value + 3_600_000,
			});
			expect(outcome.runtime).not.toHaveProperty("evilExtra");
		}
	});

	it("resolve rejects near-expiry stored credentials", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-old-token-xx",
				access: "access-old-token-xx",
				expires: clock.value + 1000,
			},
			models: [model],
			encryptionKey: KEY,
			nowMs: clock.value,
			createId,
		});
		const old = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});
		const outcome = await resolveOAuthCredential({
			db,
			env: env(),
			userId: "user-a",
			providerId: "anthropic",
			stored: old!.credential,
			version: old!.version,
			nowMs: () => clock.value,
			createId,
			runResolve: async () => ({
				ok: true,
				resultJson: JSON.stringify({
					storedCredential: {
						type: "oauth",
						refresh: "refresh-new",
						access: "access-new",
						expires: clock.value + 30_000,
					},
				}),
			}),
		});
		expect(outcome).toEqual({ ok: false, code: "refresh_failed" });
	});

	it("controlProviderAuth: ownership 404", async () => {
		const res = await controlProviderAuth({
			db,
			env: env(),
			userId: "user-a",
			input: { action: "cancel", attemptId: "missing" },
		});
		expect(res.status).toBe(404);
	});

	it("client disconnect cleans up auth sandbox", async () => {
		const ac = new AbortController();
		let cleaned = false;
		await streamProviderAuth({
			db,
			env: env(),
			userId: "user-a",
			input: { providerId: "openai", authType: "api_key" },
			signal: ac.signal,
			emit: () => undefined,
			deps: {
				createId,
				nowMs: () => clock.value,
				destroySandbox: async () => {
					cleaned = true;
				},
			},
			runInSandbox: async () => {
				ac.abort();
			},
		});
		expect(cleaned).toBe(true);
	});
});
