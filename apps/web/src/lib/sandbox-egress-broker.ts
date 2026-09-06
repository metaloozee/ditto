import { eq } from "drizzle-orm";
import { createDb } from "#/db";
import { projects, workspaceSessions } from "#/db/schema";
import type {
	dispatchAgentGitAction,
	resolveAgentGitContext,
} from "#/lib/agent-git-handler";
import {
	classifyDittoActionRequest,
	DITTO_ACTION_CONTRACT_VERSION,
	DITTO_ACTION_OPERATION_TYPE,
	DittoActionContractError,
	isDittoSyntheticHost,
	validateDittoActionRequest,
	wrapDittoActionError,
	wrapDittoActionResult,
} from "#/lib/ditto-action-contract";
import {
	buildAuthenticatedGitUpstreamRequest,
	classifyGithubGitRequest,
	GIT_FETCH_CONTRACT_VERSION,
	validateGitFetchRequest,
	wrapGitUpstreamResponse,
} from "#/lib/git-fetch-contract";
import {
	buildAuthenticatedGitPushUpstreamRequest,
	GIT_PUSH_CONTRACT_VERSION,
	GIT_PUSH_ENABLED,
	isGitReceivePackRequest,
	isGitUploadPackRequest,
	parseGitPushContractState,
	readGitPushDiscoveryResponse,
	serializeGitPushContractState,
	validateGitPushRequest,
	wrapGitPushReceivePackResponse,
} from "#/lib/git-push-contract";
import {
	getInstallationAccessToken,
	repositoryNameFromSlug,
} from "#/lib/github-app";
import {
	buildAuthenticatedOpenCodeUpstreamRequest,
	classifyOpenCodeRequest,
	OPENCODE_CONTRACT_VERSION,
	OPENCODE_OPERATION_TYPES,
	OpenCodeContractError,
	validateOpenCodeRequest,
	wrapOpenCodeUpstreamResponse,
} from "#/lib/open-code-contract";
import {
	createSandboxAuthority,
	type PrivilegedOperationHandle,
	type ResolvedOutboundOperation,
	type SandboxAuthority,
	SandboxAuthorityError,
	type SandboxIdentityHandle,
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
	resolveAgentGitContext?: typeof resolveAgentGitContext;
	dispatchAgentGitAction?: typeof dispatchAgentGitAction;
};

/**
 * workerd's `fetch` is a method. `const fetchImpl = fetch; fetchImpl(req)`
 * throws Illegal invocation. Call it on globalThis, or use an injected impl.
 */
export function resolveOutboundFetch(fetchImpl?: typeof fetch): typeof fetch {
	return fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
}

