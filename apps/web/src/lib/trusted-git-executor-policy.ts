/**
 * Pure Trusted Git Executor policy: identity, input validation, egress request
 * classification, stream bounds, and safe results. No Cloudflare class imports.
 */
import { redactSecrets } from "#/lib/secret-redaction";

// --- Fixed limits (mirrored in containers/trusted-git-executor/ditto-git-executor) ---

export const TRUSTED_GIT_LIMITS = {
	publicationIdMaxBytes: 128,
	ownerMaxBytes: 100,
	repoMaxBytes: 100,
	fullRefMaxBytes: 512,
	bundleMaxBytes: 64 * 1024 * 1024,
	quarantineObjectBytes: 256 * 1024 * 1024,
	blobMaxBytes: 8 * 1024 * 1024,
	reachableObjects: 100_000,
	reachableCommits: 1_000,
	pathRecords: 20_000,
	httpBodyMaxBytes: 80 * 1024 * 1024,
	gitCommandTimeoutMs: 120_000,
	phaseGrantMaxMs: 150_000,
	capacityRetries: 3,
	ambiguousWriteRetries: 1,
	diagnosticMaxBytes: 8 * 1024,
	resultMaxBytes: 16 * 1024,
} as const;

export const TRUSTED_GIT_GITHUB_HOST = "github.com";
export const TRUSTED_GIT_IDENTITY_DOMAIN = "ditto:trusted-git-executor:v1";

const OWNER_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const HEADS_REF_RE = /^refs\/heads\/[A-Za-z0-9._/-]+$/;

export type TrustedGitPhase = "read" | "write";

export type TrustedGitService = "git-upload-pack" | "git-receive-pack";

export type SmartHttpRequestKind =
	| "read-discovery"
	| "read-rpc"
	| "write-discovery"
	| "write-rpc";

export type TrustedGitErrorCode =
	| "invalid_input"
	| "identity_mismatch"
	| "denied"
	| "expired"
	| "phase_mismatch"
	| "redirect"
	| "upstream"
	| "revoke_failed"
	| "validation_failed"
	| "capacity"
	| "timeout"
	| "ambiguous"
	| "interrupted"
	| "cleanup_failed"
	| "terminal_reuse"
	| "internal";

export type TrustedGitSafeResult =
	| {
			ok: true;
			code: "ok" | "reconciled";
			publicationIdHash: string;
			executionEpoch: number;
			ref: string;
			sha: string | null;
			present?: boolean;
			revoked: boolean;
			destroyed: boolean;
			capacityRetries?: number;
			diagnostic?: string;
	  }
	| {
			ok: false;
			code: TrustedGitErrorCode;
			publicationIdHash?: string;
			executionEpoch?: number;
			revoked: boolean;
			destroyed: boolean;
			diagnostic?: string;
	  };

export type PhaseGrantParams = {
	publicationIdHash: string;
	executionEpoch: number;
	installationId: number;
	owner: string;
	repo: string;
	phase: TrustedGitPhase;
	expiresAtMs: number;
};

export type ValidatedPublicationInput = {
	publicationId: string;
	executionEpoch: number;
	installationId: number;
	owner: string;
	repo: string;
	ref: string;
};

export type ValidatedBundleInput = ValidatedPublicationInput & {
	r2Key: string;
	bundleSize: number;
	bundleSha256: string;
	proposedSha: string;
	expectedOldSha: string | null;
};

// --- Validation helpers ---

function utf8Bytes(text: string): number {
	return new TextEncoder().encode(text).byteLength;
}

function hasControlOrSpace(text: string): boolean {
	return /[\0\s]/.test(text);
}

export function isExactSha1(value: string): boolean {
	return SHA1_RE.test(value);
}

export function isExactSha256(value: string): boolean {
	return SHA256_RE.test(value);
}

export function validatePublicationId(
	publicationId: unknown,
): asserts publicationId is string {
	if (typeof publicationId !== "string" || publicationId.length === 0) {
		throw new TrustedGitPolicyError("invalid_input", "publicationId");
	}
	if (hasControlOrSpace(publicationId)) {
		throw new TrustedGitPolicyError("invalid_input", "publicationId chars");
	}
	if (utf8Bytes(publicationId) > TRUSTED_GIT_LIMITS.publicationIdMaxBytes) {
		throw new TrustedGitPolicyError("invalid_input", "publicationId size");
	}
}

