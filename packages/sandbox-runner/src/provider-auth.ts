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
import type { AuthControlRequest, ProviderAuthOut } from "./protocol.js";
import { assertPublicAuthEvent } from "./protocol.js";
import { startAuthControlServer } from "./provider-auth-control.js";

/** Portable provider -> allowed auth types. Account-level D1 only. */
export const PORTABLE_PROVIDER_AUTH = {
	anthropic: ["api_key", "oauth"],
	openai: ["api_key"],
	"openai-codex": ["oauth"],
	xai: ["api_key", "oauth"],
	"github-copilot": ["oauth"],
	opencode: ["api_key"],
	"opencode-go": ["api_key"],
	deepseek: ["api_key"],
	google: ["api_key"],
	mistral: ["api_key"],
	groq: ["api_key"],
	cerebras: ["api_key"],
	openrouter: ["api_key"],
	"vercel-ai-gateway": ["api_key"],
	fireworks: ["api_key"],
	together: ["api_key"],
} as const;

export type PortableProviderId = keyof typeof PORTABLE_PROVIDER_AUTH;
export type PortableAuthType =
	(typeof PORTABLE_PROVIDER_AUTH)[PortableProviderId][number];

export function isPortableProviderId(
	value: string,
): value is PortableProviderId {
	return Object.hasOwn(PORTABLE_PROVIDER_AUTH, value);
}

export function isAllowedAuthType(
	providerId: string,
	authType: string,
): authType is PortableAuthType {
	if (!isPortableProviderId(providerId)) return false;
	return (PORTABLE_PROVIDER_AUTH[providerId] as readonly string[]).includes(
		authType,
	);
}

export const OAUTH_REFRESH_SENTINEL = "ditto:no-refresh";
export const RESULT_DIR = "/tmp/ditto-provider-auth-results";
export const AUTH_CONTROL_DIR = "/tmp/ditto-provider-auth-controls";
export const MAX_SAFE_MODELS = 500;
export const MAX_PROMPT_ANSWER_BYTES = 8_192;
export const RESULT_HANDSHAKE_TIMEOUT_MS = 30_000;
export const RESULT_HANDSHAKE_POLL_MS = 50;

/** Canonical env var name for API-key runtime projection (allowlisted). */
export const PROVIDER_API_KEY_ENV: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	xai: "XAI_API_KEY",
	opencode: "OPENCODE_API_KEY",
	"opencode-go": "OPENCODE_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	google: "GOOGLE_API_KEY",
	mistral: "MISTRAL_API_KEY",
	groq: "GROQ_API_KEY",
	cerebras: "CEREBRAS_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
	fireworks: "FIREWORKS_API_KEY",
	together: "TOGETHER_API_KEY",
};

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
	createRuntime?: (
		credentials: InMemoryCredentialStore,
	) => Promise<ModelRuntime>;
	loginImpl?: (
		runtime: ModelRuntime,
		providerId: string,
		authType: AuthType,
		interaction: AuthInteraction,
	) => Promise<Credential>;
	resolveAuthImpl?: (
		runtime: ModelRuntime,
		providerId: string,
	) => Promise<void>;
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

function emitPublic(
	onEvent: (msg: ProviderAuthOut) => void,
	msg: ProviderAuthOut,
	answerSecrets: string[],
) {
	// Never let prompt answers reappear in public events.
	const json = JSON.stringify(msg);
	for (const secret of answerSecrets) {
		if (secret.length > 0 && json.includes(secret)) {
			throw new Error("secret_in_event");
		}
	}
	onEvent(assertPublicAuthEvent(msg));
}

export function normalizeResultPath(resultPath: string): string {
	const resolved = path.resolve(resultPath);
	const root = path.resolve(RESULT_DIR);
	if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
		throw new Error("invalid_result_path");
	}
	return resolved;
}

const MAX_ID_LEN = 256;
const MAX_NAME_LEN = 512;
const MAX_INPUT_VALUES = 16;
const MAX_INPUT_VALUE_LEN = 64;

function requireBoundedString(
	value: unknown,
	max: number,
	label: string,
): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max) {
		throw new Error(`invalid_${label}`);
	}
	return value;
}

function requirePositiveInt(value: unknown, label: string): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		!Number.isInteger(value) ||
		value <= 0
	) {
		throw new Error(`invalid_${label}`);
	}
	return value;
}

function requireNonnegFinite(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`invalid_${label}`);
	}
	return value;
}

