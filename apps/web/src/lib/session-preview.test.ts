import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: vi.fn(),
}));
vi.mock("#/lib/project-sandbox", () => ({
	ensureProjectSandbox: vi.fn(),
}));
vi.mock("#/lib/session-worktree", () => ({
	ensureSessionWorkspaceReady: vi.fn(),
}));

const {
	acquireProjectPreviewLease,
	archiveSessionWithPreviewCleanup,
	deleteProjectWithPreviewFence,
	discoverPreviewCommand,
	isAstroVersionSupported,
	isViteVersionSupported,
	parseLeadingSemver,
	releaseProjectPreviewLease,
	resolvePreviewHostname,
	SessionPreviewError,
	startSessionPreview,
	stopSessionPreview,
	validatePreviewUrl,
} = await import("#/lib/session-preview");

import type {
	SessionPreviewDeps,
	SessionPreviewProcess,
	SessionPreviewSandbox,
} from "#/lib/session-preview";
import { SESSION_PREVIEW_PORT_MIN } from "#/lib/workspace-policy";

function makeProcess(
	overrides: Partial<SessionPreviewProcess> = {},
): SessionPreviewProcess {
	return {
		id: "ditto-preview-sess-1",
		status: "running",
		waitForPort: vi.fn().mockResolvedValue(undefined),
		kill: vi.fn().mockResolvedValue(undefined),
		getStatus: vi.fn().mockResolvedValue("running"),
		...overrides,
	};
}

function makeSandbox(
	overrides: Partial<SessionPreviewSandbox> = {},
): SessionPreviewSandbox {
	return {
		readFile: vi.fn(),
		exists: vi.fn().mockResolvedValue({ exists: true }),
		getProcess: vi.fn().mockResolvedValue(null),
		startProcess: vi.fn().mockResolvedValue(makeProcess()),
		killProcess: vi.fn().mockResolvedValue(undefined),
		exposePort: vi.fn().mockResolvedValue({
			url: "https://10000-box-token.ayn.wtf",
			port: 10000,
		}),
		unexposePort: vi.fn().mockResolvedValue(undefined),
		getExposedPorts: vi.fn().mockResolvedValue([]),
		...overrides,
	};
}

type ProjectState = {
	id: string;
	userId: string;
	status: "provisioning" | "ready" | "failed";
	sandboxId: string | null;
	githubRepo: string | null;
	githubInstallationId: number | null;
	previewLockToken: string | null;
	previewLockExpiresAt: number | null;
	deletingAt: number | null;
};

type SessionState = {
	id: string;
	projectId: string;
	userId: string;
	status: "active" | "archived";
	previewPort: number | null;
	branchName: string | null;
	baseCommitSha: string | null;
	workspacePath: string;
};

/** Shared test clock for lease open checks (seconds). */
let testNowSeconds = 1_700_000_000;

function createMemoryDb(seed: {
	project: ProjectState;
	session: SessionState;
	extraSessions?: SessionState[];
}) {
	const project = { ...seed.project };
	const sessions = new Map<string, SessionState>([
		[seed.session.id, { ...seed.session }],
		...(seed.extraSessions ?? []).map(
			(s) => [s.id, { ...s }] as [string, SessionState],
		),
	]);
	const session = sessions.get(seed.session.id)!;

	function isProjectsTable(table: Record<string, unknown>) {
		return "previewLockToken" in table || "sandboxId" in table;
	}
	function isSessionsTable(table: Record<string, unknown>) {
		return "previewPort" in table;
	}

	const db = {
		run: vi.fn(async (query: unknown) => {
			const text = JSON.stringify(query);
			const portMatch = text.match(/100\d{2}/);
			const idMatch = text.match(/sess-[\w-]+/);
			const target = idMatch ? (sessions.get(idMatch[0]) ?? session) : session;
			if (
				portMatch &&
				target.status === "active" &&
				target.previewPort == null
			) {
				const candidate = Number(portMatch[0]);
				const taken = [...sessions.values()].some(
					(s) =>
						s.projectId === target.projectId &&
						s.id !== target.id &&
						s.previewPort === candidate,
				);
				if (!taken) {
					target.previewPort = candidate;
				}
			}
			return { success: true };
		}),
		select: (fields?: Record<string, unknown>) => {
			const state: {
				fields?: Record<string, unknown>;
				table?: string;
				sessionId?: string;
			} = { fields };
			const chain = {
				from: (table: Record<string, unknown>) => {
					state.table = isSessionsTable(table) ? "sessions" : "projects";
					return chain;
				},
				where: () => chain,
				limit: async () => {
					if (state.table === "sessions") {
						// Prefer primary session for single-session tests
						const row = session;
						if (state.fields && "previewPort" in state.fields) {
							return [
								{
									previewPort: row.previewPort,
									status: row.status,
								},
							];
						}
						return row.status === "active" ? [{ ...row }] : [];
					}
					return [{ ...project }];
				},
			};
			return chain;
		},
		update: (table: Record<string, unknown>) => {
			const projectsTable = isProjectsTable(table);
			const sessionsTable = isSessionsTable(table);
			return {
				set: (values: Record<string, unknown>) => {
					const apply = async () => {
						if (projectsTable) {
							if ("previewLockToken" in values) {
								const token = values.previewLockToken as string | null;
								if (token === null) {
									project.previewLockToken = null;
									project.previewLockExpiresAt = null;
								} else {
									const now = testNowSeconds;
									const open =
										project.previewLockToken == null ||
										project.previewLockExpiresAt == null ||
										project.previewLockExpiresAt <= now;
									if (open) {
										project.previewLockToken = token;
										project.previewLockExpiresAt =
											typeof values.previewLockExpiresAt === "number"
												? values.previewLockExpiresAt
												: now + 900;
									}
								}
							}
							if ("deletingAt" in values) {
								project.deletingAt = values.deletingAt as number;
								project.status = "failed";
							}
							if (values.status === "failed") project.status = "failed";
						}
						if (sessionsTable) {
							if ("previewPort" in values) {
								session.previewPort = values.previewPort as number | null;
							}
							if (values.status === "archived") session.status = "archived";
							if ("workspacePath" in values) {
								Object.assign(session, values);
							}
						}
					};

					return {
						where: () => {
							const promise = apply().then(() => [] as unknown[]);
							return Object.assign(promise, {
								returning: async (fields?: Record<string, unknown>) => {
									await apply();
									if (projectsTable && fields) return [{ id: project.id }];
									if (sessionsTable && fields && values.status === "archived") {
										return [{ id: session.id }];
									}
									if (sessionsTable && fields) return [{ id: session.id }];
									return [];
								},
							});
						},
					};
				},
			};
		},
		delete: () => ({
			where: () => ({
				returning: async () => {
					project.previewLockToken = null;
					return [{ id: project.id }];
				},
			}),
		}),
	};

	return {
		db: db as unknown as SessionPreviewDeps["db"],
		project,
		session,
		sessions,
	};
}

