import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	privilegedOperations,
	projectSeeds,
	projects,
	sandboxIdentities,
} from "#/db/schema";

const getInstallationOctokitMock = vi.hoisted(() => vi.fn());
const getProjectSandboxMock = vi.hoisted(() => vi.fn());
const clearSandboxWorkspaceMock = vi.hoisted(() => vi.fn());
const configureDittoGitIdentityMock = vi.hoisted(() => vi.fn());
const fetchGitHubBranchBrokeredMock = vi.hoisted(() => vi.fn());
const createArchiveMock = vi.hoisted(() => vi.fn());
const createSandboxAuthorityMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/github-app", () => ({
	getGitHubApp: () => ({
		getInstallationOctokit: getInstallationOctokitMock,
	}),
}));

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
	clearSandboxWorkspace: clearSandboxWorkspaceMock,
	configureDittoGitIdentity: configureDittoGitIdentityMock,
}));

vi.mock("#/lib/privileged-git", () => ({
	fetchGitHubBranchBrokered: fetchGitHubBranchBrokeredMock,
}));

vi.mock("#/lib/sandbox-archive", () => ({
	createArchive: createArchiveMock,
	ARCHIVE_FORMAT_VERSION: 1,
	ARCHIVE_COMPATIBILITY_KEY: "ditto-workspace-archive-v1",
}));

vi.mock("#/lib/sandbox-authority", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./sandbox-authority")>();
	return {
		...actual,
		createSandboxAuthority: createSandboxAuthorityMock,
	};
});

const { buildProjectSeed } = await import("./project-seed");

type ProjectRow = typeof projects.$inferSelect;
type SeedRow = typeof projectSeeds.$inferSelect;
type IdentityRow = typeof sandboxIdentities.$inferSelect;
type OperationRow = typeof privilegedOperations.$inferSelect;

