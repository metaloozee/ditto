import { nanoid } from "nanoid";
import { z } from "zod";
import type { createDb } from "#/db";
import {
	AUTH_PROCESS_KILL_GRACE_MS,
	AUTH_RESOLUTION_TIMEOUT_MS,
	type AuthAttemptRow,
	acquireLeaseWithWait,
	assertCredentialConfig,
	type CredentialRepository,
	createCredentialRepository,
	FALLBACK_MODEL_SPECIFIER,
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

export const providerAuthStreamBodySchema = z
	.object({
		providerId: z.string().min(1).max(64),
		authType: z.enum(["api_key", "oauth"]),
	})
	.strict();

export const providerAuthControlBodySchema = z.discriminatedUnion("action", [
	z
		.object({
			action: z.literal("answer"),
			attemptId: z.string().min(1).max(128),
			promptId: z.string().min(1).max(128),
			value: z.string().max(MAX_ANSWER),
		})
		.strict(),
	z
		.object({
			action: z.literal("cancel"),
			attemptId: z.string().min(1).max(128),
		})
		.strict(),
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

/** Subset of @cloudflare/sandbox 0.12.x ExecutionSession used by auth. */
export type AuthProcess = {
	id: string;
	kill: (signal?: string) => Promise<void>;
	waitForExit: (timeout?: number) => Promise<{ exitCode?: number }>;
	getLogs?: () => Promise<{ stdout: string; stderr: string }>;
};

export type AuthShell = {
	id: string;
	mkdir: (path: string, options?: { recursive?: boolean }) => Promise<unknown>;
	writeFile: (path: string, content: string) => Promise<unknown>;
	readFile: (path: string) => Promise<{ content: string }>;
	deleteFile: (path: string) => Promise<unknown>;
	exec: (
		command: string,
		options?: { timeout?: number },
	) => Promise<{ success: boolean; stdout: string; stderr?: string }>;
	startProcess: (
		command: string,
		options?: Record<string, unknown>,
	) => Promise<AuthProcess>;
	streamProcessLogs: (
		processId: string,
		options?: { signal?: AbortSignal },
	) => Promise<ReadableStream<Uint8Array>>;
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

function asRepo(db: CredentialRepository | Db): CredentialRepository {
	if (
		typeof db === "object" &&
		db !== null &&
		"getRow" in db &&
		typeof (db as CredentialRepository).getRow === "function"
	) {
		return db as CredentialRepository;
	}
	return createCredentialRepository(db as Db);
}

const fallbackModel: SafeModel = {
	providerId: "opencode",
	modelId: "deepseek-v4-flash-free",
	name: "DeepSeek V4 Flash Free",
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const catalogProviderSchema = z
	.object({
		providerId: z.string().min(1).max(64),
		name: z.string().min(1).max(MAX_PROVIDER_NAME),
		authMethods: z
			.array(
				z
					.object({
						type: z.enum(["api_key", "oauth"]),
						label: z.string().min(1).max(MAX_AUTH_LABEL),
					})
					.strict(),
			)
			.max(8),
		models: z.array(z.unknown()).max(500).optional(),
	})
	.strict();

const loginResultSchema = z
	.object({
		credential: z.unknown(),
		models: z.array(z.unknown()).max(500),
	})
	.strict();

const resolveResultSchema = z
	.object({
		storedCredential: z.unknown(),
		runtimeCredential: z.unknown().optional(),
		models: z.array(z.unknown()).max(500).optional(),
	})
	.strict();

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

/**
 * TERM the exact process, await exit, escalate to KILL after grace, await exit.
 * Returns only after confirmed exit (or both waits exhausted).
 */
export async function terminateAuthProcess(
	proc: AuthProcess,
	options?: {
		graceMs?: number;
		onStep?: (step: "term" | "await_term" | "kill" | "await_kill") => void;
	},
): Promise<void> {
	const grace = options?.graceMs ?? AUTH_PROCESS_KILL_GRACE_MS;
	const step = options?.onStep;
	step?.("term");
	try {
		await proc.kill("SIGTERM");
	} catch {
		// may already be dead
	}
	step?.("await_term");
	try {
		await proc.waitForExit(grace);
		return;
	} catch {
		// still alive
	}
	step?.("kill");
	try {
		await proc.kill("SIGKILL");
	} catch {
		// ignore
	}
	step?.("await_kill");
	try {
		await proc.waitForExit(grace);
	} catch {
		// best-effort
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
				.strict()
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
	db: CredentialRepository | Db;
	userId: string;
	listConnections: (
		db: CredentialRepository,
		userId: string,
	) => Promise<
		Array<{
			providerId: string;
			status: string;
			models: SafeModel[];
		}>
	>;
}): Promise<SafeModel[]> {
	const repo = asRepo(options.db);
	const connections = await options.listConnections(repo, options.userId);
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
	db: CredentialRepository | Db;
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
	const repo = asRepo(options.db);
	const attempt = await repo.getAttempt(
		options.input.attemptId,
		options.userId,
	);
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
				.strict()
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

export async function streamProviderAuth(options: {
	db: CredentialRepository | Db;
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
	const repo = asRepo(options.db);
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

	const attemptRow: AuthAttemptRow = {
		id: attemptId,
		userId: options.userId,
		providerId: options.input.providerId,
		authType: options.input.authType,
		authSandboxId: sandboxId,
		status: "pending",
		expiresAt: new Date(now + ATTEMPT_TTL_MS),
		createdAt: new Date(now),
		updatedAt: new Date(now),
	};
	await repo.insertAttempt(attemptRow);

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
				db: repo,
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
			let processHandle: AuthProcess | null = null;
			let exited = false;
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
				// Exactly one process start; consume its NDJSON via streamProcessLogs.
				processHandle = await shell.startProcess(cmd, { cwd: "/tmp" });
				const { parseSSEStream } = await import("@cloudflare/sandbox");
				type LogEvent = import("@cloudflare/sandbox").LogEvent;
				const stream = await shell.streamProcessLogs(processHandle.id, {
					signal: options.signal,
				});
				let stdoutBuffer = "";
				for await (const logEvent of parseSSEStream<LogEvent>(stream)) {
					if (cancelled || options.signal?.aborted) {
						break;
					}
					if (logEvent.type === "exit") {
						exited = true;
						break;
					}
					if (logEvent.type === "stdout" && typeof logEvent.data === "string") {
						const split = splitStdoutBuffer(stdoutBuffer, logEvent.data);
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
			} finally {
				if (processHandle && !exited) {
					await terminateAuthProcess(processHandle);
					exited = true;
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
		await repo.updateAttempt(attemptId, {
			status: terminalStatus,
			updatedAt: new Date(deps.nowMs()),
		});
	} catch {
		await options.emit({
			event: "error",
			data: {
				code: "auth_failed",
				message: "Provider connection failed. Try again.",
			},
		});
		await emitDone(false);
		await repo.updateAttempt(attemptId, {
			status: "failed",
			updatedAt: new Date(deps.nowMs()),
		});
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
 * Ordering: timeout -> terminate exact process -> await exit -> then release lease.
 * Runtime credential is always projected from the validated stored credential.
 */
export async function resolveOAuthCredential(options: {
	db: CredentialRepository | Db;
	env: Env;
	userId: string;
	providerId: string;
	stored: StoredCredential;
	version: number;
	nowMs?: () => number;
	createId?: () => string;
	deps?: AuthDeps;
	/**
	 * Test hook replacing sandbox process. Must honour signal abort and only
	 * resolve after the process is considered dead.
	 */
	runResolve?: (args: {
		job: Record<string, unknown>;
		stored: StoredCredential;
		timeoutMs: number;
		signal: AbortSignal;
		/** Kill helper that tests can drive to prove TERM/KILL/await order. */
		terminate: (proc: AuthProcess) => Promise<void>;
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
	const getSandbox =
		options.deps?.getProjectSandbox ??
		(getProjectSandbox as AuthDeps["getProjectSandbox"]);
	const destroy = options.deps?.destroySandbox ?? destroySandbox;
	const repo = asRepo(options.db);

	const lease = await acquireLeaseWithWait({
		db: repo,
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

	/** Only true after waitForExit confirms death (or terminate finishes). */
	let processExited = true;
	let processHandle: AuthProcess | null = null;

	const markFailed = async () => {
		await markNeedsRelogin({
			db: repo,
			userId: options.userId,
			providerId: options.providerId,
			errorCode: "oauth_refresh_failed",
			leaseId: lease.leaseId,
			expectedVersion: options.version,
			nowMs: nowMs(),
		});
	};

	const ensureProcessDead = async () => {
		if (processExited) return;
		if (processHandle) {
			await terminateAuthProcess(processHandle);
			processHandle = null;
		}
		processExited = true;
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
			// Fake process for the test hook so terminate ordering is real.
			let alive = true;
			const fakeProc: AuthProcess = {
				id: `resolve-${attemptId}`,
				kill: async () => {
					alive = false;
				},
				waitForExit: async () => {
					if (alive) throw new Error("still_running");
					return { exitCode: 1 };
				},
			};
			processHandle = fakeProc;
			processExited = false;

			const timer = setTimeout(() => abort.abort(), AUTH_RESOLUTION_TIMEOUT_MS);
			try {
				const outcome = await options.runResolve({
					job,
					stored: options.stored,
					timeoutMs: AUTH_RESOLUTION_TIMEOUT_MS,
					signal: abort.signal,
					terminate: async (proc) => {
						await terminateAuthProcess(proc);
						if (proc === processHandle) {
							processHandle = null;
							processExited = true;
						}
					},
				});
				if (!outcome.ok) {
					if (!processExited) {
						await ensureProcessDead();
					}
					await markFailed();
					return { ok: false, code: "refresh_failed" };
				}
				// Success path: process must already be dead.
				if (!processExited) {
					processExited = true;
					processHandle = null;
				}
				resultJson = outcome.resultJson;
			} finally {
				clearTimeout(timer);
				if (!processExited) await ensureProcessDead();
			}
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

				processHandle = await shell.startProcess(cmd, { cwd: "/tmp" });
				processExited = false;

				const timer = setTimeout(
					() => abort.abort(),
					AUTH_RESOLUTION_TIMEOUT_MS,
				);
				try {
					const exit = await Promise.race([
						processHandle.waitForExit(AUTH_RESOLUTION_TIMEOUT_MS).then((r) => {
							processExited = true;
							return r;
						}),
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
						await ensureProcessDead();
						await markFailed();
						return { ok: false, code: "refresh_failed" };
					}
					processExited = true;
					processHandle = null;
					if ((exit.exitCode ?? 1) !== 0) {
						await markFailed();
						return { ok: false, code: "refresh_failed" };
					}
				} catch {
					await ensureProcessDead();
					await markFailed();
					return { ok: false, code: "refresh_failed" };
				} finally {
					clearTimeout(timer);
					if (!processExited) await ensureProcessDead();
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
				if (!processExited) await ensureProcessDead();
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
			// Always project runtime from validated stored credential (ignore runner
			// runtime payload for security: expiry window + allowlist enforced here).
			runtime = projectRuntimeCredential(stored, options.providerId, {
				nowMs: nowMs(),
			});
		} catch {
			await markFailed();
			return { ok: false, code: "refresh_failed" };
		}

		const write = await updateCredentialUnderLease({
			db: repo,
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
		await ensureProcessDead();
		await markFailed();
		return { ok: false, code: "refresh_failed" };
	} finally {
		// Lease release only after process is known dead.
		await ensureProcessDead();
		await releaseLease({
			db: repo,
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
