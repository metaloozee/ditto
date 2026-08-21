import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	privilegedOperations,
	projectSeeds,
	projects,
	sandboxIdentities,
	workspaceSessions,
} from "#/db/schema";
import {
	createSandboxAuthority,
	SandboxAuthorityError,
} from "#/lib/sandbox-authority";
import { SESSION_WORKTREE_ROOT, WORKSPACE_PATH } from "#/lib/workspace-policy";

const getInstallationOctokitMock = vi.hoisted(() => vi.fn());
const getProjectSandboxMock = vi.hoisted(() => vi.fn());
const configureDittoGitIdentityMock = vi.hoisted(() => vi.fn());
const fetchGitHubBranchBrokeredMock = vi.hoisted(() => vi.fn());
const restoreArchiveMock = vi.hoisted(() => vi.fn());
const decryptEnvVarsMock = vi.hoisted(() => vi.fn());
const checkProjectSandboxMock = vi.hoisted(() => vi.fn());
const ensureSessionWorkspaceReadyMock = vi.hoisted(() => vi.fn());
const prepareSessionWorkspaceIfPresentMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/github-app", () => ({
	getGitHubApp: () => ({
		getInstallationOctokit: getInstallationOctokitMock,
	}),
}));

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
	configureDittoGitIdentity: configureDittoGitIdentityMock,
}));

vi.mock("#/lib/privileged-git", () => ({
	fetchGitHubBranchBrokered: fetchGitHubBranchBrokeredMock,
}));

vi.mock("#/lib/sandbox-archive", () => ({
	restoreArchive: restoreArchiveMock,
	ARCHIVE_FORMAT_VERSION: 1,
	ARCHIVE_COMPATIBILITY_KEY: "ditto-workspace-archive-v1",
}));

vi.mock("#/lib/project-env-vars", () => ({
	decryptEnvVars: decryptEnvVarsMock,
}));

vi.mock("#/lib/project-sandbox", () => ({
	checkProjectSandbox: checkProjectSandboxMock,
}));

vi.mock("#/lib/session-worktree", () => ({
	ensureSessionWorkspaceReady: ensureSessionWorkspaceReadyMock,
	prepareSessionWorkspaceIfPresent: prepareSessionWorkspaceIfPresentMock,
}));

vi.mock("#/lib/session-workspace-lock", () => ({
	withSessionWorkspaceLock: vi.fn(
		async ({ run }: { run: () => Promise<unknown> }) => await run(),
	),
}));

const {
	observeWorkspaceRuntime,
	withWorkspaceRuntimeLease,
	WORKSPACE_SESSION_FETCH_OPERATION_TYPE,
} = await import("./workspace-runtime");

type ProjectRow = typeof projects.$inferSelect;
type SessionRow = typeof workspaceSessions.$inferSelect;
type SeedRow = typeof projectSeeds.$inferSelect;
type IdentityRow = typeof sandboxIdentities.$inferSelect;
type OperationRow = typeof privilegedOperations.$inferSelect;

const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function collectParams(node: unknown): unknown[] {
	const params: unknown[] = [];
	const seen = new Set<unknown>();
	const walk = (value: unknown) => {
		if (value == null || typeof value !== "object") {
			return;
		}
		if (seen.has(value)) {
			return;
		}
		seen.add(value);
		const obj = value as {
			queryChunks?: unknown[];
			value?: unknown;
			table?: unknown;
			name?: unknown;
			columnType?: unknown;
		};
		if ("table" in obj && "name" in obj && "columnType" in obj) {
			return;
		}
		if (Array.isArray(obj.queryChunks)) {
			for (const chunk of obj.queryChunks) {
				walk(chunk);
			}
			return;
		}
		if ("value" in obj) {
			params.push(obj.value);
			if (Array.isArray(obj.value)) {
				for (const part of obj.value) {
					walk(part);
				}
			}
		}
	};
	walk(node);
	return params.flatMap((value) => (Array.isArray(value) ? value : [value]));
}