/** Real node:sqlite + drizzle proxy for allocation uniqueness contracts. */
function createSqliteDb(seed: {
	project: ProjectState;
	sessions: SessionState[];
}) {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE projects (
			id text PRIMARY KEY NOT NULL,
			name text NOT NULL DEFAULT 'P',
			userId text NOT NULL,
			status text NOT NULL DEFAULT 'ready',
			sandboxId text,
			githubRepo text,
			githubInstallationId integer,
			previewLockToken text,
			previewLockExpiresAt integer,
			deletingAt integer,
			sandboxBackup text,
			sandboxBackupCreatedAt integer,
			sandboxBackupRequestedGeneration integer NOT NULL DEFAULT 0,
			sandboxBackupStoredGeneration integer NOT NULL DEFAULT 0,
			description text,
			envVars text,
			created_at integer,
			updated_at integer
		);
		CREATE TABLE workspace_sessions (
			id text PRIMARY KEY NOT NULL,
			projectId text NOT NULL,
			userId text NOT NULL,
			title text,
			branchName text,
			baseCommitSha text,
			workspacePath text NOT NULL DEFAULT '/workspace',
			memoryPath text NOT NULL DEFAULT '/workspace/.ditto/project-memory.md',
			status text NOT NULL DEFAULT 'active',
			previewPort integer,
			created_at integer,
			updated_at integer
		);
		CREATE UNIQUE INDEX workspace_sessions_project_preview_port_uidx
			ON workspace_sessions (projectId, previewPort);
	`);

	sqlite
		.prepare(
			`INSERT INTO projects (
				id, name, userId, status, sandboxId, githubRepo, githubInstallationId,
				previewLockToken, previewLockExpiresAt, deletingAt
			) VALUES (?, 'P', ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			seed.project.id,
			seed.project.userId,
			seed.project.status,
			seed.project.sandboxId,
			seed.project.githubRepo,
			seed.project.githubInstallationId,
			seed.project.previewLockToken,
			seed.project.previewLockExpiresAt,
			seed.project.deletingAt,
		);

	const insertSession = sqlite.prepare(
		`INSERT INTO workspace_sessions (
			id, projectId, userId, status, previewPort, branchName, baseCommitSha, workspacePath
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	for (const s of seed.sessions) {
		insertSession.run(
			s.id,
			s.projectId,
			s.userId,
			s.status,
			s.previewPort,
			s.branchName,
			s.baseCommitSha,
			s.workspacePath,
		);
	}

	const db = drizzle(async (sql, params, method) => {
		const stmt = sqlite.prepare(sql);
		if (method === "run") {
			stmt.run(...(params as never[]));
			return { rows: [] };
		}
		if (method === "get") {
			const row = stmt.get(...(params as never[])) as
				| Record<string, unknown>
				| undefined;
			// drizzle mapGetResult treats rows as the value array itself
			return {
				rows: row ? (Object.values(row) as unknown[]) : (undefined as never),
			};
		}
		const rows = stmt.all(...(params as never[])) as Record<string, unknown>[];
		return { rows: rows.map((r) => Object.values(r)) };
	}) as unknown as SessionPreviewDeps["db"];

	return {
		db,
		sqlite,
		getSessionPort(id: string) {
			const row = sqlite
				.prepare(`SELECT previewPort FROM workspace_sessions WHERE id = ?`)
				.get(id) as { previewPort: number | null } | undefined;
			return row?.previewPort ?? null;
		},
		getSessionStatus(id: string) {
			const row = sqlite
				.prepare(`SELECT status FROM workspace_sessions WHERE id = ?`)
				.get(id) as { status: string } | undefined;
			return row?.status;
		},
		getProject() {
			return sqlite
				.prepare(`SELECT * FROM projects WHERE id = ?`)
				.get(seed.project.id) as Record<string, unknown> | undefined;
		},
	};
}

const baseProject = (): ProjectState => ({
	id: "proj-1",
	userId: "user-1",
	status: "ready",
	sandboxId: "sandbox-1",
	githubRepo: "acme/app",
	githubInstallationId: 42,
	previewLockToken: null,
	previewLockExpiresAt: null,
	deletingAt: null,
});

const baseSession = (id = "sess-1"): SessionState => ({
	id,
	projectId: "proj-1",
	userId: "user-1",
	status: "active",
	previewPort: null,
	branchName: `ditto/session-${id}`,
	baseCommitSha: "abc",
	workspacePath: `/workspace/.ditto/worktrees/${id}`,
});

const vitePackageJson = JSON.stringify({
	name: "app",
	scripts: { dev: "vite" },
	devDependencies: { vite: "^6.1.0" },
});
const viteVersionJson = JSON.stringify({ name: "vite", version: "6.1.0" });

function viteSandbox(
	overrides: Partial<SessionPreviewSandbox> = {},
): SessionPreviewSandbox {
	return makeSandbox({
		readFile: vi.fn(async (path: string) => {
			if (path.includes("node_modules/vite")) {
				return { content: viteVersionJson };
			}
			return { content: vitePackageJson };
		}),
		exists: vi.fn(async () => ({ exists: true })),
		...overrides,
	});
}

function baseInjected(
	sandbox: SessionPreviewSandbox,
	_db: SessionPreviewDeps["db"],
	token = "lease-1",
	project: ProjectState = baseProject(),
): Partial<SessionPreviewDeps> {
	return {
		getSandbox: () => sandbox,
		ensureProjectSandbox: vi.fn(async () => ({
			project: project as never,
			state: "connected" as const,
		})),
		ensureSessionWorkspaceReady: vi.fn().mockImplementation(
			async (opts: {
				sessionId: string;
				existing: {
					branchName: string | null;
					baseCommitSha: string | null;
					workspacePath: string;
				};
			}) => ({
				branchName:
					opts.existing.branchName ?? `ditto/session-${opts.sessionId}`,
				baseCommitSha: opts.existing.baseCommitSha ?? "abc",
				workspacePath:
					opts.existing.workspacePath ||
					`/workspace/.ditto/worktrees/${opts.sessionId}`,
			}),
		),
		nowSeconds: () => testNowSeconds,
		randomToken: () => token,
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	};
}

function wireExposeToPort(sandbox: SessionPreviewSandbox) {
	sandbox.startProcess = vi.fn(async (_cmd, opts) => {
		const port = Number(opts.env.PORT);
		sandbox.exposePort = vi.fn(async () => ({
			url: `https://${port}-box-token.ayn.wtf`,
			port,
		}));
		return makeProcess();
	});
}

