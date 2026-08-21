import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createDb } from "#/db";
import { decryptEnvVars, encryptEnvVars } from "#/lib/project-env-vars";

const TEST_SECRET = "test-better-auth-secret-min-length";

const createDbMock = vi.hoisted(() => vi.fn());
const deleteProjectWithPreviewFenceMock = vi.hoisted(() => vi.fn());
const destroySandboxMock = vi.hoisted(() => vi.fn());
const provisionProjectSandboxMock = vi.hoisted(() => vi.fn());
const buildProjectSeedMock = vi.hoisted(() => vi.fn());
const authorizeGitHubRepositoryAccessMock = vi.hoisted(() => vi.fn());

vi.mock("#/db", () => ({
	createDb: createDbMock,
}));

vi.mock("#/lib/sandbox-bootstrap", () => ({
	destroySandbox: destroySandboxMock,
	getProjectSandbox: vi.fn(),
}));

vi.mock("#/lib/project-seed", () => ({
	buildProjectSeed: buildProjectSeedMock,
}));

vi.mock("#/lib/project-sandbox", () => ({
	provisionProjectSandbox: provisionProjectSandboxMock,
}));

vi.mock("#/lib/session-worktree", () => ({
	ensureSessionWorkspaceReady: vi.fn(),
}));

vi.mock("#/lib/session-workspace-lock", () => ({
	withSessionWorkspaceLock: vi.fn(),
}));

vi.mock("#/lib/github-authorization", () => ({
	authorizeGitHubRepositoryAccess: authorizeGitHubRepositoryAccessMock,
}));

vi.mock("#/lib/project-env-vars", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("#/lib/project-env-vars")>();
	return actual;
});

vi.mock("#/lib/session-preview", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/session-preview")>();
	return {
		...actual,
		deleteProjectWithPreviewFence: deleteProjectWithPreviewFenceMock,
	};
});

const { projectsRouter } = await import("./projects");
const { SessionPreviewError } = await import("#/lib/session-preview");

type ProjectRow = {
	id: string;
	userId: string;
	envVars: string | null;
	sandboxId: string | null;
	[key: string]: unknown;
};

/** Walk drizzle SQL chunks into a flat token list for predicate checks. */
function sqlTokens(node: unknown): unknown[] {
	if (node == null || typeof node !== "object") return [node];
	const obj = node as {
		queryChunks?: unknown[];
		name?: string;
		columnType?: string;
		value?: unknown;
	};
	if (Array.isArray(obj.queryChunks)) {
		return obj.queryChunks.flatMap(sqlTokens);
	}
	if (typeof obj.name === "string" && obj.columnType != null) {
		return [{ col: obj.name }];
	}
	if ("value" in obj) {
		if (
			Array.isArray(obj.value) &&
			obj.value.every((part) => typeof part === "string")
		) {
			return [obj.value.join("")];
		}
		return [{ param: obj.value }];
	}
	return [];
}

function rowMatchesWhere(row: ProjectRow, where: unknown): boolean {
	const tokens = sqlTokens(where);
	const expected: Partial<Record<string, unknown | { isNull: true }>> = {};

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (
			token == null ||
			typeof token !== "object" ||
			!("col" in token) ||
			typeof (token as { col: unknown }).col !== "string"
		) {
			continue;
		}
		const col = (token as { col: string }).col;
		const next = tokens[i + 1];
		if (next === " is null") {
			expected[col] = { isNull: true };
			i += 1;
			continue;
		}
		if (next === " = ") {
			const valueToken = tokens[i + 2];
			if (
				valueToken != null &&
				typeof valueToken === "object" &&
				"param" in valueToken
			) {
				expected[col] = (valueToken as { param: unknown }).param;
			}
			i += 2;
		}
	}

	for (const [col, want] of Object.entries(expected)) {
		const got = row[col];
		if (
			want != null &&
			typeof want === "object" &&
			"isNull" in (want as object)
		) {
			if (got != null) return false;
			continue;
		}
		if (got !== want) return false;
	}
	return Object.keys(expected).length > 0;
}

/**
 * In-memory project store with ciphertext CAS on update.
 * Optional one-shot update barrier lets tests interleave a stale writer:
 * mut1 reads → pauses in update → mut2 completes → release mut1.
 * Unfenced writers (no envVars predicate) lose siblings; CAS retries merge.
 */
