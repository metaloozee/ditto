import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { createDb } from "#/db";
import { providerAuthAttempts } from "#/db/schema";
import {
	AUTH_PROCESS_KILL_GRACE_MS,
	AUTH_RESOLUTION_TIMEOUT_MS,
	acquireLease,
	assertCredentialConfig,
	FALLBACK_MODEL_SPECIFIER,
	markNeedsRelogin,
	toRuntimeCredential as projectRuntimeCredential,
	projectSafeModels,
	releaseLease,
	type SafeModel,
	type StoredCredential,
	safeModelCatalogSchema,
	updateCredentialUnderLease,
	upsertCredential,
} from "#/lib/account-provider-credentials";
import { splitStdoutBuffer } from "#/lib/agent-stream-protocol";
import {
	classifyAuthUrl,
	isAllowedProviderAuth,
	PORTABLE_PROVIDER_AUTH,
	type ProviderAuthEvent,
	parseProviderAuthEvent,
} from "#/lib/provider-auth-protocol";
import { destroySandbox, getProjectSandbox } from "#/lib/sandbox-bootstrap";

const AUTH_CLI = "/opt/ditto-runner/dist/provider-auth-cli.js";
const AUTH_CONTROL_CLI = "/opt/ditto-runner/dist/provider-auth-control-cli.js";
const CATALOG_CLI = "/opt/ditto-runner/dist/provider-catalog-cli.js";
const RESULT_DIR = "/tmp/ditto-provider-auth-results";
const CONTROL_DIR = "/tmp/ditto-provider-auth-controls";
const AUTH_TIMEOUT_MS = 120_000;
const CONTROL_TIMEOUT_MS = 5_000;
const ATTEMPT_TTL_MS = 15 * 60_000;
const MAX_ANSWER = 8_192;

export const providerAuthStreamBodySchema = z.object({
	providerId: z.string().min(1).max(64),
	authType: z.enum(["api_key", "oauth"]),
});

export const providerAuthControlBodySchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("answer"),
		attemptId: z.string().min(1).max(128),
		promptId: z.string().min(1).max(128),
		value: z.string().max(MAX_ANSWER),
	}),
	z.object({
		action: z.literal("cancel"),
		attemptId: z.string().min(1).max(128),
	}),
]);

export type ProviderAuthStreamBody = z.infer<
	typeof providerAuthStreamBodySchema
>;
export type ProviderAuthControlBody = z.infer<
	typeof providerAuthControlBodySchema
>;

export type PublicAuthSseEvent =
	| { event: "meta"; data: { attemptId: string; providerId: string } }
	| {
			event: "prompt";
			data: Extract<ProviderAuthEvent, { kind: "prompt" }>;
	  }
	| {
			event: "auth_url";
			data: {
				url: string;
				clickable: boolean;
				instructions?: string;
			};
	  }
	| {
			event: "device_code";
			data: Extract<ProviderAuthEvent, { kind: "device_code" }>;
	  }
	| { event: "info"; data: { message: string } }
	| { event: "progress"; data: { message: string } }
	| { event: "credential_ready"; data: Record<string, never> }
	| { event: "done"; data: { ok: boolean } }
	| { event: "error"; data: { code: string; message: string } };

type Db = ReturnType<typeof createDb>;

type AuthDeps = {
	createId?: () => string;
	nowMs?: () => number;
	getProjectSandbox?: typeof getProjectSandbox;
	destroySandbox?: typeof destroySandbox;
	/** Injected catalog for tests. */
	loadCatalog?: () => Promise<{
		providers: Array<{
			providerId: string;
			name: string;
			authMethods: Array<{ type: "api_key" | "oauth"; label: string }>;
			models: SafeModel[];
		}>;
	}>;
};

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function safeId(value: string): string {
	return value.replaceAll(/[^A-Za-z0-9_-]/g, "").slice(0, 128) || nanoid();
}