function agentGitHttpStatus(error: unknown): number | null {
	if (
		error instanceof Error &&
		error.name === "AgentGitHttpError" &&
		"status" in error &&
		typeof (error as { status: unknown }).status === "number"
	) {
		return (error as { status: number }).status;
	}
	return null;
}

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
	return isDittoSyntheticHost(hostname);
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

	const opencode = classifyOpenCodeRequest(request);
	if (opencode.kind === "model") {
		return { family: "model" };
	}
	if (opencode.kind === "model_near_miss") {
		return {
			family: "denied_privileged",
			reasonCode: "privileged_placeholder",
		};
	}

	const dittoAction = classifyDittoActionRequest(request);
	if (dittoAction.kind === "ditto_action") {
		return { family: "ditto_action" };
	}
	if (dittoAction.kind === "ditto_action_near_miss") {
		return {
			family: "denied_privileged",
			reasonCode: "privileged_placeholder",
		};
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

	const receivePack = isGitReceivePackRequest(options.request);
	const consume = !(
		receivePack && options.request.method.toUpperCase() === "GET"
	);

	let resolved: ResolvedOutboundOperation;
	try {
		resolved = await authority.resolveOutboundRequest(
			options.trusted,
			"git_transport",
			{ consume },
		);
	} catch (error) {
		const code =
			error instanceof SandboxAuthorityError ? error.code : "authority_denied";
		recordDenial({ reasonCode: code, family: "git_transport" });
		return deny(403, code);
	}

	const { operation, identity } = resolved;
	if (operation.type === "push" || receivePack) {
		if (!GIT_PUSH_ENABLED) {
			recordDenial({
				reasonCode: "push_disabled",
				correlationId: operation.correlationId,
				family: "git_transport",
			});
			try {
				await authority.closeOperation(operation.id, "push_disabled");
			} catch {
				// fail closed even if close races
			}
			return deny(403, "push_disabled", operation.correlationId);
		}
	}

	if (operation.type === "push") {
		return handleGitPushTransport({
			request: options.request,
			env: options.env,
			identity,
			operation,
			authority,
			db,
			fetchImpl: options.fetchImpl,
			mintToken,
		});
	}

	if (receivePack) {
		recordDenial({
			reasonCode: "receive_pack_denied",
			correlationId: operation.correlationId,
			family: "git_transport",
		});
		return deny(403, "receive_pack_denied", operation.correlationId);
	}

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

	let upstream: Response;
	try {
		upstream = await options.fetchImpl(upstreamRequest);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "GitHub fetch threw.";
		console.error(
			JSON.stringify({
				type: "sandbox_egress_exception",
				reasonCode: "upstream_fetch_failed",
				correlationId: operation.correlationId,
				family: "git_transport",
				message,
			}),
		);
		recordDenial({
			reasonCode: "upstream_fetch_failed",
			correlationId: operation.correlationId,
			family: "git_transport",
		});
		return deny(502, "upstream_fetch_failed", operation.correlationId);
	}
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

async function handleGitPushTransport(options: {
	request: Request;
	env: Env;
	identity: SandboxIdentityHandle;
	operation: PrivilegedOperationHandle;
	authority: SandboxAuthority;
	db: ReturnType<typeof createDb>;
	fetchImpl: typeof fetch;
	mintToken: typeof getInstallationAccessToken;
}): Promise<Response> {
	const { operation, identity, authority } = options;
	const closeAndDeny = async (status: number, code: string) => {
		recordDenial({
			reasonCode: code,
			correlationId: operation.correlationId,
			family: "git_transport",
		});
		try {
			await authority.closeOperation(operation.id, code);
		} catch {
			// already closed
		}
		return deny(status, code, operation.correlationId);
	};

	if (isGitUploadPackRequest(options.request)) {
		return closeAndDeny(403, "upload_pack_denied");
	}
	if (
		operation.contractVersion !== GIT_PUSH_CONTRACT_VERSION ||
		!operation.repository ||
		!operation.allowedRefs?.length
	) {
		return closeAndDeny(403, "operation_incomplete");
	}

	const contractState = parseGitPushContractState(operation.contractState);
	if (!contractState?.preflightHeadSha) {
		return closeAndDeny(403, "operation_incomplete");
	}

	const [project] = await options.db
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
		return closeAndDeny(403, "project_binding_mismatch");
	}

	const method = options.request.method.toUpperCase();
	const isDiscovery = method === "GET";
	if (isDiscovery && contractState.advertisedOldOid) {
		return closeAndDeny(403, "duplicate_discovery");
	}

	const validated = await validateGitPushRequest(options.request, {
		repository: operation.repository,
		allowedRefs: operation.allowedRefs,
		preflightHeadSha: contractState.preflightHeadSha,
		advertisedOldOid: contractState.advertisedOldOid ?? null,
		contractVersion: operation.contractVersion,
	});
	if (!validated.ok) {
		return closeAndDeny(403, validated.code);
	}

	const shortName = repositoryNameFromSlug(operation.repository);
	const installationId = project.githubInstallationId;
	let upstreamRequest: Request;
	try {
		upstreamRequest = await buildAuthenticatedGitPushUpstreamRequest({
			validated,
			mintToken: () =>
				options.mintToken(options.env, installationId, {
					repositories: shortName ? [shortName] : undefined,
				}),
		});
	} catch {
		return closeAndDeny(502, "token_mint_failed");
	}

	const allowedRef = operation.allowedRefs[0]!;
	try {
		const upstream = await options.fetchImpl(upstreamRequest);
		if (validated.phase === "discovery") {
			const discovered = await readGitPushDiscoveryResponse(
				upstream,
				allowedRef,
			);
			try {
				await authority.updateOperationContractState(
					operation.id,
					operation.contractState,
					serializeGitPushContractState({
						preflightHeadSha: contractState.preflightHeadSha,
						advertisedOldOid: discovered.oldOid,
					}),
				);
			} catch (error) {
				const code =
					error instanceof SandboxAuthorityError
						? error.code
						: "duplicate_discovery";
				return closeAndDeny(403, code);
			}
			return discovered.response;
		}

		const wrapped = await wrapGitPushReceivePackResponse(upstream, allowedRef);
		try {
			await authority.closeOperation(operation.id, "git_push_settled");
		} catch {
			// already closed
		}
		return wrapped;
	} catch (error) {
		const code =
			error instanceof Error && "code" in error
				? String((error as { code: string }).code)
				: "upstream_denied";
		return closeAndDeny(502, code);
	}
}

