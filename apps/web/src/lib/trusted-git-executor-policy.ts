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
	userAgentMaxBytes: 256,
	containerIdMaxBytes: 128,
} as const;

export const TRUSTED_GIT_GITHUB_HOST = "github.com";
export const TRUSTED_GIT_IDENTITY_DOMAIN = "ditto:trusted-git-executor:v1";
export const TRUSTED_GIT_CLASS_NAME = "TrustedGitExecutor";

const OWNER_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const CONTAINER_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** Exact Accept values permitted on smart-HTTP requests. */
const ALLOWED_ACCEPT = new Set([
	"*/*",
	"application/x-git-upload-pack-result",
	"application/x-git-receive-pack-result",
	"application/x-git-upload-pack-advertisement",
	"application/x-git-receive-pack-advertisement",
]);

const READ_RPC_CONTENT_TYPE = "application/x-git-upload-pack-request";
const WRITE_RPC_CONTENT_TYPE = "application/x-git-receive-pack-request";

/** Git user-agent: git/X.Y or git/X.Y.Z with optional suffix suffix-free bound. */
const GIT_USER_AGENT_RE = /^git\/\d+\.\d+(?:\.\d+)?(?:\s+\([^)]{1,64}\))?$/;

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
	/** Non-secret container id bound at grant time; handler requires exact match. */
	containerId: string;
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

export type HelperLsRemote =
	| { ok: true; present: true; sha: string }
	| { ok: true; present: false; sha: null }
	| { ok: false; code: string };

export type HelperValidate =
	| {
			ok: true;
			ref: string;
			tip: string;
	  }
	| { ok: false; code: string };

export type HelperPush =
	| { ok: true; ref: string; tip: string }
	| { ok: false; code: string };

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

/**
 * Mirror git check-ref-format restrictions for refs/heads/* Session Branches.
 * Rejects leading-dot components, .lock, trailing dots, @{, and special chars.
 */