export function validateExecutionEpoch(
	epoch: unknown,
): asserts epoch is number {
	if (
		typeof epoch !== "number" ||
		!Number.isInteger(epoch) ||
		epoch < 1 ||
		epoch > Number.MAX_SAFE_INTEGER
	) {
		throw new TrustedGitPolicyError("invalid_input", "executionEpoch");
	}
}

export function validateInstallationId(id: unknown): asserts id is number {
	if (
		typeof id !== "number" ||
		!Number.isInteger(id) ||
		id < 1 ||
		id > Number.MAX_SAFE_INTEGER
	) {
		throw new TrustedGitPolicyError("invalid_input", "installationId");
	}
}

export function validateOwnerName(owner: unknown): asserts owner is string {
	if (typeof owner !== "string" || !OWNER_REPO_RE.test(owner)) {
		throw new TrustedGitPolicyError("invalid_input", "owner");
	}
	if (owner.startsWith(".") || owner.startsWith("-") || owner.includes("..")) {
		throw new TrustedGitPolicyError("invalid_input", "owner shape");
	}
	if (utf8Bytes(owner) > TRUSTED_GIT_LIMITS.ownerMaxBytes) {
		throw new TrustedGitPolicyError("invalid_input", "owner size");
	}
}

export function validateRepoName(repo: unknown): asserts repo is string {
	if (typeof repo !== "string" || !OWNER_REPO_RE.test(repo)) {
		throw new TrustedGitPolicyError("invalid_input", "repo");
	}
	if (repo.startsWith(".") || repo.startsWith("-") || repo.includes("..")) {
		throw new TrustedGitPolicyError("invalid_input", "repo shape");
	}
	if (utf8Bytes(repo) > TRUSTED_GIT_LIMITS.repoMaxBytes) {
		throw new TrustedGitPolicyError("invalid_input", "repo size");
	}
}

export function validateHeadsRef(ref: unknown): asserts ref is string {
	if (typeof ref !== "string" || !HEADS_REF_RE.test(ref)) {
		throw new TrustedGitPolicyError("invalid_input", "ref");
	}
	if (
		ref.includes("..") ||
		ref.includes("//") ||
		ref.includes("/./") ||
		ref.endsWith("/.") ||
		ref.endsWith("/") ||
		ref.includes("/-")
	) {
		throw new TrustedGitPolicyError("invalid_input", "ref shape");
	}
	if (utf8Bytes(ref) > TRUSTED_GIT_LIMITS.fullRefMaxBytes) {
		throw new TrustedGitPolicyError("invalid_input", "ref size");
	}
}

export function validateR2Key(key: unknown): asserts key is string {
	if (typeof key !== "string" || key.length === 0 || key.length > 1024) {
		throw new TrustedGitPolicyError("invalid_input", "r2Key");
	}
	if (
		key.startsWith("/") ||
		key.includes("\\") ||
		key.includes("..") ||
		hasControlOrSpace(key) ||
		key.includes("//")
	) {
		throw new TrustedGitPolicyError("invalid_input", "r2Key shape");
	}
}

export function validateBundleMeta(size: unknown, digest: unknown): void {
	if (
		typeof size !== "number" ||
		!Number.isInteger(size) ||
		size < 1 ||
		size > TRUSTED_GIT_LIMITS.bundleMaxBytes
	) {
		throw new TrustedGitPolicyError("invalid_input", "bundleSize");
	}
	if (typeof digest !== "string" || !isExactSha256(digest)) {
		throw new TrustedGitPolicyError("invalid_input", "bundleSha256");
	}
}

export function validateSha1OrNull(
	value: unknown,
	field: string,
): string | null {
	if (value === null || value === undefined || value === "-") {
		return null;
	}
	if (typeof value !== "string" || !isExactSha1(value)) {
		throw new TrustedGitPolicyError("invalid_input", field);
	}
	return value;
}

export function validateProbeInput(input: {
	publicationId: unknown;
	executionEpoch: unknown;
	installationId: unknown;
	owner: unknown;
	repo: unknown;
	ref: unknown;
}): ValidatedPublicationInput {
	validatePublicationId(input.publicationId);
	validateExecutionEpoch(input.executionEpoch);
	validateInstallationId(input.installationId);
	validateOwnerName(input.owner);
	validateRepoName(input.repo);
	validateHeadsRef(input.ref);
	return {
		publicationId: input.publicationId,
		executionEpoch: input.executionEpoch,
		installationId: input.installationId,
		owner: input.owner,
		repo: input.repo,
		ref: input.ref,
	};
}

