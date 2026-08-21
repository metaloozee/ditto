import { parseGithubSmartHttpPath } from "#/lib/git-fetch-contract";
import { PktLineError } from "#/lib/git-pkt-line";
import {
	collectStream,
	extractAdvertisedOldOid,
	GitReceivePackError,
	MAX_RECEIVE_PACK_ADVERTISEMENT_BYTES,
	MAX_RECEIVE_PACK_PREFIX_BYTES,
	MAX_REPORT_STATUS_BYTES,
	parseReceivePackCommands,
	parseReportStatus,
	reconstructReceivePackBody,
	splitReceivePackBody,
} from "#/lib/git-receive-pack";

export const GIT_PUSH_CONTRACT_VERSION = 1;

/**
 * GitHub unprotected branches accept force updates by default. Receive-pack
 * commands do not carry a trustworthy force flag, and proving ancestry needs
 * the pack. Product push stays closed until a crafted non-fast-forward
 * receive-pack is rejected before the branch SHA moves.
 */
export const GIT_PUSH_ENABLED = false;

export const GIT_PUSH_UNAVAILABLE_MESSAGE =
	"Pushing to GitHub is currently unavailable.";

export class GitPushContractError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "GitPushContractError";
		this.code = code;
	}
}

export class SessionGitPushUnavailableError extends Error {
	constructor(message = GIT_PUSH_UNAVAILABLE_MESSAGE) {
		super(message);
		this.name = "SessionGitPushUnavailableError";
	}
}

const ALLOWED_REQUEST_HEADERS = new Set([
	"accept",
	"content-type",
	"content-length",
	"git-protocol",
	"user-agent",
	"accept-encoding",
]);

const FORBIDDEN_REQUEST_HEADERS = [
	"authorization",
	"cookie",
	"proxy-authorization",
	"proxy-connection",
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-proto",
	"connection",
	"transfer-encoding",
	"te",
	"upgrade",
	"http2-settings",
];

export type GitPushContractState = {
	preflightHeadSha: string;
	advertisedOldOid?: string;
};

export type GitPushOperationBound = {
	repository: string;
	allowedRefs: string[];
	preflightHeadSha: string;
	advertisedOldOid: string | null;
	contractVersion: number;
};

export type MintGitHubInstallationToken = () => Promise<string>;

export type GitPushContractResult =
	| {
			ok: true;
			phase: "discovery" | "receive-pack";
			upstreamUrl: URL;
			method: string;
			headers: Headers;
			body: ReadableStream<Uint8Array> | null;
	  }
	| { ok: false; code: string; message: string };

function normalizeRepoPath(ownerRepo: string): string {
	const trimmed = ownerRepo.replace(/\.git$/i, "");
	return trimmed.toLowerCase();
}

function assertAllowedHeaders(request: Request): void {
	for (const [name, value] of request.headers) {
		const lower = name.toLowerCase();
		if (FORBIDDEN_REQUEST_HEADERS.includes(lower)) {
			throw new GitPushContractError(
				"forbidden_header",
				`Request header ${lower} is not allowed.`,
			);
		}
		if (lower.startsWith("proxy-") || lower.startsWith("x-forwarded-")) {
			throw new GitPushContractError(
				"forbidden_header",
				`Request header ${lower} is not allowed.`,
			);
		}
		if (!ALLOWED_REQUEST_HEADERS.has(lower)) {
			throw new GitPushContractError(
				"forbidden_header",
				`Request header ${lower} is not on the allowlist.`,
			);
		}
		if (lower === "git-protocol") {
			const normalized = value.trim().toLowerCase();
			if (normalized === "version=2") {
				throw new GitPushContractError(
					"protocol_downgrade",
					"Git push uses receive-pack protocol v1.",
				);
			}
			if (normalized !== "version=1") {
				throw new GitPushContractError(
					"protocol_version",
					"Unsupported Git-Protocol header.",
				);
			}
		}
	}
}

function validateInfoRefsQuery(url: URL): void {
	const keys = [...url.searchParams.keys()];
	if (keys.length !== 1 || keys[0] !== "service") {
		throw new GitPushContractError(
			"invalid_query",
			"info/refs query may only contain service=git-receive-pack.",
		);
	}
	if (url.searchParams.get("service") !== "git-receive-pack") {
		throw new GitPushContractError(
			"invalid_query",
			"info/refs service must be git-receive-pack.",
		);
	}
}

function assertSingleAllowedRef(allowedRefs: string[]): string {
	if (allowedRefs.length !== 1 || !allowedRefs[0]) {
		throw new GitPushContractError(
			"operation_incomplete",
			"Push operations must bind exactly one refs/heads/<branch> ref.",
		);
	}
	const ref = allowedRefs[0];
	if (!ref.startsWith("refs/heads/") || ref === "refs/heads/") {
		throw new GitPushContractError(
			"ref_denied",
			"Push allowedRefs must be exactly one refs/heads/<branch>.",
		);
	}
	return ref;
}

