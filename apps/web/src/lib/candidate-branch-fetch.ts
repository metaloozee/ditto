import {
	buildAuthenticatedGitUpstreamRequest,
	GIT_FETCH_CONTRACT_VERSION,
	validateGitFetchRequest,
	wrapGitUpstreamResponse,
} from "./git-fetch-contract";
import {
	type CandidateAuthorityRow,
	prepareCandidateRuntimeAuthority,
	validateCandidateRuntimeAuthority,
} from "./session-command-candidate";

const FETCH_TYPE = "candidate_branch_fetch";
const MAX_REQUESTS = 16;
const WINDOW_SECONDS = 5 * 60;
const REPOSITORY_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type CandidateFetchScope = {
	userId: string;
	projectId: string;
	workspaceSessionId: string;
	ownerVersion: number;
};

export type CandidateBranchFetchDeps = {
	db: D1Database;
	now: () => number;
	github: {
		branchExists(repository: string, branch: string): Promise<boolean>;
		defaultBranch(repository: string): Promise<string>;
	};
	/** The token never leaves this module except in the upstream request. */
	mintToken(repository: string): Promise<string>;
	fetch(request: Request): Promise<Response>;
};

export type OpenCandidateBranchFetchResult =
	| { window: string; ref: string; repository: string }
	| { denied: string };

/** Mirrors `rejectInvalidBranchShape` in privileged-git.ts; keep the two in step. */
function branchShapeError(branch: string): string | undefined {
	if (!branch) return "invalid_branch";
	if (
		branch.includes("\0") ||
		branch.includes("\n") ||
		branch.includes("\r") ||
		branch !== branch.trim() ||
		branch.startsWith("-") ||
		branch.startsWith("refs/")
	)
		return "invalid_branch";
	return undefined;
}

type WindowRow = {
	id: string;
	lifecycleGeneration: number;
	incarnationId: string | null;
	runtimeOwnerVersion: number;
	repository: string | null;
	allowedRefs: string | null;
	maxRequests: number | null;
	consumedRequests: number;
	contractState: string | null;
	expiresAt: number;
	closedAt: number | null;
	contractVersion: number;
};

async function currentAuthority(
	db: D1Database,
	scope: CandidateFetchScope,
): Promise<CandidateAuthorityRow | null> {
	if (scope.ownerVersion !== 1) return null;
	const row = await prepareCandidateRuntimeAuthority(
		db,
		scope.userId,
		scope.projectId,
		scope.workspaceSessionId,
	).first<CandidateAuthorityRow>();
	return validateCandidateRuntimeAuthority(row).current ? row : null;
}

function denied(code: string, status = 403): Response {
	return new Response("denied", {
		status,
		headers: { "x-ditto-denial": code, "content-type": "text/plain" },
	});
}

export async function openCandidateBranchFetch(
	deps: CandidateBranchFetchDeps,
	scope: CandidateFetchScope,
	request: { operation: string; branch: string },
): Promise<OpenCandidateBranchFetchResult> {
	try {
		const shape = branchShapeError(request.branch);
		if (shape) return { denied: shape };
		const authority = await currentAuthority(deps.db, scope);
		if (!authority) return { denied: "authority_denied" };
		const project = await deps.db
			.prepare("SELECT githubRepo FROM projects WHERE id=? AND userId=?")
			.bind(scope.projectId, scope.userId)
			.first<{ githubRepo: string | null }>();
		const repository = project?.githubRepo;
		if (!repository || !REPOSITORY_SLUG.test(repository))
			return { denied: "repository_unavailable" };
		const branch = (await deps.github.branchExists(repository, request.branch))
			? request.branch
			: await deps.github.defaultBranch(repository);
		if (branchShapeError(branch)) return { denied: "invalid_branch" };
		const ref = `refs/heads/${branch}`;
		const nowSeconds = Math.floor(deps.now() / 1000);
		// An abandoned window must not block the identity forever.
		await deps.db
			.prepare(
				"UPDATE privileged_operations SET closedAt=?,closeReason='expired',openSlot=id WHERE identityId=? AND family='git_transport' AND type=? AND openSlot='open' AND expiresAt<=?",
			)
			.bind(nowSeconds, authority.identityId, FETCH_TYPE, nowSeconds)
			.run();
		const id = crypto.randomUUID();
		try {
			await deps.db
				.prepare(
					`INSERT INTO privileged_operations(id,identityId,lifecycleGeneration,family,type,contractVersion,runtimeOwnerVersion,incarnationId,repository,allowedRefs,maxRequests,consumedRequests,openedAt,expiresAt,correlationId,openSlot)
VALUES(?,?,?,'git_transport',?,?,?,?,?,?,?,0,?,?,?,'open')`,
				)
				.bind(
					id,
					authority.identityId,
					authority.lifecycleGeneration,
					FETCH_TYPE,
					GIT_FETCH_CONTRACT_VERSION,
					scope.ownerVersion,
					authority.incarnationId,
					repository,
					JSON.stringify([ref]),
					MAX_REQUESTS,
					nowSeconds,
					nowSeconds + WINDOW_SECONDS,
					crypto.randomUUID(),
				)
				.run();
		} catch {
			return { denied: "busy" };
		}
		return { window: id, ref, repository };
	} catch {
		return { denied: "open_failed" };
	}
}