afterEach(() => {
	vi.useRealTimers();
	testNowSeconds = 1_700_000_000;
});

describe("preview helpers", () => {
	it("parses strict installed vite semver and gates >=6.1", () => {
		expect(parseLeadingSemver("6.1.0")).toEqual([6, 1, 0]);
		expect(parseLeadingSemver("6.1.0+build.1")).toEqual([6, 1, 0]);
		expect(parseLeadingSemver("7.0.0")).toEqual([7, 0, 0]);
		expect(parseLeadingSemver("6.0.9")).toEqual([6, 0, 9]);
		expect(parseLeadingSemver("^6.2.3")).toBeNull();
		expect(parseLeadingSemver("garbage6.1.0")).toBeNull();
		expect(parseLeadingSemver("6.1.0-beta.1")).toBeNull();
		expect(parseLeadingSemver("not-a-version")).toBeNull();
		expect(isViteVersionSupported("6.1.0")).toBe(true);
		expect(isViteVersionSupported("7.0.0")).toBe(true);
		expect(isViteVersionSupported("6.0.9")).toBe(false);
		expect(isViteVersionSupported("5.4.0")).toBe(false);
		expect(isViteVersionSupported("^6.2.3")).toBe(false);
		expect(isViteVersionSupported("garbage6.1.0")).toBe(false);
		expect(isViteVersionSupported("6.1.0-beta.1")).toBe(false);
		expect(isAstroVersionSupported("5.4.0")).toBe(true);
		expect(isAstroVersionSupported("6.0.0")).toBe(true);
		expect(isAstroVersionSupported("5.3.9")).toBe(false);
		expect(isAstroVersionSupported("4.16.0")).toBe(false);
		expect(isAstroVersionSupported("^5.4.0")).toBe(false);
	});

	it("resolves local host with port; production only exact HTTPS apex", () => {
		expect(
			resolvePreviewHostname({
				requestUrl: "http://localhost:5173/x",
				previewBaseHost: "ayn.wtf",
			}),
		).toBe("localhost:5173");
		expect(
			resolvePreviewHostname({
				requestUrl: "http://127.0.0.1:8787/",
				previewBaseHost: "ayn.wtf",
			}),
		).toBe("localhost:8787");
		expect(
			resolvePreviewHostname({
				requestUrl: "http://127.0.0.1/",
				previewBaseHost: "ayn.wtf",
			}),
		).toBe("localhost");
		expect(
			resolvePreviewHostname({
				requestUrl: "https://ayn.wtf/",
				previewBaseHost: "ayn.wtf",
			}),
		).toBe("ayn.wtf");
		expect(
			resolvePreviewHostname({
				requestUrl: "https://ayn.wtf/app",
				previewBaseHost: "ayn.wtf",
			}),
		).toBe("ayn.wtf");
		expect(() =>
			resolvePreviewHostname({
				requestUrl: "https://evil.example/",
				previewBaseHost: "ayn.wtf",
			}),
		).toThrow(SessionPreviewError);
		expect(() =>
			resolvePreviewHostname({
				requestUrl: "https://ayn.wtf.evil.example/",
				previewBaseHost: "ayn.wtf",
			}),
		).toThrow(SessionPreviewError);
		expect(() =>
			resolvePreviewHostname({
				requestUrl: "https://ayn.wtf:8443/",
				previewBaseHost: "ayn.wtf",
			}),
		).toThrow(SessionPreviewError);
		expect(() =>
			resolvePreviewHostname({
				requestUrl: "http://ayn.wtf/",
				previewBaseHost: "ayn.wtf",
			}),
		).toThrow(SessionPreviewError);
		expect(() =>
			resolvePreviewHostname({
				requestUrl: "https://foo.workers.dev/",
				previewBaseHost: "ayn.wtf",
			}),
		).toThrow(SessionPreviewError);
		expect(() =>
			resolvePreviewHostname({
				requestUrl: "https://ayn.wtf/",
				previewBaseHost: undefined,
			}),
		).toThrow(SessionPreviewError);
		expect(() =>
			resolvePreviewHostname({
				requestUrl: "https://ayn.wtf/",
				previewBaseHost: "*.ayn.wtf",
			}),
		).toThrow(SessionPreviewError);
	});

	it("validates production and local URLs", () => {
		expect(
			validatePreviewUrl({
				url: "https://10000-box-token.ayn.wtf",
				port: 10000,
				hostname: "ayn.wtf",
				local: false,
			}),
		).toBe("https://10000-box-token.ayn.wtf");
		expect(() =>
			validatePreviewUrl({
				url: "https://10000-box-token.preview.ayn.wtf",
				port: 10000,
				hostname: "ayn.wtf",
				local: false,
			}),
		).toThrow(SessionPreviewError);
		// SDK 0.12.3 local shape: <port>-<sandbox>-<token>.localhost:<app-port>
		expect(
			validatePreviewUrl({
				url: "http://10000-box-token.localhost:5173/",
				port: 10000,
				hostname: "localhost:5173",
				local: true,
			}),
		).toBe("http://10000-box-token.localhost:5173/");
		expect(
			validatePreviewUrl({
				url: "https://10000-box-token.localhost:5173/",
				port: 10000,
				hostname: "localhost:5173",
				local: true,
			}),
		).toBe("https://10000-box-token.localhost:5173/");

		const localRejects: Array<{
			url: string;
			port?: number;
			hostname?: string;
		}> = [
			{ url: "http://10001-box-token.localhost:5173/" }, // wrong leased-port prefix
			{ url: "http://10000-box.evil.localhost:5173/" }, // nested label
			{ url: "http://10000-box-token.localhost.evil:5173/" }, // lookalike
			{ url: "http://10000-box-token.localhost:4173/" }, // wrong Alchemy port
			{ url: "http://localhost:10000/" }, // old incorrect shape
			{ url: "http://10000-box-token.localhost:5173/?x=1" }, // search
			{
				url: "http://user:pass@10000-box-token.localhost:5173/",
			}, // credentials
		];
		for (const row of localRejects) {
			expect(() =>
				validatePreviewUrl({
					url: row.url,
					port: row.port ?? 10000,
					hostname: row.hostname ?? "localhost:5173",
					local: true,
				}),
			).toThrow(SessionPreviewError);
		}
	});
});