function toContractError(error: unknown): GitPushContractResult {
	if (
		error instanceof GitPushContractError ||
		error instanceof GitReceivePackError ||
		error instanceof PktLineError
	) {
		return {
			ok: false,
			code: error.code,
			message: error.message,
		};
	}
	return {
		ok: false,
		code: "contract_error",
		message:
			error instanceof Error ? error.message : "Git push contract failed.",
	};
}

export function isGitReceivePackRequest(request: Request): boolean {
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return false;
	}
	const parsed = parseGithubSmartHttpPath(url.pathname);
	if (!parsed) {
		return false;
	}
	if (parsed.servicePath === "git-receive-pack") {
		return true;
	}
	return (
		parsed.servicePath === "info/refs" &&
		url.searchParams.get("service") === "git-receive-pack"
	);
}

export function isGitUploadPackRequest(request: Request): boolean {
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return false;
	}
	const parsed = parseGithubSmartHttpPath(url.pathname);
	if (!parsed) {
		return false;
	}
	if (parsed.servicePath === "git-upload-pack") {
		return true;
	}
	return (
		parsed.servicePath === "info/refs" &&
		url.searchParams.get("service") === "git-upload-pack"
	);
}

export function parseGitPushContractState(
	raw: string | null,
): GitPushContractState | null {
	if (raw == null || raw.length === 0) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed == null || typeof parsed !== "object") {
			return null;
		}
		const record = parsed as Record<string, unknown>;
		if (typeof record.preflightHeadSha !== "string") {
			return null;
		}
		const advertisedOldOid = record.advertisedOldOid;
		if (advertisedOldOid != null && typeof advertisedOldOid !== "string") {
			return null;
		}
		return {
			preflightHeadSha: record.preflightHeadSha,
			advertisedOldOid:
				typeof advertisedOldOid === "string" ? advertisedOldOid : undefined,
		};
	} catch {
		return null;
	}
}

export function serializeGitPushContractState(
	state: GitPushContractState,
): string {
	const payload: GitPushContractState = {
		preflightHeadSha: state.preflightHeadSha,
	};
	if (state.advertisedOldOid != null) {
		payload.advertisedOldOid = state.advertisedOldOid;
	}
	return JSON.stringify(payload);
}

/**
 * Validate a sandbox Git receive-pack request against operation bounds.
 * Does not mint tokens. POST bodies are split into a bounded command prefix
 * and an unbuffered pack stream.
 */
