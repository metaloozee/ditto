import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
	type AuthEvent,
	type AuthInteraction,
	type AuthPrompt,
	type AuthType,
	type Credential,
	InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	type AuthControlRequest,
	type ProviderAuthOut,
} from "./provider-auth-protocol.js";
import { startAuthControlServer } from "./provider-auth-control.js";
import {
	isAllowedAuthType,
	MAX_SAFE_MODELS,
	OAUTH_REFRESH_SENTINEL,
	PORTABLE_PROVIDER_AUTH,
	RESULT_DIR,
	RESULT_HANDSHAKE_POLL_MS,
	RESULT_HANDSHAKE_TIMEOUT_MS,
} from "./provider-matrix.js";

export type SafeModelProjection = {
	providerId: string;
	modelId: string;
	name: string;
	input?: string[];
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
};

export type ProviderAuthJob =
	| {
			mode: "login";
			attemptId: string;
			providerId: string;
			authType: AuthType;
			resultPath: string;
	  }
	| {
			mode: "resolve";
			attemptId: string;
			providerId: string;
			resultPath: string;
	  };

export type ProviderAuthOptions = {
	job: ProviderAuthJob;
	onEvent: (msg: ProviderAuthOut) => void;
	/** Injected for tests. */
	createRuntime?: (credentials: InMemoryCredentialStore) => Promise<ModelRuntime>;
	/** Injected for tests. */
	loginImpl?: (
		runtime: ModelRuntime,
		providerId: string,
		authType: AuthType,
		interaction: AuthInteraction,
	) => Promise<Credential>;
	/** Injected for tests. */
	resolveAuthImpl?: (
		runtime: ModelRuntime,
		providerId: string,
	) => Promise<void>;
	/** Skip handshake wait in unit tests when result already consumed. */
	handshakeTimeoutMs?: number;
};

const STABLE_ERRORS = {
	unsupported_provider: "This provider is not available.",
	unsupported_auth: "This sign-in method is not available.",
	cancelled: "Provider connection was cancelled.",
	auth_failed: "Provider connection failed. Try again.",
	refresh_failed: "Provider session expired. Reconnect the provider.",
	result_timeout: "Provider connection timed out while saving credentials.",
	invalid_result_path: "Invalid auth result path.",
	missing_stored_credential: "Stored credential was not provided.",
	invalid_credential: "Stored credential is invalid.",
} as const;

export type StableErrorCode = keyof typeof STABLE_ERRORS;

function emitError(
	onEvent: (msg: ProviderAuthOut) => void,
	code: StableErrorCode,
) {
	onEvent({
		v: 1,
		kind: "error",
		code,
		message: STABLE_ERRORS[code],
	});
}

export function normalizeResultPath(resultPath: string): string {
	const resolved = path.resolve(resultPath);
	const root = path.resolve(RESULT_DIR);
	if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
		throw new Error("invalid_result_path");
	}
	return resolved;
}

export function projectSafeModels(
	runtime: ModelRuntime,
	providerId: string,
): SafeModelProjection[] {
	const models = runtime.getModels(providerId);
	if (models.length > MAX_SAFE_MODELS) {
		throw new Error("catalog_too_large");
	}
	const seen = new Set<string>();
	const out: SafeModelProjection[] = [];
	for (const model of models) {
		if (model.provider !== providerId) {
			throw new Error("provider_mismatch");
		}
		const key = `${model.provider}/${model.id}`;
		if (seen.has(key)) throw new Error("duplicate_model");
		seen.add(key);
		const projected: SafeModelProjection = {
			providerId: model.provider,
			modelId: model.id,
			name: model.name,
		};
		if (Array.isArray(model.input)) {
			projected.input = model.input.map(String);
		}
		if (typeof model.reasoning === "boolean") {
			projected.reasoning = model.reasoning;
		}
		if (typeof model.contextWindow === "number") {
			projected.contextWindow = model.contextWindow;
		}
		if (typeof model.maxTokens === "number") {
			projected.maxTokens = model.maxTokens;
		}
		if (model.cost && typeof model.cost === "object") {
			projected.cost = {
				input: model.cost.input,
				output: model.cost.output,
				cacheRead: model.cost.cacheRead,
				cacheWrite: model.cost.cacheWrite,
			};
		}
		// Reject if raw model sneaks transport fields into our projection object
		// by only copying the allowlisted keys above.
		out.push(projected);
	}
	return out;
}