export function validatePushInput(input: {
	publicationId: unknown;
	executionEpoch: unknown;
	installationId: unknown;
	owner: unknown;
	repo: unknown;
	ref: unknown;
	r2Key: unknown;
	bundleSize: unknown;
	bundleSha256: unknown;
	proposedSha: unknown;
	expectedOldSha: unknown;
}): ValidatedBundleInput {
	const base = validateProbeInput(input);
	validateR2Key(input.r2Key);
	validateBundleMeta(input.bundleSize, input.bundleSha256);
	if (
		typeof input.proposedSha !== "string" ||
		!isExactSha1(input.proposedSha)
	) {
		throw new TrustedGitPolicyError("invalid_input", "proposedSha");
	}
	const expectedOldSha = validateSha1OrNull(
		input.expectedOldSha,
		"expectedOldSha",
	);
	return {
		...base,
		r2Key: input.r2Key as string,
		bundleSize: input.bundleSize as number,
		bundleSha256: input.bundleSha256 as string,
		proposedSha: input.proposedSha,
		expectedOldSha,
	};
}

export class TrustedGitPolicyError extends Error {
	readonly code: TrustedGitErrorCode;

	constructor(code: TrustedGitErrorCode, message: string) {
		super(message);
		this.name = "TrustedGitPolicyError";
		this.code = code;
	}
}

// --- Identity ---

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let out = "";
	for (const b of view) {
		out += b.toString(16).padStart(2, "0");
	}
	return out;
}

/**
 * Domain-separated SHA-256 identity for one publication + positive epoch.
 * Returns a lowercase hex name (64 chars) with no raw publication text.
 */
export async function deriveExecutorIdentity(
	publicationId: string,
	executionEpoch: number,
): Promise<string> {
	validatePublicationId(publicationId);
	validateExecutionEpoch(executionEpoch);
	const material = `${TRUSTED_GIT_IDENTITY_DOMAIN}\n${publicationId}\n${executionEpoch}`;
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(material),
	);
	return bytesToHex(digest);
}

export async function assertIdentityMatch(
	publicationId: string,
	executionEpoch: number,
	expectedName: string,
): Promise<string> {
	const derived = await deriveExecutorIdentity(publicationId, executionEpoch);
	if (derived !== expectedName) {
		throw new TrustedGitPolicyError("identity_mismatch", "identity");
	}
	return derived;
}

// --- Egress request classification ---

const FORWARDED_HEADER_ALLOWLIST = new Set([
	"accept",
	"content-type",
	"git-protocol",
	"user-agent",
]);

const READ_RPC_CONTENT_TYPE = "application/x-git-upload-pack-request";
const WRITE_RPC_CONTENT_TYPE = "application/x-git-receive-pack-request";

export type ClassifiedSmartHttpRequest = {
	kind: SmartHttpRequestKind;
	service: TrustedGitService;
	owner: string;
	repo: string;
};