function makeDb() {
	const projectRows = new Map<string, ProjectRow>();
	const seedRows = new Map<string, SeedRow>();
	const identityRows = new Map<string, IdentityRow>();
	const operationRows = new Map<string, OperationRow>();
	let batchCalls = 0;
	const getSandboxOrder: string[] = [];

	const db = {
		batch: vi.fn(async (statements: Array<Promise<unknown>>) => {
			batchCalls += 1;
			return Promise.all(statements);
		}),
		insert(_table: unknown) {
			return {
				values(value: Record<string, unknown>) {
					const exec = async () => {
						if ("compatibilityKey" in value && "buildState" in value) {
							const row = {
								id: String(value.id),
								projectId: String(value.projectId),
								sourceCommit: (value.sourceCommit as string | null) ?? null,
								archiveId: (value.archiveId as string | null) ?? null,
								formatVersion: Number(value.formatVersion),
								compatibilityKey: String(value.compatibilityKey),
								buildState: value.buildState as SeedRow["buildState"],
								failureReasonCode:
									(value.failureReasonCode as string | null) ?? null,
								createdAt: new Date(),
								updatedAt: new Date(),
							} satisfies SeedRow;
							seedRows.set(row.id, row);
							return [row];
						}
						if ("containerId" in value && "kind" in value) {
							const row = {
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
							} satisfies IdentityRow;
							identityRows.set(row.id, row);
							return [row];
						}
						if ("correlationId" in value && "family" in value) {
							const row = {
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
							} satisfies OperationRow;
							operationRows.set(row.id, row);
							return [row];
						}
						const row = {
							id: String(value.id),
							name: String(value.name),
							description: (value.description as string | null) ?? null,
							userId: String(value.userId),
							githubRepo: (value.githubRepo as string | null) ?? null,
							githubInstallationId:
								(value.githubInstallationId as number | null) ?? null,
							sandboxId: (value.sandboxId as string | null) ?? null,
							sandboxBackup: null,
							sandboxBackupCreatedAt: null,
							sandboxBackupRequestedGeneration: 0,
							sandboxBackupStoredGeneration: 0,
							status: value.status as ProjectRow["status"],
							envVars: (value.envVars as string | null) ?? null,
							previewLockToken: null,
							previewLockExpiresAt: null,
							deletingAt: null,
							createdAt: new Date(),
							updatedAt: new Date(),
						} satisfies ProjectRow;
						projectRows.set(row.id, row);
						return [row];
					};
					return {
						returning: exec,
						// Drizzle insert builders are thenable without .returning().
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
		update(_table: unknown) {
			return {
				set(patch: Record<string, unknown>) {
					return {
						where(_where: unknown) {
							const exec = async () => {
								if ("buildState" in patch || "compatibilityKey" in patch) {
									const row = [...seedRows.values()][0];
									if (!row) return [];
									const next = {
										...row,
										sourceCommit:
											"sourceCommit" in patch
												? (patch.sourceCommit as string | null)
												: row.sourceCommit,
										archiveId:
											"archiveId" in patch
												? (patch.archiveId as string | null)
												: row.archiveId,
										compatibilityKey:
											typeof patch.compatibilityKey === "string"
												? patch.compatibilityKey
												: row.compatibilityKey,
										buildState:
											typeof patch.buildState === "string"
												? (patch.buildState as SeedRow["buildState"])
												: row.buildState,
										failureReasonCode:
											"failureReasonCode" in patch
												? (patch.failureReasonCode as string | null)
												: row.failureReasonCode,
										updatedAt: new Date(),
									};
									seedRows.set(row.id, next);
									return [next];
								}
								const row = [...projectRows.values()][0];
								if (!row) return [];
								const next = {
									...row,
									status:
										typeof patch.status === "string"
											? (patch.status as ProjectRow["status"])
											: row.status,
									updatedAt: new Date(),
								};
								projectRows.set(row.id, next);
								return [next];
							};
							return {
								returning: exec,
								// biome-ignore lint/suspicious/noThenProperty: drizzle thenable mock
								then: (
									resolve: (value: unknown) => unknown,
									reject?: (error: unknown) => unknown,
								) => exec().then(resolve, reject),
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
		seedRows,
		identityRows,
		operationRows,
		get batchCalls() {
			return batchCalls;
		},
		getSandboxOrder,
		trackGetSandbox(label: string) {
			getSandboxOrder.push(label);
		},
	};
}

describe("buildProjectSeed", () => {
	const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
	let store: ReturnType<typeof makeDb>;
	let destroyMock: ReturnType<typeof vi.fn>;
	let setOutboundHandlerMock: ReturnType<typeof vi.fn>;
	let closeOperationMock: ReturnType<typeof vi.fn>;
	let retireIdentityMock: ReturnType<typeof vi.fn>;
	let execEnvSnapshots: Array<Record<string, string | undefined>>;

	beforeEach(() => {
		vi.clearAllMocks();
		store = makeDb();
		execEnvSnapshots = [];
		destroyMock = vi.fn(async () => undefined);
		setOutboundHandlerMock = vi.fn(async () => undefined);
		closeOperationMock = vi.fn(async () => undefined);
		retireIdentityMock = vi.fn(async (id: string) => {
			const row = store.identityRows.get(id);
			if (!row) return null;
			const next = {
				...row,
				state: "destroyed" as const,
				retiredAt: new Date(),
			};
			store.identityRows.set(id, next);
			return {
				id: next.id,
				kind: next.kind,
				sandboxId: next.sandboxId,
				containerId: next.containerId,
				userId: next.userId,
				projectId: next.projectId,
				workspaceSessionId: next.workspaceSessionId,
				lifecycleGeneration: next.lifecycleGeneration,
				state: next.state,
				retiredAt: next.retiredAt,
			};
		});

		createSandboxAuthorityMock.mockReturnValue({
			closeOperation: closeOperationMock,
			retireIdentity: retireIdentityMock,
			getIdentity: async (id: string) => {
				const row = store.identityRows.get(id);
				if (!row) return null;
				return {
					...row,
					retiredAt: row.retiredAt,
				};
			},
			resolveOutboundRequest: async () => {
				throw new Error("retired");
			},
		});

		getInstallationOctokitMock.mockResolvedValue({
			rest: {
				repos: {
					get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
				},
			},
		});

		getProjectSandboxMock.mockImplementation(() => {
			store.trackGetSandbox("getSandbox");
			return {
				setOutboundHandler: setOutboundHandlerMock,
				destroy: destroyMock,
				exec: vi.fn(
					async (
						command: string,
						options?: { env?: Record<string, string | undefined> },
					) => {
						if (options?.env) {
							execEnvSnapshots.push(options.env);
						}
						if (command.includes("process.version")) {
							return {
								success: true,
								stdout: "v22.23.1 x64\n",
								stderr: "",
								exitCode: 0,
							};
						}
						if (command.includes("package.json")) {
							return {
								success: true,
								stdout: "1.2.3\n",
								stderr: "",
								exitCode: 0,
							};
						}
						return { success: true, stdout: "", stderr: "", exitCode: 0 };
					},
				),
			};
		});

		clearSandboxWorkspaceMock.mockImplementation(async () => {
			store.trackGetSandbox("clear");
		});
		configureDittoGitIdentityMock.mockResolvedValue(undefined);
		fetchGitHubBranchBrokeredMock.mockImplementation(
			async (options: { githubRepo: string; destinationCwd: string }) => {
				store.trackGetSandbox("fetch");
				expect(options.githubRepo).toBe("acme/app");
				expect(options.destinationCwd).toBe("/workspace");
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
			},
		);
		createArchiveMock.mockResolvedValue({
			id: "archive-1",
			formatVersion: 1,
			compatibilityKey: "ditto-workspace-archive-v1",
			byteCount: 10,
			digest: "abc",
			generation: 0,
		});
	});

	const env = {
		Sandbox: {
			idFromName: (name: string) => ({
				toString: () => `container-for-${name}`,
			}),
		},
	} as unknown as Env;

	it("D1 batch happens before getSandbox/network", async () => {
		await buildProjectSeed({
			env,
			db: store.db,
			userId: "user-1",
			projectId: "proj-1",
			name: "App",
			githubRepo: "acme/app",
			installationId: 7,
			encryptedEnvVars: null,
		});
		expect(store.batchCalls).toBe(1);
		expect(store.getSandboxOrder[0]).toBe("getSandbox");
		expect(getProjectSandboxMock).toHaveBeenCalled();
		expect(fetchGitHubBranchBrokeredMock).toHaveBeenCalled();
	});

	it("builder env/process listings contain no platform or project credentials", async () => {
		await buildProjectSeed({
			env,
			db: store.db,
			userId: "user-1",
			projectId: "proj-1",
			name: "App",
			githubRepo: "acme/app",
			installationId: 7,
			encryptedEnvVars: "cipher",
		});
		expect(fetchGitHubBranchBrokeredMock).toHaveBeenCalled();
		for (const snapshot of execEnvSnapshots) {
			const joined = JSON.stringify(snapshot);
			expect(joined).not.toMatch(/ghs_|x-access-token|OPENCODE|Authorization/i);
			expect(joined).not.toContain("cipher");
		}
		const fetchArgs = fetchGitHubBranchBrokeredMock.mock.calls[0]?.[0] as {
			githubRepo: string;
		};
		expect(JSON.stringify(fetchArgs)).not.toMatch(/ghs_|token|Authorization/i);
	});

	it("project readiness follows durable seed storage", async () => {
		const result = await buildProjectSeed({
			env,
			db: store.db,
			userId: "user-1",
			projectId: "proj-1",
			name: "App",
			githubRepo: "acme/app",
			installationId: 7,
			encryptedEnvVars: null,
		});
		expect(result.project.status).toBe("ready");
		expect(result.project.sandboxId).toBeNull();
		const seed = [...store.seedRows.values()][0];
		expect(seed?.buildState).toBe("ready");
		expect(seed?.archiveId).toBe("archive-1");
		expect(seed?.sourceCommit).toBe(HEAD_SHA);
	});

	it("builder destruction leaves a permanent identity tombstone", async () => {
		const result = await buildProjectSeed({
			env,
			db: store.db,
			userId: "user-1",
			projectId: "proj-1",
			name: "App",
			githubRepo: "acme/app",
			installationId: 7,
			encryptedEnvVars: null,
		});
		expect(destroyMock).toHaveBeenCalledOnce();
		expect(retireIdentityMock).toHaveBeenCalledOnce();
		expect(closeOperationMock).toHaveBeenCalledOnce();
		const tombstone = store.identityRows.get(result.identity.id);
		expect(tombstone?.retiredAt).toBeInstanceOf(Date);
		expect(tombstone?.state).toBe("destroyed");
		expect(setOutboundHandlerMock).toHaveBeenCalledWith("dittoCatchAll", {
			identityId: result.identity.id,
			lifecycleGeneration: 1,
		});
	});

	it("archive failure leaves project failed and does not promote a seed", async () => {
		createArchiveMock.mockRejectedValue(new Error("archive exploded"));
		await expect(
			buildProjectSeed({
				env,
				db: store.db,
				userId: "user-1",
				projectId: "proj-1",
				name: "App",
				githubRepo: "acme/app",
				installationId: 7,
				encryptedEnvVars: null,
			}),
		).rejects.toThrow("archive exploded");

		const project = [...store.projectRows.values()][0];
		const seed = [...store.seedRows.values()][0];
		expect(project?.status).toBe("failed");
		expect(seed?.buildState).toBe("failed");
		expect(seed?.archiveId).toBeNull();
		expect(seed?.sourceCommit).toBeNull();
		expect(destroyMock).toHaveBeenCalledOnce();
		expect(retireIdentityMock).toHaveBeenCalledOnce();
	});
});