export function toRuntimeCredential(
	credential: Credential,
	providerId: string,
): Credential {
	if (credential.type === "api_key") {
		const out: Credential = { type: "api_key" };
		if (typeof credential.key === "string") out.key = credential.key;
		if (credential.env && typeof credential.env === "object") {
			out.env = { ...credential.env };
		}
		return out;
	}
	if (credential.type !== "oauth") {
		throw new Error("unsupported_credential");
	}
	const base: Credential = {
		type: "oauth",
		refresh: OAUTH_REFRESH_SENTINEL,
		access: String(credential.access),
		expires: Number(credential.expires),
	};
	if (providerId === "openai-codex") {
		if (typeof credential.accountId === "string") {
			base.accountId = credential.accountId;
		}
		return base;
	}
	if (providerId === "github-copilot") {
		if (typeof credential.enterpriseUrl === "string") {
			base.enterpriseUrl = credential.enterpriseUrl;
		}
		if (Array.isArray(credential.availableModelIds)) {
			base.availableModelIds = credential.availableModelIds;
		}
		return base;
	}
	if (providerId === "anthropic" || providerId === "xai") {
		return base;
	}
	// Strip unknown OAuth fields for other providers.
	return base;
}

function writeSecretFile(filePath: string, content: string): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	const fd = fs.openSync(filePath, "w", 0o600);
	try {
		fs.writeFileSync(fd, content, { encoding: "utf8" });
		fs.fchmodSync(fd, 0o600);
	} finally {
		fs.closeSync(fd);
	}
}

async function waitForResultConsumed(
	resultPath: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await fsp.access(resultPath);
		} catch {
			return true;
		}
		await new Promise((r) => setTimeout(r, RESULT_HANDSHAKE_POLL_MS));
	}
	return false;
}

function mapAuthEvent(event: AuthEvent): ProviderAuthOut | null {
	if (event.type === "info") {
		return { v: 1, kind: "info", message: event.message.slice(0, 500) };
	}
	if (event.type === "progress") {
		return { v: 1, kind: "progress", message: event.message.slice(0, 500) };
	}
	if (event.type === "auth_url") {
		return {
			v: 1,
			kind: "auth_url",
			url: event.url,
			instructions: event.instructions?.slice(0, 500),
		};
	}
	if (event.type === "device_code") {
		return {
			v: 1,
			kind: "device_code",
			userCode: event.userCode,
			verificationUri: event.verificationUri,
			intervalSeconds: event.intervalSeconds,
			expiresInSeconds: event.expiresInSeconds,
		};
	}
	return null;
}