describe("discoverPreviewCommand", () => {
	it("builds fixed vite command and env", async () => {
		const result = await discoverPreviewCommand({
			sandbox: viteSandbox(),
			cwd: "/workspace/.ditto/worktrees/sess-1",
			port: 10000,
		});
		expect(result.command).toBe(
			"./node_modules/.bin/vite --host 0.0.0.0 --port 10000 --strictPort",
		);
		expect(result.env).toEqual({
			HOST: "0.0.0.0",
			PORT: "10000",
			__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".ayn.wtf",
		});
	});

	it("rejects old vite and wrappers", async () => {
		const old = makeSandbox({
			readFile: vi.fn(async (path: string) => {
				if (path.includes("node_modules/vite")) {
					return { content: JSON.stringify({ version: "6.0.0" }) };
				}
				return {
					content: JSON.stringify({
						scripts: { dev: "vite" },
						devDependencies: { vite: "6.0.0" },
					}),
				};
			}),
		});
		await expect(
			discoverPreviewCommand({
				sandbox: old,
				cwd: "/wt",
				port: 10000,
			}),
		).rejects.toMatchObject({ code: "unsupported_project" });

		const wrapper = makeSandbox({
			readFile: vi.fn(async () => ({
				content: JSON.stringify({
					scripts: { dev: "npm run vite" },
					devDependencies: { vite: "6.1.0" },
				}),
			})),
		});
		await expect(
			discoverPreviewCommand({
				sandbox: wrapper,
				cwd: "/wt",
				port: 10000,
			}),
		).rejects.toMatchObject({ code: "unsupported_project" });
	});

	it("builds fixed next command", async () => {
		const sandbox = makeSandbox({
			readFile: vi.fn(async () => ({
				content: JSON.stringify({
					scripts: { dev: "next dev" },
					dependencies: { next: "15.0.0" },
				}),
			})),
		});
		const result = await discoverPreviewCommand({
			sandbox,
			cwd: "/wt",
			port: 10001,
		});
		expect(result.command).toBe(
			"./node_modules/.bin/next dev --hostname 0.0.0.0 --port 10001",
		);
		expect(result.env).toEqual({ HOST: "0.0.0.0", PORT: "10001" });
	});

	it("builds fixed astro command and env", async () => {
		const sandbox = makeSandbox({
			readFile: vi.fn(async (path: string) => {
				if (path.includes("node_modules/astro")) {
					return { content: JSON.stringify({ version: "5.4.0" }) };
				}
				return {
					content: JSON.stringify({
						scripts: { dev: "astro dev" },
						dependencies: { astro: "5.4.0" },
						devDependencies: { vite: "6.1.0" },
					}),
				};
			}),
		});
		const result = await discoverPreviewCommand({
			sandbox,
			cwd: "/wt",
			port: 10002,
		});
		expect(result.framework).toBe("astro");
		expect(result.command).toBe(
			"./node_modules/.bin/astro dev --host 0.0.0.0 --port 10002 --allowed-hosts=.ayn.wtf",
		);
		expect(result.env).toEqual({
			HOST: "0.0.0.0",
			PORT: "10002",
			__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".ayn.wtf",
		});
	});

	it("rejects old astro, wrappers, and missing binary", async () => {
		const old = makeSandbox({
			readFile: vi.fn(async (path: string) => {
				if (path.includes("node_modules/astro")) {
					return { content: JSON.stringify({ version: "5.3.0" }) };
				}
				return {
					content: JSON.stringify({
						scripts: { dev: "astro dev" },
						dependencies: { astro: "5.3.0" },
					}),
				};
			}),
		});
		await expect(
			discoverPreviewCommand({
				sandbox: old,
				cwd: "/wt",
				port: 10000,
			}),
		).rejects.toMatchObject({ code: "unsupported_project" });

		const wrapper = makeSandbox({
			readFile: vi.fn(async () => ({
				content: JSON.stringify({
					scripts: { dev: "astro dev --open" },
					dependencies: { astro: "5.4.0" },
				}),
			})),
		});
		await expect(
			discoverPreviewCommand({
				sandbox: wrapper,
				cwd: "/wt",
				port: 10000,
			}),
		).rejects.toMatchObject({ code: "unsupported_project" });

		const missingBin = makeSandbox({
			readFile: vi.fn(async (path: string) => {
				if (path.includes("node_modules/astro")) {
					return { content: JSON.stringify({ version: "5.4.0" }) };
				}
				return {
					content: JSON.stringify({
						scripts: { dev: "astro" },
						devDependencies: { astro: "5.4.0" },
					}),
				};
			}),
			exists: vi.fn(async (path: string) => ({
				exists: !path.includes("node_modules/.bin/astro"),
			})),
		});
		await expect(
			discoverPreviewCommand({
				sandbox: missingBin,
				cwd: "/wt",
				port: 10000,
			}),
		).rejects.toMatchObject({ code: "unsupported_project" });
	});

	it("selects astro by script when vite is also a direct dependency", async () => {
		const sandbox = makeSandbox({
			readFile: vi.fn(async (path: string) => {
				if (path.includes("node_modules/astro")) {
					return { content: JSON.stringify({ version: "5.7.1" }) };
				}
				return {
					content: JSON.stringify({
						scripts: { dev: "astro dev" },
						dependencies: { astro: "5.7.1", vite: "6.2.0" },
					}),
				};
			}),
		});
		const result = await discoverPreviewCommand({
			sandbox,
			cwd: "/wt",
			port: 10000,
		});
		expect(result.framework).toBe("astro");
	});
});

describe("project preview lease", () => {
	it("acquires, rejects unexpired contention, takes over expired, releases", async () => {
		const { db, project } = createMemoryDb({
			project: baseProject(),
			session: baseSession(),
		});
		const now = 1_700_000_000;
		const deps: SessionPreviewDeps = {
			db,
			env: {} as Env,
			nowSeconds: () => now,
			randomToken: () => "token-a",
			sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
			getSandbox: () => makeSandbox(),
			ensureProjectSandbox: vi.fn(),
			ensureSessionWorkspaceReady: vi.fn(),
		};

		const first = await acquireProjectPreviewLease(deps, {
			projectId: "proj-1",
			userId: "user-1",
		});
		expect(first.token).toBe("token-a");
		expect(project.previewLockToken).toBe("token-a");

		deps.randomToken = () => "token-b";
		vi.useFakeTimers();
		const busyPromise = acquireProjectPreviewLease(deps, {
			projectId: "proj-1",
			userId: "user-1",
		});
		const busyExpect = expect(busyPromise).rejects.toMatchObject({
			code: "busy",
		});
		await vi.advanceTimersByTimeAsync(5_200);
		await busyExpect;
		vi.useRealTimers();

		project.previewLockExpiresAt = now - 1;
		deps.randomToken = () => "token-c";
		const taken = await acquireProjectPreviewLease(deps, {
			projectId: "proj-1",
			userId: "user-1",
		});
		expect(taken.token).toBe("token-c");

		await releaseProjectPreviewLease(deps, {
			projectId: "proj-1",
			userId: "user-1",
			token: "token-c",
		});
		expect(project.previewLockToken).toBeNull();
	});
});

