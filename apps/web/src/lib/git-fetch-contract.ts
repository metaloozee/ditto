import {
	createBoundedByteCounter,
	decodePktLines,
	MAX_GIT_REQUEST_BODY_BYTES,
	MAX_PKT_LINES,
	type PktLine,
	PktLineError,
	pktLineText,
} from "#/lib/git-pkt-line";

export const GIT_FETCH_CONTRACT_VERSION = 1;
export const MAX_GIT_RESPONSE_BYTES = 1024 * 1024 * 1024;

export class GitFetchContractError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "GitFetchContractError";
		this.code = code;
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

const ALLOWED_V1_CAPABILITIES = new Set([
	"multi_ack",
	"multi_ack_detailed",
	"no-done",
	"thin-pack",
	"side-band",
	"side-band-64k",
	"ofs-delta",
	"agent",
	"object-format=sha1",
	"shallow",
	"deepen-since",
	"deepen-relative",
	"no-progress",
	"include-tag",
]);

const ALLOWED_V2_CAPABILITIES = new Set([
	"agent",
	"object-format=sha1",
	"thin-pack",
	"ofs-delta",
	"side-band-64k",
	"shallow",
	"deepen-relative",
	"include-tag",
	"wait-for-done",
]);

const SHA1_RE = /^[0-9a-f]{40}$/i;

export type GitFetchOperationBound = {
	repository: string;
	allowedRefs: string[];
	contractVersion: number;
};

export type MintGitHubInstallationToken = () => Promise<string>;