function normalizeHostname(host: string): string {
	return host.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Classify an outbound container request as one of the four allowed smart-HTTP
 * shapes for the exact owner/repo and phase. Throws TrustedGitPolicyError on deny.
 */
export function classifySmartHttpRequest(
	request: Request,
	params: Pick<PhaseGrantParams, "owner" | "repo" | "phase" | "expiresAtMs">,
	nowMs: number = Date.now(),
): ClassifiedSmartHttpRequest {
	if (nowMs > params.expiresAtMs) {
		throw new TrustedGitPolicyError("expired", "phase expired");
	}

	// Reject credentials / traversal in the raw URL before parser normalization.
	const rawUrl = request.url;
	if (
		rawUrl.includes("@") ||
		rawUrl.includes("..") ||
		/%2e%2e/i.test(rawUrl) ||
		/%00/i.test(rawUrl)
	) {
		throw new TrustedGitPolicyError("denied", "raw url");
	}

	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new TrustedGitPolicyError("denied", "url");
	}

	if (url.protocol !== "https:") {
		throw new TrustedGitPolicyError("denied", "scheme");
	}
	if (url.port !== "" && url.port !== "443") {
		throw new TrustedGitPolicyError("denied", "port");
	}
	if (url.username || url.password) {
		throw new TrustedGitPolicyError("denied", "userinfo");
	}

	const host = normalizeHostname(url.hostname);
	if (host !== TRUSTED_GIT_GITHUB_HOST) {
		throw new TrustedGitPolicyError("denied", "host");
	}
	// Exact host label only (no trailing-dot variants slipping past).
	if (url.hostname.toLowerCase() !== TRUSTED_GIT_GITHUB_HOST) {
		throw new TrustedGitPolicyError("denied", "host");
	}

	// Reject credentials on the inbound container request.
	if (
		request.headers.has("authorization") ||
		request.headers.has("proxy-authorization") ||
		request.headers.has("cookie")
	) {
		throw new TrustedGitPolicyError("denied", "inbound credential");
	}

	const method = request.method.toUpperCase();
	if (method !== "GET" && method !== "POST") {
		throw new TrustedGitPolicyError("denied", "method");
	}

	// Path: /<owner>/<repo>.git/(info/refs|git-upload-pack|git-receive-pack)
	const path = url.pathname;
	if (
		path.includes("//") ||
		path.includes("/./") ||
		path.includes("/../") ||
		path.includes("%")
	) {
		// Percent-encoding can smuggle; require decoded exact path only.
		// URL.pathname is already decoded; reject residual % and dot segments.
		throw new TrustedGitPolicyError("denied", "path");
	}
	if (path.includes("..")) {
		throw new TrustedGitPolicyError("denied", "path");
	}

	const pathRe =
		/^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/;
	const match = pathRe.exec(path);
	if (!match) {
		throw new TrustedGitPolicyError("denied", "path shape");
	}
	const owner = match[1]!;
	const repo = match[2]!;
	const tail = match[3]!;

	if (owner !== params.owner || repo !== params.repo) {
		throw new TrustedGitPolicyError("denied", "repository");
	}
	// Prefix/suffix confusion already prevented by exact regex + equality.

	let kind: SmartHttpRequestKind;
	let service: TrustedGitService;

	if (tail === "info/refs") {
		if (method !== "GET") {
			throw new TrustedGitPolicyError("denied", "discovery method");
		}
		// Exact single query key service=
		const keys = [...url.searchParams.keys()];
		if (keys.length !== 1 || keys[0] !== "service") {
			throw new TrustedGitPolicyError("denied", "query");
		}
		const svc = url.searchParams.get("service");
		if (svc !== "git-upload-pack" && svc !== "git-receive-pack") {
			throw new TrustedGitPolicyError("denied", "service");
		}
		// Reject duplicate service keys (searchParams collapses; check raw).
		const rawQuery = url.search.startsWith("?")
			? url.search.slice(1)
			: url.search;
		if (rawQuery !== `service=${svc}`) {
			throw new TrustedGitPolicyError("denied", "query raw");
		}
		service = svc;
		kind = svc === "git-upload-pack" ? "read-discovery" : "write-discovery";
	} else if (tail === "git-upload-pack") {
		if (method !== "POST") {
			throw new TrustedGitPolicyError("denied", "rpc method");
		}
		if (url.search !== "") {
			throw new TrustedGitPolicyError("denied", "rpc query");
		}
		const ctype = request.headers.get("content-type");
		if (ctype !== READ_RPC_CONTENT_TYPE) {
			throw new TrustedGitPolicyError("denied", "content-type");
		}
		service = "git-upload-pack";
		kind = "read-rpc";
	} else if (tail === "git-receive-pack") {
		if (method !== "POST") {
			throw new TrustedGitPolicyError("denied", "rpc method");
		}
		if (url.search !== "") {
			throw new TrustedGitPolicyError("denied", "rpc query");
		}
		const ctype = request.headers.get("content-type");
		if (ctype !== WRITE_RPC_CONTENT_TYPE) {
			throw new TrustedGitPolicyError("denied", "content-type");
		}
		service = "git-receive-pack";
		kind = "write-rpc";
	} else {
		throw new TrustedGitPolicyError("denied", "path tail");
	}

	// Phase separation.
	const isRead = service === "git-upload-pack";
	if (params.phase === "read" && !isRead) {
		throw new TrustedGitPolicyError("phase_mismatch", "write in read phase");
	}
	if (params.phase === "write" && isRead) {
		throw new TrustedGitPolicyError("phase_mismatch", "read in write phase");
	}

	// GET must not carry a body we forward; Request bodies on GET are rejected.
	if (method === "GET" && request.body !== null) {
		throw new TrustedGitPolicyError("denied", "get body");
	}

	return { kind, service, owner, repo };
}