export function projectSafeModels(
	runtime: ModelRuntime,
	providerId: string,
): SafeModelProjection[] {
	requireBoundedString(providerId, MAX_ID_LEN, "provider");
	const models = runtime.getModels(providerId);
	if (models.length > MAX_SAFE_MODELS) {
		throw new Error("catalog_too_large");
	}
	const seen = new Set<string>();
	const out: SafeModelProjection[] = [];
	for (const model of models) {
		const modelProvider = requireBoundedString(
			model.provider,
			MAX_ID_LEN,
			"provider",
		);
		if (modelProvider !== providerId) {
			throw new Error("provider_mismatch");
		}
		const modelId = requireBoundedString(model.id, MAX_ID_LEN, "model_id");
		const name = requireBoundedString(model.name, MAX_NAME_LEN, "name");
		const key = `${modelProvider}/${modelId}`;
		if (seen.has(key)) throw new Error("duplicate_model");
		seen.add(key);
		const projected: SafeModelProjection = {
			providerId: modelProvider,
			modelId,
			name,
		};
		if (model.input !== undefined) {
			if (
				!Array.isArray(model.input) ||
				model.input.length > MAX_INPUT_VALUES
			) {
				throw new Error("invalid_input");
			}
			projected.input = model.input.map((v) =>
				requireBoundedString(String(v), MAX_INPUT_VALUE_LEN, "input_value"),
			);
		}
		if (model.reasoning !== undefined) {
			if (typeof model.reasoning !== "boolean")
				throw new Error("invalid_reasoning");
			projected.reasoning = model.reasoning;
		}
		if (model.contextWindow !== undefined) {
			projected.contextWindow = requirePositiveInt(
				model.contextWindow,
				"context_window",
			);
		}
		if (model.maxTokens !== undefined) {
			projected.maxTokens = requirePositiveInt(model.maxTokens, "max_tokens");
		}
		if (model.cost !== undefined) {
			if (!model.cost || typeof model.cost !== "object")
				throw new Error("invalid_cost");
			const cost: NonNullable<SafeModelProjection["cost"]> = {};
			const c = model.cost as unknown as Record<string, unknown>;
			if (c.input !== undefined)
				cost.input = requireNonnegFinite(c.input, "cost_input");
			if (c.output !== undefined)
				cost.output = requireNonnegFinite(c.output, "cost_output");
			if (c.cacheRead !== undefined)
				cost.cacheRead = requireNonnegFinite(c.cacheRead, "cost_cache_read");
			if (c.cacheWrite !== undefined)
				cost.cacheWrite = requireNonnegFinite(c.cacheWrite, "cost_cache_write");
			projected.cost = cost;
		}
		out.push(projected);
	}
	return out;
}

function projectApiKeyEnv(
	credential: Credential,
	providerId: string,
): Record<string, string> | undefined {
	const canonical = PROVIDER_API_KEY_ENV[providerId];
	if (!canonical || !credential.env || typeof credential.env !== "object") {
		return undefined;
	}
	const raw = (credential.env as Record<string, unknown>)[canonical];
	if (typeof raw !== "string" || raw.length === 0 || raw.length > 16_384) {
		return undefined;
	}
	return { [canonical]: raw };
}

/** Max agent run window + safety skew (must match Worker). */
export const AGENT_COMMAND_TIMEOUT_MS = 600_000;
export const ACCESS_EXPIRY_SAFETY_MS = 60_000;