export type GitFetchContractResult =
	| {
			ok: true;
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

function parseGithubSmartHttpPath(
	pathname: string,
): { owner: string; repo: string; servicePath: string } | null {
	const match = pathname.match(
		/^\/([^/]+)\/([^/]+?)(\.git)?\/(info\/refs|git-upload-pack)\/?$/,
	);
	if (!match) {
		return null;
	}
	return {
		owner: match[1]!,
		repo: match[2]!,
		servicePath: match[4]!,
	};
}

/** Near-miss GitHub git paths: under a .git segment but not exact smart-HTTP. */
export function isGithubGitNearMissPath(pathname: string): boolean {
	if (parseGithubSmartHttpPath(pathname)) {
		return false;
	}
	return /^\/[^/]+\/[^/]+?\.git(\/|$)/i.test(pathname);
}

function assertAllowedHeaders(request: Request): void {
	for (const [name, value] of request.headers) {
		const lower = name.toLowerCase();
		if (FORBIDDEN_REQUEST_HEADERS.includes(lower)) {
			throw new GitFetchContractError(
				"forbidden_header",
				`Request header ${lower} is not allowed.`,
			);
		}
		if (lower.startsWith("proxy-") || lower.startsWith("x-forwarded-")) {
			throw new GitFetchContractError(
				"forbidden_header",
				`Request header ${lower} is not allowed.`,
			);
		}
		if (!ALLOWED_REQUEST_HEADERS.has(lower)) {
			throw new GitFetchContractError(
				"forbidden_header",
				`Request header ${lower} is not on the allowlist.`,
			);
		}
		if (lower === "git-protocol") {
			const normalized = value.trim().toLowerCase();
			if (normalized !== "version=2" && normalized !== "version=1") {
				throw new GitFetchContractError(
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
		throw new GitFetchContractError(
			"invalid_query",
			"info/refs query may only contain service=git-upload-pack.",
		);
	}
	if (url.searchParams.get("service") !== "git-upload-pack") {
		throw new GitFetchContractError(
			"invalid_query",
			"info/refs service must be git-upload-pack.",
		);
	}
}

function splitCapabilityList(raw: string): string[] {
	return raw
		.split(/[\s\0]+/)
		.map((part) => part.trim())
		.filter(Boolean);
}

function assertCapabilityAllowed(
	capability: string,
	allowed: Set<string>,
): void {
	const base = capability.includes("=")
		? capability.slice(0, capability.indexOf("=") + 1) === "agent="
			? "agent"
			: capability
		: capability;
	const normalized = capability.startsWith("agent=") ? "agent" : capability;
	if (capability.startsWith("agent=")) {
		if (!allowed.has("agent")) {
			throw new GitFetchContractError(
				"capability_denied",
				`Capability ${capability} is not allowed.`,
			);
		}
		return;
	}
	if (capability === "filter" || capability.startsWith("filter=")) {
		throw new GitFetchContractError(
			"capability_denied",
			"filter capability is not allowed.",
		);
	}
	if (
		capability === "deepen-not" ||
		capability.startsWith("deepen-not ") ||
		capability.startsWith("deepen-not=")
	) {
		throw new GitFetchContractError(
			"capability_denied",
			"deepen-not is not allowed.",
		);
	}
	if (capability === "object-format=sha256" || capability.includes("sha256")) {
		throw new GitFetchContractError(
			"capability_denied",
			"SHA-256 object format is not allowed.",
		);
	}
	if (!allowed.has(normalized) && !allowed.has(base)) {
		throw new GitFetchContractError(
			"capability_denied",
			`Capability ${capability} is not allowed.`,
		);
	}
}

function validateV1WantHaveBody(lines: PktLine[], allowedRefs: string[]): void {
	const allowed = new Set(allowedRefs);
	let sawWant = false;
	let sawDone = false;
	for (const line of lines) {
		if (line.kind === "flush") {
			continue;
		}
		if (line.kind !== "data") {
			throw new GitFetchContractError(
				"invalid_body",
				"Unexpected special pkt-line in protocol v1 body.",
			);
		}
		const text = pktLineText(line).replace(/\n$/, "");
		if (text.startsWith("want ")) {
			sawWant = true;
			const rest = text.slice("want ".length);
			const [oid, ...caps] = splitCapabilityList(rest);
			if (!oid || !SHA1_RE.test(oid)) {
				throw new GitFetchContractError(
					"invalid_oid",
					"want object id is invalid.",
				);
			}
			for (const capability of caps) {
				assertCapabilityAllowed(capability, ALLOWED_V1_CAPABILITIES);
			}
			continue;
		}
		if (text.startsWith("have ")) {
			const oid = text.slice("have ".length).trim();
			if (!SHA1_RE.test(oid)) {
				throw new GitFetchContractError(
					"invalid_oid",
					"have object id is invalid.",
				);
			}
			continue;
		}
		if (text === "done") {
			sawDone = true;
			continue;
		}
		if (text.startsWith("deepen ")) {
			continue;
		}
		if (text.startsWith("shallow ")) {
			const oid = text.slice("shallow ".length).trim();
			if (!SHA1_RE.test(oid)) {
				throw new GitFetchContractError(
					"invalid_oid",
					"shallow object id is invalid.",
				);
			}
			continue;
		}
		// Ref advertisement wants are OID-based; ref name wants are rejected.
		if (text.startsWith("want-ref ")) {
			const ref = text.slice("want-ref ".length).trim();
			if (!allowed.has(ref)) {
				throw new GitFetchContractError(
					"ref_denied",
					"Requested ref is not in allowedRefs.",
				);
			}
			sawWant = true;
			continue;
		}
		throw new GitFetchContractError(
			"invalid_body",
			`Unsupported protocol v1 command: ${text.slice(0, 64)}`,
		);
	}
	if (!sawWant) {
		throw new GitFetchContractError(
			"invalid_body",
			"Protocol v1 body must include at least one want.",
		);
	}
	if (!sawDone) {
		throw new GitFetchContractError(
			"invalid_body",
			"Protocol v1 body must end with done.",
		);
	}
	void allowed;
}

/** ref-prefix is allowed only when it equals or narrows an allowed ref. */
function isAllowedRefPrefix(prefix: string, allowedRefs: string[]): boolean {
	return allowedRefs.some(
		(ref) => prefix === ref || prefix.startsWith(`${ref}/`),
	);
}

function validateV2Body(lines: PktLine[], allowedRefs: string[]): void {
	const allowed = new Set(allowedRefs);
	let command: string | null = null;
	let inCommandArgs = false;
	let sawNarrowLsRefsPrefix = false;

	for (const line of lines) {
		if (line.kind === "delim") {
			inCommandArgs = true;
			continue;
		}
		if (line.kind === "flush" || line.kind === "response-end") {
			continue;
		}
		if (line.kind !== "data") {
			throw new GitFetchContractError(
				"invalid_body",
				"Unexpected special pkt-line in protocol v2 body.",
			);
		}
		const text = pktLineText(line).replace(/\n$/, "");
		if (!inCommandArgs) {
			if (text.startsWith("command=")) {
				command = text.slice("command=".length);
				if (command !== "ls-refs" && command !== "fetch") {
					throw new GitFetchContractError(
						"unknown_command",
						`Unsupported protocol v2 command: ${command}`,
					);
				}
				continue;
			}
			if (text.includes("=") || text.length > 0) {
				assertCapabilityAllowed(text, ALLOWED_V2_CAPABILITIES);
				continue;
			}
			continue;
		}

		if (command === "ls-refs") {
			if (text === "peel" || text === "symrefs" || text === "unborn") {
				continue;
			}
			if (text.startsWith("ref-prefix ")) {
				const prefix = text.slice("ref-prefix ".length);
				if (!isAllowedRefPrefix(prefix, allowedRefs)) {
					throw new GitFetchContractError(
						"ref_denied",
						"ls-refs ref-prefix is outside allowedRefs.",
					);
				}
				sawNarrowLsRefsPrefix = true;
				continue;
			}
			throw new GitFetchContractError(
				"invalid_body",
				`Unsupported ls-refs argument: ${text.slice(0, 64)}`,
			);
		}

		if (command === "fetch") {
			if (text.startsWith("want ")) {
				const oid = text.slice("want ".length).trim();
				if (!SHA1_RE.test(oid)) {
					throw new GitFetchContractError(
						"invalid_oid",
						"want object id is invalid.",
					);
				}
				continue;
			}
			if (text.startsWith("have ")) {
				const oid = text.slice("have ".length).trim();
				if (!SHA1_RE.test(oid)) {
					throw new GitFetchContractError(
						"invalid_oid",
						"have object id is invalid.",
					);
				}
				continue;
			}
			if (
				text === "done" ||
				text === "thin-pack" ||
				text === "ofs-delta" ||
				text === "no-progress" ||
				text === "include-tag" ||
				text === "wait-for-done" ||
				text.startsWith("deepen ") ||
				text.startsWith("deepen-since ") ||
				text.startsWith("shallow ")
			) {
				continue;
			}
			if (text.startsWith("want-ref ")) {
				const ref = text.slice("want-ref ".length).trim();
				if (!allowed.has(ref)) {
					throw new GitFetchContractError(
						"ref_denied",
						"Requested ref is not in allowedRefs.",
					);
				}
				continue;
			}
			if (text.startsWith("filter ") || text === "deepen-not") {
				throw new GitFetchContractError(
					"capability_denied",
					"filter/deepen-not are not allowed.",
				);
			}
			throw new GitFetchContractError(
				"invalid_body",
				`Unsupported fetch argument: ${text.slice(0, 64)}`,
			);
		}
	}

	if (!command) {
		throw new GitFetchContractError(
			"invalid_body",
			"Protocol v2 body must declare a command.",
		);
	}
	if (command === "ls-refs" && !sawNarrowLsRefsPrefix) {
		throw new GitFetchContractError(
			"ref_denied",
			"ls-refs must include a ref-prefix that narrows to an allowed ref.",
		);
	}
}

function validateUploadPackBody(
	lines: PktLine[],
	request: Request,
	allowedRefs: string[],
): void {
	const protocol = request.headers.get("git-protocol")?.trim().toLowerCase();
	const isV2 =
		protocol === "version=2" ||
		lines.some(
			(line) =>
				line.kind === "data" && pktLineText(line).startsWith("command="),
		);
	if (isV2) {
		validateV2Body(lines, allowedRefs);
		return;
	}
	validateV1WantHaveBody(lines, allowedRefs);
}

export function classifyGithubGitRequest(request: Request): {
	kind: "git_transport" | "git_transport_near_miss" | "other";
	host: string;
	pathname: string;
} {
	const url = new URL(request.url);
	const host = url.hostname.toLowerCase();
	const port = url.port || (url.protocol === "https:" ? "443" : "80");
	if (host === "github.com" && port === "443") {
		if (parseGithubSmartHttpPath(url.pathname)) {
			return { kind: "git_transport", host, pathname: url.pathname };
		}
		if (isGithubGitNearMissPath(url.pathname)) {
			return {
				kind: "git_transport_near_miss",
				host,
				pathname: url.pathname,
			};
		}
	}
	return { kind: "other", host, pathname: url.pathname };
}

/**
 * Validate a sandbox Git smart-HTTP request against operation bounds.
 * Does not mint tokens. On success, returns a sanitized upstream request plan.
 */
export async function validateGitFetchRequest(
	request: Request,
	bound: GitFetchOperationBound,
): Promise<GitFetchContractResult> {
	try {
		if (bound.contractVersion !== GIT_FETCH_CONTRACT_VERSION) {
			throw new GitFetchContractError(
				"contract_version",
				"Unsupported Git fetch contract version.",
			);
		}

		const url = new URL(request.url);
		if (url.protocol !== "https:") {
			throw new GitFetchContractError(
				"invalid_scheme",
				"Git fetch requires HTTPS.",
			);
		}
		if (url.username || url.password) {
			throw new GitFetchContractError(
				"embedded_credentials",
				"URL credentials are not allowed.",
			);
		}
		const host = url.hostname.toLowerCase();
		const port = url.port || "443";
		if (host !== "github.com" || port !== "443") {
			throw new GitFetchContractError(
				"invalid_host",
				"Git fetch is limited to github.com:443.",
			);
		}

		const parsed = parseGithubSmartHttpPath(url.pathname);
		if (!parsed) {
			throw new GitFetchContractError(
				"invalid_path",
				"Path is not an allowed Git smart-HTTP endpoint.",
			);
		}

		const requestRepo = normalizeRepoPath(`${parsed.owner}/${parsed.repo}`);
		const boundRepo = normalizeRepoPath(bound.repository);
		if (requestRepo !== boundRepo) {
			throw new GitFetchContractError(
				"repository_mismatch",
				"Request repository does not match the open operation.",
			);
		}

		assertAllowedHeaders(request);

		const method = request.method.toUpperCase();
		let body: ReadableStream<Uint8Array> | null = null;

		if (parsed.servicePath === "info/refs") {
			if (method !== "GET") {
				throw new GitFetchContractError(
					"invalid_method",
					"info/refs must use GET.",
				);
			}
			validateInfoRefsQuery(url);
		} else if (parsed.servicePath === "git-upload-pack") {
			if (method !== "POST") {
				throw new GitFetchContractError(
					"invalid_method",
					"git-upload-pack must use POST.",
				);
			}
			const contentType = request.headers.get("content-type")?.toLowerCase();
			if (contentType !== "application/x-git-upload-pack-request") {
				throw new GitFetchContractError(
					"invalid_content_type",
					"git-upload-pack Content-Type is invalid.",
				);
			}
			if (!request.body) {
				throw new GitFetchContractError(
					"invalid_body",
					"git-upload-pack body is required.",
				);
			}
			// Request bodies are capped at 1 MiB; validate pkt-lines before forward.
			const raw = new Uint8Array(await request.arrayBuffer());
			if (raw.byteLength > MAX_GIT_REQUEST_BODY_BYTES) {
				throw new GitFetchContractError(
					"body_too_large",
					"Git request body exceeds the contract limit.",
				);
			}
			const { lines, consumed } = decodePktLines(raw, {
				maxLines: MAX_PKT_LINES,
			});
			if (consumed !== raw.byteLength) {
				throw new PktLineError(
					"truncated",
					"Git request body ended mid pkt-line.",
				);
			}
			validateUploadPackBody(lines, request, bound.allowedRefs);
			body = new ReadableStream({
				start(controller) {
					controller.enqueue(raw);
					controller.close();
				},
			});
		} else {
			throw new GitFetchContractError(
				"invalid_path",
				"Path is not an allowed Git smart-HTTP endpoint.",
			);
		}

		const upstreamPath = `/${parsed.owner}/${parsed.repo}.git/${parsed.servicePath}`;
		const upstreamUrl = new URL(`https://github.com${upstreamPath}`);
		if (parsed.servicePath === "info/refs") {
			upstreamUrl.searchParams.set("service", "git-upload-pack");
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
			upstreamUrl,
			method,
			headers,
			body,
		};
	} catch (error) {
		if (
			error instanceof GitFetchContractError ||
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
			message: error instanceof Error ? error.message : "Git contract failed.",
		};
	}
}

/**
 * After contract validation, mint a token and build a fresh upstream Request.
 */
export async function buildAuthenticatedGitUpstreamRequest(options: {
	validated: Extract<GitFetchContractResult, { ok: true }>;
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

export function wrapGitUpstreamResponse(response: Response): Response {
	if (response.status >= 300 && response.status < 400) {
		throw new GitFetchContractError(
			"redirect_denied",
			"Upstream redirects are not followed.",
		);
	}
	if (!response.body) {
		return new Response(null, {
			status: response.status,
			statusText: response.statusText,
			headers: sanitizeResponseHeaders(response.headers),
		});
	}
	const bounded = response.body.pipeThrough(
		createBoundedByteCounter(MAX_GIT_RESPONSE_BYTES),
	);
	return new Response(bounded, {
		status: response.status,
		statusText: response.statusText,
		headers: sanitizeResponseHeaders(response.headers),
	});
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