export async function brokerCandidateGit(
	deps: CandidateBranchFetchDeps,
	scope: CandidateFetchScope,
	request: Request,
	containerId: string,
): Promise<Response> {
	try {
		const authority = await currentAuthority(deps.db, scope);
		if (!authority) return denied("authority_denied");
		const nowSeconds = Math.floor(deps.now() / 1000);
		const row = await deps.db
			.prepare(
				"SELECT id,lifecycleGeneration,incarnationId,runtimeOwnerVersion,repository,allowedRefs,maxRequests,consumedRequests,contractState,expiresAt,closedAt,contractVersion FROM privileged_operations WHERE identityId=? AND family='git_transport' AND type=? AND openSlot='open'",
			)
			.bind(authority.identityId, FETCH_TYPE)
			.first<WindowRow>();
		if (!row || row.closedAt !== null) return denied("no_window");
		if (
			row.lifecycleGeneration !== authority.lifecycleGeneration ||
			row.incarnationId !== authority.incarnationId ||
			row.runtimeOwnerVersion !== scope.ownerVersion ||
			!row.repository
		)
			return denied("window_mismatch");
		// Drizzle stores timestamps in seconds.
		if (row.expiresAt <= nowSeconds) return denied("window_expired");
		if (row.consumedRequests >= (row.maxRequests ?? 0))
			return denied("budget_exhausted");
		let boundContainer: unknown;
		try {
			boundContainer = row.contractState
				? (JSON.parse(row.contractState) as { containerId?: unknown })
						.containerId
				: undefined;
		} catch {
			return denied("window_mismatch");
		}
		if (boundContainer !== undefined && boundContainer !== containerId)
			return denied("container_mismatch");
		let allowedRefs: string[];
		try {
			const parsed: unknown = JSON.parse(row.allowedRefs ?? "[]");
			if (
				!Array.isArray(parsed) ||
				!parsed.every((ref) => typeof ref === "string")
			)
				return denied("window_mismatch");
			allowedRefs = parsed;
		} catch {
			return denied("window_mismatch");
		}
		const validated = await validateGitFetchRequest(request, {
			repository: row.repository,
			allowedRefs,
			contractVersion: row.contractVersion,
		});
		if (!validated.ok) return denied(validated.code);
		// The conditional update is the single point that spends budget and binds
		// the container, so concurrent requests cannot overspend or rebind.
		const claim = await deps.db
			.prepare(
				"UPDATE privileged_operations SET consumedRequests=consumedRequests+1,contractState=? WHERE id=? AND openSlot='open' AND closedAt IS NULL AND expiresAt>? AND consumedRequests<maxRequests AND (contractState IS NULL OR json_extract(contractState,'$.containerId')=?)",
			)
			.bind(JSON.stringify({ containerId }), row.id, nowSeconds, containerId)
			.run();
		if (!claim.meta.changes) return denied("window_unavailable");
		const repository = row.repository;
		const upstream = await buildAuthenticatedGitUpstreamRequest({
			validated,
			mintToken: () => deps.mintToken(repository),
		});
		const response = await deps.fetch(upstream);
		return wrapGitUpstreamResponse(response);
	} catch {
		return denied("upstream_failed");
	}
}

export async function closeCandidateBranchFetch(
	deps: Pick<CandidateBranchFetchDeps, "db" | "now">,
	scope: CandidateFetchScope,
	window: string,
): Promise<void> {
	const authority = await deps.db
		.prepare(
			"SELECT i.id AS identityId FROM sandbox_identities i WHERE i.workspaceSessionId=? AND i.userId=? AND i.projectId=? AND i.kind='workspace_session'",
		)
		.bind(scope.workspaceSessionId, scope.userId, scope.projectId)
		.first<{ identityId: string }>();
	if (!authority) return;
	await deps.db
		.prepare(
			"UPDATE privileged_operations SET closedAt=?,closeReason='closed',openSlot=id WHERE id=? AND identityId=? AND family='git_transport' AND type=? AND closedAt IS NULL",
		)
		.bind(
			Math.floor(deps.now() / 1000),
			window,
			authority.identityId,
			FETCH_TYPE,
		)
		.run();
}
