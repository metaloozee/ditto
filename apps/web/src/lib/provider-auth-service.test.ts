import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	acquireLease,
	createMemoryCredentialDb,
	loadCredential,
	type MemoryCredentialDb,
	type SafeModel,
	upsertCredential,
} from "#/lib/account-provider-credentials";

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: vi.fn(),
	destroySandbox: vi.fn(),
}));

const {
	controlProviderAuth,
	listAccountModels,
	providerAuthControlBodySchema,
	providerAuthStreamBodySchema,
	resolveOAuthCredential,
	streamProviderAuth,
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

describe("provider-auth-service", () => {
	let db: MemoryCredentialDb;
	let ids: number;

	beforeEach(() => {
		db = createMemoryCredentialDb(2_000_000);
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
			providerAuthStreamBodySchema.safeParse({ providerId: "x" }).success,
		).toBe(false);
		const cancel = providerAuthControlBodySchema.safeParse({
			action: "cancel",
			attemptId: "a",
			value: "nope",
		});
		expect(cancel.success).toBe(true);
		if (cancel.success) {
			expect(cancel.data).toEqual({ action: "cancel", attemptId: "a" });
		}
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
			db: db as never,
			env: env(),
			userId: "user-a",
			input: { providerId: "anthropic", authType: "api_key" },
			emit: (e) => {
				events.push(e);
			},
			deps: { createId, nowMs: () => db.clock },
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
			db: db as never,
			env: env(),
			userId: "user-a",
			input: { providerId: "anthropic", authType: "api_key" },
			emit: (e) => {
				events.push(e);
			},
			deps: { createId, nowMs: () => db.clock },
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
			db: db as never,
			env: env(),
			userId: "user-a",
			input: { providerId: "openai", authType: "api_key" },
			emit: (e) => {
				events.push(e);
			},
			deps: { createId, nowMs: () => db.clock },
			runInSandbox: async ({ onLine }) => {
				await onLine(JSON.stringify({ v: 1, kind: "credential_ready" }));
				await onLine(JSON.stringify({ v: 1, kind: "done", ok: true }));
			},
		});
		expect(events.at(-1)).toMatchObject({ event: "done", data: { ok: false } });
	});

	it("validates device_code verification URLs with host policy", async () => {
		const events: Array<{ event: string; data: unknown }> = [];
		await streamProviderAuth({
			db: db as never,
			env: env(),
			userId: "user-a",
			input: { providerId: "openai-codex", authType: "oauth" },
			emit: (e) => {
				events.push(e);
			},
			deps: { createId, nowMs: () => db.clock },
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

	it("binds Copilot enterprise host from attempt_meta", async () => {
		const events: Array<{ event: string; data: unknown }> = [];
		await streamProviderAuth({
			db: db as never,
			env: env(),
			userId: "user-a",
			input: { providerId: "github-copilot", authType: "oauth" },
			emit: (e) => {
				events.push(e);
			},
			deps: { createId, nowMs: () => db.clock },
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
						url: "https://other.ghe.com/login/device",
					}),
				);
				await onLine(JSON.stringify({ v: 1, kind: "done", ok: false }));
			},
		});
		const urls = events.filter((e) => e.event === "auth_url");
		expect(urls[0]).toMatchObject({ data: { clickable: true } });
		expect(urls[1]).toMatchObject({ data: { clickable: false } });
	});

	it("resolveOAuthCredential timeout/kill grace before lease release", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-token-value-xx",
				access: "access-token-value-xx",
				expires: db.clock + 1000,
			},
			models: [model],
			encryptionKey: KEY,
			nowMs: db.clock,
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
			db: db as never,
			env: env(),
			userId: "user-a",
			providerId: "anthropic",
			stored: loaded!.credential,
			version: loaded!.version,
			nowMs: () => db.clock,
			createId,
			deps: {
				sleep: async () => {
					order.push("kill_grace");
				},
				destroySandbox: async () => {
					order.push("destroy");
				},
			},
			runResolve: async () => {
				order.push("timeout");
				return { ok: false, timedOut: true };
			},
		});
		expect(outcome).toEqual({ ok: false, code: "refresh_failed" });
		expect(order.indexOf("timeout")).toBeLessThan(order.indexOf("kill_grace"));
		const lease = await acquireLease({
			db,
			userId: "user-a",
			providerId: "anthropic",
			nowMs: db.clock,
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
				expires: db.clock + 1000,
			},
			models: [model],
			encryptionKey: KEY,
			nowMs: db.clock,
			createId,
		});
		const old = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});

		await resolveOAuthCredential({
			db: db as never,
			env: env(),
			userId: "user-a",
			providerId: "anthropic",
			stored: old!.credential,
			version: old!.version,
			nowMs: () => db.clock,
			createId,
			runResolve: async () => {
				const row = db.rows.get("user-a\0anthropic");
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

	it("resolve success validates credential and updates under lease", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-old-token-xx",
				access: "access-old-token-xx",
				expires: db.clock + 1000,
			},
			models: [model],
			encryptionKey: KEY,
			nowMs: db.clock,
			createId,
		});
		const old = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY,
		});
		const outcome = await resolveOAuthCredential({
			db: db as never,
			env: env(),
			userId: "user-a",
			providerId: "anthropic",
			stored: old!.credential,
			version: old!.version,
			nowMs: () => db.clock,
			createId,
			runResolve: async () => ({
				ok: true,
				resultJson: JSON.stringify({
					storedCredential: {
						type: "oauth",
						refresh: "refresh-new-token-yy",
						access: "access-new-token-yy",
						expires: db.clock + 3_600_000,
					},
					runtimeCredential: {
						type: "oauth",
						refresh: "ditto:no-refresh",
						access: "access-new-token-yy",
						expires: db.clock + 3_600_000,
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
			});
		}
	});

	it("controlProviderAuth: ownership 404", async () => {
		const res = await controlProviderAuth({
			db: {
				select: () => ({
					from: () => ({
						where: () => ({
							limit: async () => [],
						}),
					}),
				}),
			} as never,
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
			db: db as never,
			env: env(),
			userId: "user-a",
			input: { providerId: "openai", authType: "api_key" },
			signal: ac.signal,
			emit: () => undefined,
			deps: {
				createId,
				nowMs: () => db.clock,
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