async function markSessionContractReview(
	db: ReturnType<typeof createDb>,
	workspaceSessionId: string,
): Promise<void> {
	await db
		.update(workspaceSessions)
		.set({
			runtimeFailureReasonCode: "opencode_contract_denial_limit",
		})
		.where(eq(workspaceSessions.id, workspaceSessionId));
}

async function handleOpenCodeModel(options: {
	request: Request;
	env: Env;
	trusted: TrustedOutboundHandlerContext;
	fetchImpl: typeof fetch;
	deps: SandboxEgressBrokerDeps;
}): Promise<Response> {
	const dbFactory = options.deps.createDb ?? createDb;
	const authorityFactory =
		options.deps.createAuthority ?? createSandboxAuthority;
	const db = dbFactory(options.env);
	const authority = authorityFactory(db);

	let resolved: ResolvedOutboundOperation;
	try {
		resolved = await authority.resolveOutboundRequest(options.trusted, "model");
	} catch (error) {
		const code =
			error instanceof SandboxAuthorityError ? error.code : "authority_denied";
		recordDenial({ reasonCode: code, family: "model" });
		return deny(403, code);
	}

	const { operation } = resolved;
	if (
		!(OPENCODE_OPERATION_TYPES as readonly string[]).includes(operation.type)
	) {
		recordDenial({
			reasonCode: "operation_type_mismatch",
			correlationId: operation.correlationId,
			family: "model",
		});
		return deny(403, "operation_type_mismatch", operation.correlationId);
	}
	if (operation.contractVersion !== OPENCODE_CONTRACT_VERSION) {
		recordDenial({
			reasonCode: "contract_version",
			correlationId: operation.correlationId,
			family: "model",
		});
		return deny(403, "contract_version", operation.correlationId);
	}

	const apiKey = options.env.OPENCODE_API_KEY?.trim() ?? "";
	if (!apiKey) {
		recordDenial({
			reasonCode: "missing_opencode_key",
			correlationId: operation.correlationId,
			family: "model",
		});
		return deny(403, "missing_opencode_key", operation.correlationId);
	}

	const validated = await validateOpenCodeRequest(options.request, {
		contractVersion: operation.contractVersion,
	});
	if (!validated.ok) {
		recordDenial({
			reasonCode: validated.code,
			correlationId: operation.correlationId,
			family: "model",
		});
		try {
			const denial = await authority.recordContractDenial(operation.id);
			if (denial.closed && denial.workspaceSessionId) {
				await markSessionContractReview(db, denial.workspaceSessionId);
			}
		} catch {
			// Denial persistence must not restore forwarding.
		}
		return deny(403, validated.code, operation.correlationId);
	}

	const upstreamRequest = buildAuthenticatedOpenCodeUpstreamRequest({
		validated,
		apiKey,
		signal: options.request.signal,
	});
	const upstream = await options.fetchImpl(upstreamRequest);
	try {
		return wrapOpenCodeUpstreamResponse(upstream);
	} catch (error) {
		const code =
			error instanceof OpenCodeContractError
				? error.code
				: error instanceof Error && "code" in error
					? String((error as { code: string }).code)
					: "upstream_denied";
		recordDenial({
			reasonCode: code,
			correlationId: operation.correlationId,
			family: "model",
		});
		return deny(502, code, operation.correlationId);
	}
}