describe("real D1 allocation semantics", () => {
	it("enforces unique project+port across sessions and converges same session", async () => {
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [baseSession("sess-1"), baseSession("sess-2")],
		});
		// Occupy preferred ports for sess-1's hash neighbors by filling all but prove collision
		sqliteDb.sqlite
			.prepare(`UPDATE workspace_sessions SET previewPort = ? WHERE id = ?`)
			.run(10000, "sess-2");

		const sandbox = viteSandbox();
		wireExposeToPort(sandbox);

		const result = await startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/",
			},
			baseInjected(sandbox, sqliteDb.db, "alloc-1"),
		);
		expect(result.port).not.toBe(10000);
		expect(sqliteDb.getSessionPort("sess-1")).toBe(result.port);
		expect(sqliteDb.getSessionPort("sess-2")).toBe(10000);

		// Same-session convergence: second start reuses port, no second process if healthy+exposed
		const proc = makeProcess();
		const reuseSandbox = viteSandbox({
			getProcess: vi.fn().mockResolvedValue(proc),
			getExposedPorts: vi.fn().mockResolvedValue([
				{
					url: `https://${result.port}-box-token.ayn.wtf`,
					port: result.port,
					status: "active",
				},
			]),
		});
		const reused = await startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/",
			},
			baseInjected(reuseSandbox, sqliteDb.db, "alloc-2"),
		);
		expect(reused.port).toBe(result.port);
		expect(reused.reused).toBe(true);
		expect(reuseSandbox.startProcess).not.toHaveBeenCalled();
	});

	it("exhausts capacity after 32 ports", async () => {
		const sessions: SessionState[] = Array.from({ length: 32 }, (_, i) => ({
			...baseSession(`sess-fill-${i}`),
			previewPort: SESSION_PREVIEW_PORT_MIN + i,
		}));
		sessions.push(baseSession("sess-overflow"));
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions,
		});
		const sandbox = viteSandbox();
		await expect(
			startSessionPreview(
				{
					db: sqliteDb.db,
					env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
					projectId: "proj-1",
					sessionId: "sess-overflow",
					userId: "user-1",
					requestUrl: "https://ayn.wtf/",
				},
				baseInjected(sandbox, sqliteDb.db, "cap-1"),
			),
		).rejects.toMatchObject({ code: "capacity_exhausted" });
		expect(sqliteDb.getSessionPort("sess-overflow")).toBeNull();
		expect(sandbox.startProcess).not.toHaveBeenCalled();
	});
});