/**
 * Build a clean upstream Request: code-owned header allowlist + injected Basic.
 * Does not mutate the original request. redirect must be handled as manual by caller.
 */
export function buildUpstreamGitRequest(
	request: Request,
	classified: ClassifiedSmartHttpRequest,
	installationToken: string,
): Request {
	const url = new URL(request.url);
	// Reconstruct exact canonical URL without userinfo.
	const canonical = `https://${TRUSTED_GIT_GITHUB_HOST}${url.pathname}${url.search}`;

	const headers = new Headers();
	for (const [name, value] of request.headers.entries()) {
		const lower = name.toLowerCase();
		if (!FORWARDED_HEADER_ALLOWLIST.has(lower)) {
			continue;
		}
		if (lower === "user-agent" && utf8Bytes(value) > 256) {
			continue;
		}
		if (lower === "content-type") {
			// Only the exact RPC types (discovery has none required).
			if (classified.kind === "read-rpc" && value !== READ_RPC_CONTENT_TYPE) {
				continue;
			}
			if (classified.kind === "write-rpc" && value !== WRITE_RPC_CONTENT_TYPE) {
				continue;
			}
			if (
				classified.kind === "read-discovery" ||
				classified.kind === "write-discovery"
			) {
				continue;
			}
		}
		headers.set(name, value);
	}

	const basic = btoa(`x-access-token:${installationToken}`);
	headers.set("authorization", `Basic ${basic}`);
	headers.set("accept", headers.get("accept") ?? "*/*");

	return new Request(canonical, {
		method: request.method.toUpperCase(),
		headers,
		body: request.body,
		redirect: "manual",
		// @ts-expect-error duplex required for streamed body in some runtimes
		duplex: request.body ? "half" : undefined,
	});
}

export function contentsPermissionForPhase(
	phase: TrustedGitPhase,
): "read" | "write" {
	return phase === "write" ? "write" : "read";
}

// --- Stream bounds + one-shot finalizer ---

export type StreamFinalizer = () => Promise<void>;

/**
 * Wrap a readable stream with a byte cap. Oversize aborts with denied error.
 * Invokes finalizer exactly once on EOF, error, cancel, or abort.
 */
export function boundReadableStream(
	source: ReadableStream<Uint8Array>,
	maxBytes: number,
	finalizer: StreamFinalizer,
): ReadableStream<Uint8Array> {
	let seen = 0;
	let finalized = false;
	const runFinalizer = async () => {
		if (finalized) return;
		finalized = true;
		await finalizer();
	};

	const reader = source.getReader();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					controller.close();
					await runFinalizer();
					return;
				}
				seen += value.byteLength;
				if (seen > maxBytes) {
					await reader.cancel("oversize");
					controller.error(
						new TrustedGitPolicyError("denied", "body oversize"),
					);
					await runFinalizer();
					return;
				}
				controller.enqueue(value);
			} catch (err) {
				controller.error(err);
				await runFinalizer();
			}
		},
		async cancel() {
			try {
				await reader.cancel();
			} finally {
				await runFinalizer();
			}
		},
	});
}

/**
 * Count bytes through a transform without retaining body content.
 */
export function countingTransform(
	onCount: (total: number) => void,
	maxBytes: number,
): TransformStream<Uint8Array, Uint8Array> {
	let total = 0;
	return new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			total += chunk.byteLength;
			if (total > maxBytes) {
				controller.error(
					new TrustedGitPolicyError("denied", "stream oversize"),
				);
				return;
			}
			onCount(total);
			controller.enqueue(chunk);
		},
	});
}

// --- Safe results ---

export function capDiagnostic(
	text: string,
	secrets: readonly string[] = [],
): string {
	const redacted = redactSecrets(text, secrets);
	const bytes = new TextEncoder().encode(redacted);
	if (bytes.byteLength <= TRUSTED_GIT_LIMITS.diagnosticMaxBytes) {
		return redacted;
	}
	// Truncate on UTF-8 byte boundary.
	let end = TRUSTED_GIT_LIMITS.diagnosticMaxBytes;
	while (end > 0 && (bytes[end]! & 0xc0) === 0x80) {
		end -= 1;
	}
	return new TextDecoder().decode(bytes.slice(0, end));
}