function makeStore() {
	const projectRows = new Map<string, ProjectRow>();
	const sessionRows = new Map<string, SessionRow>();
	const seedRows = new Map<string, SeedRow>();
	const identityRows = new Map<string, IdentityRow>();
	const operationRows = new Map<string, OperationRow>();
	const eventOrder: string[] = [];

	function findSession(where: unknown): SessionRow | undefined {
		const params = collectParams(where);
		for (const value of params) {
			if (typeof value === "string" && sessionRows.has(value)) {
				return sessionRows.get(value);
			}
		}
		return [...sessionRows.values()][0];
	}

	function findIdentity(where: unknown): IdentityRow | undefined {
		const params = collectParams(where).filter(
			(value): value is string => typeof value === "string",
		);
		for (const id of params) {
			const row = identityRows.get(id);
			if (row) return row;
		}
		return undefined;
	}

	function findOperations(where: unknown): OperationRow[] {
		const params = collectParams(where);
		const strings = params.filter(
			(value): value is string => typeof value === "string",
		);
		return [...operationRows.values()].filter((row) => {
			if (strings.includes(row.id)) {
				return true;
			}
			const identityMatch = strings.includes(row.identityId);
			const familyMatch = strings.includes(row.family);
			if (identityMatch && familyMatch) {
				return row.closedAt == null;
			}
			if (identityMatch && !familyMatch) {
				return row.closedAt == null;
			}
			return false;
		});
	}

	const db = {
		insert(table: unknown) {
			return {
				values(value: Record<string, unknown>) {
					const exec = async () => {
						if (
							table === sandboxIdentities ||
							("containerId" in value && "kind" in value)
						) {
							const row: IdentityRow = {
								id: String(value.id),
								kind: value.kind as IdentityRow["kind"],
								sandboxId: String(value.sandboxId),
								containerId: String(value.containerId),
								userId: String(value.userId),
								projectId: String(value.projectId),
								workspaceSessionId:
									(value.workspaceSessionId as string | null) ?? null,
								lifecycleGeneration: Number(value.lifecycleGeneration ?? 1),
								state: value.state as IdentityRow["state"],
								retiredAt: null,
								createdAt: new Date(),
								updatedAt: new Date(),
							};
							identityRows.set(row.id, row);
							return [row];
						}
						if (
							table === privilegedOperations ||
							("correlationId" in value && "family" in value)
						) {
							const row: OperationRow = {
								id: String(value.id),
								identityId: String(value.identityId),
								lifecycleGeneration: Number(value.lifecycleGeneration),
								family: value.family as OperationRow["family"],
								type: String(value.type),
								contractVersion: Number(value.contractVersion),
								repository: (value.repository as string | null) ?? null,
								allowedRefs: (value.allowedRefs as string | null) ?? null,
								maxRequests: (value.maxRequests as number | null) ?? null,
								consumedRequests: Number(value.consumedRequests ?? 0),
								openedAt: value.openedAt as Date,
								expiresAt: value.expiresAt as Date,
								closedAt: null,
								closeReason: null,
								correlationId: String(value.correlationId),
								openSlot: String(value.openSlot ?? "open"),
								createdAt: new Date(),
								updatedAt: new Date(),
							};
							operationRows.set(row.id, row);
							return [row];
						}
						return [];
					};
					return {
						returning: exec,
						// biome-ignore lint/suspicious/noThenProperty: drizzle thenable mock
						then(
							resolve: (value: unknown) => unknown,
							reject?: (error: unknown) => unknown,
						) {
							return exec().then(resolve, reject);
						},
					};
				},
			};
		},
		select() {
			return {
				from(table: unknown) {
					return {
						where(where: unknown) {
							const rows = (() => {
								if (table === workspaceSessions) {
									const row = findSession(where);
									return row ? [row] : [];
								}
								if (table === projects) {
									return [...projectRows.values()];
								}
								if (table === projectSeeds) {
									return [...seedRows.values()];
								}
								if (table === sandboxIdentities) {
									const row = findIdentity(where);
									return row ? [row] : [];
								}
								if (table === privilegedOperations) {
									return findOperations(where);
								}
								return [];
							})();
							return {
								async limit(n: number) {
									return rows.slice(0, n);
								},
								// biome-ignore lint/suspicious/noThenProperty: drizzle thenable mock
								then(
									resolve: (value: unknown) => unknown,
									reject?: (error: unknown) => unknown,
								) {
									return Promise.resolve(rows).then(resolve, reject);
								},
							};
						},
					};
				},
			};
		},
		update(table: unknown) {
			return {
				set(patch: Record<string, unknown>) {
					return {
						where(where: unknown) {
							const exec = async () => {
								if (table === workspaceSessions) {
									const row = findSession(where);
									if (!row) return [];
									if (
										"runtimeLeaseId" in patch &&
										patch.runtimeLeaseId != null &&
										row.runtimeLeaseId &&
										row.runtimeLeaseExpiresAt &&
										row.runtimeLeaseExpiresAt.getTime() > Date.now()
									) {
										return [];
									}
									const next: SessionRow = {
										...row,
										sandboxIdentityId:
											"sandboxIdentityId" in patch
												? (patch.sandboxIdentityId as string | null)
												: row.sandboxIdentityId,
										runtimeLeaseId:
											"runtimeLeaseId" in patch
												? (patch.runtimeLeaseId as string | null)
												: row.runtimeLeaseId,
										runtimeLeaseExpiresAt:
											"runtimeLeaseExpiresAt" in patch
												? (patch.runtimeLeaseExpiresAt as Date | null)
												: row.runtimeLeaseExpiresAt,
										runtimeFailureReasonCode:
											"runtimeFailureReasonCode" in patch
												? (patch.runtimeFailureReasonCode as string | null)
												: row.runtimeFailureReasonCode,
										branchName:
											"branchName" in patch
												? (patch.branchName as string | null)
												: row.branchName,
										baseCommitSha:
											"baseCommitSha" in patch
												? (patch.baseCommitSha as string | null)
												: row.baseCommitSha,
										workspacePath:
											typeof patch.workspacePath === "string"
												? patch.workspacePath
												: row.workspacePath,
										updatedAt: new Date(),
									};
									sessionRows.set(row.id, next);
									return [next];
								}
								if (table === sandboxIdentities) {
									const row = findIdentity(where);
									if (!row) return [];
									const next: IdentityRow = {
										...row,
										lifecycleGeneration:
											"lifecycleGeneration" in patch
												? Number(patch.lifecycleGeneration)
												: row.lifecycleGeneration,
										state:
											"state" in patch
												? (patch.state as IdentityRow["state"])
												: row.state,
										retiredAt:
											"retiredAt" in patch
												? patch.retiredAt == null
													? null
													: new Date()
												: row.retiredAt,
										updatedAt: new Date(),
									};
									identityRows.set(row.id, next);
									return [next];
								}
								if (table === privilegedOperations) {
									const candidates = findOperations(where);
									const row =
										candidates.find((item) => item.closedAt == null) ??
										candidates[0];
									if (!row) return [];
									const next: OperationRow = {
										...row,
										closedAt:
											"closedAt" in patch
												? patch.closedAt == null
													? null
													: new Date()
												: row.closedAt,
										closeReason:
											"closeReason" in patch
												? (patch.closeReason as string | null)
												: row.closeReason,
										openSlot:
											"openSlot" in patch
												? String(patch.openSlot)
												: row.openSlot,
										updatedAt: new Date(),
									};
									operationRows.set(row.id, next);
									return [next];
								}
								return [];
							};
							return {
								returning: exec,
								// biome-ignore lint/suspicious/noThenProperty: drizzle thenable mock
								then(
									resolve: (value: unknown) => unknown,
									reject?: (error: unknown) => unknown,
								) {
									return exec().then(resolve, reject);
								},
							};
						},
					};
				},
			};
		},
	};

	return {
		db: db as never,
		projectRows,
		sessionRows,
		seedRows,
		identityRows,
		operationRows,
		eventOrder,
	};
}