async function handleDittoAction(options: {
	request: Request;
	env: Env;
	trusted: TrustedOutboundHandlerContext;
	deps: SandboxEgressBrokerDeps;
}): Promise<Response> {
	const dbFactory = options.deps.createDb ?? createDb;
	const authorityFactory =
		options.deps.createAuthority ?? createSandboxAuthority;
	let resolveGitContext = options.deps.resolveAgentGitContext;
	let dispatchGit = options.deps.dispatchAgentGitAction;
	if (!resolveGitContext || !dispatchGit) {
		const gitHandler = await import("#/lib/agent-git-handler");
		resolveGitContext = resolveGitContext ?? gitHandler.resolveAgentGitContext;
		dispatchGit = dispatchGit ?? gitHandler.dispatchAgentGitAction;
	}
	if (!resolveGitContext || !dispatchGit) {
		recordDenial({
			reasonCode: "git_action_denied",
			family: "ditto_action",
		});
		return deny(403, "git_action_denied");
	}
	const db = dbFactory(options.env);
	const authority = authorityFactory(db);

	let resolved: ResolvedOutboundOperation;
	try {
		resolved = await authority.resolveOutboundRequest(
			options.trusted,
			"ditto_action",
		);
	} catch (error) {
		const code =
			error instanceof SandboxAuthorityError ? error.code : "authority_denied";
		recordDenial({ reasonCode: code, family: "ditto_action" });
		return deny(403, code);
	}

	const { operation, identity } = resolved;
	if (operation.type !== DITTO_ACTION_OPERATION_TYPE) {
		recordDenial({
			reasonCode: "operation_type_mismatch",
			correlationId: operation.correlationId,
			family: "ditto_action",
		});
		return deny(403, "operation_type_mismatch", operation.correlationId);
	}
	if (operation.contractVersion !== DITTO_ACTION_CONTRACT_VERSION) {
		recordDenial({
			reasonCode: "contract_version",
			correlationId: operation.correlationId,
			family: "ditto_action",
		});
		return deny(403, "contract_version", operation.correlationId);
	}
	if (!identity.workspaceSessionId) {
		recordDenial({
			reasonCode: "identity_binding_mismatch",
			correlationId: operation.correlationId,
			family: "ditto_action",
		});
		return deny(403, "identity_binding_mismatch", operation.correlationId);
	}

	const validated = await validateDittoActionRequest(options.request, {
		contractVersion: operation.contractVersion,
	});
	if (!validated.ok) {
		recordDenial({
			reasonCode: validated.code,
			correlationId: operation.correlationId,
			family: "ditto_action",
		});
		return deny(403, validated.code, operation.correlationId);
	}

	let gitContext: Awaited<ReturnType<typeof resolveAgentGitContext>>;
	try {
		gitContext = await resolveGitContext({
			db,
			env: options.env,
			identity: {
				userId: identity.userId,
				projectId: identity.projectId,
				workspaceSessionId: identity.workspaceSessionId,
				sandboxId: identity.sandboxId,
			},
		});
	} catch {
		recordDenial({
			reasonCode: "git_action_denied",
			correlationId: operation.correlationId,
			family: "ditto_action",
		});
		return deny(403, "git_action_denied", operation.correlationId);
	}

	try {
		const result = await dispatchGit({
			env: options.env,
			resolved: gitContext,
			body: validated.body,
			allowedRefs: operation.allowedRefs,
		});
		return wrapDittoActionResult(result, gitContext.knownSecrets);
	} catch (error) {
		const gitStatus = agentGitHttpStatus(error);
		if (gitStatus != null) {
			recordDenial({
				reasonCode: "git_action_denied",
				correlationId: operation.correlationId,
				family: "ditto_action",
			});
			return wrapDittoActionError(gitStatus, gitContext.knownSecrets);
		}
		if (error instanceof DittoActionContractError) {
			recordDenial({
				reasonCode: error.code,
				correlationId: operation.correlationId,
				family: "ditto_action",
			});
			return deny(403, error.code, operation.correlationId);
		}
		recordDenial({
			reasonCode: "git_action_failed",
			correlationId: operation.correlationId,
			family: "ditto_action",
		});
		return deny(502, "git_action_failed", operation.correlationId);
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
	const fetchImpl = resolveOutboundFetch(deps.fetch);
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

	try {
		if (classification.family === "git_transport") {
			return await handleGitTransport({
				request,
				env,
				trusted,
				fetchImpl,
				deps,
			});
		}

		if (classification.family === "model") {
			return await handleOpenCodeModel({
				request,
				env,
				trusted,
				fetchImpl,
				deps,
			});
		}

		if (classification.family === "ditto_action") {
			return await handleDittoAction({
				request,
				env,
				trusted,
				deps,
			});
		}

		return await handlePublicInternet(request, fetchImpl);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "outbound handler threw";
		console.error(
			JSON.stringify({
				type: "sandbox_egress_exception",
				reasonCode: "handler_exception",
				family: classification.family,
				message,
			}),
		);
		recordDenial({
			reasonCode: "handler_exception",
			family: classification.family,
		});
		return deny(502, "handler_exception");
	}
}