export function validateHeadsRef(ref: unknown): asserts ref is string {
	if (typeof ref !== "string") {
		throw new TrustedGitPolicyError("invalid_input", "ref");
	}
	if (!ref.startsWith("refs/heads/")) {
		throw new TrustedGitPolicyError("invalid_input", "ref");
	}
	if (utf8Bytes(ref) > TRUSTED_GIT_LIMITS.fullRefMaxBytes) {
		throw new TrustedGitPolicyError("invalid_input", "ref size");
	}
	const body = ref.slice("refs/heads/".length);
	if (body.length === 0) {
		throw new TrustedGitPolicyError("invalid_input", "ref empty");
	}
	// git check-ref-format disallows these globally.
	if (
		body.includes("..") ||
		body.includes("//") ||
		body.includes("@{") ||
		body.includes("\\") ||
		body.endsWith(".") ||
		body.endsWith("/") ||
		body.startsWith("/") ||
		hasControlOrSpace(body) ||
		/[~^:?*[]/.test(body) ||
		body.includes("*") ||
		body.includes("?") ||
		body === "@"
	) {
		throw new TrustedGitPolicyError("invalid_input", "ref shape");
	}
	const parts = body.split("/");
	for (const part of parts) {
		if (
			part.length === 0 ||
			part.startsWith(".") ||
			part.endsWith(".") ||
			part.endsWith(".lock") ||
			part.includes("*") ||
			part === "@"
		) {
			throw new TrustedGitPolicyError("invalid_input", "ref component");
		}
		// Component must be GitHub/git-safe characters only.
		if (!/^[A-Za-z0-9._-]+$/.test(part)) {
			throw new TrustedGitPolicyError("invalid_input", "ref chars");
		}
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

export function validateContainerId(id: unknown): asserts id is string {
	if (typeof id !== "string" || !CONTAINER_ID_RE.test(id)) {
		throw new TrustedGitPolicyError("invalid_input", "containerId");
	}
	if (utf8Bytes(id) > TRUSTED_GIT_LIMITS.containerIdMaxBytes) {
		throw new TrustedGitPolicyError("invalid_input", "containerId size");
	}
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

export type ClassifiedSmartHttpRequest = {
	kind: SmartHttpRequestKind;
	service: TrustedGitService;
	owner: string;
	repo: string;
};

/**
 * Inspect raw authority before URL parser normalization.
 * Rejects uppercase hosts, trailing dots, explicit :443, userinfo, non-https.
 */
export function assertExactGithubAuthority(rawUrl: string): void {
	if (
		typeof rawUrl !== "string" ||
		rawUrl.length === 0 ||
		rawUrl.length > 4096
	) {
		throw new TrustedGitPolicyError("denied", "url");
	}
	if (
		rawUrl.includes("@") ||
		rawUrl.includes("..") ||
		/%2e%2e/i.test(rawUrl) ||
		/%00/i.test(rawUrl)
	) {
		throw new TrustedGitPolicyError("denied", "raw url");
	}
	// Scheme must be exact lowercase https://
	if (!rawUrl.startsWith("https://")) {
		throw new TrustedGitPolicyError("denied", "scheme");
	}
	const rest = rawUrl.slice("https://".length);
	const slash = rest.indexOf("/");
	const authority = slash === -1 ? rest : rest.slice(0, slash);
	// Exact host only — no userinfo, port, trailing dot, or case variants.
	if (authority !== TRUSTED_GIT_GITHUB_HOST) {
		throw new TrustedGitPolicyError("denied", "authority");
	}
}

function validateForwardedHeaders(
	request: Request,
	kind: SmartHttpRequestKind,
): void {
	// Only allowlisted headers may be present among security-relevant ones;
	// buildUpstream drops others. Here we reject disallowed values on allowlist.
	const accept = request.headers.get("accept");
	if (accept !== null) {
		// Allow comma-separated subset of approved values only.
		const parts = accept.split(",").map((p) => p.trim().toLowerCase());
		for (const p of parts) {
			// Strip optional ;q=
			const base = (p.split(";")[0] ?? "").trim();
			if (!base || !ALLOWED_ACCEPT.has(base)) {
				throw new TrustedGitPolicyError("denied", "accept");
			}
		}
	}

	const ctype = request.headers.get("content-type");
	if (kind === "read-rpc") {
		if (ctype !== READ_RPC_CONTENT_TYPE) {
			throw new TrustedGitPolicyError("denied", "content-type");
		}
	} else if (kind === "write-rpc") {
		if (ctype !== WRITE_RPC_CONTENT_TYPE) {
			throw new TrustedGitPolicyError("denied", "content-type");
		}
	} else if (ctype !== null && ctype !== "") {
		// Discovery should not carry a content-type we forward.
		throw new TrustedGitPolicyError("denied", "content-type");
	}

	const gitProtocol = request.headers.get("git-protocol");
	if (gitProtocol !== null) {
		// Exact version=2 only (optional header).
		if (gitProtocol !== "version=2") {
			throw new TrustedGitPolicyError("denied", "git-protocol");
		}
	}

	const ua = request.headers.get("user-agent");
	if (ua !== null) {
		if (utf8Bytes(ua) > TRUSTED_GIT_LIMITS.userAgentMaxBytes) {
			throw new TrustedGitPolicyError("denied", "user-agent size");
		}
		if (!GIT_USER_AGENT_RE.test(ua)) {
			throw new TrustedGitPolicyError("denied", "user-agent");
		}
	}
}

/**
 * Classify an outbound container request as one of the four allowed smart-HTTP
 * shapes for the exact owner/repo and phase. Throws TrustedGitPolicyError on deny.
 */
export function classifySmartHttpRequest(
	request: Request,
	params: Pick<
		PhaseGrantParams,
		"owner" | "repo" | "phase" | "expiresAtMs" | "containerId"
	> & {
		/** Optional expected container id from grant; required when present on params. */
	},
	nowMs: number = Date.now(),
	ctx?: { containerId?: string; className?: string },
): ClassifiedSmartHttpRequest {
	if (nowMs > params.expiresAtMs) {
		throw new TrustedGitPolicyError("expired", "phase expired");
	}

	if (ctx) {
		if (ctx.className !== TRUSTED_GIT_CLASS_NAME) {
			throw new TrustedGitPolicyError("denied", "className");
		}
		if (
			typeof ctx.containerId !== "string" ||
			ctx.containerId !== params.containerId
		) {
			throw new TrustedGitPolicyError("denied", "containerId");
		}
	}

	const rawUrl = request.url;
	assertExactGithubAuthority(rawUrl);

	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new TrustedGitPolicyError("denied", "url");
	}

	if (url.protocol !== "https:") {
		throw new TrustedGitPolicyError("denied", "scheme");
	}
	// Parser may normalize; still require empty port (explicit :443 already denied by authority).
	if (url.port !== "") {
		throw new TrustedGitPolicyError("denied", "port");
	}
	if (url.username || url.password) {
		throw new TrustedGitPolicyError("denied", "userinfo");
	}
	if (url.hostname !== TRUSTED_GIT_GITHUB_HOST) {
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

	const path = url.pathname;
	if (
		path.includes("//") ||
		path.includes("/./") ||
		path.includes("/../") ||
		path.includes("%") ||
		path.includes("..")
	) {
		throw new TrustedGitPolicyError("denied", "path");
	}

	const pathRe =
		/^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/;
	const match = pathRe.exec(path);
	if (!match) {
		throw new TrustedGitPolicyError("denied", "path shape");
	}
	const owner = match[1] ?? "";
	const repo = match[2] ?? "";
	const tail = match[3] ?? "";
	if (!owner || !repo || !tail) {
		throw new TrustedGitPolicyError("denied", "path shape");
	}

	if (owner !== params.owner || repo !== params.repo) {
		throw new TrustedGitPolicyError("denied", "repository");
	}

	let kind: SmartHttpRequestKind;
	let service: TrustedGitService;

	if (tail === "info/refs") {
		if (method !== "GET") {
			throw new TrustedGitPolicyError("denied", "discovery method");
		}
		const keys = [...url.searchParams.keys()];
		if (keys.length !== 1 || keys[0] !== "service") {
			throw new TrustedGitPolicyError("denied", "query");
		}
		const svc = url.searchParams.get("service");
		if (svc !== "git-upload-pack" && svc !== "git-receive-pack") {
			throw new TrustedGitPolicyError("denied", "service");
		}
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
		service = "git-upload-pack";
		kind = "read-rpc";
	} else if (tail === "git-receive-pack") {
		if (method !== "POST") {
			throw new TrustedGitPolicyError("denied", "rpc method");
		}
		if (url.search !== "") {
			throw new TrustedGitPolicyError("denied", "rpc query");
		}
		service = "git-receive-pack";
		kind = "write-rpc";
	} else {
		throw new TrustedGitPolicyError("denied", "path tail");
	}

	validateForwardedHeaders(request, kind);

	const isRead = service === "git-upload-pack";
	if (params.phase === "read" && !isRead) {
		throw new TrustedGitPolicyError("phase_mismatch", "write in read phase");
	}
	if (params.phase === "write" && isRead) {
		throw new TrustedGitPolicyError("phase_mismatch", "read in write phase");
	}

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
	body?: ReadableStream<Uint8Array> | null,
): Request {
	const url = new URL(request.url);
	const canonical = `https://${TRUSTED_GIT_GITHUB_HOST}${url.pathname}${url.search}`;

	const headers = new Headers();
	for (const [name, value] of request.headers.entries()) {
		const lower = name.toLowerCase();
		if (
			lower !== "accept" &&
			lower !== "content-type" &&
			lower !== "git-protocol" &&
			lower !== "user-agent"
		) {
			continue;
		}
		if (lower === "user-agent") {
			if (
				utf8Bytes(value) > TRUSTED_GIT_LIMITS.userAgentMaxBytes ||
				!GIT_USER_AGENT_RE.test(value)
			) {
				continue;
			}
		}
		if (lower === "accept") {
			const parts = value.split(",").map((p) => p.trim().toLowerCase());
			let ok = true;
			for (const p of parts) {
				const base = (p.split(";")[0] ?? "").trim();
				if (!ALLOWED_ACCEPT.has(base)) {
					ok = false;
					break;
				}
			}
			if (!ok) continue;
		}
		if (lower === "content-type") {
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
		if (lower === "git-protocol" && value !== "version=2") {
			continue;
		}
		headers.set(name, value);
	}

	const basic = btoa(`x-access-token:${installationToken}`);
	headers.set("authorization", `Basic ${basic}`);
	if (!headers.has("accept")) {
		headers.set("accept", "*/*");
	}

	const outBody =
		body === undefined
			? (request.body as ReadableStream<Uint8Array> | null)
			: body;

	return new Request(canonical, {
		method: request.method.toUpperCase(),
		headers,
		body: outBody,
		redirect: "manual",
		// @ts-expect-error duplex required for streamed body in some runtimes
		duplex: outBody ? "half" : undefined,
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
 * Invokes finalizer exactly once. Finalizer runs before successful close so a
 * revoke failure cannot look like normal EOF success.
 */
export function boundReadableStream(
	source: ReadableStream<Uint8Array>,
	maxBytes: number,
	finalizer: StreamFinalizer,
): ReadableStream<Uint8Array> {
	let seen = 0;
	let finalized = false;
	let finalizeError: unknown;
	const runFinalizer = async () => {
		if (finalized) return;
		finalized = true;
		try {
			await finalizer();
		} catch (err) {
			finalizeError = err;
			throw err;
		}
	};

	const reader = source.getReader();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					try {
						await runFinalizer();
						controller.close();
					} catch (err) {
						controller.error(
							err instanceof TrustedGitPolicyError
								? err
								: new TrustedGitPolicyError("revoke_failed", "finalize"),
						);
					}
					return;
				}
				seen += value.byteLength;
				if (seen > maxBytes) {
					try {
						await reader.cancel("oversize");
					} catch {
						// ignore
					}
					try {
						await runFinalizer();
					} catch {
						// prefer oversize signal; finalize still ran once
					}
					controller.error(
						new TrustedGitPolicyError("denied", "body oversize"),
					);
					return;
				}
				controller.enqueue(value);
			} catch (err) {
				try {
					await runFinalizer();
				} catch (finErr) {
					controller.error(finErr instanceof Error ? finErr : err);
					return;
				}
				controller.error(err);
			}
		},
		async cancel(reason) {
			try {
				await reader.cancel(reason);
			} finally {
				try {
					await runFinalizer();
				} catch {
					// cancel path still finalizes once
				}
			}
			if (finalizeError) {
				// Surface finalize failure to cancel callers when possible.
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

// --- Helper JSON boundary revalidation ---

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Revalidate ls-remote helper JSON at the Worker boundary. Never trust raw strings. */
export function parseHelperLsRemote(raw: unknown): HelperLsRemote {
	if (!isPlainObject(raw)) {
		return { ok: false, code: "helper_invalid" };
	}
	if (raw.ok === true) {
		if (raw.present === true) {
			if (typeof raw.sha !== "string" || !isExactSha1(raw.sha)) {
				return { ok: false, code: "helper_invalid" };
			}
			return { ok: true, present: true, sha: raw.sha };
		}
		if (raw.present === false && (raw.sha === null || raw.sha === undefined)) {
			return { ok: true, present: false, sha: null };
		}
		return { ok: false, code: "helper_invalid" };
	}
	if (
		raw.ok === false &&
		typeof raw.code === "string" &&
		raw.code.length <= 64
	) {
		return { ok: false, code: raw.code };
	}
	return { ok: false, code: "helper_invalid" };
}

export function parseHelperValidate(
	raw: unknown,
	expected: { ref: string; tip: string },
): HelperValidate {
	if (!isPlainObject(raw)) {
		return { ok: false, code: "helper_invalid" };
	}
	if (raw.ok === true) {
		if (typeof raw.ref !== "string" || typeof raw.tip !== "string") {
			return { ok: false, code: "helper_invalid" };
		}
		if (raw.ref !== expected.ref || raw.tip !== expected.tip) {
			return { ok: false, code: "helper_mismatch" };
		}
		if (!isExactSha1(raw.tip)) {
			return { ok: false, code: "helper_invalid" };
		}
		return { ok: true, ref: raw.ref, tip: raw.tip };
	}
	if (
		raw.ok === false &&
		typeof raw.code === "string" &&
		raw.code.length <= 64
	) {
		return { ok: false, code: raw.code };
	}
	return { ok: false, code: "helper_invalid" };
}

export function parseHelperPush(
	raw: unknown,
	expected: { ref: string; tip: string },
): HelperPush {
	if (!isPlainObject(raw)) {
		return { ok: false, code: "helper_invalid" };
	}
	if (raw.ok === true) {
		// tip/ref optional on push success but when present must match.
		const ref = typeof raw.ref === "string" ? raw.ref : expected.ref;
		const tip = typeof raw.tip === "string" ? raw.tip : expected.tip;
		if (ref !== expected.ref || tip !== expected.tip || !isExactSha1(tip)) {
			return { ok: false, code: "helper_mismatch" };
		}
		return { ok: true, ref, tip };
	}
	if (
		raw.ok === false &&
		typeof raw.code === "string" &&
		raw.code.length <= 64
	) {
		return { ok: false, code: raw.code };
	}
	return { ok: false, code: "helper_invalid" };
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
	let end = TRUSTED_GIT_LIMITS.diagnosticMaxBytes;
	while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) {
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
	containerId: string;
	nowMs?: number;
	ttlMs?: number;
}): PhaseGrantParams {
	validateContainerId(input.containerId);
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
		containerId: input.containerId,
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
	validateContainerId(params.containerId);
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

/**
 * Concurrent-safe drain of a process stream with hard byte cap.
 * On overflow, cancels the reader and reports overflow.
 */
export async function drainProcessStream(
	stream: ReadableStream<Uint8Array> | null,
	maxBytes: number,
): Promise<{ text: string; overflow: boolean; bytes: number }> {
	if (!stream) {
		return { text: "", overflow: false, bytes: 0 };
	}
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let overflow = false;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			overflow = true;
			try {
				await reader.cancel("overflow");
			} catch {
				// ignore
			}
			break;
		}
		chunks.push(value);
	}
	const keep = overflow ? maxBytes : total;
	const merged = new Uint8Array(Math.min(keep, total));
	let offset = 0;
	for (const c of chunks) {
		const slice =
			c.byteLength > merged.byteLength - offset
				? c.subarray(0, merged.byteLength - offset)
				: c;
		merged.set(slice, offset);
		offset += slice.byteLength;
		if (offset >= merged.byteLength) break;
	}
	return {
		text: new TextDecoder().decode(merged),
		overflow,
		bytes: total,
	};
}

export type BoundedProcessHandle = {
	stdout: ReadableStream<Uint8Array> | null;
	stderr: ReadableStream<Uint8Array> | null;
	exitCode: Promise<number>;
	kill: (signal?: number) => void;
};

export type BoundedProcessResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	overflow: boolean;
	killed: boolean;
};

/**
 * One bounded runner for validate/ls/push: concurrent drains, byte overflow
 * failure, real wall-clock race, kill without indefinite wait.
 * Never calls output() after stream consumption.
 */
export async function runBoundedProcess(
	proc: BoundedProcessHandle,
	options: {
		timeoutMs: number;
		maxStdoutBytes: number;
		maxStderrBytes: number;
		/** Grace after kill before treating exit as hung. */
		killGraceMs?: number;
	},
): Promise<BoundedProcessResult> {
	const killGraceMs = options.killGraceMs ?? 2_000;
	let timedOut = false;
	let killed = false;
	let overflow = false;

	const kill = () => {
		killed = true;
		try {
			proc.kill();
		} catch {
			// ignore
		}
	};

	const timer = setTimeout(() => {
		timedOut = true;
		kill();
	}, options.timeoutMs);

	const exitRace = Promise.race([
		proc.exitCode.then((code) => ({ kind: "exit" as const, code })),
		new Promise<{ kind: "hang" }>((resolve) => {
			// Resolved only after timeout+grace if exitCode never settles.
			const watch = () => {
				if (!timedOut && !killed) {
					setTimeout(watch, 50);
					return;
				}
				setTimeout(() => resolve({ kind: "hang" }), killGraceMs);
			};
			setTimeout(watch, options.timeoutMs);
		}),
	]);

	try {
		const [stdoutDrain, stderrDrain, exit] = await Promise.all([
			drainProcessStream(proc.stdout, options.maxStdoutBytes),
			drainProcessStream(proc.stderr, options.maxStderrBytes),
			exitRace,
		]);
		overflow = stdoutDrain.overflow || stderrDrain.overflow;
		if (overflow && !killed) {
			kill();
		}
		const exitCode =
			exit.kind === "exit" ? exit.code : timedOut || killed ? 124 : 1;
		return {
			exitCode,
			stdout: stdoutDrain.text,
			stderr: stderrDrain.text,
			timedOut,
			overflow,
			killed,
		};
	} finally {
		clearTimeout(timer);
	}
}
