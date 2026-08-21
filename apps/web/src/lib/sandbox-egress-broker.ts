import { eq } from "drizzle-orm";
import { createDb } from "#/db";
import { projects } from "#/db/schema";
import {
	buildAuthenticatedGitUpstreamRequest,
	classifyGithubGitRequest,
	GIT_FETCH_CONTRACT_VERSION,
	validateGitFetchRequest,
	wrapGitUpstreamResponse,
} from "#/lib/git-fetch-contract";
import {
	getInstallationAccessToken,
	repositoryNameFromSlug,
} from "#/lib/github-app";
import {
	createSandboxAuthority,
	type ResolvedOutboundOperation,
	SandboxAuthorityError,
	type TrustedOutboundHandlerContext,
} from "#/lib/sandbox-authority";

export type OutboundHandlerRuntimeContext = {
	containerId: string;
	className: string;
	params: unknown;
};

export type SandboxEgressBrokerDeps = {
	fetch?: typeof fetch;
	createDb?: typeof createDb;
	createAuthority?: typeof createSandboxAuthority;
	mintInstallationToken?: typeof getInstallationAccessToken;
};

const OPENCODE_HOST_MARKERS = [
	"opencode.ai",
	"api.opencode.ai",
	"opencode.ditto.invalid",
];

const DITTO_SYNTHETIC_HOST_SUFFIXES = [
	".ditto.internal",
	".ditto.invalid",
	".ditto.local",
];

function deny(
	status: number,
	reasonCode: string,
	correlationId?: string,
): Response {
	const headers = new Headers({
		"content-type": "application/json",
		"x-ditto-deny-reason": reasonCode,
	});
	if (correlationId) {
		headers.set("x-ditto-correlation-id", correlationId);
	}
	return new Response(
		JSON.stringify({
			error: "denied",
			reasonCode,
			correlationId: correlationId ?? null,
		}),
		{ status, headers },
	);
}

function recordDenial(options: {
	reasonCode: string;
	correlationId?: string | null;
	family?: string | null;
}): void {
	console.info(
		JSON.stringify({
			type: "sandbox_egress_deny",
			reasonCode: options.reasonCode,
			correlationId: options.correlationId ?? null,
			family: options.family ?? null,
		}),
	);
}

function narrowTrustedParams(
	params: unknown,
): TrustedOutboundHandlerContext | null {
	if (params == null || typeof params !== "object") {
		return null;
	}
	const record = params as Record<string, unknown>;
	const identityId = record.identityId;
	const lifecycleGeneration = record.lifecycleGeneration;
	if (typeof identityId !== "string" || identityId.length === 0) {
		return null;
	}
	if (
		typeof lifecycleGeneration !== "number" ||
		!Number.isInteger(lifecycleGeneration) ||
		lifecycleGeneration < 1
	) {
		return null;
	}
	return {
		identityId,
		lifecycleGeneration,
		containerId: "",
	};
}

function isLiteralIpHostname(hostname: string): boolean {
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
		return true;
	}
	if (hostname.includes(":")) {
		return true;
	}
	if (/^0x/i.test(hostname) || /^\d+$/.test(hostname)) {
		return true;
	}
	return false;
}

function isPrivateOrSpecialHostname(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host === "metadata.google.internal" ||
		host.endsWith(".internal")
	) {
		return true;
	}
	if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
		return false;
	}
	const parts = host.split(".").map((part) => Number(part));
	if (parts.length !== 4 || parts.some((part) => part > 255)) {
		return true;
	}
	const [a, b] = parts as [number, number, number, number];
	if (a === 10 || a === 127 || a === 0 || a === 169 || a === 224 || a >= 240) {
		return true;
	}
	if (a === 169 && b === 254) {
		return true;
	}
	if (a === 172 && b >= 16 && b <= 31) {
		return true;
	}
	if (a === 192 && b === 168) {
		return true;
	}
	if (a === 100 && b >= 64 && b <= 127) {
		return true;
	}
	return false;
}

function isPrivilegedPlaceholderHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (OPENCODE_HOST_MARKERS.includes(host)) {
		return true;
	}
	return DITTO_SYNTHETIC_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function classifyOutbound(request: Request): {
	family:
		| "git_transport"
		| "model"
		| "ditto_action"
		| "public_internet"
		| "denied_privileged";
	reasonCode?: string;
} {
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return { family: "denied_privileged", reasonCode: "invalid_url" };
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { family: "denied_privileged", reasonCode: "non_http" };
	}

	const host = url.hostname.toLowerCase();
	if (isPrivilegedPlaceholderHost(host)) {
		return {
			family: "denied_privileged",
			reasonCode: "privileged_placeholder",
		};
	}

	const git = classifyGithubGitRequest(request);
	if (git.kind === "git_transport" || git.kind === "git_transport_near_miss") {
		return { family: "git_transport" };
	}

	return { family: "public_internet" };
}

function validatePublicInternetDestination(url: URL): string | null {
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return "non_http";
	}
	const expectedPort = url.protocol === "https:" ? "443" : "80";
	const port = url.port || expectedPort;
	if (port !== expectedPort) {
		return "invalid_port";
	}
	if (url.username || url.password) {
		return "embedded_credentials";
	}
	const host = url.hostname.toLowerCase();
	if (!host || host.includes(" ") || host.includes("%")) {
		return "ambiguous_host";
	}
	if (isLiteralIpHostname(host)) {
		return "literal_ip";
	}
	if (isPrivateOrSpecialHostname(host)) {
		return "private_destination";
	}
	if (isPrivilegedPlaceholderHost(host)) {
		return "privileged_placeholder";
	}
	return null;
}

async function handlePublicInternet(
	request: Request,
	fetchImpl: typeof fetch,
): Promise<Response> {
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		recordDenial({ reasonCode: "invalid_url" });
		return deny(400, "invalid_url");
	}
	const destinationError = validatePublicInternetDestination(url);
	if (destinationError) {
		recordDenial({ reasonCode: destinationError });
		return deny(403, destinationError);
	}

	const headers = new Headers();
	for (const [name, value] of request.headers) {
		const lower = name.toLowerCase();
		if (
			lower === "authorization" ||
			lower === "cookie" ||
			lower === "proxy-authorization" ||
			lower.startsWith("proxy-") ||
			lower.startsWith("x-forwarded-") ||
			lower === "forwarded"
		) {
			continue;
		}
		headers.set(name, value);
	}

	const init: RequestInit & { duplex?: "half" } = {
		method: request.method,
		headers,
		redirect: "manual",
	};
	if (request.body) {
		init.body = request.body;
		init.duplex = "half";
	}

	const upstream = await fetchImpl(new Request(url, init));
	if (upstream.status >= 300 && upstream.status < 400) {
		recordDenial({ reasonCode: "redirect_denied" });
		return deny(502, "redirect_denied");
	}
	return upstream;
}