describe("startSessionPreview", () => {
	it("prepares node_modules on existing worktree before discovery", async () => {
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});
		const sandbox = viteSandbox();
		wireExposeToPort(sandbox);
		const ensureReady = vi.fn().mockResolvedValue({
			branchName: "ditto/session-sess-1",
			baseCommitSha: "abc",
			workspacePath: "/workspace/.ditto/worktrees/sess-1",
		});

		await startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/",
			},
			{
				...baseInjected(sandbox, sqliteDb.db),
				ensureSessionWorkspaceReady: ensureReady,
			},
		);

		expect(ensureReady).toHaveBeenCalledWith(
			expect.objectContaining({
				sandboxId: "sandbox-1",
				sessionId: "sess-1",
				lock: "acquire",
			}),
		);
		expect(sandbox.startProcess).toHaveBeenCalledWith(
			expect.stringContaining("./node_modules/.bin/vite --host 0.0.0.0 --port"),
			expect.any(Object),
		);
		expect(sandbox.startProcess).toHaveBeenCalledWith(
			expect.not.stringContaining("--cacheDir"),
			expect.any(Object),
		);
		expect(ensureReady.mock.invocationCallOrder[0]).toBeLessThan(
			(sandbox.startProcess as ReturnType<typeof vi.fn>).mock
				.invocationCallOrder[0],
		);
	});

	it("waits tcp then best-effort http before expose", async () => {
		const order: string[] = [];
		const proc = makeProcess({
			waitForPort: vi.fn(async (_port, opts) => {
				order.push(opts?.mode ?? "unknown");
			}),
			getStatus: vi.fn(async (): Promise<"running"> => {
				order.push("status");
				return "running";
			}),
		});
		const sandbox = viteSandbox({
			getProcess: vi.fn().mockResolvedValue(null),
			startProcess: vi.fn().mockResolvedValue(proc),
			exposePort: vi.fn(async () => {
				order.push("expose");
				return { url: "https://10000-box-token.ayn.wtf", port: 10000 };
			}),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});

		await startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/",
			},
			baseInjected(sandbox, sqliteDb.db),
		);

		expect(order).toEqual(["tcp", "http", "status", "expose"]);
		expect(proc.waitForPort).toHaveBeenCalledWith(10000, {
			mode: "tcp",
			timeout: 30_000,
		});
		expect(proc.waitForPort).toHaveBeenCalledWith(10000, {
			mode: "http",
			timeout: 5_000,
			path: "/",
			status: { min: 100, max: 599 },
		});
	});

	it("continues when http readiness fails but process stays healthy", async () => {
		const proc = makeProcess({
			waitForPort: vi.fn(async (_port, opts) => {
				if (opts?.mode === "http") {
					throw new Error("not ready");
				}
			}),
			getStatus: vi.fn().mockResolvedValue("running"),
		});
		const sandbox = viteSandbox({
			getProcess: vi.fn().mockResolvedValue(null),
			startProcess: vi.fn().mockResolvedValue(proc),
			exposePort: vi.fn().mockResolvedValue({
				url: "https://10000-box-token.ayn.wtf",
				port: 10000,
			}),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});

		const result = await startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/",
			},
			baseInjected(sandbox, sqliteDb.db),
		);
		expect(result.status).toBe("running");
		expect(sandbox.exposePort).toHaveBeenCalled();
	});

	it("accepts SDK 0.12.3 local expose URL and canonicalizes 127.0.0.1 host", async () => {
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});
		const exposedUrl = "http://10000-box-token.localhost:5173/";
		const sandbox = viteSandbox({
			exposePort: vi.fn(async () => ({
				url: exposedUrl,
				port: 10000,
			})),
		});

		const result = await startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "http://127.0.0.1:5173/project/p/session/s",
			},
			baseInjected(sandbox, sqliteDb.db),
		);

		expect(result.status).toBe("running");
		expect(result.reused).toBe(false);
		expect(result.url).toBe(exposedUrl);
		expect(result.port).toBe(10000);
		expect(sandbox.exposePort).toHaveBeenCalledWith(10000, {
			hostname: "localhost:5173",
		});
		expect(sqliteDb.getSessionPort("sess-1")).toBe(10000);
	});

	it("starts, exposes, returns url without persisting it", async () => {
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [baseSession()],
		});
		const sandbox = viteSandbox();
		wireExposeToPort(sandbox);

		const result = await startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/app",
			},
			baseInjected(sandbox, sqliteDb.db),
		);
		expect(result.status).toBe("running");
		expect(result.reused).toBe(false);
		expect(result.url).toMatch(/^https:\/\/100\d{2}-box-token\.ayn\.wtf$/);
		expect(result.port).toBeGreaterThanOrEqual(SESSION_PREVIEW_PORT_MIN);
		expect(sandbox.startProcess).toHaveBeenCalledWith(
			expect.stringContaining("./node_modules/.bin/vite"),
			expect.objectContaining({
				cwd: "/workspace/.ditto/worktrees/sess-1",
				autoCleanup: true,
				env: expect.objectContaining({
					HOST: "0.0.0.0",
					__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".ayn.wtf",
				}),
			}),
		);
		expect(sqliteDb.getSessionPort("sess-1")).toBe(result.port);
		expect(sqliteDb.getProject()?.previewLockToken).toBeNull();
	});

	it("reuses healthy process + exposure", async () => {
		const process = makeProcess();
		const sandbox = viteSandbox({
			getProcess: vi.fn().mockResolvedValue(process),
			getExposedPorts: vi.fn().mockResolvedValue([
				{
					url: "https://10000-box-token.ayn.wtf",
					port: 10000,
					status: "active",
				},
			]),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});
		const result = await startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/",
			},
			baseInjected(sandbox, sqliteDb.db),
		);
		expect(result.reused).toBe(true);
		expect(sandbox.startProcess).not.toHaveBeenCalled();
		expect(sandbox.exposePort).not.toHaveBeenCalled();
	});

	it("maps terminal process after start to start_failed (no root port probe)", async () => {
		const dead = makeProcess({
			status: "failed",
			waitForPort: vi.fn().mockRejectedValue(new Error("closed")),
			getStatus: vi.fn().mockResolvedValue("failed"),
		});
		const sandbox = viteSandbox({
			getProcess: vi.fn().mockResolvedValue(null),
			startProcess: vi.fn().mockResolvedValue(dead),
			unexposePort: vi.fn().mockResolvedValue(undefined),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});
		await expect(
			startSessionPreview(
				{
					db: sqliteDb.db,
					env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
					projectId: "proj-1",
					sessionId: "sess-1",
					userId: "user-1",
					requestUrl: "https://ayn.wtf/",
				},
				baseInjected(sandbox, sqliteDb.db),
			),
		).rejects.toMatchObject({ code: "start_failed" });
		expect(sandbox.exposePort).not.toHaveBeenCalled();
		expect(sandbox.unexposePort).toHaveBeenCalledWith(10000);
		expect(sqliteDb.getSessionPort("sess-1")).toBeNull();
	});

	it("invalid expose URL revokes exposure, kills process, clears lease", async () => {
		const proc = makeProcess({ status: "running" });
		proc.kill = vi.fn(async () => {
			proc.status = "killed";
		});
		let gone = false;
		const sandbox = viteSandbox({
			getProcess: vi.fn(async () => {
				if (gone || proc.status === "killed") {
					gone = true;
					return null;
				}
				return proc;
			}),
			startProcess: vi.fn(async () => proc),
			exposePort: vi.fn(async () => ({
				url: "https://evil.example.com",
				port: 10000,
			})),
			unexposePort: vi.fn().mockResolvedValue(undefined),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});
		await expect(
			startSessionPreview(
				{
					db: sqliteDb.db,
					env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
					projectId: "proj-1",
					sessionId: "sess-1",
					userId: "user-1",
					requestUrl: "https://ayn.wtf/",
				},
				baseInjected(sandbox, sqliteDb.db),
			),
		).rejects.toMatchObject({ code: "expose_failed" });
		expect(sandbox.unexposePort).toHaveBeenCalledWith(10000);
		expect(sqliteDb.getSessionPort("sess-1")).toBeNull();
	});

	it("second discovery failure after allocation cleans up and returns unsupported_project", async () => {
		let reads = 0;
		const sandbox = viteSandbox({
			readFile: vi.fn(async (path: string) => {
				if (path.includes("node_modules/vite")) {
					return { content: viteVersionJson };
				}
				reads += 1;
				// First discovery (pre-alloc) succeeds; second (post-alloc) fails package.
				if (reads >= 2 && !path.includes("node_modules")) {
					return {
						content: JSON.stringify({
							scripts: { dev: "npm run something" },
							devDependencies: { vite: "6.1.0" },
						}),
					};
				}
				return { content: vitePackageJson };
			}),
			unexposePort: vi.fn().mockResolvedValue(undefined),
			getProcess: vi.fn().mockResolvedValue(null),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [baseSession()],
		});
		await expect(
			startSessionPreview(
				{
					db: sqliteDb.db,
					env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
					projectId: "proj-1",
					sessionId: "sess-1",
					userId: "user-1",
					requestUrl: "https://ayn.wtf/",
				},
				baseInjected(sandbox, sqliteDb.db),
			),
		).rejects.toMatchObject({ code: "unsupported_project" });
		expect(sandbox.unexposePort).toHaveBeenCalled();
		expect(sandbox.startProcess).not.toHaveBeenCalled();
		expect(sqliteDb.getSessionPort("sess-1")).toBeNull();
	});

	it("getExposedPorts throw after allocation cleans up with fixed start_failed", async () => {
		const sandbox = viteSandbox({
			getProcess: vi.fn().mockResolvedValue(null),
			getExposedPorts: vi.fn().mockRejectedValue(new Error("sdk boom")),
			unexposePort: vi.fn().mockResolvedValue(undefined),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});
		await expect(
			startSessionPreview(
				{
					db: sqliteDb.db,
					env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
					projectId: "proj-1",
					sessionId: "sess-1",
					userId: "user-1",
					requestUrl: "https://ayn.wtf/",
				},
				baseInjected(sandbox, sqliteDb.db),
			),
		).rejects.toMatchObject({ code: "start_failed" });
		expect(sandbox.unexposePort).toHaveBeenCalledWith(10000);
		expect(sqliteDb.getSessionPort("sess-1")).toBeNull();
	});

	it("cleanup cannot confirm revocation retains D1 port as cleanup_failed", async () => {
		const sticky = makeProcess({
			status: "running",
			waitForPort: vi.fn().mockRejectedValue(new Error("closed")),
			getStatus: vi.fn().mockResolvedValue("failed"),
			kill: vi.fn().mockResolvedValue(undefined),
		});
		const sandbox = viteSandbox({
			getProcess: vi.fn().mockResolvedValue(sticky),
			startProcess: vi.fn().mockResolvedValue(sticky),
			unexposePort: vi.fn().mockResolvedValue(undefined),
			killProcess: vi.fn().mockResolvedValue(undefined),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});
		// getProcess always returns healthy sticky process → processGone false
		await expect(
			startSessionPreview(
				{
					db: sqliteDb.db,
					env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
					projectId: "proj-1",
					sessionId: "sess-1",
					userId: "user-1",
					requestUrl: "https://ayn.wtf/",
				},
				baseInjected(sandbox, sqliteDb.db),
			),
		).rejects.toMatchObject({ code: "cleanup_failed" });
		expect(sqliteDb.getSessionPort("sess-1")).toBe(10000);
	});

	it("retains lease when cleanup unexpose rejects after start failure", async () => {
		const sandbox = viteSandbox({
			startProcess: vi.fn().mockRejectedValue(new Error("boom")),
			getProcess: vi.fn().mockResolvedValue(null),
			unexposePort: vi.fn().mockRejectedValue(new Error("nope")),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});
		await expect(
			startSessionPreview(
				{
					db: sqliteDb.db,
					env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
					projectId: "proj-1",
					sessionId: "sess-1",
					userId: "user-1",
					requestUrl: "https://ayn.wtf/",
				},
				baseInjected(sandbox, sqliteDb.db),
			),
		).rejects.toMatchObject({ code: "cleanup_failed" });
		expect(sqliteDb.getSessionPort("sess-1")).toBe(10000);
	});

	it("rejects not_ready without sandbox access on missing github", async () => {
		const sqliteDb = createSqliteDb({
			project: {
				...baseProject(),
				githubRepo: null,
				githubInstallationId: null,
			},
			sessions: [baseSession()],
		});
		const sandbox = viteSandbox();
		const injected = baseInjected(sandbox, sqliteDb.db, "lease-1", {
			...baseProject(),
			githubRepo: null,
			githubInstallationId: null,
		});
		await expect(
			startSessionPreview(
				{
					db: sqliteDb.db,
					env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
					projectId: "proj-1",
					sessionId: "sess-1",
					userId: "user-1",
					requestUrl: "https://ayn.wtf/",
				},
				injected,
			),
		).rejects.toMatchObject({ code: "not_ready" });
		expect(injected.ensureProjectSandbox).not.toHaveBeenCalled();
	});
});

