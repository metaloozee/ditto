import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { createDb } from "#/db";
import { providerAuthAttempts } from "#/db/schema";
import {
	AUTH_PROCESS_KILL_GRACE_MS,
	AUTH_RESOLUTION_TIMEOUT_MS,
	acquireLeaseWithWait,
	assertCredentialConfig,
	FALLBACK_MODEL_SPECIFIER,
	isMemoryCredentialDb,
	type MemoryCredentialDb,
	markNeedsRelogin,
	parseStoredCredential,
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
const MAX_PROVIDER_NAME = 128;
const MAX_AUTH_LABEL = 128;

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
			data: {
				userCode: string;
				verificationUri: string;
				clickable: boolean;
				intervalSeconds?: number;
				expiresInSeconds?: number;
			};
	  }
	| { event: "info"; data: { message: string } }
	| { event: "progress"; data: { message: string } }
	| { event: "credential_ready"; data: Record<string, never> }
	| { event: "done"; data: { ok: boolean } }
	| { event: "error"; data: { code: string; message: string } };

type Db = ReturnType<typeof createDb>;

type AuthShell = {
	id: string;
	mkdir: (path: string, options?: { recursive?: boolean }) => Promise<unknown>;
	writeFile: (path: string, content: string) => Promise<unknown>;
	readFile: (path: string) => Promise<{ content: string }>;
	deleteFile: (path: string) => Promise<unknown>;
	exec: (
		command: string,
		options?: { timeout?: number },
	) => Promise<{ success: boolean; stdout: string; stderr?: string }>;
	execStream?: (
		command: string,
		options?: { cwd?: string },
	) => Promise<ReadableStream<Uint8Array>>;
	startProcess?: (
		command: string,
		options?: Record<string, unknown>,
	) => Promise<{
		id: string;
		kill: (signal?: string) => Promise<void>;
		waitForExit: (timeout?: number) => Promise<{ exitCode?: number }>;
		getLogs?: () => Promise<{ stdout: string; stderr: string }>;
	}>;
};

type AuthSandbox = {
	createSession: (options: {
		id: string;
		cwd: string;
		env?: Record<string, string>;
		commandTimeoutMs?: number;
	}) => Promise<AuthShell>;
	deleteSession: (id: string) => Promise<unknown>;
};