async function handleGitTransport(options: {
	request: Request;
	env: Env;
	trusted: TrustedOutboundHandlerContext;
	fetchImpl: typeof fetch;
	deps: SandboxEgressBrokerDeps;
}): Promise<Response> {
	const dbFactory = options.deps.createDb ?? createDb;
	const authorityFactory =
		options.deps.createAuthority ?? createSandboxAuthority;
	const mintToken =
		options.deps.mintInstallationToken ?? getInstallationAccessToken;
	const db = dbFactory(options.env);
	const authority = authorityFactory(db);

	let resolved: ResolvedOutboundOperation;
	try {
		resolved = await authority.resolveOutboundRequest(
			options.trusted,
			"git_transport",
		);
	} catch (error) {
		const code =
			error instanceof SandboxAuthorityError ? error.code : "authority_denied";
		recordDenial({ reasonCode: code, family: "git_transport" });
		return deny(403, code);
	}

	const { operation, identity } = resolved;
	if (
		operation.contractVersion !== GIT_FETCH_CONTRACT_VERSION ||
		!operation.repository ||
		!operation.allowedRefs?.length
	) {
		recordDenial({
			reasonCode: "operation_incomplete",
			correlationId: operation.correlationId,
			family: "git_transport",
		});
		return deny(403, "operation_incomplete", operation.correlationId);
	}

	const validated = await validateGitFetchRequest(options.request, {
		repository: operation.repository,
		allowedRefs: operation.allowedRefs,
		contractVersion: operation.contractVersion,
	});
	if (!validated.ok) {
		recordDenial({
			reasonCode: validated.code,
			correlationId: operation.correlationId,
			family: "git_transport",
		});
		return deny(403, validated.code, operation.correlationId);
	}

	const [project] = await db
		.select({
			githubInstallationId: projects.githubInstallationId,
			githubRepo: projects.githubRepo,
		})
		.from(projects)
		.where(eq(projects.id, identity.projectId))
		.limit(1);
	if (
		!project?.githubInstallationId ||
		!project.githubRepo ||
		project.githubRepo !== operation.repository
	) {
		recordDenial({
			reasonCode: "project_binding_mismatch",
			correlationId: operation.correlationId,
			family: "git_transport",
		});
		return deny(403, "project_binding_mismatch", operation.correlationId);
	}

	const shortName = repositoryNameFromSlug(operation.repository);
	const installationId = project.githubInstallationId;
	let upstreamRequest: Request;
	try {
		upstreamRequest = await buildAuthenticatedGitUpstreamRequest({
			validated,
			mintToken: () =>
				mintToken(options.env, installationId, {
					repositories: shortName ? [shortName] : undefined,
				}),
		});
	} catch {
		recordDenial({
			reasonCode: "token_mint_failed",
			correlationId: operation.correlationId,
			family: "git_transport",
		});
		return deny(502, "token_mint_failed", operation.correlationId);
	}

	const upstream = await options.fetchImpl(upstreamRequest);
	try {
		return wrapGitUpstreamResponse(upstream);
	} catch (error) {
		const code =
			error instanceof Error && "code" in error
				? String((error as { code: string }).code)
				: "upstream_denied";
		recordDenial({
			reasonCode: code,
			correlationId: operation.correlationId,
			family: "git_transport",
		});
		return deny(502, code, operation.correlationId);
	}
}

/**
 * Sole outbound handler entry for sandbox HTTP(S) interception.
 */
export async function handleOutbound(
	request: Request,
	env: Env,
	ctx: OutboundHandlerRuntimeContext,
	deps: SandboxEgressBrokerDeps = {},
): Promise<Response> {
	const fetchImpl = deps.fetch ?? fetch;
	const narrowed = narrowTrustedParams(ctx.params);
	if (!narrowed) {
		recordDenial({ reasonCode: "invalid_handler_params" });
		return deny(403, "invalid_handler_params");
	}
	if (typeof ctx.containerId !== "string" || ctx.containerId.length === 0) {
		recordDenial({ reasonCode: "invalid_container_id" });
		return deny(403, "invalid_container_id");
	}
	const trusted: TrustedOutboundHandlerContext = {
		...narrowed,
		containerId: ctx.containerId,
	};

	const classification = classifyOutbound(request);
	if (classification.family === "denied_privileged") {
		recordDenial({
			reasonCode: classification.reasonCode ?? "privileged_denied",
			family: "denied_privileged",
		});
		return deny(403, classification.reasonCode ?? "privileged_denied");
	}

	if (classification.family === "git_transport") {
		return handleGitTransport({
			request,
			env,
			trusted,
			fetchImpl,
			deps,
		});
	}

	if (
		classification.family === "model" ||
		classification.family === "ditto_action"
	) {
		recordDenial({
			reasonCode: "privileged_unimplemented",
			family: classification.family,
		});
		return deny(403, "privileged_unimplemented");
	}

	return handlePublicInternet(request, fetchImpl);
}