function createProjectDbMock(initial: ProjectRow) {
	const row: ProjectRow = { ...initial };
	let updateBarrier: {
		entered: Promise<void>;
		signalEntered: () => void;
		wait: Promise<void>;
		release: () => void;
	} | null = null;
	let scrambleBeforeCas = false;
	let scrambleCiphertexts: string[] = [];
	let scrambleCount = 0;

	function armUpdateBarrier() {
		let signalEntered!: () => void;
		let release!: () => void;
		const entered = new Promise<void>((resolve) => {
			signalEntered = resolve;
		});
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		updateBarrier = { entered, signalEntered, wait, release };
		return {
			entered,
			release: () => {
				release();
			},
		};
	}

	function project(fields?: Record<string, { name?: string }>) {
		if (!fields) return { ...row };
		const out: Record<string, unknown> = {};
		for (const [alias, col] of Object.entries(fields)) {
			const name = col?.name ?? alias;
			out[alias] = row[name];
		}
		return out;
	}

	const db = {
		select(fields?: Record<string, { name?: string }>) {
			return {
				from() {
					return {
						where(where: unknown) {
							const matched = rowMatchesWhere(row, where);
							const result = async () => (matched ? [project(fields)] : []);
							return { limit: result };
						},
					};
				},
			};
		},
		update() {
			return {
				set(values: Record<string, unknown>) {
					return {
						where(where: unknown) {
							return {
								async returning(returningFields?: Record<string, unknown>) {
									if (updateBarrier) {
										const barrier = updateBarrier;
										updateBarrier = null;
										barrier.signalEntered();
										await barrier.wait;
									}
									if (scrambleBeforeCas) {
										// Force every CAS attempt to see a changed blob (valid ciphertext).
										const next =
											scrambleCiphertexts[
												scrambleCount % scrambleCiphertexts.length
											] ?? row.envVars;
										scrambleCount += 1;
										row.envVars = next;
									}
									if (!rowMatchesWhere(row, where)) {
										return [];
									}
									Object.assign(row, values);
									if (returningFields && "id" in returningFields) {
										return [{ id: row.id }];
									}
									return [{ ...row }];
								},
							};
						},
					};
				},
			};
		},
	};

	return {
		db: db as unknown as ReturnType<typeof createDb>,
		row,
		armUpdateBarrier,
		setScrambleBeforeCas(value: boolean, ciphers: string[] = []) {
			scrambleBeforeCas = value;
			scrambleCiphertexts = ciphers;
			scrambleCount = 0;
		},
	};
}

function createCaller() {
	return projectsRouter.createCaller({
		env: {
			DB: {},
			BETTER_AUTH_SECRET: TEST_SECRET,
		} as Env,
		session: {
			session: {
				id: "auth-sess",
				userId: "user-1",
				expiresAt: new Date(Date.now() + 60_000),
				token: "tok",
				createdAt: new Date(),
				updatedAt: new Date(),
				ipAddress: null,
				userAgent: null,
			},
			user: {
				id: "user-1",
				name: "Test",
				email: "test@example.com",
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
				image: null,
			},
		},
		request: new Request("http://localhost"),
		auth: {} as never,
	});
}

async function seedCipher(vars: Array<{ key: string; value: string }>) {
	return encryptEnvVars(vars, TEST_SECRET);
}

async function readKeys(ciphertext: string | null) {
	const vars = await decryptEnvVars(ciphertext, TEST_SECRET);
	return {
		keys: new Set(vars.map((v) => v.key)),
		byKey: Object.fromEntries(vars.map((v) => [v.key, v.value])),
	};
}