function seedProject(
	store: ReturnType<typeof makeStore>,
	overrides: Partial<ProjectRow> = {},
): ProjectRow {
	const row: ProjectRow = {
		id: "proj-1",
		name: "App",
		description: null,
		userId: "user-1",
		githubRepo: "acme/app",
		githubInstallationId: 7,
		sandboxId: null,
		sandboxBackup: null,
		sandboxBackupCreatedAt: null,
		sandboxBackupRequestedGeneration: 0,
		sandboxBackupStoredGeneration: 0,
		status: "ready",
		envVars: "cipher",
		previewLockToken: null,
		previewLockExpiresAt: null,
		deletingAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
	store.projectRows.set(row.id, row);
	store.seedRows.set("seed-1", {
		id: "seed-1",
		projectId: row.id,
		sourceCommit: HEAD_SHA,
		archiveId: "archive-1",
		formatVersion: 1,
		compatibilityKey: "seed",
		buildState: "ready",
		failureReasonCode: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	return row;
}

function seedSession(
	store: ReturnType<typeof makeStore>,
	overrides: Partial<SessionRow> = {},
): SessionRow {
	const row: SessionRow = {
		id: "sess-1",
		projectId: "proj-1",
		userId: "user-1",
		title: "Chat",
		branchName: null,
		baseCommitSha: null,
		workspacePath: WORKSPACE_PATH,
		memoryPath: "/workspace/.ditto/project-memory.md",
		status: "active",
		previewPort: null,
		sandboxIdentityId: null,
		runtimeLeaseId: null,
		runtimeLeaseExpiresAt: null,
		runtimeFailureReasonCode: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
	store.sessionRows.set(row.id, row);
	return row;
}

function makeSandbox(label: string) {
	return {
		label,
		setOutboundHandler: vi.fn(async () => undefined),
		exists: vi.fn(async () => ({ exists: true })),
		exec: vi.fn(async () => ({
			success: true,
			stdout: "",
			stderr: "",
			exitCode: 0,
		})),
		createSession: vi.fn(),
		deleteSession: vi.fn(),
	};
}

const env = {
	Sandbox: {
		idFromName: (name: string) => ({
			toString: () => `container-for-${name}`,
		}),
	},
	BETTER_AUTH_SECRET: "test-better-auth-secret-min-length",
} as unknown as Env;

describe("WorkspaceRuntime", () => {
	let store: ReturnType<typeof makeStore>;
	const sandboxes = new Map<string, ReturnType<typeof makeSandbox>>();

	beforeEach(() => {
		vi.clearAllMocks();
		store = makeStore();
		sandboxes.clear();
		decryptEnvVarsMock.mockResolvedValue([{ key: "SECRET", value: "s3cret" }]);
		configureDittoGitIdentityMock.mockResolvedValue(undefined);
		getInstallationOctokitMock.mockResolvedValue({
			rest: {
				repos: {
					get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
				},
			},
		});
		getProjectSandboxMock.mockImplementation((_env: Env, sandboxId: string) => {
			const existing = sandboxes.get(sandboxId);
			if (existing) return existing;
			const created = makeSandbox(sandboxId);
			sandboxes.set(sandboxId, created);
			return created;
		});
		restoreArchiveMock.mockImplementation(async () => {
			store.eventOrder.push("restore");
			return {
				archive: {
					id: "archive-1",
					formatVersion: 1,
					compatibilityKey: "ditto-workspace-archive-v1",
					byteCount: 10,
					digest: "abc",
					generation: 0,
				},
				extractedBytes: 10,
			};
		});
		fetchGitHubBranchBrokeredMock.mockImplementation(async () => {
			store.eventOrder.push("fetch");
			return {
				branchName: "main",
				headSha: HEAD_SHA,
				refs: {
					branchName: "main",
					headRef: "refs/heads/main",
					remoteTrackingRef: "refs/remotes/origin/main",
					isolatedFetchRefspec: "+refs/heads/main:refs/ditto-isolated",
					pushRefspecFrom: (sha: string) => `${sha}:refs/heads/main`,
					destinationFetchRefspecFrom: (sha: string) =>
						`${sha}:refs/remotes/origin/main`,
				},
			};
		});
	});

	function open(options: {
		sessionId: string;
		purpose?:
			| "agent_run"
			| "agent_control"
			| "local_git_read"
			| "mutating_git"
			| "git_metadata"
			| "preview"
			| "backup_restore";
	}) {
		return withWorkspaceRuntimeLease(
			{
				env,
				db: store.db,
				userId: "user-1",
				projectId: "proj-1",
				sessionId: options.sessionId,
				purpose: options.purpose ?? "preview",
				sleep: async () => undefined,
				authority: createSandboxAuthority(store.db),
			},
			async (lease) => lease,
		);
	}

	it("gives two sessions distinct sandbox IDs", async () => {
		seedProject(store);
		seedSession(store, { id: "sess-1" });
		seedSession(store, { id: "sess-2" });

		const first = await open({ sessionId: "sess-1" });
		const second = await open({ sessionId: "sess-2" });

		const ids = [...store.identityRows.values()].map((row) => row.sandboxId);
		expect(ids).toHaveLength(2);
		expect(new Set(ids).size).toBe(2);
		expect(first.matchesSandboxClaim(ids[0] as string)).toBe(true);
		expect(second.matchesSandboxClaim(ids[0] as string)).toBe(false);
		expect(first.workspacePath).toBe(WORKSPACE_PATH);
		expect(second.workspacePath).toBe(WORKSPACE_PATH);
		expect(sandboxes.size).toBe(2);
	});

	it("resolves the same identity after a new runtime instance", async () => {
		seedProject(store);
		seedSession(store);

		await open({ sessionId: "sess-1" });
		const before = [...store.identityRows.values()][0];
		expect(before).toBeTruthy();

		const again = await withWorkspaceRuntimeLease(
			{
				env,
				db: store.db,
				userId: "user-1",
				projectId: "proj-1",
				sessionId: "sess-1",
				purpose: "preview",
				sleep: async () => undefined,
				authority: createSandboxAuthority(store.db),
			},
			async (lease) => lease,
		);

		const after = [...store.identityRows.values()][0];
		expect(after?.id).toBe(before?.id);
		expect(after?.sandboxId).toBe(before?.sandboxId);
		expect(again.matchesSandboxClaim(before?.sandboxId as string)).toBe(true);
		expect(restoreArchiveMock).toHaveBeenCalledTimes(1);
	});

	it("increments lifecycle generation before restore", async () => {
		seedProject(store);
		seedSession(store);

		restoreArchiveMock.mockImplementation(async () => {
			const identity = [...store.identityRows.values()][0];
			store.eventOrder.push(`restore:gen=${identity?.lifecycleGeneration}`);
			return {
				archive: {
					id: "archive-1",
					formatVersion: 1,
					compatibilityKey: "ditto-workspace-archive-v1",
					byteCount: 10,
					digest: "abc",
					generation: 0,
				},
				extractedBytes: 10,
			};
		});

		await open({ sessionId: "sess-1" });
		expect(store.eventOrder[0]).toBe("restore:gen=2");
		expect(store.eventOrder[1]).toBe("fetch");
		const identity = [...store.identityRows.values()][0];
		expect(identity?.lifecycleGeneration).toBe(2);
		expect(identity?.state).toBe("ready");
		expect(identity?.kind).toBe("workspace_session");
	});

	it("rejects an old generation on SandboxAuthority", async () => {
		seedProject(store);
		seedSession(store);
		await open({ sessionId: "sess-1" });

		const identity = [...store.identityRows.values()][0];
		expect(identity).toBeTruthy();
		const authority = createSandboxAuthority(store.db);
		await authority.openOperation({
			identityId: identity?.id as string,
			family: "git_transport",
			type: WORKSPACE_SESSION_FETCH_OPERATION_TYPE,
			contractVersion: 1,
			repository: "acme/app",
			allowedRefs: ["refs/heads/main"],
			expiresAt: new Date(Date.now() + 60_000),
		});

		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity?.id as string,
					lifecycleGeneration: 1,
					containerId: identity?.containerId as string,
				},
				"git_transport",
			),
		).rejects.toBeInstanceOf(SandboxAuthorityError);

		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity?.id as string,
					lifecycleGeneration: 1,
					containerId: identity?.containerId as string,
				},
				"git_transport",
			),
		).rejects.toMatchObject({ code: "generation_mismatch" });
	});

	it("freezes the brokered default-branch commit as baseCommitSha", async () => {
		seedProject(store);
		seedSession(store);
		const lease = await open({ sessionId: "sess-1" });
		expect(lease.baseCommitSha).toBe(HEAD_SHA);
		expect(store.sessionRows.get("sess-1")?.baseCommitSha).toBe(HEAD_SHA);
		expect(store.sessionRows.get("sess-1")?.workspacePath).toBe(WORKSPACE_PATH);
		expect(fetchGitHubBranchBrokeredMock).toHaveBeenCalledWith(
			expect.objectContaining({
				githubRepo: "acme/app",
				branchName: "main",
				destinationCwd: WORKSPACE_PATH,
			}),
		);
		const fetchOp = [...store.operationRows.values()].find(
			(row) => row.type === WORKSPACE_SESSION_FETCH_OPERATION_TYPE,
		);
		expect(fetchOp?.family).toBe("git_transport");
		expect(fetchOp?.type).not.toBe("project_seed_fetch");
	});

	it("does not move baseCommitSha on a later ready call", async () => {
		seedProject(store);
		seedSession(store);
		await open({ sessionId: "sess-1" });
		fetchGitHubBranchBrokeredMock.mockResolvedValue({
			branchName: "main",
			headSha: OTHER_SHA,
			refs: {
				branchName: "main",
				headRef: "refs/heads/main",
				remoteTrackingRef: "refs/remotes/origin/main",
				isolatedFetchRefspec: "+refs/heads/main:refs/ditto-isolated",
				pushRefspecFrom: (sha: string) => `${sha}:refs/heads/main`,
				destinationFetchRefspecFrom: (sha: string) =>
					`${sha}:refs/remotes/origin/main`,
			},
		});
		const again = await open({ sessionId: "sess-1" });
		expect(again.baseCommitSha).toBe(HEAD_SHA);
		expect(store.sessionRows.get("sess-1")?.baseCommitSha).toBe(HEAD_SHA);
		expect(restoreArchiveMock).toHaveBeenCalledTimes(1);
	});

	it("injects project env only for agent_run", async () => {
		seedProject(store);
		seedSession(store);
		const agent = await open({ sessionId: "sess-1", purpose: "agent_run" });
		expect(agent.projectEnv).toEqual([{ key: "SECRET", value: "s3cret" }]);
		expect(decryptEnvVarsMock).toHaveBeenCalled();

		decryptEnvVarsMock.mockClear();
		const preview = await open({ sessionId: "sess-1", purpose: "preview" });
		expect(preview.projectEnv).toBeNull();
		expect(decryptEnvVarsMock).not.toHaveBeenCalled();

		const control = await open({
			sessionId: "sess-1",
			purpose: "agent_control",
		});
		expect(control.projectEnv).toBeNull();
		const git = await open({ sessionId: "sess-1", purpose: "mutating_git" });
		expect(git.projectEnv).toBeNull();
		const restore = await open({
			sessionId: "sess-1",
			purpose: "backup_restore",
		});
		expect(restore.projectEnv).toBeNull();
	});

	it("serves legacy worktrees without creating a session identity", async () => {
		seedProject(store, { sandboxId: "project-sandbox" });
		seedSession(store, {
			id: "sess-legacy",
			branchName: "ditto/session-legacy",
			baseCommitSha: "legacy-sha",
			workspacePath: `${SESSION_WORKTREE_ROOT}/sess-legacy`,
		});
		ensureSessionWorkspaceReadyMock.mockResolvedValue({
			branchName: "ditto/session-legacy",
			baseCommitSha: "legacy-sha",
			workspacePath: `${SESSION_WORKTREE_ROOT}/sess-legacy`,
		});

		const lease = await open({ sessionId: "sess-legacy", purpose: "preview" });
		expect(lease.workspacePath).toBe(`${SESSION_WORKTREE_ROOT}/sess-legacy`);
		expect(lease.baseCommitSha).toBe("legacy-sha");
		expect(lease.matchesSandboxClaim("project-sandbox")).toBe(true);
		expect(store.identityRows.size).toBe(0);
		expect(restoreArchiveMock).not.toHaveBeenCalled();
		expect(ensureSessionWorkspaceReadyMock).toHaveBeenCalled();
	});

	it("fails closed for a foreign session", async () => {
		seedProject(store);
		await expect(open({ sessionId: "missing" })).rejects.toMatchObject({
			code: "not_found",
		});
	});

	it("observes seed-ready projects as connected without a project sandbox", async () => {
		seedProject(store);
		const observed = await observeWorkspaceRuntime({
			env,
			db: store.db,
			userId: "user-1",
			projectId: "proj-1",
		});
		expect(observed.state).toBe("connected");
		expect(checkProjectSandboxMock).not.toHaveBeenCalled();
	});

	it("observes an unprovisioned session identity as provisioning", async () => {
		seedProject(store);
		seedSession(store, { sandboxIdentityId: "ident-unprov" });
		store.identityRows.set("ident-unprov", {
			id: "ident-unprov",
			kind: "workspace_session",
			sandboxId: "sbx-unprov",
			containerId: "container-unprov",
			userId: "user-1",
			projectId: "proj-1",
			workspaceSessionId: "sess-1",
			lifecycleGeneration: 1,
			state: "unprovisioned",
			retiredAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		const observed = await observeWorkspaceRuntime({
			env,
			db: store.db,
			userId: "user-1",
			projectId: "proj-1",
			sessionId: "sess-1",
			authority: createSandboxAuthority(store.db),
		});
		expect(observed.state).toBe("provisioning");
	});
});