describe("stop and archive cleanup", () => {
	it("clears lease only after unexpose + process death", async () => {
		const proc = makeProcess({ status: "running" });
		proc.kill = vi.fn(async () => {
			proc.status = "killed";
		});
		let gone = false;
		const sandbox = makeSandbox({
			getProcess: vi.fn(async () => {
				if (gone) return null;
				if (proc.status === "killed") {
					gone = true;
					return null;
				}
				return proc;
			}),
			unexposePort: vi.fn().mockResolvedValue(undefined),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});

		const result = await stopSessionPreview(
			{
				db: sqliteDb.db,
				env: {} as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
			},
			baseInjected(sandbox, sqliteDb.db, "lease-stop"),
		);
		expect(result).toEqual({ status: "stopped" });
		expect(sqliteDb.getSessionPort("sess-1")).toBeNull();
		expect(sandbox.unexposePort).toHaveBeenCalledWith(10000);
	});

	it("retains lease when unexpose rejects even if exposure list empty", async () => {
		const sandbox = makeSandbox({
			getProcess: vi.fn().mockResolvedValue(null),
			unexposePort: vi.fn().mockRejectedValue(new Error("nope")),
			getExposedPorts: vi.fn().mockResolvedValue([]),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});
		await expect(
			stopSessionPreview(
				{
					db: sqliteDb.db,
					env: {} as Env,
					projectId: "proj-1",
					sessionId: "sess-1",
					userId: "user-1",
				},
				baseInjected(sandbox, sqliteDb.db, "lease-x"),
			),
		).rejects.toMatchObject({ code: "cleanup_failed" });
		expect(sqliteDb.getSessionPort("sess-1")).toBe(10000);
	});

	it("archives only after successful cleanup", async () => {
		const sandbox = makeSandbox({
			getProcess: vi.fn().mockResolvedValue(null),
			unexposePort: vi.fn().mockResolvedValue(undefined),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10005 }],
		});
		const result = await archiveSessionWithPreviewCleanup(
			{
				db: sqliteDb.db,
				env: {} as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
			},
			baseInjected(sandbox, sqliteDb.db, "lease-a"),
		);
		expect(result).toEqual({ id: "sess-1" });
		expect(sqliteDb.getSessionStatus("sess-1")).toBe("archived");
		expect(sqliteDb.getSessionPort("sess-1")).toBeNull();
	});

	it("does not archive when cleanup fails", async () => {
		const sandbox = makeSandbox({
			getProcess: vi.fn().mockResolvedValue(makeProcess({ status: "running" })),
			unexposePort: vi.fn().mockRejectedValue(new Error("fail")),
			killProcess: vi.fn().mockResolvedValue(undefined),
		});
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10005 }],
		});
		await expect(
			archiveSessionWithPreviewCleanup(
				{
					db: sqliteDb.db,
					env: {} as Env,
					projectId: "proj-1",
					sessionId: "sess-1",
					userId: "user-1",
				},
				baseInjected(sandbox, sqliteDb.db, "lease-a"),
			),
		).rejects.toMatchObject({ code: "cleanup_failed" });
		expect(sqliteDb.getSessionStatus("sess-1")).toBe("active");
		expect(sqliteDb.getSessionPort("sess-1")).toBe(10005);
	});
});