export function makeSuccessResult(input: {
	code?: "ok" | "reconciled";
	publicationIdHash: string;
	executionEpoch: number;
	ref: string;
	sha: string | null;
	present?: boolean;
	revoked: boolean;
	destroyed: boolean;
	capacityRetries?: number;
	diagnostic?: string;
	secrets?: readonly string[];
}): TrustedGitSafeResult {
	const result: TrustedGitSafeResult = {
		ok: true,
		code: input.code ?? "ok",
		publicationIdHash: input.publicationIdHash,
		executionEpoch: input.executionEpoch,
		ref: input.ref,
		sha: input.sha,
		revoked: input.revoked,
		destroyed: input.destroyed,
	};
	if (input.present !== undefined) {
		result.present = input.present;
	}
	if (input.capacityRetries !== undefined) {
		result.capacityRetries = input.capacityRetries;
	}
	if (input.diagnostic) {
		result.diagnostic = capDiagnostic(input.diagnostic, input.secrets ?? []);
	}
	assertResultBound(result);
	return result;
}

export function makeErrorResult(input: {
	code: TrustedGitErrorCode;
	publicationIdHash?: string;
	executionEpoch?: number;
	revoked: boolean;
	destroyed: boolean;
	diagnostic?: string;
	secrets?: readonly string[];
}): TrustedGitSafeResult {
	const result: TrustedGitSafeResult = {
		ok: false,
		code: input.code,
		revoked: input.revoked,
		destroyed: input.destroyed,
	};
	if (input.publicationIdHash !== undefined) {
		result.publicationIdHash = input.publicationIdHash;
	}
	if (input.executionEpoch !== undefined) {
		result.executionEpoch = input.executionEpoch;
	}
	if (input.diagnostic) {
		result.diagnostic = capDiagnostic(input.diagnostic, input.secrets ?? []);
	}
	assertResultBound(result);
	return result;
}

function assertResultBound(result: TrustedGitSafeResult): void {
	const serialized = JSON.stringify(result);
	if (utf8Bytes(serialized) > TRUSTED_GIT_LIMITS.resultMaxBytes) {
		// Fail closed: strip diagnostic.
		if ("diagnostic" in result) {
			delete (result as { diagnostic?: string }).diagnostic;
		}
	}
}

export function buildPhaseGrant(input: {
	publicationIdHash: string;
	executionEpoch: number;
	installationId: number;
	owner: string;
	repo: string;
	phase: TrustedGitPhase;
	nowMs?: number;
	ttlMs?: number;
}): PhaseGrantParams {
	const now = input.nowMs ?? Date.now();
	const ttl = Math.min(
		input.ttlMs ?? TRUSTED_GIT_LIMITS.phaseGrantMaxMs,
		TRUSTED_GIT_LIMITS.phaseGrantMaxMs,
	);
	return {
		publicationIdHash: input.publicationIdHash,
		executionEpoch: input.executionEpoch,
		installationId: input.installationId,
		owner: input.owner,
		repo: input.repo,
		phase: input.phase,
		expiresAtMs: now + ttl,
	};
}

/** Ensure phase grant params contain no secret-looking fields. */
export function assertPhaseGrantNonSecret(params: PhaseGrantParams): void {
	const json = JSON.stringify(params);
	if (
		/gh[pousr]_/i.test(json) ||
		/x-access-token/i.test(json) ||
		/authorization/i.test(json) ||
		/BEGIN [A-Z ]*PRIVATE KEY/i.test(json)
	) {
		throw new TrustedGitPolicyError("internal", "secret in phase grant");
	}
}

export function isRedirectStatus(status: number): boolean {
	return status >= 300 && status < 400;
}

/**
 * Three-state write reconciliation against exact remote ref SHA.
 * - proposed → reconciled success
 * - expected old or absent (null) → may retry once
 * - any third state → interrupted, no retry
 */
export type ReconcileDecision =
	| { action: "success"; sha: string }
	| { action: "retry" }
	| { action: "interrupted"; observed: string | null };

export function reconcileWriteRef(input: {
	observedSha: string | null;
	proposedSha: string;
	expectedOldSha: string | null;
}): ReconcileDecision {
	if (input.observedSha === input.proposedSha) {
		return { action: "success", sha: input.proposedSha };
	}
	if (input.observedSha === input.expectedOldSha) {
		return { action: "retry" };
	}
	return { action: "interrupted", observed: input.observedSha };
}