export async function validateGitPushRequest(
	request: Request,
	bound: GitPushOperationBound,
): Promise<GitPushContractResult> {
	try {
		if (bound.contractVersion !== GIT_PUSH_CONTRACT_VERSION) {
			throw new GitPushContractError(
				"contract_version",
				"Unsupported Git push contract version.",
			);
		}

		const url = new URL(request.url);
		if (url.protocol !== "https:") {
			throw new GitPushContractError(
				"invalid_scheme",
				"Git push requires HTTPS.",
			);
		}
		if (url.username || url.password) {
			throw new GitPushContractError(
				"embedded_credentials",
				"URL credentials are not allowed.",
			);
		}
		const host = url.hostname.toLowerCase();
		const port = url.port || "443";
		if (host !== "github.com" || port !== "443") {
			throw new GitPushContractError(
				"invalid_host",
				"Git push is limited to github.com:443.",
			);
		}

		const parsed = parseGithubSmartHttpPath(url.pathname);
		if (!parsed) {
			throw new GitPushContractError(
				"invalid_path",
				"Path is not an allowed Git smart-HTTP endpoint.",
			);
		}
		if (parsed.servicePath === "git-upload-pack") {
			throw new GitPushContractError(
				"invalid_path",
				"Push operations cannot use git-upload-pack.",
			);
		}

		const requestRepo = normalizeRepoPath(`${parsed.owner}/${parsed.repo}`);
		const boundRepo = normalizeRepoPath(bound.repository);
		if (requestRepo !== boundRepo) {
			throw new GitPushContractError(
				"repository_mismatch",
				"Request repository does not match the open operation.",
			);
		}

		assertAllowedHeaders(request);
		const allowedRef = assertSingleAllowedRef(bound.allowedRefs);
		const method = request.method.toUpperCase();
		let body: ReadableStream<Uint8Array> | null = null;
		let phase: "discovery" | "receive-pack";

		if (parsed.servicePath === "info/refs") {
			if (method !== "GET") {
				throw new GitPushContractError(
					"invalid_method",
					"info/refs must use GET.",
				);
			}
			validateInfoRefsQuery(url);
			phase = "discovery";
		} else if (parsed.servicePath === "git-receive-pack") {
			if (method !== "POST") {
				throw new GitPushContractError(
					"invalid_method",
					"git-receive-pack must use POST.",
				);
			}
			const contentType = request.headers.get("content-type")?.toLowerCase();
			if (contentType !== "application/x-git-receive-pack-request") {
				throw new GitPushContractError(
					"invalid_content_type",
					"git-receive-pack Content-Type is invalid.",
				);
			}
			if (!request.body) {
				throw new GitPushContractError(
					"invalid_body",
					"git-receive-pack body is required.",
				);
			}
			if (!bound.advertisedOldOid) {
				throw new GitPushContractError(
					"discovery_required",
					"Receive-pack POST requires a recorded advertised old object id.",
				);
			}
			const split = await splitReceivePackBody(
				request.body,
				MAX_RECEIVE_PACK_PREFIX_BYTES,
			);
			parseReceivePackCommands(split.prefix, {
				allowedRef,
				newOid: bound.preflightHeadSha,
				oldOid: bound.advertisedOldOid,
			});
			body = reconstructReceivePackBody(split.prefix, split.pack);
			phase = "receive-pack";
		} else {
			throw new GitPushContractError(
				"invalid_path",
				"Path is not an allowed Git smart-HTTP endpoint.",
			);
		}

		const upstreamPath = `/${parsed.owner}/${parsed.repo}.git/${parsed.servicePath}`;
		const upstreamUrl = new URL(`https://github.com${upstreamPath}`);
		if (parsed.servicePath === "info/refs") {
			upstreamUrl.searchParams.set("service", "git-receive-pack");
		}

		const headers = new Headers();
		for (const name of ALLOWED_REQUEST_HEADERS) {
			const value = request.headers.get(name);
			if (value != null && name !== "authorization" && name !== "cookie") {
				headers.set(name, value);
			}
		}

		return {
			ok: true,
			phase,
			upstreamUrl,
			method,
			headers,
			body,
		};
	} catch (error) {
		return toContractError(error);
	}
}

export async function buildAuthenticatedGitPushUpstreamRequest(options: {
	validated: Extract<GitPushContractResult, { ok: true }>;
	mintToken: MintGitHubInstallationToken;
}): Promise<Request> {
	const token = await options.mintToken();
	const headers = new Headers(options.validated.headers);
	headers.set("Authorization", `token ${token}`);
	headers.delete("cookie");

	const init: RequestInit & { duplex?: "half" } = {
		method: options.validated.method,
		headers,
		redirect: "manual",
	};
	if (options.validated.body) {
		init.body = options.validated.body;
		init.duplex = "half";
	}
	return new Request(options.validated.upstreamUrl, init);
}

function bytesAsBody(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

function sanitizeResponseHeaders(source: Headers): Headers {
	const headers = new Headers();
	const allow = [
		"content-type",
		"cache-control",
		"expires",
		"pragma",
		"content-length",
	];
	for (const name of allow) {
		const value = source.get(name);
		if (value != null) {
			headers.set(name, value);
		}
	}
	return headers;
}

export async function readGitPushDiscoveryResponse(
	response: Response,
	allowedRef: string,
): Promise<{ oldOid: string; response: Response }> {
	if (response.status >= 300 && response.status < 400) {
		throw new GitPushContractError(
			"redirect_denied",
			"Upstream redirects are not followed.",
		);
	}
	const bytes = response.body
		? await collectStream(response.body, MAX_RECEIVE_PACK_ADVERTISEMENT_BYTES)
		: new Uint8Array(0);
	const oldOid = extractAdvertisedOldOid(bytes, allowedRef);
	return {
		oldOid,
		response: new Response(bytesAsBody(bytes), {
			status: response.status,
			statusText: response.statusText,
			headers: sanitizeResponseHeaders(response.headers),
		}),
	};
}

export async function wrapGitPushReceivePackResponse(
	response: Response,
	expectedRef: string,
): Promise<Response> {
	if (response.status >= 300 && response.status < 400) {
		throw new GitPushContractError(
			"redirect_denied",
			"Upstream redirects are not followed.",
		);
	}
	const bytes = response.body
		? await collectStream(response.body, MAX_REPORT_STATUS_BYTES)
		: new Uint8Array(0);
	if (response.ok) {
		parseReportStatus(bytes, expectedRef);
	}
	return new Response(bytesAsBody(bytes), {
		status: response.status,
		statusText: response.statusText,
		headers: sanitizeResponseHeaders(response.headers),
	});
}