export function toRuntimeCredential(
	credential: Credential,
	providerId: string,
	options?: { nowMs?: number; maxAgentWindowMs?: number },
): Credential {
	if (credential.type === "api_key") {
		const out: Credential = { type: "api_key" };
		if (typeof credential.key === "string" && credential.key.length > 0) {
			out.key = credential.key;
		}
		const env = projectApiKeyEnv(credential, providerId);
		if (env) out.env = env;
		return out;
	}
	if (credential.type !== "oauth") {
		throw new Error("unsupported_credential");
	}
	const expires = Number(credential.expires);
	if (!Number.isFinite(expires)) {
		throw new Error("unsupported_credential");
	}
	const now = options?.nowMs ?? Date.now();
	const windowMs =
		(options?.maxAgentWindowMs ?? AGENT_COMMAND_TIMEOUT_MS) +
		ACCESS_EXPIRY_SAFETY_MS;
	if (expires <= now + windowMs) {
		throw new Error("token_expires_too_soon");
	}
	const access = String(credential.access ?? "");
	if (!access) throw new Error("unsupported_credential");

	const base: Credential = {
		type: "oauth",
		refresh: OAUTH_REFRESH_SENTINEL,
		access,
		expires,
	};
	if (providerId === "openai-codex") {
		if (typeof credential.accountId === "string" && credential.accountId) {
			base.accountId = credential.accountId.slice(0, 256);
		}
		return base;
	}
	if (providerId === "github-copilot") {
		if (
			typeof credential.enterpriseUrl === "string" &&
			credential.enterpriseUrl
		) {
			// Bound + require https-looking URL string only.
			const url = credential.enterpriseUrl.slice(0, 512);
			if (/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(url)) {
				base.enterpriseUrl = url;
			}
		}
		if (Array.isArray(credential.availableModelIds)) {
			base.availableModelIds = credential.availableModelIds
				.filter((id): id is string => typeof id === "string" && id.length > 0)
				.slice(0, 500)
				.map((id) => id.slice(0, 256));
		}
		return base;
	}
	if (providerId === "anthropic" || providerId === "xai") {
		return base;
	}
	throw new Error("unsupported_credential");
}

function writeSecretFile(filePath: string, content: string): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	// Pre-create 0600, then write.
	const fd = fs.openSync(filePath, "w", 0o600);
	try {
		fs.fchmodSync(fd, 0o600);
		fs.writeFileSync(fd, content, { encoding: "utf8" });
		fs.fchmodSync(fd, 0o600);
	} finally {
		fs.closeSync(fd);
	}
	const mode = fs.statSync(filePath).mode & 0o777;
	if (mode !== 0o600) {
		try {
			fs.unlinkSync(filePath);
		} catch {
			// ignore
		}
		throw new Error("result_mode");
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

function normalizeEnterpriseHost(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed || trimmed.length > 253) return null;
	try {
		if (trimmed.includes("://")) {
			const host = new URL(trimmed).hostname.toLowerCase();
			return /^[a-z0-9.-]+$/.test(host) ? host : null;
		}
	} catch {
		return null;
	}
	const host = trimmed.toLowerCase().split("/")[0]?.split(":")[0] ?? "";
	return /^[a-z0-9.-]+$/.test(host) ? host : null;
}

function isCopilotEnterprisePrompt(prompt: AuthPrompt): boolean {
	return (
		prompt.type === "text" &&
		/enterprise/i.test(prompt.message) &&
		(/domain/i.test(prompt.message) || /host/i.test(prompt.message) || true)
	);
}

export async function runProviderAuth(
	options: ProviderAuthOptions,
): Promise<{ ok: boolean }> {
	const { job, onEvent } = options;
	let ok = false;
	let doneEmitted = false;
	let controlServer:
		| Awaited<ReturnType<typeof startAuthControlServer>>
		| undefined;
	let resultPath: string | undefined;
	let cancelled = false;
	const abort = new AbortController();
	/** Prompt answers kept only in process memory for redaction. */
	const answerSecrets: string[] = [];

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
		if (
			job.mode === "login" &&
			!isAllowedAuthType(job.providerId, job.authType)
		) {
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
				// Track only secret-bearing answers for output redaction. Domain/text
				// answers (e.g. Copilot enterprise host) are non-secret metadata.
				current.resolve(request.value);
				return { accepted: true, action: "answer" };
			},
		});

		const interaction: AuthInteraction = {
			signal: abort.signal,
			notify(event) {
				const mapped = mapAuthEvent(event);
				if (!mapped) return;
				try {
					emitPublic(onEvent, mapped, answerSecrets);
				} catch {
					// Drop event rather than leak a secret answer.
				}
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
				emitPublic(onEvent, event, answerSecrets);
				const answer = await new Promise<string>((resolve, reject) => {
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

				if (
					(prompt.type === "secret" || prompt.type === "manual_code") &&
					answer.length > 0
				) {
					answerSecrets.push(answer);
				}

				// Propagate Copilot Enterprise host for server-side URL binding.
				if (
					job.mode === "login" &&
					job.providerId === "github-copilot" &&
					isCopilotEnterprisePrompt(prompt)
				) {
					const host = normalizeEnterpriseHost(answer);
					if (host) {
						onEvent(
							assertPublicAuthEvent({
								v: 1,
								kind: "attempt_meta",
								enterpriseHost: host,
							}),
						);
					}
				}
				return answer;
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
			writeSecretFile(resultPath, JSON.stringify({ credential, models }));
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
		answerSecrets.length = 0;
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