const fallbackModel: SafeModel = {
	providerId: "opencode",
	modelId: "deepseek-v4-flash-free",
	name: "DeepSeek V4 Flash Free",
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export async function getProviderCatalog(options: {
	env: Env;
	deps?: AuthDeps;
}) {
	if (options.deps?.loadCatalog) {
		return options.deps.loadCatalog();
	}
	const sandboxId = `auth-catalog-${nanoid(10)}`;
	const sandbox = getProjectSandbox(options.env, sandboxId);
	try {
		const shell = await sandbox.createSession({
			id: `catalog-${nanoid(8)}`,
			cwd: "/tmp",
			commandTimeoutMs: 60_000,
		});
		try {
			const result = await shell.exec(`node ${CATALOG_CLI}`, {
				timeout: 60_000,
			});
			if (!result.success) {
				throw new Error("catalog_failed");
			}
			const parsed = JSON.parse(result.stdout) as {
				providers: Array<{
					providerId: string;
					name: string;
					authMethods: Array<{ type: "api_key" | "oauth"; label: string }>;
					models: unknown[];
				}>;
			};
			const providers = [];
			for (const p of parsed.providers ?? []) {
				if (!(p.providerId in PORTABLE_PROVIDER_AUTH)) continue;
				const methods = (p.authMethods ?? []).filter((m) =>
					isAllowedProviderAuth(p.providerId, m.type),
				);
				if (methods.length === 0) continue;
				let models: SafeModel[] = [];
				try {
					models = projectSafeModels(
						safeModelCatalogSchema.parse(p.models ?? []),
						p.providerId,
					);
				} catch {
					models = [];
				}
				providers.push({
					providerId: p.providerId,
					name: p.name,
					authMethods: methods,
					models,
				});
			}
			return { providers };
		} finally {
			try {
				await sandbox.deleteSession(shell.id);
			} catch {
				// ignore
			}
		}
	} finally {
		try {
			await destroySandbox({ env: options.env, sandboxId });
		} catch {
			// ignore
		}
	}
}

export async function listAccountModels(options: {
	db: Db;
	userId: string;
	listConnections: (
		db: Db,
		userId: string,
	) => Promise<
		Array<{
			providerId: string;
			status: string;
			models: SafeModel[];
		}>
	>;
}): Promise<SafeModel[]> {
	const connections = await options.listConnections(options.db, options.userId);
	const models: SafeModel[] = [fallbackModel];
	const seen = new Set<string>([FALLBACK_MODEL_SPECIFIER]);
	for (const conn of connections) {
		if (conn.status !== "connected") continue;
		for (const model of conn.models) {
			const id = `${model.providerId}/${model.modelId}`;
			if (seen.has(id)) continue;
			seen.add(id);
			models.push(model);
		}
	}
	return models;
}

export async function controlProviderAuth(options: {
	db: Db;
	env: Env;
	userId: string;
	input: ProviderAuthControlBody;
	deps?: AuthDeps;
}): Promise<{ status: number; body: Record<string, unknown> }> {
	const deps = { createId: nanoid, nowMs: Date.now, ...options.deps };
	const [attempt] = await options.db
		.select()
		.from(providerAuthAttempts)
		.where(
			and(
				eq(providerAuthAttempts.id, options.input.attemptId),
				eq(providerAuthAttempts.userId, options.userId),
			),
		)
		.limit(1);
	if (!attempt || attempt.status !== "pending") {
		return { status: 404, body: { error: "Auth attempt not found." } };
	}
	if (attempt.expiresAt.getTime() <= deps.nowMs()) {
		return { status: 404, body: { error: "Auth attempt expired." } };
	}
	if (!attempt.authSandboxId) {
		return { status: 409, body: { error: "Auth attempt is not ready." } };
	}

	const sandbox = (deps.getProjectSandbox ?? getProjectSandbox)(
		options.env,
		attempt.authSandboxId,
	);
	const requestId = deps.createId();
	const jobPath = `${CONTROL_DIR}/${safeId(requestId)}.json`;
	const request =
		options.input.action === "cancel"
			? { attemptId: options.input.attemptId, action: "cancel" as const }
			: {
					attemptId: options.input.attemptId,
					promptId: options.input.promptId,
					action: "answer" as const,
					value: options.input.value,
				};

	const shell = await sandbox.createSession({
		id: `auth-control-${safeId(requestId)}`,
		cwd: "/tmp",
		commandTimeoutMs: CONTROL_TIMEOUT_MS,
	});
	try {
		await shell.mkdir(CONTROL_DIR, { recursive: true });
		// Write then chmod 0600 via shell — Cloudflare sandbox writeFile may not set mode.
		await shell.writeFile(jobPath, JSON.stringify(request));
		await shell.exec(`chmod 600 ${quoteShellArg(jobPath)}`, {
			timeout: CONTROL_TIMEOUT_MS,
		});
		const result = await shell.exec(
			`node ${AUTH_CONTROL_CLI} --request ${quoteShellArg(jobPath)}`,
			{ timeout: CONTROL_TIMEOUT_MS },
		);
		let parsed: { accepted?: boolean } = {};
		try {
			parsed = JSON.parse(result.stdout.trim().split("\n")[0] ?? "{}") as {
				accepted?: boolean;
			};
		} catch {
			return { status: 409, body: { error: "Control failed." } };
		}
		// Never echo value.
		return {
			status: parsed.accepted ? 200 : 409,
			body: {
				accepted: !!parsed.accepted,
				action: options.input.action,
			},
		};
	} catch {
		return { status: 409, body: { error: "Control failed." } };
	} finally {
		try {
			await shell.deleteFile(jobPath);
		} catch {
			// ignore
		}
		try {
			await sandbox.deleteSession(shell.id);
		} catch {
			// ignore
		}
	}
}

export async function streamProviderAuth(options: {
	db: Db;
	env: Env;
	userId: string;
	input: ProviderAuthStreamBody;
	emit: (event: PublicAuthSseEvent) => void | Promise<void>;
	deps?: AuthDeps;
	/** Test hook: skip sandbox and inject result. */
	runInSandbox?: (args: {
		sandboxId: string;
		job: Record<string, unknown>;
		onLine: (line: string) => void | Promise<void>;
		readResult: () => Promise<string | null>;
	}) => Promise<void>;
}): Promise<void> {
	const deps = {
		createId: nanoid,
		nowMs: Date.now,
		getProjectSandbox,
		destroySandbox,
		...options.deps,
	};
	assertCredentialConfig({
		AI_CREDENTIALS_ENCRYPTION_KEY: options.env.AI_CREDENTIALS_ENCRYPTION_KEY,
		BETTER_AUTH_SECRET: options.env.BETTER_AUTH_SECRET,
		OPENCODE_API_KEY: options.env.OPENCODE_API_KEY,
	});

	if (
		!isAllowedProviderAuth(options.input.providerId, options.input.authType)
	) {
		await options.emit({
			event: "error",
			data: {
				code: "unsupported_auth",
				message: "This sign-in method is not available.",
			},
		});
		await options.emit({ event: "done", data: { ok: false } });
		return;
	}

	const attemptId = deps.createId();
	const sandboxId = `auth-${safeId(attemptId)}`;
	const resultPath = `${RESULT_DIR}/${safeId(attemptId)}.json`;
	const now = deps.nowMs();

	await options.db.insert(providerAuthAttempts).values({
		id: attemptId,
		userId: options.userId,
		providerId: options.input.providerId,
		authType: options.input.authType,
		authSandboxId: sandboxId,
		status: "pending",
		expiresAt: new Date(now + ATTEMPT_TTL_MS),
		createdAt: new Date(now),
		updatedAt: new Date(now),
	});

	await options.emit({
		event: "meta",
		data: { attemptId, providerId: options.input.providerId },
	});

	let enterpriseHost: string | undefined;
	let terminalOk = false;

	const handleEvent = async (raw: unknown) => {
		let event: ProviderAuthEvent;
		try {
			event = parseProviderAuthEvent(raw);
		} catch {
			return;
		}
		switch (event.kind) {
			case "prompt":
				if (
					options.input.providerId === "github-copilot" &&
					event.type === "text" &&
					/enterprise/i.test(event.message)
				) {
					// enterprise host captured from later answer path on worker is unknown;
					// host binding applied when auth_url arrives if we tracked answers — skip.
				}
				await options.emit({ event: "prompt", data: event });
				return;
			case "auth_url": {
				const decision = classifyAuthUrl(options.input.providerId, event.url, {
					enterpriseHost,
				});
				await options.emit({
					event: "auth_url",
					data: {
						url: decision.url,
						clickable: decision.kind === "open",
						instructions: event.instructions,
					},
				});
				return;
			}
			case "device_code":
				await options.emit({ event: "device_code", data: event });
				return;
			case "info":
				await options.emit({ event: "info", data: { message: event.message } });
				return;
			case "progress":
				await options.emit({
					event: "progress",
					data: { message: event.message },
				});
				return;
			case "credential_ready":
				await options.emit({ event: "credential_ready", data: {} });
				return;
			case "error":
				await options.emit({
					event: "error",
					data: { code: event.code, message: event.message },
				});
				return;
			case "done":
				terminalOk = event.ok;
				await options.emit({ event: "done", data: { ok: event.ok } });
				return;
		}
	};

	try {
		const job = {
			mode: "login",
			attemptId,
			providerId: options.input.providerId,
			authType: options.input.authType,
			resultPath,
		};

		if (options.runInSandbox) {
			const resultJson: string | null = null;
			await options.runInSandbox({
				sandboxId,
				job,
				onLine: async (line) => {
					try {
						await handleEvent(JSON.parse(line));
					} catch {
						// ignore
					}
				},
				readResult: async () => resultJson,
			});
			// Test harness sets result via closure — re-read after credential_ready path.
			void resultJson;
		} else {
			const sandbox = deps.getProjectSandbox(options.env, sandboxId);
			const shell = await sandbox.createSession({
				id: `auth-${safeId(attemptId)}`,
				cwd: "/tmp",
				commandTimeoutMs: AUTH_TIMEOUT_MS,
			});
			const jobPath = `/tmp/ditto-provider-auth-job-${safeId(attemptId)}.json`;
			try {
				await shell.mkdir(RESULT_DIR, { recursive: true });
				await shell.writeFile(jobPath, JSON.stringify(job));
				await shell.exec(`chmod 600 ${quoteShellArg(jobPath)}`, {
					timeout: 5_000,
				});

				const { parseSSEStream } = await import("@cloudflare/sandbox");
				type ExecEvent = import("@cloudflare/sandbox").ExecEvent;
				const stream = await shell.execStream(
					`node ${AUTH_CLI} --job ${quoteShellArg(jobPath)}`,
					{ cwd: "/tmp" },
				);

				let stdoutBuffer = "";
				let sawCredentialReady = false;

				for await (const execEvent of parseSSEStream<ExecEvent>(stream)) {
					if (
						execEvent.type === "stdout" &&
						typeof execEvent.data === "string"
					) {
						const split = splitStdoutBuffer(stdoutBuffer, execEvent.data);
						stdoutBuffer = split.rest;
						for (const line of split.lines) {
							if (!line.trim()) continue;
							let parsed: unknown;
							try {
								parsed = JSON.parse(line);
							} catch {
								continue;
							}
							const before = sawCredentialReady;
							await handleEvent(parsed);
							if (
								!before &&
								parsed &&
								typeof parsed === "object" &&
								(parsed as { kind?: string }).kind === "credential_ready"
							) {
								sawCredentialReady = true;
								try {
									const rawFile = await shell.readFile(resultPath);
									const raw = rawFile.content;
									await shell.deleteFile(resultPath);
									const payload = JSON.parse(raw) as {
										credential: StoredCredential;
										models: SafeModel[];
									};
									if (
										payload.credential &&
										typeof payload.credential === "object" &&
										"enterpriseUrl" in payload.credential &&
										typeof payload.credential.enterpriseUrl === "string"
									) {
										try {
											enterpriseHost = new URL(payload.credential.enterpriseUrl)
												.hostname;
										} catch {
											// ignore
										}
									}
									const models = projectSafeModels(
										payload.models,
										options.input.providerId,
									);
									await upsertCredential({
										db: options.db,
										userId: options.userId,
										providerId: options.input.providerId,
										authType: options.input.authType,
										credential: payload.credential,
										models,
										encryptionKey: options.env.AI_CREDENTIALS_ENCRYPTION_KEY,
										nowMs: deps.nowMs(),
										createId: deps.createId,
									});
								} catch {
									await options.emit({
										event: "error",
										data: {
											code: "persist_failed",
											message: "Failed to save provider connection.",
										},
									});
									terminalOk = false;
								}
							}
						}
					}
				}
			} finally {
				try {
					await shell.deleteFile(jobPath);
				} catch {
					// ignore
				}
				try {
					await shell.deleteFile(resultPath);
				} catch {
					// ignore
				}
				try {
					await sandbox.deleteSession(shell.id);
				} catch {
					// ignore
				}
			}
		}

		await options.db
			.update(providerAuthAttempts)
			.set({
				status: terminalOk ? "complete" : "failed",
				updatedAt: new Date(deps.nowMs()),
			})
			.where(eq(providerAuthAttempts.id, attemptId));
	} catch {
		await options.emit({
			event: "error",
			data: {
				code: "auth_failed",
				message: "Provider connection failed. Try again.",
			},
		});
		await options.emit({ event: "done", data: { ok: false } });
		await options.db
			.update(providerAuthAttempts)
			.set({ status: "failed", updatedAt: new Date(deps.nowMs()) })
			.where(eq(providerAuthAttempts.id, attemptId));
	} finally {
		try {
			await deps.destroySandbox({ env: options.env, sandboxId });
		} catch {
			// ignore
		}
	}
}

/** Refresh OAuth under D1 lease in an auth-only sandbox; return runtime credential. */
export async function resolveOAuthCredential(options: {
	db: Db;
	env: Env;
	userId: string;
	providerId: string;
	stored: StoredCredential;
	version: number;
	nowMs?: () => number;
	createId?: () => string;
}): Promise<
	| { ok: true; runtime: StoredCredential }
	| { ok: false; code: "busy" | "refresh_failed" | "missing" }
> {
	const nowMs = options.nowMs ?? Date.now;
	const createId = options.createId ?? nanoid;
	const lease = await acquireLease({
		db: options.db,
		userId: options.userId,
		providerId: options.providerId,
		nowMs: nowMs(),
		createId,
	});
	if (!lease) return { ok: false, code: "busy" };

	const attemptId = createId();
	const sandboxId = `auth-resolve-${safeId(attemptId)}`;
	const resultPath = `${RESULT_DIR}/${safeId(attemptId)}.json`;
	const jobPath = `/tmp/ditto-provider-auth-job-${safeId(attemptId)}.json`;

	try {
		const sandbox = getProjectSandbox(options.env, sandboxId);
		const shell = await sandbox.createSession({
			id: `auth-resolve-${safeId(attemptId)}`,
			cwd: "/tmp",
			env: {
				DITTO_PI_STORED_CREDENTIAL: JSON.stringify(options.stored),
			},
			commandTimeoutMs: AUTH_RESOLUTION_TIMEOUT_MS,
		});
		try {
			await shell.mkdir(RESULT_DIR, { recursive: true });
			await shell.writeFile(
				jobPath,
				JSON.stringify({
					mode: "resolve",
					attemptId,
					providerId: options.providerId,
					resultPath,
				}),
			);
			await shell.exec(`chmod 600 ${quoteShellArg(jobPath)}`, {
				timeout: 5_000,
			});
			const result = await shell.exec(
				`node ${AUTH_CLI} --job ${quoteShellArg(jobPath)}`,
				{ timeout: AUTH_RESOLUTION_TIMEOUT_MS },
			);
			void AUTH_PROCESS_KILL_GRACE_MS;

			if (!result.success) {
				await markNeedsRelogin({
					db: options.db,
					userId: options.userId,
					providerId: options.providerId,
					errorCode: "oauth_refresh_failed",
					nowMs: nowMs(),
				});
				return { ok: false, code: "refresh_failed" };
			}

			let raw = "";
			try {
				const file = await shell.readFile(resultPath);
				raw = file.content;
				await shell.deleteFile(resultPath);
			} catch {
				await markNeedsRelogin({
					db: options.db,
					userId: options.userId,
					providerId: options.providerId,
					errorCode: "oauth_refresh_failed",
					nowMs: nowMs(),
				});
				return { ok: false, code: "refresh_failed" };
			}

			const payload = JSON.parse(raw) as {
				storedCredential: StoredCredential;
				runtimeCredential: StoredCredential;
			};
			const write = await updateCredentialUnderLease({
				db: options.db,
				userId: options.userId,
				providerId: options.providerId,
				leaseId: lease.leaseId,
				expectedVersion: options.version,
				credential: payload.storedCredential,
				encryptionKey: options.env.AI_CREDENTIALS_ENCRYPTION_KEY,
				nowMs: nowMs(),
			});
			if (write === "missing") return { ok: false, code: "missing" };
			if (write === "stale") return { ok: false, code: "busy" };
			return {
				ok: true,
				runtime:
					payload.runtimeCredential ??
					projectRuntimeCredential(
						payload.storedCredential,
						options.providerId,
					),
			};
		} finally {
			try {
				await shell.deleteFile(jobPath);
			} catch {
				// ignore
			}
			try {
				await shell.deleteFile(resultPath);
			} catch {
				// ignore
			}
			try {
				await sandbox.deleteSession(shell.id);
			} catch {
				// ignore
			}
		}
	} catch {
		await markNeedsRelogin({
			db: options.db,
			userId: options.userId,
			providerId: options.providerId,
			errorCode: "oauth_refresh_failed",
			nowMs: nowMs(),
		});
		return { ok: false, code: "refresh_failed" };
	} finally {
		await releaseLease({
			db: options.db,
			userId: options.userId,
			providerId: options.providerId,
			leaseId: lease.leaseId,
			nowMs: nowMs(),
		});
		try {
			await destroySandbox({ env: options.env, sandboxId });
		} catch {
			// ignore
		}
	}
}