export async function runProviderAuth(
	options: ProviderAuthOptions,
): Promise<{ ok: boolean }> {
	const { job, onEvent } = options;
	let ok = false;
	let doneEmitted = false;
	let controlServer: Awaited<ReturnType<typeof startAuthControlServer>> | undefined;
	let resultPath: string | undefined;
	let cancelled = false;
	const abort = new AbortController();

	const finish = (success: boolean) => {
		ok = success;
		if (!doneEmitted) {
			doneEmitted = true;
			onEvent({ v: 1, kind: "done", ok: success });
		}
	};

	type PendingPrompt = {
		promptId: string;
		resolve: (value: string) => void;
		reject: (error: Error) => void;
	};
	let pending: PendingPrompt | null = null;
	let promptCounter = 0;

	const cancelPending = (reason: string) => {
		if (!pending) return;
		const current = pending;
		pending = null;
		current.reject(new Error(reason));
	};

	try {
		if (!(job.providerId in PORTABLE_PROVIDER_AUTH)) {
			emitError(onEvent, "unsupported_provider");
			finish(false);
			return { ok: false };
		}
		if (job.mode === "login" && !isAllowedAuthType(job.providerId, job.authType)) {
			emitError(onEvent, "unsupported_auth");
			finish(false);
			return { ok: false };
		}

		try {
			resultPath = normalizeResultPath(job.resultPath);
		} catch {
			emitError(onEvent, "invalid_result_path");
			finish(false);
			return { ok: false };
		}

		const credentials = new InMemoryCredentialStore();
		const createRuntime =
			options.createRuntime ??
			((store) =>
				ModelRuntime.create({
					credentials: store,
					modelsPath: null,
					allowModelNetwork: false,
				}));
		const runtime = await createRuntime(credentials);

		controlServer = await startAuthControlServer({
			attemptId: job.attemptId,
			handle: async (request: AuthControlRequest) => {
				if (request.action === "cancel") {
					cancelled = true;
					abort.abort();
					cancelPending("cancelled");
					return { accepted: true, action: "cancel" };
				}
				if (!pending || pending.promptId !== request.promptId) {
					return { accepted: false, message: "No matching prompt is active" };
				}
				const current = pending;
				pending = null;
				current.resolve(request.value);
				return { accepted: true, action: "answer" };
			},
		});

		const interaction: AuthInteraction = {
			signal: abort.signal,
			notify(event) {
				const mapped = mapAuthEvent(event);
				if (mapped) onEvent(mapped);
			},
			async prompt(prompt: AuthPrompt): Promise<string> {
				// Auto-select Codex device-code login method.
				if (
					job.mode === "login" &&
					job.providerId === "openai-codex" &&
					prompt.type === "select" &&
					prompt.options.some((o) => o.id === "device_code")
				) {
					return "device_code";
				}
				const promptId = `p${++promptCounter}`;
				const event: ProviderAuthOut = {
					v: 1,
					kind: "prompt",
					promptId,
					type: prompt.type,
					message: prompt.message.slice(0, 500),
				};
				if (
					(prompt.type === "text" ||
						prompt.type === "secret" ||
						prompt.type === "manual_code") &&
					prompt.placeholder
				) {
					event.placeholder = prompt.placeholder.slice(0, 200);
				}
				if (prompt.type === "select") {
					event.options = prompt.options.map((o) => ({
						id: o.id,
						label: o.label,
						description: o.description?.slice(0, 200),
					}));
				}
				onEvent(event);
				return await new Promise<string>((resolve, reject) => {
					let settled = false;
					const settleResolve = (value: string) => {
						if (settled) return;
						settled = true;
						resolve(value);
					};
					const settleReject = (error: Error) => {
						if (settled) return;
						settled = true;
						reject(error);
					};
					pending = {
						promptId,
						resolve: settleResolve,
						reject: settleReject,
					};
					const onAbort = () => {
						cancelPending("cancelled");
					};
					abort.signal.addEventListener("abort", onAbort, { once: true });
					if (prompt.signal) {
						prompt.signal.addEventListener(
							"abort",
							() => cancelPending("prompt_aborted"),
							{ once: true },
						);
					}
				});
			},
		};

		if (job.mode === "login") {
			const login =
				options.loginImpl ??
				((rt, providerId, authType, ix) => rt.login(providerId, authType, ix));
			const credential = await login(
				runtime,
				job.providerId,
				job.authType,
				interaction,
			);
			if (cancelled) {
				emitError(onEvent, "cancelled");
				finish(false);
				return { ok: false };
			}
			const models = projectSafeModels(runtime, job.providerId);
			writeSecretFile(
				resultPath,
				JSON.stringify({ credential, models }),
			);
			onEvent({ v: 1, kind: "credential_ready" });
			const consumed = await waitForResultConsumed(
				resultPath,
				options.handshakeTimeoutMs ?? RESULT_HANDSHAKE_TIMEOUT_MS,
			);
			if (!consumed) {
				emitError(onEvent, "result_timeout");
				finish(false);
				return { ok: false };
			}
			finish(true);
			return { ok: true };
		}

		// resolve mode
		const raw = process.env.DITTO_PI_STORED_CREDENTIAL;
		delete process.env.DITTO_PI_STORED_CREDENTIAL;
		if (!raw) {
			emitError(onEvent, "missing_stored_credential");
			finish(false);
			return { ok: false };
		}
		let stored: Credential;
		try {
			stored = JSON.parse(raw) as Credential;
			if (!stored || typeof stored !== "object" || !stored.type) {
				throw new Error("bad");
			}
		} catch {
			emitError(onEvent, "invalid_credential");
			finish(false);
			return { ok: false };
		}

		await credentials.modify(job.providerId, async () => stored);
		const resolveAuth =
			options.resolveAuthImpl ??
			(async (rt, providerId) => {
				// Force auth resolution / refresh under PI's store lock.
				await rt.getAuth(providerId);
			});
		try {
			await resolveAuth(runtime, job.providerId);
		} catch {
			emitError(onEvent, "refresh_failed");
			finish(false);
			return { ok: false };
		}

		const updated = (await credentials.read(job.providerId)) ?? stored;
		const runtimeCredential = toRuntimeCredential(updated, job.providerId);
		const models = projectSafeModels(runtime, job.providerId);
		writeSecretFile(
			resultPath,
			JSON.stringify({
				storedCredential: updated,
				runtimeCredential,
				models,
			}),
		);
		onEvent({ v: 1, kind: "credential_ready" });
		const consumed = await waitForResultConsumed(
			resultPath,
			options.handshakeTimeoutMs ?? RESULT_HANDSHAKE_TIMEOUT_MS,
		);
		if (!consumed) {
			emitError(onEvent, "result_timeout");
			finish(false);
			return { ok: false };
		}
		finish(true);
		return { ok: true };
	} catch (error) {
		if (cancelled || abort.signal.aborted) {
			emitError(onEvent, "cancelled");
		} else {
			// Never serialize PI exception details — may contain fresh secrets.
			void error;
			emitError(onEvent, "auth_failed");
		}
		finish(false);
		return { ok: false };
	} finally {
		cancelPending("finished");
		try {
			await controlServer?.close();
		} catch {
			// ignore
		}
		if (resultPath) {
			try {
				await fsp.unlink(resultPath);
			} catch {
				// Worker may have already deleted it.
			}
		}
		if (!doneEmitted) finish(ok);
	}
}