describe("projects.create GitHub import", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authorizeGitHubRepositoryAccessMock.mockResolvedValue(undefined);
	});

	it("builds a project seed and does not store sandboxId", async () => {
		buildProjectSeedMock.mockResolvedValue({
			project: {
				id: "proj-1",
				name: "App",
				description: null,
				userId: "user-1",
				githubRepo: "acme/app",
				githubInstallationId: 9,
				sandboxId: null,
				sandboxBackup: null,
				sandboxBackupCreatedAt: null,
				sandboxBackupRequestedGeneration: 0,
				sandboxBackupStoredGeneration: 0,
				status: "ready",
				envVars: null,
				previewLockToken: null,
				previewLockExpiresAt: null,
				deletingAt: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			seed: {
				id: "seed-1",
				projectId: "proj-1",
				sourceCommit: "a".repeat(40),
				archiveId: "archive-1",
				formatVersion: 1,
				compatibilityKey: "seed",
				buildState: "ready",
				failureReasonCode: null,
			},
			identity: {
				id: "id-1",
				kind: "project_seed",
				sandboxId: "sbx-temp",
				containerId: "container-1",
				userId: "user-1",
				projectId: "proj-1",
				workspaceSessionId: null,
				lifecycleGeneration: 1,
				state: "destroyed",
				retiredAt: new Date(),
			},
		});
		createDbMock.mockReturnValue({
			update() {
				return {
					set() {
						return {
							where: async () => undefined,
						};
					},
				};
			},
		});

		const result = await createCaller().create({
			name: "App",
			githubRepo: "acme/app",
			githubInstallationId: 9,
		});

		expect(authorizeGitHubRepositoryAccessMock).toHaveBeenCalledOnce();
		expect(buildProjectSeedMock).toHaveBeenCalledWith(
			expect.objectContaining({
				githubRepo: "acme/app",
				installationId: 9,
				userId: "user-1",
			}),
		);
		expect(result.sandboxId).toBeNull();
		expect(result.status).toBe("ready");
	});
});