export type AuthDeps = {
	createId?: () => string;
	nowMs?: () => number;
	getProjectSandbox?: (env: Env, sandboxId: string) => AuthSandbox;
	destroySandbox?: typeof destroySandbox;
	loadCatalog?: () => Promise<{
		providers: Array<{
			providerId: string;
			name: string;
			authMethods: Array<{ type: "api_key" | "oauth"; label: string }>;
			models: SafeModel[];
		}>;
	}>;
	sleep?: (ms: number) => Promise<void>;
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

const catalogProviderSchema = z.object({
	providerId: z.string().min(1).max(64),
	name: z.string().min(1).max(MAX_PROVIDER_NAME),
	authMethods: z
		.array(
			z.object({
				type: z.enum(["api_key", "oauth"]),
				label: z.string().min(1).max(MAX_AUTH_LABEL),
			}),
		)
		.max(8),
	models: z.array(z.unknown()).max(500).optional(),
});

/** Pre-create path as 0600, write content, verify mode. */
async function writeSecretPath(
	shell: AuthShell,
	filePath: string,
	content: string,
): Promise<void> {
	const q = quoteShellArg(filePath);
	await shell.exec(`install -m 600 /dev/null ${q}`, { timeout: 5_000 });
	await shell.writeFile(filePath, content);
	await shell.exec(`chmod 600 ${q}`, { timeout: 5_000 });
	const mode = await shell.exec(`stat -c %a ${q}`, { timeout: 5_000 });
	if (mode.stdout.trim() !== "600") {
		throw new Error("unsafe_file_mode");
	}
}

async function verifyMode600(
	shell: AuthShell,
	filePath: string,
): Promise<void> {
	const mode = await shell.exec(`stat -c %a ${quoteShellArg(filePath)}`, {
		timeout: 5_000,
	});
	if (mode.stdout.trim() !== "600") {
		throw new Error("unsafe_file_mode");
	}
}

export async function getProviderCatalog(options: {
	env: Env;
	deps?: AuthDeps;
}) {
	if (options.deps?.loadCatalog) {
		return options.deps.loadCatalog();
	}
	const sandboxId = `auth-catalog-${nanoid(10)}`;
	const getSandbox = options.deps?.getProjectSandbox ?? getProjectSandbox;
	const destroy = options.deps?.destroySandbox ?? destroySandbox;
	const sandbox = getSandbox(options.env, sandboxId) as AuthSandbox;
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
			const parsed = z
				.object({
					v: z.literal(1).optional(),
					providers: z.array(z.unknown()).max(64),
				})
				.parse(JSON.parse(result.stdout));
			const providers = [];
			for (const raw of parsed.providers) {
				const p = catalogProviderSchema.safeParse(raw);
				if (!p.success) continue;
				if (!(p.data.providerId in PORTABLE_PROVIDER_AUTH)) continue;
				const methods = p.data.authMethods.filter((m) =>
					isAllowedProviderAuth(p.data.providerId, m.type),
				);
				if (methods.length === 0) continue;
				let models: SafeModel[] = [];
				try {
					models = projectSafeModels(
						safeModelCatalogSchema.parse(p.data.models ?? []),
						p.data.providerId,
					);
				} catch {
					models = [];
				}
				providers.push({
					providerId: p.data.providerId,
					name: p.data.name,
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
			await destroy({ env: options.env, sandboxId });
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
	const deps = {
		createId: nanoid,
		nowMs: Date.now,
		getProjectSandbox: getProjectSandbox as AuthDeps["getProjectSandbox"],
		...options.deps,
	};
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

	const getSandbox = deps.getProjectSandbox ?? getProjectSandbox;
	const sandbox = getSandbox(options.env, attempt.authSandboxId) as AuthSandbox;
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
		await writeSecretPath(shell, jobPath, JSON.stringify(request));
		const result = await shell.exec(
			`node ${AUTH_CONTROL_CLI} --request ${quoteShellArg(jobPath)}`,
			{ timeout: CONTROL_TIMEOUT_MS },
		);
		let parsed: { accepted?: boolean } = {};
		try {
			parsed = z
				.object({ accepted: z.boolean().optional() })
				.parse(JSON.parse(result.stdout.trim().split("\n")[0] ?? "{}"));
		} catch {
			return { status: 409, body: { error: "Control failed." } };
		}
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

const loginResultSchema = z.object({
	credential: z.unknown(),
	models: z.array(z.unknown()).max(500),
});

const resolveResultSchema = z.object({
	storedCredential: z.unknown(),
	runtimeCredential: z.unknown().optional(),
	models: z.array(z.unknown()).max(500).optional(),
});

export async function streamProviderAuth(options: {
	db: Db | MemoryCredentialDb;
	env: Env;
	userId: string;
	input: ProviderAuthStreamBody;
	emit: (event: PublicAuthSseEvent) => void | Promise<void>;
	deps?: AuthDeps;
	signal?: AbortSignal;
	/** Test hook: drive auth without a real sandbox. */
	runInSandbox?: (args: {
		sandboxId: string;
		attemptId: string;
		job: Record<string, unknown>;
		onLine: (line: string) => void | Promise<void>;
		/** Provide credential result JSON for the next credential_ready read. */
		setResult: (raw: string | null) => void;
		readResult: () => Promise<string | null>;
		signal?: AbortSignal;
	}) => Promise<void>;
}): Promise<void> {
	const deps = {
		createId: nanoid,
		nowMs: Date.now,
		getProjectSandbox: getProjectSandbox as AuthDeps["getProjectSandbox"],
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

	const attemptRow = {
		id: attemptId,
		userId: options.userId,
		providerId: options.input.providerId,
		authType: options.input.authType,
		authSandboxId: sandboxId,
		status: "pending" as const,
		expiresAt: new Date(now + ATTEMPT_TTL_MS),
		createdAt: new Date(now),
		updatedAt: new Date(now),
	};
	if (isMemoryCredentialDb(options.db)) {
		options.db.attempts.set(attemptId, attemptRow);
	} else {
		await options.db.insert(providerAuthAttempts).values(attemptRow);
	}

	await options.emit({
		event: "meta",
		data: { attemptId, providerId: options.input.providerId },
	});

	let enterpriseHost: string | undefined;
	/** null = no credential yet; true/false = persist outcome. */
	let persistOk: boolean | null = null;
	let emittedDone = false;
	let cancelled = false;

	const emitDone = async (ok: boolean) => {
		if (emittedDone) return;
		emittedDone = true;
		await options.emit({ event: "done", data: { ok } });
	};

	const persistCredential = async (raw: string): Promise<boolean> => {
		try {
			const payload = loginResultSchema.parse(JSON.parse(raw));
			const credential = parseStoredCredential(payload.credential);
			const models = projectSafeModels(
				payload.models,
				options.input.providerId,
			);
			const write = await upsertCredential({
				db: options.db,
				userId: options.userId,
				providerId: options.input.providerId,
				authType: options.input.authType,
				credential,
				models,
				encryptionKey: options.env.AI_CREDENTIALS_ENCRYPTION_KEY,
				nowMs: deps.nowMs(),
				createId: deps.createId,
			});
			return write === "ok";
		} catch {
			return false;
		}
	};

	const handleEvent = async (
		raw: unknown,
		readResult: () => Promise<string | null>,
	) => {
		let event: ProviderAuthEvent;
		try {
			event = parseProviderAuthEvent(raw);
		} catch {
			return;
		}
		switch (event.kind) {
			case "prompt":
				await options.emit({ event: "prompt", data: event });
				return;
			case "attempt_meta":
				enterpriseHost = event.enterpriseHost.toLowerCase();
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
			case "device_code": {
				const decision = classifyAuthUrl(
					options.input.providerId,
					event.verificationUri,
					{ enterpriseHost },
				);
				await options.emit({
					event: "device_code",
					data: {
						userCode: event.userCode,
						verificationUri: decision.url,
						clickable: decision.kind === "open",
						intervalSeconds: event.intervalSeconds,
						expiresInSeconds: event.expiresInSeconds,
					},
				});
				return;
			}
			case "info":
				await options.emit({ event: "info", data: { message: event.message } });
				return;
			case "progress":
				await options.emit({
					event: "progress",
					data: { message: event.message },
				});
				return;
			case "credential_ready": {
				await options.emit({ event: "credential_ready", data: {} });
				const rawFile = await readResult();
				if (!rawFile) {
					persistOk = false;
					await options.emit({
						event: "error",
						data: {
							code: "persist_failed",
							message: "Failed to save provider connection.",
						},
					});
					return;
				}
				persistOk = await persistCredential(rawFile);
				if (!persistOk) {
					await options.emit({
						event: "error",
						data: {
							code: "persist_failed",
							message: "Failed to save provider connection.",
						},
					});
				}
				return;
			}
			case "error":
				await options.emit({
					event: "error",
					data: { code: event.code, message: event.message },
				});
				return;
			case "done": {
				// Never accept runner success unless D1 persistence succeeded.
				const ok = event.ok && persistOk === true;
				if (event.ok && persistOk !== true) {
					if (persistOk === null) {
						await options.emit({
							event: "error",
							data: {
								code: "persist_failed",
								message: "Failed to save provider connection.",
							},
						});
					}
					await emitDone(false);
					return;
				}
				await emitDone(ok);
				return;
			}
		}
	};

	const onAbort = () => {
		cancelled = true;
	};
	options.signal?.addEventListener("abort", onAbort, { once: true });

	try {
		const job = {
			mode: "login",
			attemptId,
			providerId: options.input.providerId,
			authType: options.input.authType,
			resultPath,
		};

		if (options.runInSandbox) {
			let resultHolder: string | null = null;
			const readResult = async () => {
				const raw = resultHolder;
				resultHolder = null;
				return raw;
			};
			await options.runInSandbox({
				sandboxId,
				attemptId,
				job,
				signal: options.signal,
				setResult: (raw) => {
					resultHolder = raw;
				},
				readResult,
				onLine: async (line) => {
					if (cancelled || options.signal?.aborted) return;
					try {
						await handleEvent(JSON.parse(line), readResult);
					} catch {
						// ignore
					}
				},
			});
		} else {
			const getSb = deps.getProjectSandbox ?? getProjectSandbox;
			const sandbox = getSb(options.env, sandboxId) as AuthSandbox;
			const shell = await sandbox.createSession({
				id: `auth-${safeId(attemptId)}`,
				cwd: "/tmp",
				commandTimeoutMs: AUTH_TIMEOUT_MS,
			});
			const jobPath = `/tmp/ditto-provider-auth-job-${safeId(attemptId)}.json`;
			let processHandle: {
				kill: (signal?: string) => Promise<void>;
				waitForExit: (timeout?: number) => Promise<{ exitCode?: number }>;
			} | null = null;
			try {
				await shell.mkdir(RESULT_DIR, { recursive: true });
				await writeSecretPath(shell, jobPath, JSON.stringify(job));

				const readResult = async (): Promise<string | null> => {
					try {
						await verifyMode600(shell, resultPath);
						const rawFile = await shell.readFile(resultPath);
						await shell.deleteFile(resultPath);
						return rawFile.content;
					} catch {
						return null;
					}
				};

				const cmd = `node ${AUTH_CLI} --job ${quoteShellArg(jobPath)}`;
				if (shell.startProcess) {
					processHandle = await shell.startProcess(cmd, { cwd: "/tmp" });
					// Prefer log stream if available via execStream fallback.
				}

				if (shell.execStream) {
					const { parseSSEStream } = await import("@cloudflare/sandbox");
					type ExecEvent = import("@cloudflare/sandbox").ExecEvent;
					const stream = await shell.execStream(cmd, { cwd: "/tmp" });
					let stdoutBuffer = "";
					for await (const execEvent of parseSSEStream<ExecEvent>(stream)) {
						if (cancelled || options.signal?.aborted) {
							if (processHandle) {
								try {
									await processHandle.kill("SIGTERM");
									await processHandle.waitForExit(AUTH_PROCESS_KILL_GRACE_MS);
								} catch {
									// ignore
								}
							}
							break;
						}
						if (
							execEvent.type === "stdout" &&
							typeof execEvent.data === "string"
						) {
							const split = splitStdoutBuffer(stdoutBuffer, execEvent.data);
							stdoutBuffer = split.rest;
							for (const line of split.lines) {
								if (!line.trim()) continue;
								try {
									await handleEvent(JSON.parse(line), readResult);
								} catch {
									// ignore
								}
							}
						}
					}
				} else {
					const result = await shell.exec(cmd, { timeout: AUTH_TIMEOUT_MS });
					for (const line of result.stdout.split("\n")) {
						if (!line.trim()) continue;
						try {
							await handleEvent(JSON.parse(line), readResult);
						} catch {
							// ignore
						}
					}
				}
			} finally {
				if (cancelled || options.signal?.aborted) {
					try {
						await shell.exec(`pkill -f ${quoteShellArg(AUTH_CLI)} || true`, {
							timeout: AUTH_PROCESS_KILL_GRACE_MS,
						});
					} catch {
						// ignore
					}
					const sleep =
						deps.sleep ??
						((ms: number) => new Promise((r) => setTimeout(r, ms)));
					await sleep(Math.min(AUTH_PROCESS_KILL_GRACE_MS, 100));
				}
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

		if (!emittedDone) {
			const ok = persistOk === true && !cancelled && !options.signal?.aborted;
			await emitDone(ok);
		}

		const terminalStatus =
			cancelled || options.signal?.aborted
				? ("cancelled" as const)
				: persistOk === true
					? ("complete" as const)
					: ("failed" as const);
		if (isMemoryCredentialDb(options.db)) {
			const row = options.db.attempts.get(attemptId);
			if (row) {
				row.status = terminalStatus;
				row.updatedAt = new Date(deps.nowMs());
			}
		} else {
			await options.db
				.update(providerAuthAttempts)
				.set({
					status: terminalStatus,
					updatedAt: new Date(deps.nowMs()),
				})
				.where(eq(providerAuthAttempts.id, attemptId));
		}
	} catch {
		await options.emit({
			event: "error",
			data: {
				code: "auth_failed",
				message: "Provider connection failed. Try again.",
			},
		});
		await emitDone(false);
		if (isMemoryCredentialDb(options.db)) {
			const row = options.db.attempts.get(attemptId);
			if (row) {
				row.status = "failed";
				row.updatedAt = new Date(deps.nowMs());
			}
		} else {
			await options.db
				.update(providerAuthAttempts)
				.set({ status: "failed", updatedAt: new Date(deps.nowMs()) })
				.where(eq(providerAuthAttempts.id, attemptId));
		}
	} finally {
		options.signal?.removeEventListener("abort", onAbort);
		try {
			await deps.destroySandbox({ env: options.env, sandboxId });
		} catch {
			// ignore
		}
	}
}

/**
 * Refresh OAuth under D1 lease in an auth-only sandbox; return runtime credential.
 * Ordering: timeout -> terminate -> await exit/kill grace -> then release lease.
 */
export async function resolveOAuthCredential(options: {
	db: Db | MemoryCredentialDb;
	env: Env;
	userId: string;
	providerId: string;
	stored: StoredCredential;
	version: number;
	nowMs?: () => number;
	createId?: () => string;
	deps?: AuthDeps;
	/** Test hook replacing sandbox process. */
	runResolve?: (args: {
		job: Record<string, unknown>;
		stored: StoredCredential;
		timeoutMs: number;
		signal: AbortSignal;
	}) => Promise<
		| { ok: true; resultJson: string }
		| { ok: false; timedOut?: boolean; code?: string }
	>;
}): Promise<
	| { ok: true; runtime: StoredCredential }
	| { ok: false; code: "busy" | "refresh_failed" | "missing" }
> {
	const nowMs = options.nowMs ?? Date.now;
	const createId = options.createId ?? nanoid;
	const sleep =
		options.deps?.sleep ??
		((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const getSandbox =
		options.deps?.getProjectSandbox ??
		(getProjectSandbox as AuthDeps["getProjectSandbox"]);
	const destroy = options.deps?.destroySandbox ?? destroySandbox;

	const lease = await acquireLeaseWithWait({
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
	const abort = new AbortController();
	let processAlive = false;

	const markFailed = async () => {
		await markNeedsRelogin({
			db: options.db,
			userId: options.userId,
			providerId: options.providerId,
			errorCode: "oauth_refresh_failed",
			leaseId: lease.leaseId,
			expectedVersion: options.version,
			nowMs: nowMs(),
		});
	};

	try {
		const job = {
			mode: "resolve" as const,
			attemptId,
			providerId: options.providerId,
			resultPath,
		};

		let resultJson: string | null = null;

		if (options.runResolve) {
			processAlive = true;
			const outcome = await options.runResolve({
				job,
				stored: options.stored,
				timeoutMs: AUTH_RESOLUTION_TIMEOUT_MS,
				signal: abort.signal,
			});
			processAlive = false;
			if (!outcome.ok) {
				if (outcome.timedOut) {
					// Simulate terminate + kill grace before release (caller ordering).
					await sleep(0);
				}
				await markFailed();
				return { ok: false, code: "refresh_failed" };
			}
			resultJson = outcome.resultJson;
		} else {
			const sandbox = (getSandbox ?? getProjectSandbox)(
				options.env,
				sandboxId,
			) as AuthSandbox;
			const shell = await sandbox.createSession({
				id: `auth-resolve-${safeId(attemptId)}`,
				cwd: "/tmp",
				env: {
					DITTO_PI_STORED_CREDENTIAL: JSON.stringify(options.stored),
				},
				commandTimeoutMs:
					AUTH_RESOLUTION_TIMEOUT_MS + AUTH_PROCESS_KILL_GRACE_MS,
			});
			try {
				await shell.mkdir(RESULT_DIR, { recursive: true });
				await writeSecretPath(shell, jobPath, JSON.stringify(job));
				const cmd = `node ${AUTH_CLI} --job ${quoteShellArg(jobPath)}`;
				processAlive = true;

				if (shell.startProcess) {
					const proc = await shell.startProcess(cmd, { cwd: "/tmp" });
					let timedOut = false;
					const timer = setTimeout(() => {
						timedOut = true;
						abort.abort();
					}, AUTH_RESOLUTION_TIMEOUT_MS);
					try {
						if (timedOut || abort.signal.aborted) {
							await proc.kill("SIGTERM");
							try {
								await proc.waitForExit(AUTH_PROCESS_KILL_GRACE_MS);
							} catch {
								try {
									await proc.kill("SIGKILL");
									await proc.waitForExit(AUTH_PROCESS_KILL_GRACE_MS);
								} catch {
									// ignore
								}
							}
							processAlive = false;
							await markFailed();
							return { ok: false, code: "refresh_failed" };
						}
						const exit = await Promise.race([
							proc.waitForExit(AUTH_RESOLUTION_TIMEOUT_MS),
							new Promise<{ exitCode?: number }>((resolve) => {
								abort.signal.addEventListener(
									"abort",
									() => resolve({ exitCode: 124 }),
									{ once: true },
								);
							}),
						]);
						clearTimeout(timer);
						if (abort.signal.aborted || exit.exitCode === 124) {
							await proc.kill("SIGTERM");
							try {
								await proc.waitForExit(AUTH_PROCESS_KILL_GRACE_MS);
							} catch {
								try {
									await proc.kill("SIGKILL");
									await proc.waitForExit(AUTH_PROCESS_KILL_GRACE_MS);
								} catch {
									// ignore
								}
							}
							processAlive = false;
							await markFailed();
							return { ok: false, code: "refresh_failed" };
						}
						processAlive = false;
						if ((exit.exitCode ?? 1) !== 0) {
							await markFailed();
							return { ok: false, code: "refresh_failed" };
						}
					} finally {
						clearTimeout(timer);
						processAlive = false;
					}
				} else {
					const result = await shell.exec(cmd, {
						timeout: AUTH_RESOLUTION_TIMEOUT_MS,
					});
					processAlive = false;
					if (!result.success) {
						await markFailed();
						return { ok: false, code: "refresh_failed" };
					}
				}

				try {
					await verifyMode600(shell, resultPath);
					const file = await shell.readFile(resultPath);
					resultJson = file.content;
					await shell.deleteFile(resultPath);
				} catch {
					await markFailed();
					return { ok: false, code: "refresh_failed" };
				}
			} finally {
				if (processAlive) {
					try {
						await shell.exec(`pkill -f ${quoteShellArg(AUTH_CLI)} || true`, {
							timeout: AUTH_PROCESS_KILL_GRACE_MS,
						});
					} catch {
						// ignore
					}
					await sleep(Math.min(AUTH_PROCESS_KILL_GRACE_MS, 50));
					processAlive = false;
				}
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

		if (!resultJson) {
			await markFailed();
			return { ok: false, code: "refresh_failed" };
		}

		let payload: z.infer<typeof resolveResultSchema>;
		try {
			payload = resolveResultSchema.parse(JSON.parse(resultJson));
		} catch {
			await markFailed();
			return { ok: false, code: "refresh_failed" };
		}

		let stored: StoredCredential;
		let runtime: StoredCredential;
		try {
			stored = parseStoredCredential(payload.storedCredential);
			runtime = payload.runtimeCredential
				? parseStoredCredential(payload.runtimeCredential)
				: projectRuntimeCredential(stored, options.providerId, {
						nowMs: nowMs(),
					});
			// Ensure runtime has no real refresh token.
			if (runtime.type === "oauth" && runtime.refresh !== "ditto:no-refresh") {
				runtime = projectRuntimeCredential(stored, options.providerId, {
					nowMs: nowMs(),
				});
			}
		} catch {
			await markFailed();
			return { ok: false, code: "refresh_failed" };
		}

		const write = await updateCredentialUnderLease({
			db: options.db,
			userId: options.userId,
			providerId: options.providerId,
			leaseId: lease.leaseId,
			expectedVersion: options.version,
			credential: stored,
			encryptionKey: options.env.AI_CREDENTIALS_ENCRYPTION_KEY,
			nowMs: nowMs(),
		});
		if (write === "missing") return { ok: false, code: "missing" };
		if (write === "stale") return { ok: false, code: "busy" };
		return { ok: true, runtime };
	} catch {
		await markFailed();
		return { ok: false, code: "refresh_failed" };
	} finally {
		// Lease release only after process is known dead.
		await releaseLease({
			db: options.db,
			userId: options.userId,
			providerId: options.providerId,
			leaseId: lease.leaseId,
			nowMs: nowMs(),
		});
		try {
			await destroy({ env: options.env, sandboxId });
		} catch {
			// ignore
		}
	}
}