describe("deleteProjectWithPreviewFence", () => {
	it("tombstones, destroys sandbox last, deletes row", async () => {
		const order: string[] = [];
		const mem = createMemoryDb({
			project: baseProject(),
			session: baseSession(),
		});
		const destroySandbox = vi.fn(async () => {
			order.push("destroy");
		});
		const originalDelete = mem.db.delete.bind(mem.db);
		mem.db.delete = ((table: never) => {
			order.push("delete-row");
			return originalDelete(table);
		}) as typeof mem.db.delete;

		const result = await deleteProjectWithPreviewFence(
			{
				db: mem.db,
				env: {} as Env,
				projectId: "proj-1",
				userId: "user-1",
				destroySandbox,
			},
			baseInjected(makeSandbox(), mem.db, "del-1"),
		);
		expect(result).toEqual({ id: "proj-1" });
		expect(order).toEqual(["destroy", "delete-row"]);
		expect(destroySandbox).toHaveBeenCalledWith({
			env: expect.anything(),
			sandboxId: "sandbox-1",
		});
		expect(mem.project.deletingAt).toBe(1_700_000_000);
	});

	it("keeps tombstone and releases lease when destroy fails", async () => {
		const mem = createMemoryDb({
			project: baseProject(),
			session: baseSession(),
		});
		await expect(
			deleteProjectWithPreviewFence(
				{
					db: mem.db,
					env: {} as Env,
					projectId: "proj-1",
					userId: "user-1",
					destroySandbox: async () => {
						throw new Error("boom");
					},
				},
				baseInjected(makeSandbox(), mem.db, "del-2"),
			),
		).rejects.toThrow("boom");
		expect(mem.project.deletingAt).toBe(1_700_000_000);
		expect(mem.project.status).toBe("failed");
		expect(mem.project.previewLockToken).toBeNull();
	});
});

describe("controlled barrier races", () => {
	it("concurrent Start/Start: one winner port, no start storm", async () => {
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [baseSession()],
		});
		let starts = 0;
		let live: SessionPreviewProcess | null = null;
		let exposed: { url: string; port: number; status: "active" } | undefined;
		const sandbox = viteSandbox({
			getProcess: vi.fn(async () => live),
			getExposedPorts: vi.fn(async () => (exposed ? [exposed] : [])),
			startProcess: vi.fn(async (_cmd, opts) => {
				starts += 1;
				const port = Number(opts.env.PORT);
				live = makeProcess();
				exposed = {
					url: `https://${port}-box-token.ayn.wtf`,
					port,
					status: "active",
				};
				sandbox.exposePort = vi.fn(async () => ({
					url: exposed!.url,
					port: exposed!.port,
				}));
				return live;
			}),
		});

		let releaseA: () => void = () => undefined;
		const aHeld = new Promise<void>((r) => {
			releaseA = r;
		});
		let aAfterLease = false;

		const startA = startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/",
			},
			{
				...baseInjected(sandbox, sqliteDb.db, "tok-a"),
				barrier: async (label) => {
					if (label === "after_lease" && !aAfterLease) {
						aAfterLease = true;
						await aHeld;
					}
				},
			},
		);

		for (let i = 0; i < 50 && !aAfterLease; i++) {
			await new Promise((r) => setTimeout(r, 5));
		}
		expect(aAfterLease).toBe(true);

		const startBPromise = startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/",
			},
			baseInjected(sandbox, sqliteDb.db, "tok-b"),
		);

		await new Promise((r) => setTimeout(r, 20));
		releaseA();

		const [a, b] = await Promise.all([startA, startBPromise]);
		expect(a.port).toBe(b.port);
		expect(a.port).toBe(sqliteDb.getSessionPort("sess-1"));
		expect(starts).toBe(1);
		expect(b.reused).toBe(true);
	});

	it("Start vs archive: archive wins; Start sees inactive; no sandbox start", async () => {
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [{ ...baseSession(), previewPort: 10000 }],
		});
		const sandbox = viteSandbox({
			getProcess: vi.fn().mockResolvedValue(null),
			unexposePort: vi.fn().mockResolvedValue(undefined),
		});

		let releaseStart: () => void = () => undefined;
		const startHeld = new Promise<void>((r) => {
			releaseStart = r;
		});
		let startAtLease = false;

		const startPromise = startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/",
			},
			{
				...baseInjected(sandbox, sqliteDb.db, "start-tok"),
				barrier: async (label) => {
					if (label === "before_lease") {
						startAtLease = true;
						await startHeld;
					}
				},
			},
		);

		for (let i = 0; i < 50 && !startAtLease; i++) {
			await new Promise((r) => setTimeout(r, 5));
		}
		expect(startAtLease).toBe(true);

		await archiveSessionWithPreviewCleanup(
			{
				db: sqliteDb.db,
				env: {} as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
			},
			baseInjected(sandbox, sqliteDb.db, "arch-tok"),
		);
		expect(sqliteDb.getSessionStatus("sess-1")).toBe("archived");

		releaseStart();
		await expect(startPromise).rejects.toMatchObject({ code: "not_found" });
		expect(sandbox.startProcess).not.toHaveBeenCalled();
	});

	it("Start vs project delete: delete tombstones; Start does not recreate sandbox", async () => {
		const sqliteDb = createSqliteDb({
			project: baseProject(),
			sessions: [baseSession()],
		});
		const sandbox = viteSandbox();
		let releaseStart: () => void = () => undefined;
		const startHeld = new Promise<void>((r) => {
			releaseStart = r;
		});
		let startAtLease = false;
		const destroySandbox = vi.fn(async () => undefined);

		const injectedStart = {
			...baseInjected(sandbox, sqliteDb.db, "start-del"),
			barrier: async (label: string) => {
				if (label === "before_lease") {
					startAtLease = true;
					await startHeld;
				}
			},
		};

		const startPromise = startSessionPreview(
			{
				db: sqliteDb.db,
				env: { PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/",
			},
			injectedStart,
		);

		for (let i = 0; i < 50 && !startAtLease; i++) {
			await new Promise((r) => setTimeout(r, 5));
		}
		expect(startAtLease).toBe(true);

		// Delete holds lease, tombstones, destroys, removes row (same sqlite db).
		await deleteProjectWithPreviewFence(
			{
				db: sqliteDb.db,
				env: {} as Env,
				projectId: "proj-1",
				userId: "user-1",
				destroySandbox,
			},
			baseInjected(sandbox, sqliteDb.db, "del-race"),
		);
		expect(destroySandbox).toHaveBeenCalled();
		expect(sqliteDb.getProject()).toBeUndefined();

		releaseStart();
		await expect(startPromise).rejects.toMatchObject({ code: "not_found" });
		expect(injectedStart.ensureProjectSandbox).not.toHaveBeenCalled();
		expect(sandbox.startProcess).not.toHaveBeenCalled();
	});
});