describe("projects.deleteProject fence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDbMock.mockReturnValue({});
	});

	it("delegates to deleteProjectWithPreviewFence with destroySandbox", async () => {
		deleteProjectWithPreviewFenceMock.mockResolvedValue({ id: "proj-1" });
		const result = await createCaller().deleteProject({ id: "proj-1" });
		expect(result).toEqual({ id: "proj-1" });
		expect(deleteProjectWithPreviewFenceMock).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "proj-1",
				userId: "user-1",
				destroySandbox: destroySandboxMock,
			}),
		);
	});

	it("maps not_found", async () => {
		deleteProjectWithPreviewFenceMock.mockRejectedValue(
			new SessionPreviewError("not_found", "Session or project not found."),
		);
		await expect(
			createCaller().deleteProject({ id: "missing" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Project not found.",
		});
	});

	it("maps busy", async () => {
		deleteProjectWithPreviewFenceMock.mockRejectedValue(
			new SessionPreviewError("busy", "Preview is busy. Try again shortly."),
		);
		await expect(
			createCaller().deleteProject({ id: "proj-1" }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});
});

describe("projects env var mutations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		provisionProjectSandboxMock.mockResolvedValue({
			state: "connected",
			project: { sandboxId: "sbx-1" },
		});
	});

	it("set||set keeps sibling keys (stale write barrier)", async () => {
		// Simulation: mut1 reads, pauses before write; mut2 completes; mut1 resumes.
		// Unfenced UPDATE loses mut2's key; CAS retries and keeps {A,B,C}.
		const cipherA = await seedCipher([{ key: "A", value: "1" }]);
		const store = createProjectDbMock({
			id: "proj-1",
			userId: "user-1",
			envVars: cipherA,
			sandboxId: null,
		});
		createDbMock.mockReturnValue(store.db);

		const barrier = store.armUpdateBarrier();
		const caller = createCaller();

		const mut1 = caller.setEnvVar({ id: "proj-1", key: "B", value: "2" });
		await barrier.entered;
		await caller.setEnvVar({ id: "proj-1", key: "C", value: "3" });
		barrier.release();
		await mut1;

		const { keys } = await readKeys(store.row.envVars);
		expect(keys).toEqual(new Set(["A", "B", "C"]));
	});

	it("delete||set does not resurrect deleted key", async () => {
		const cipher = await seedCipher([
			{ key: "A", value: "1" },
			{ key: "B", value: "2" },
		]);
		const store = createProjectDbMock({
			id: "proj-1",
			userId: "user-1",
			envVars: cipher,
			sandboxId: null,
		});
		createDbMock.mockReturnValue(store.db);

		const barrier = store.armUpdateBarrier();
		const caller = createCaller();

		// Pause delete A's write; concurrent set B=3 completes; resume delete.
		const del = caller.deleteEnvVar({ id: "proj-1", key: "A" });
		await barrier.entered;
		await caller.setEnvVar({ id: "proj-1", key: "B", value: "3" });
		barrier.release();
		await del;

		const { keys, byKey } = await readKeys(store.row.envVars);
		expect(keys.has("A")).toBe(false);
		expect(keys.has("B")).toBe(true);
		expect(byKey.B).toBe("3");
	});

	it("set||delete does not drop unrelated new key after completed delete", async () => {
		const cipher = await seedCipher([
			{ key: "A", value: "1" },
			{ key: "B", value: "2" },
		]);
		const store = createProjectDbMock({
			id: "proj-1",
			userId: "user-1",
			envVars: cipher,
			sandboxId: null,
		});
		createDbMock.mockReturnValue(store.db);

		const barrier = store.armUpdateBarrier();
		const caller = createCaller();

		// Pause set C's write; delete A completes; resume set C.
		const setC = caller.setEnvVar({ id: "proj-1", key: "C", value: "3" });
		await barrier.entered;
		await caller.deleteEnvVar({ id: "proj-1", key: "A" });
		barrier.release();
		await setC;

		const { keys } = await readKeys(store.row.envVars);
		expect(keys.has("A")).toBe(false);
		expect(keys.has("C")).toBe(true);
		expect(keys.has("B")).toBe(true);
	});

	it("same-key concurrent sets resolve to one serial value", async () => {
		const cipher = await seedCipher([{ key: "X", value: "0" }]);
		const store = createProjectDbMock({
			id: "proj-1",
			userId: "user-1",
			envVars: cipher,
			sandboxId: null,
		});
		createDbMock.mockReturnValue(store.db);

		const barrier = store.armUpdateBarrier();
		const caller = createCaller();

		const set1 = caller.setEnvVar({ id: "proj-1", key: "A", value: "1" });
		await barrier.entered;
		await caller.setEnvVar({ id: "proj-1", key: "A", value: "2" });
		barrier.release();
		await set1;

		const { keys, byKey } = await readKeys(store.row.envVars);
		expect(keys).toEqual(new Set(["X", "A"]));
		expect(["1", "2"]).toContain(byKey.A);
	});

	it("CAS exhaustion returns CONFLICT", async () => {
		const cipher = await seedCipher([{ key: "A", value: "1" }]);
		// Distinct valid ciphertexts so each CAS attempt mismatches without breaking decrypt.
		const rivals = (
			await Promise.all(
				Array.from({ length: 6 }, (_, i) =>
					seedCipher([{ key: "A", value: `rival-${i}` }]),
				),
			)
		).filter((value): value is string => value != null);
		const store = createProjectDbMock({
			id: "proj-1",
			userId: "user-1",
			envVars: cipher,
			sandboxId: null,
		});
		store.setScrambleBeforeCas(true, rivals);
		createDbMock.mockReturnValue(store.db);

		await expect(
			createCaller().setEnvVar({ id: "proj-1", key: "B", value: "2" }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Environment variables were updated concurrently. Please retry.",
		});
	});

	it("does not call provisionProjectSandbox when sandboxId is set", async () => {
		const cipher = await seedCipher([{ key: "A", value: "1" }]);
		const store = createProjectDbMock({
			id: "proj-1",
			userId: "user-1",
			envVars: cipher,
			sandboxId: "sbx-1",
		});
		createDbMock.mockReturnValue(store.db);

		await createCaller().setEnvVar({ id: "proj-1", key: "B", value: "2" });
		await createCaller().deleteEnvVar({ id: "proj-1", key: "A" });

		expect(provisionProjectSandboxMock).not.toHaveBeenCalled();
	});

	it("setEnvVar NOT_FOUND when project missing", async () => {
		const store = createProjectDbMock({
			id: "proj-1",
			userId: "user-1",
			envVars: null,
			sandboxId: null,
		});
		// Force ownership mismatch via empty match: use different id seed then query other
		createDbMock.mockReturnValue(store.db);
		await expect(
			createCaller().setEnvVar({ id: "missing", key: "A", value: "1" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("setEnvVar BAD_REQUEST on empty key", async () => {
		const store = createProjectDbMock({
			id: "proj-1",
			userId: "user-1",
			envVars: null,
			sandboxId: null,
		});
		createDbMock.mockReturnValue(store.db);
		await expect(
			createCaller().setEnvVar({ id: "proj-1", key: "   ", value: "1" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});
