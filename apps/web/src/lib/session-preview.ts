import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { createDb } from "#/db";
import { projects, workspaceSessions } from "#/db/schema";
import { ensureProjectSandbox } from "#/lib/project-sandbox";
import { getProjectSandbox } from "#/lib/sandbox-bootstrap";
import { SessionWorkspaceBusyError } from "#/lib/session-workspace-lock-error";
import { ensureSessionWorkspaceReady } from "#/lib/session-worktree";
import {
	isSessionPreviewPort,
	SESSION_PREVIEW_PORT_COUNT,
	SESSION_PREVIEW_PORT_MIN,
	sessionPreviewProcessId,
} from "#/lib/workspace-policy";
import { loadOwnedActiveSession } from "#/lib/workspace-session";

export type SessionPreviewDb = ReturnType<typeof createDb>;

export type SessionPreviewErrorCode =
	| "not_found"
	| "not_ready"
	| "busy"
	| "unsupported_project"
	| "capacity_exhausted"
	| "port_conflict"
	| "start_failed"
	| "expose_failed"
	| "cleanup_failed";

export class SessionPreviewError extends Error {
	readonly code: SessionPreviewErrorCode;

	constructor(code: SessionPreviewErrorCode, message: string) {
		super(message);
		this.name = "SessionPreviewError";
		this.code = code;
	}
}

const ERROR_MESSAGES: Record<SessionPreviewErrorCode, string> = {
	not_found: "Session or project not found.",
	not_ready: "Project sandbox is not ready.",
	busy: "Preview is busy. Try again shortly.",
	unsupported_project:
		"Only root Vite (>=6.1.0), Next.js, and Astro (>=5.4.0) projects with a local dev binary are supported.",
	capacity_exhausted: "All preview ports for this project are in use.",
	port_conflict: "Preview port is already in use by another process.",
	start_failed: "Failed to start the preview server.",
	expose_failed: "Failed to expose the preview port.",
	cleanup_failed: "Failed to fully stop the preview. Try again.",
};

export function sessionPreviewError(
	code: SessionPreviewErrorCode,
): SessionPreviewError {
	return new SessionPreviewError(code, ERROR_MESSAGES[code]);
}

const LEASE_TTL_SECONDS = 900;
const LEASE_ACQUIRE_BUDGET_MS = 5_000;
const WAIT_FOR_PORT_MS = 30_000;
const WAIT_FOR_HTTP_MS = 5_000;
const PACKAGE_JSON_MAX_BYTES = 64 * 1024;
const VITE_MIN_MAJOR = 6;
const VITE_MIN_MINOR = 1;
const ASTRO_MIN_MAJOR = 5;
const ASTRO_MIN_MINOR = 4;
const PREVIEW_BASE_HOST = "ayn.wtf";

type ProcessStatus =
	| "starting"
	| "running"
	| "completed"
	| "failed"
	| "killed"
	| "error";

export type SessionPreviewProcess = {
	id: string;
	status: ProcessStatus;
	waitForPort: (
		port: number,
		options?: {
			mode?: "http" | "tcp";
			timeout?: number;
			path?: string;
			status?: number | { min: number; max: number };
		},
	) => Promise<void>;
	kill: (signal?: string) => Promise<void>;
	getStatus: () => Promise<ProcessStatus>;
};

export type SessionPreviewSandbox = {
	readFile: (
		path: string,
		options?: { encoding?: string },
	) => Promise<{ content: string }>;
	exists: (path: string) => Promise<{ exists: boolean }>;
	getProcess: (id: string) => Promise<SessionPreviewProcess | null>;
	startProcess: (
		command: string,
		options: {
			processId: string;
			cwd: string;
			env: Record<string, string>;
			autoCleanup: boolean;
		},
	) => Promise<SessionPreviewProcess>;
	killProcess: (id: string) => Promise<void>;
	exposePort: (
		port: number,
		options: { hostname: string },
	) => Promise<{ url: string; port: number }>;
	unexposePort: (port: number) => Promise<void>;
	getExposedPorts: (
		hostname: string,
	) => Promise<Array<{ url: string; port: number; status: "active" }>>;
};

export type SessionPreviewDeps = {
	db: SessionPreviewDb;
	env: Env;
	nowSeconds: () => number;
	randomToken: () => string;
	sleep: (ms: number) => Promise<void>;
	getSandbox: (env: Env, sandboxId: string) => SessionPreviewSandbox;
	ensureProjectSandbox: typeof ensureProjectSandbox;
	ensureSessionWorkspaceReady: typeof ensureSessionWorkspaceReady;
	/** Test-only controlled barrier. */
	barrier?: (label: string) => Promise<void>;
};

function defaultDeps(db: SessionPreviewDb, env: Env): SessionPreviewDeps {
	return {
		db,
		env,
		nowSeconds: () => Math.floor(Date.now() / 1000),
		randomToken: () => crypto.randomUUID(),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		getSandbox: (e, id) =>
			getProjectSandbox(e, id) as unknown as SessionPreviewSandbox,
		ensureProjectSandbox,
		ensureSessionWorkspaceReady,
	};
}

type ProjectRow = typeof projects.$inferSelect;
type SessionRow = typeof workspaceSessions.$inferSelect;

async function loadOwnedProject(
	db: SessionPreviewDb,
	projectId: string,
	userId: string,
): Promise<ProjectRow | null> {
	const [project] = await db
		.select()
		.from(projects)
		.where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
		.limit(1);
	return project ?? null;
}

/**
 * Acquire the external D1 lifecycle lease on a project row.
 * No Sandbox operations. Bound contention retries to 5s.
 */
export async function acquireProjectPreviewLease(
	deps: SessionPreviewDeps,
	options: {
		projectId: string;
		userId: string;
		/** When true, allow acquiring an expired lease even if deletingAt is set. */
		allowDeleting?: boolean;
	},
): Promise<{ token: string; project: ProjectRow }> {
	const deadline = Date.now() + LEASE_ACQUIRE_BUDGET_MS;
	const token = deps.randomToken();

	while (Date.now() <= deadline) {
		const now = deps.nowSeconds();
		const expiresAt = now + LEASE_TTL_SECONDS;

		const openLease = or(
			isNull(projects.previewLockToken),
			isNull(projects.previewLockExpiresAt),
			sql`${projects.previewLockExpiresAt} <= ${now}`,
		);

		const conditions = [
			eq(projects.id, options.projectId),
			eq(projects.userId, options.userId),
			openLease,
		];
		if (!options.allowDeleting) {
			conditions.push(isNull(projects.deletingAt));
		}

		await deps.db
			.update(projects)
			.set({
				previewLockToken: token,
				previewLockExpiresAt: expiresAt,
				updatedAt: sql`(unixepoch())`,
			})
			.where(and(...conditions));

		const project = await loadOwnedProject(
			deps.db,
			options.projectId,
			options.userId,
		);
		if (!project) {
			throw sessionPreviewError("not_found");
		}
		if (project.previewLockToken === token) {
			if (!options.allowDeleting && project.deletingAt != null) {
				await releaseProjectPreviewLease(deps, {
					projectId: options.projectId,
					userId: options.userId,
					token,
				});
				throw sessionPreviewError("not_found");
			}
			return { token, project };
		}

		await deps.sleep(50);
	}

	throw sessionPreviewError("busy");
}

export async function releaseProjectPreviewLease(
	deps: SessionPreviewDeps,
	options: { projectId: string; userId: string; token: string },
): Promise<void> {
	await deps.db
		.update(projects)
		.set({
			previewLockToken: null,
			previewLockExpiresAt: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(projects.id, options.projectId),
				eq(projects.userId, options.userId),
				eq(projects.previewLockToken, options.token),
			),
		);
}

export function resolvePreviewHostname(options: {
	requestUrl: string;
	previewBaseHost: string | undefined;
}): string {
	const url = new URL(options.requestUrl);
	const hostname = url.hostname.toLowerCase();

	if (hostname === "localhost" || hostname === "127.0.0.1") {
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw sessionPreviewError("expose_failed");
		}
		// SDK cannot put a preview label under an IPv4 literal; keep the port.
		return url.port ? `localhost:${url.port}` : "localhost";
	}

	// Production: exact apex host only — no lookalikes, ports, or workers.dev.
	if (
		!options.previewBaseHost ||
		options.previewBaseHost !== PREVIEW_BASE_HOST
	) {
		throw sessionPreviewError("expose_failed");
	}
	if (url.protocol !== "https:") {
		throw sessionPreviewError("expose_failed");
	}
	if (hostname !== PREVIEW_BASE_HOST || url.port !== "") {
		throw sessionPreviewError("expose_failed");
	}

	return PREVIEW_BASE_HOST;
}

type DevFramework = "vite" | "next" | "astro";

type DiscoveredCommand = {
	framework: DevFramework;
	command: string;
	env: Record<string, string>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringMap(value: unknown): Record<string, string> | null {
	if (!isPlainObject(value)) {
		return null;
	}
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof key !== "string" || key.length === 0 || key.length > 256) {
			return null;
		}
		if (typeof entry !== "string" || entry.length > 1024) {
			return null;
		}
		out[key] = entry;
	}
	return out;
}

/**
 * Parse installed package version: strict major.minor.patch, optional +build.
 * Rejects ranges, prefixes, prereleases, and trailing garbage.
 */
export function parseLeadingSemver(
	raw: string,
): [number, number, number] | null {
	const cleaned = raw.trim();
	const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/);
	if (!match) {
		return null;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isMinVersion(
	version: string,
	minMajor: number,
	minMinor: number,
): boolean {
	const parsed = parseLeadingSemver(version);
	if (!parsed) {
		return false;
	}
	const [major, minor] = parsed;
	if (major > minMajor) {
		return true;
	}
	if (major < minMajor) {
		return false;
	}
	return minor >= minMinor;
}

export function isViteVersionSupported(version: string): boolean {
	return isMinVersion(version, VITE_MIN_MAJOR, VITE_MIN_MINOR);
}

export function isAstroVersionSupported(version: string): boolean {
	return isMinVersion(version, ASTRO_MIN_MAJOR, ASTRO_MIN_MINOR);
}

export async function discoverPreviewCommand(options: {
	sandbox: SessionPreviewSandbox;
	cwd: string;
	port: number;
}): Promise<DiscoveredCommand> {
	const packagePath = `${options.cwd}/package.json`;
	const exists = await options.sandbox.exists(packagePath);
	if (!exists.exists) {
		throw sessionPreviewError("unsupported_project");
	}

	const file = await options.sandbox.readFile(packagePath);
	if (
		typeof file.content !== "string" ||
		new TextEncoder().encode(file.content).byteLength > PACKAGE_JSON_MAX_BYTES
	) {
		throw sessionPreviewError("unsupported_project");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(file.content);
	} catch {
		throw sessionPreviewError("unsupported_project");
	}
	if (!isPlainObject(parsed)) {
		throw sessionPreviewError("unsupported_project");
	}

	const scripts = asStringMap(parsed.scripts);
	const dependencies = asStringMap(parsed.dependencies) ?? {};
	const devDependencies = asStringMap(parsed.devDependencies) ?? {};
	if (!scripts) {
		throw sessionPreviewError("unsupported_project");
	}

	const devScript = scripts.dev?.trim();
	if (!devScript) {
		throw sessionPreviewError("unsupported_project");
	}
	if (scripts.predev || scripts.postdev) {
		throw sessionPreviewError("unsupported_project");
	}

	const hasViteDep = "vite" in dependencies || "vite" in devDependencies;
	const hasNextDep = "next" in dependencies || "next" in devDependencies;
	const hasAstroDep = "astro" in dependencies || "astro" in devDependencies;

	const exactVite = devScript === "vite" || devScript === "vite dev";
	const exactNext = devScript === "next" || devScript === "next dev";
	const exactAstro = devScript === "astro" || devScript === "astro dev";
	const matchCount = Number(exactVite) + Number(exactNext) + Number(exactAstro);
	if (matchCount !== 1) {
		throw sessionPreviewError("unsupported_project");
	}
	if (exactVite && !hasViteDep) {
		throw sessionPreviewError("unsupported_project");
	}
	if (exactNext && !hasNextDep) {
		throw sessionPreviewError("unsupported_project");
	}
	if (exactAstro && !hasAstroDep) {
		throw sessionPreviewError("unsupported_project");
	}

	const port = options.port;
	if (!isSessionPreviewPort(port)) {
		throw sessionPreviewError("start_failed");
	}

	if (exactVite) {
		const versionPath = `${options.cwd}/node_modules/vite/package.json`;
		const versionExists = await options.sandbox.exists(versionPath);
		if (!versionExists.exists) {
			throw sessionPreviewError("unsupported_project");
		}
		const versionFile = await options.sandbox.readFile(versionPath);
		let versionJson: unknown;
		try {
			versionJson = JSON.parse(versionFile.content);
		} catch {
			throw sessionPreviewError("unsupported_project");
		}
		const version =
			isPlainObject(versionJson) && typeof versionJson.version === "string"
				? versionJson.version
				: "";
		if (!isViteVersionSupported(version)) {
			throw sessionPreviewError("unsupported_project");
		}

		const binPath = `${options.cwd}/node_modules/.bin/vite`;
		const binExists = await options.sandbox.exists(binPath);
		if (!binExists.exists) {
			throw sessionPreviewError("unsupported_project");
		}

		return {
			framework: "vite",
			command: `./node_modules/.bin/vite --host 0.0.0.0 --port ${port} --strictPort`,
			env: {
				HOST: "0.0.0.0",
				PORT: String(port),
				__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".ayn.wtf",
			},
		};
	}

	if (exactAstro) {
		const versionPath = `${options.cwd}/node_modules/astro/package.json`;
		const versionExists = await options.sandbox.exists(versionPath);
		if (!versionExists.exists) {
			throw sessionPreviewError("unsupported_project");
		}
		const versionFile = await options.sandbox.readFile(versionPath);
		let versionJson: unknown;
		try {
			versionJson = JSON.parse(versionFile.content);
		} catch {
			throw sessionPreviewError("unsupported_project");
		}
		const version =
			isPlainObject(versionJson) && typeof versionJson.version === "string"
				? versionJson.version
				: "";
		if (!isAstroVersionSupported(version)) {
			throw sessionPreviewError("unsupported_project");
		}

		const binPath = `${options.cwd}/node_modules/.bin/astro`;
		const binExists = await options.sandbox.exists(binPath);
		if (!binExists.exists) {
			throw sessionPreviewError("unsupported_project");
		}

		return {
			framework: "astro",
			command: `./node_modules/.bin/astro dev --host 0.0.0.0 --port ${port} --allowed-hosts=.ayn.wtf`,
			env: {
				HOST: "0.0.0.0",
				PORT: String(port),
				__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".ayn.wtf",
			},
		};
	}

	const binPath = `${options.cwd}/node_modules/.bin/next`;
	const binExists = await options.sandbox.exists(binPath);
	if (!binExists.exists) {
		throw sessionPreviewError("unsupported_project");
	}

	return {
		framework: "next",
		command: `./node_modules/.bin/next dev --hostname 0.0.0.0 --port ${port}`,
		env: {
			HOST: "0.0.0.0",
			PORT: String(port),
		},
	};
}

async function hashSessionOffset(sessionId: string): Promise<number> {
	const data = new TextEncoder().encode(sessionId);
	const digest = await crypto.subtle.digest("SHA-256", data);
	const view = new DataView(digest);
	return view.getUint32(0) % SESSION_PREVIEW_PORT_COUNT;
}

async function allocatePreviewPort(
	deps: SessionPreviewDeps,
	options: {
		sessionId: string;
		projectId: string;
		userId: string;
		existingPort: number | null;
	},
): Promise<number> {
	if (
		options.existingPort != null &&
		isSessionPreviewPort(options.existingPort)
	) {
		return options.existingPort;
	}

	const offset = await hashSessionOffset(options.sessionId);

	for (let i = 0; i < SESSION_PREVIEW_PORT_COUNT; i++) {
		const candidate =
			SESSION_PREVIEW_PORT_MIN + ((offset + i) % SESSION_PREVIEW_PORT_COUNT);

		await deps.db.run(
			sql`UPDATE OR IGNORE workspace_sessions
SET previewPort = ${candidate}
WHERE id = ${options.sessionId}
  AND projectId = ${options.projectId}
  AND userId = ${options.userId}
  AND status = 'active'
  AND previewPort IS NULL`,
		);

		const [row] = await deps.db
			.select({
				previewPort: workspaceSessions.previewPort,
				status: workspaceSessions.status,
			})
			.from(workspaceSessions)
			.where(
				and(
					eq(workspaceSessions.id, options.sessionId),
					eq(workspaceSessions.projectId, options.projectId),
					eq(workspaceSessions.userId, options.userId),
				),
			)
			.limit(1);

		if (!row || row.status !== "active") {
			throw sessionPreviewError("not_found");
		}
		if (row.previewPort != null && isSessionPreviewPort(row.previewPort)) {
			return row.previewPort;
		}
	}

	throw sessionPreviewError("capacity_exhausted");
}

function isHealthyStatus(status: ProcessStatus | undefined): boolean {
	return status === "starting" || status === "running";
}

function isTerminalStatus(status: ProcessStatus | undefined): boolean {
	return (
		status === "completed" ||
		status === "failed" ||
		status === "killed" ||
		status === "error" ||
		status == null
	);
}

export function validatePreviewUrl(options: {
	url: string;
	port: number;
	hostname: string;
	local: boolean;
}): string {
	let parsed: URL;
	try {
		parsed = new URL(options.url);
	} catch {
		throw sessionPreviewError("expose_failed");
	}

	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw sessionPreviewError("expose_failed");
	}

	if (options.local) {
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw sessionPreviewError("expose_failed");
		}
		// Exposure host is canonical localhost[:port] from resolvePreviewHostname.
		const expectedPort = options.hostname.startsWith("localhost:")
			? options.hostname.slice("localhost:".length)
			: options.hostname === "localhost"
				? ""
				: null;
		if (expectedPort === null || parsed.port !== expectedPort) {
			throw sessionPreviewError("expose_failed");
		}
		const host = parsed.hostname.toLowerCase();
		// SDK 0.12.3: http://<port>-<sandbox>-<token>.localhost:<app-port>/
		if (!host.endsWith(".localhost")) {
			throw sessionPreviewError("expose_failed");
		}
		const labels = host.slice(0, -".localhost".length).split(".");
		if (labels.length !== 1 || !labels[0]) {
			throw sessionPreviewError("expose_failed");
		}
		if (!labels[0].startsWith(`${options.port}-`)) {
			throw sessionPreviewError("expose_failed");
		}
		return options.url;
	}

	if (parsed.protocol !== "https:") {
		throw sessionPreviewError("expose_failed");
	}
	const host = parsed.hostname.toLowerCase();
	if (!host.endsWith(`.${PREVIEW_BASE_HOST}`)) {
		throw sessionPreviewError("expose_failed");
	}
	const labels = host.slice(0, -(PREVIEW_BASE_HOST.length + 1)).split(".");
	// Direct child: exactly one label before .ayn.wtf
	if (labels.length !== 1 || !labels[0]) {
		throw sessionPreviewError("expose_failed");
	}
	if (!labels[0].startsWith(`${options.port}-`)) {
		throw sessionPreviewError("expose_failed");
	}

	return options.url;
}

async function cleanupPreviewRuntime(options: {
	sandbox: SessionPreviewSandbox;
	port: number;
	processId: string;
}): Promise<{ unexposed: boolean; processGone: boolean }> {
	const [unexposeResult, killResult] = await Promise.allSettled([
		options.sandbox.unexposePort(options.port),
		(async () => {
			const proc = await options.sandbox.getProcess(options.processId);
			if (proc && isHealthyStatus(proc.status)) {
				await proc.kill();
			} else {
				try {
					await options.sandbox.killProcess(options.processId);
				} catch {
					// process may already be gone
				}
			}
		})(),
	]);

	const unexposed = unexposeResult.status === "fulfilled";

	let processGone = false;
	try {
		const again = await options.sandbox.getProcess(options.processId);
		processGone = !again || isTerminalStatus(again.status);
	} catch {
		processGone = killResult.status === "fulfilled";
	}

	return { unexposed, processGone };
}

async function clearSessionPreviewPort(
	deps: SessionPreviewDeps,
	options: {
		sessionId: string;
		projectId: string;
		userId: string;
		port: number;
	},
): Promise<void> {
	try {
		await deps.db
			.update(workspaceSessions)
			.set({ previewPort: null, updatedAt: sql`(unixepoch())` })
			.where(
				and(
					eq(workspaceSessions.id, options.sessionId),
					eq(workspaceSessions.projectId, options.projectId),
					eq(workspaceSessions.userId, options.userId),
					eq(workspaceSessions.status, "active"),
					eq(workspaceSessions.previewPort, options.port),
				),
			);
	} catch {
		throw sessionPreviewError("cleanup_failed");
	}
}

/**
 * Post-allocation failure boundary: cleanup once, then rethrow fixed error.
 * On incomplete cleanup, throw cleanup_failed and retain the D1 port lease.
 */
async function failAfterAllocation(
	deps: SessionPreviewDeps,
	options: {
		sandbox: SessionPreviewSandbox;
		port: number;
		processId: string;
		sessionId: string;
		projectId: string;
		userId: string;
		error: unknown;
	},
): Promise<never> {
	const original =
		options.error instanceof SessionPreviewError
			? options.error
			: sessionPreviewError("start_failed");

	// Already passed this boundary (e.g. nested cleanup_failed).
	if (original.code === "cleanup_failed") {
		throw original;
	}

	let cleaned: { unexposed: boolean; processGone: boolean };
	try {
		cleaned = await cleanupPreviewRuntime({
			sandbox: options.sandbox,
			port: options.port,
			processId: options.processId,
		});
	} catch {
		throw sessionPreviewError("cleanup_failed");
	}
	if (!cleaned.unexposed || !cleaned.processGone) {
		throw sessionPreviewError("cleanup_failed");
	}
	await clearSessionPreviewPort(deps, {
		sessionId: options.sessionId,
		projectId: options.projectId,
		userId: options.userId,
		port: options.port,
	});
	throw original;
}

async function waitForPreviewReady(
	process: SessionPreviewProcess,
	port: number,
): Promise<void> {
	await process.waitForPort(port, {
		mode: "tcp",
		timeout: WAIT_FOR_PORT_MS,
	});
	try {
		await process.waitForPort(port, {
			mode: "http",
			timeout: WAIT_FOR_HTTP_MS,
			path: "/",
			status: { min: 100, max: 599 },
		});
	} catch {}
	const status = await process.getStatus();
	if (!isHealthyStatus(status)) {
		throw sessionPreviewError("start_failed");
	}
}

async function resolveSessionWorktree(
	deps: SessionPreviewDeps,
	options: {
		project: ProjectRow;
		session: SessionRow;
		sandboxId: string;
	},
): Promise<string> {
	if (!options.project.githubRepo || !options.project.githubInstallationId) {
		throw sessionPreviewError("not_ready");
	}
	try {
		const ready = await deps.ensureSessionWorkspaceReady({
			env: deps.env,
			sandboxId: options.sandboxId,
			sessionId: options.session.id,
			githubRepo: options.project.githubRepo,
			installationId: options.project.githubInstallationId,
			projectId: options.project.id,
			userId: options.session.userId,
			db: deps.db,
			existing: {
				branchName: options.session.branchName,
				baseCommitSha: options.session.baseCommitSha,
				workspacePath: options.session.workspacePath,
			},
			lock: "acquire", // readiness no-ops lock on reuse
		});
		return ready.workspacePath;
	} catch (error) {
		if (error instanceof SessionWorkspaceBusyError) {
			throw sessionPreviewError("busy");
		}
		if (error instanceof SessionPreviewError) {
			throw error;
		}
		throw sessionPreviewError("start_failed");
	}
}

export type StartSessionPreviewResult = {
	status: "running";
	url: string;
	port: number;
	reused: boolean;
};

export async function startSessionPreview(
	options: {
		db: SessionPreviewDb;
		env: Env;
		projectId: string;
		sessionId: string;
		userId: string;
		requestUrl: string;
	},
	injected?: Partial<SessionPreviewDeps>,
): Promise<StartSessionPreviewResult> {
	const deps: SessionPreviewDeps = {
		...defaultDeps(options.db, options.env),
		...injected,
		db: options.db,
		env: options.env,
	};

	const host = resolvePreviewHostname({
		requestUrl: options.requestUrl,
		previewBaseHost: options.env.PREVIEW_BASE_HOST,
	});
	const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");

	await deps.barrier?.("before_lease");
	const { token } = await acquireProjectPreviewLease(deps, {
		projectId: options.projectId,
		userId: options.userId,
	});
	await deps.barrier?.("after_lease");

	try {
		const project = await loadOwnedProject(
			deps.db,
			options.projectId,
			options.userId,
		);
		if (!project || project.deletingAt != null) {
			throw sessionPreviewError("not_found");
		}
		if (
			project.status !== "ready" ||
			!project.sandboxId ||
			project.sandboxId !== project.sandboxId.toLowerCase() ||
			!project.githubRepo ||
			!project.githubInstallationId
		) {
			throw sessionPreviewError("not_ready");
		}

		const session = await loadOwnedActiveSession({
			db: deps.db,
			projectId: options.projectId,
			sessionId: options.sessionId,
			userId: options.userId,
		});
		if (!session) {
			throw sessionPreviewError("not_found");
		}

		const ensured = await deps.ensureProjectSandbox({
			db: deps.db,
			env: deps.env,
			project,
		});
		const sandboxId = ensured.project.sandboxId;
		if (!sandboxId) {
			throw sessionPreviewError("not_ready");
		}

		const cwd = await resolveSessionWorktree(deps, {
			project: ensured.project,
			session,
			sandboxId,
		});

		const sandbox = deps.getSandbox(deps.env, sandboxId);
		const processId = sessionPreviewProcessId(options.sessionId);

		// Discover before allocating capacity — unsupported projects fail without cleanup.
		const provisionalPort =
			session.previewPort != null && isSessionPreviewPort(session.previewPort)
				? session.previewPort
				: SESSION_PREVIEW_PORT_MIN +
					(await hashSessionOffset(options.sessionId));

		await discoverPreviewCommand({
			sandbox,
			cwd,
			port: provisionalPort,
		});

		const port = await allocatePreviewPort(deps, {
			sessionId: options.sessionId,
			projectId: options.projectId,
			userId: options.userId,
			existingPort: session.previewPort,
		});
		await deps.barrier?.("after_allocate");

		// ONE structured boundary for every non-success exit after allocation.
		try {
			const discovered = await discoverPreviewCommand({
				sandbox,
				cwd,
				port,
			});

			// Re-check ownership under lease immediately before runtime mutation.
			const active = await loadOwnedActiveSession({
				db: deps.db,
				projectId: options.projectId,
				sessionId: options.sessionId,
				userId: options.userId,
			});
			if (!active || active.previewPort !== port) {
				throw sessionPreviewError("not_found");
			}
			const readyProject = await loadOwnedProject(
				deps.db,
				options.projectId,
				options.userId,
			);
			if (
				!readyProject ||
				readyProject.status !== "ready" ||
				readyProject.deletingAt != null
			) {
				throw sessionPreviewError("not_ready");
			}

			await deps.barrier?.("before_runtime");

			let process: SessionPreviewProcess | null;
			try {
				process = await sandbox.getProcess(processId);
			} catch {
				throw sessionPreviewError("start_failed");
			}

			let exposed: Array<{ url: string; port: number; status: "active" }>;
			try {
				exposed = await sandbox.getExposedPorts(host);
			} catch {
				throw sessionPreviewError("start_failed");
			}
			const existingExposure = exposed.find((entry) => entry.port === port);

			if (process && isHealthyStatus(process.status) && existingExposure) {
				const url = validatePreviewUrl({
					url: existingExposure.url,
					port,
					hostname: host,
					local,
				});
				return { status: "running", url, port, reused: true };
			}

			if (process && isHealthyStatus(process.status) && !existingExposure) {
				try {
					await waitForPreviewReady(process, port);
				} catch (error) {
					if (error instanceof SessionPreviewError) {
						throw error;
					}
					throw sessionPreviewError("start_failed");
				}
				let exposedReuse: { url: string; port: number };
				try {
					exposedReuse = await sandbox.exposePort(port, { hostname: host });
				} catch {
					throw sessionPreviewError("expose_failed");
				}
				if (exposedReuse.port !== port) {
					throw sessionPreviewError("expose_failed");
				}
				const url = validatePreviewUrl({
					url: exposedReuse.url,
					port: exposedReuse.port,
					hostname: host,
					local,
				});
				return { status: "running", url, port, reused: true };
			}

			// Start with --strictPort / fixed Next port. Generic terminal/readiness
			// failure is start_failed (not port_conflict) without a root port probe.
			try {
				process = await sandbox.startProcess(discovered.command, {
					processId,
					cwd,
					env: discovered.env,
					autoCleanup: true,
				});
			} catch {
				const existing = await sandbox.getProcess(processId).catch(() => null);
				if (existing && isHealthyStatus(existing.status)) {
					process = existing;
				} else {
					throw sessionPreviewError("start_failed");
				}
			}
			if (!process) {
				throw sessionPreviewError("start_failed");
			}
			const started = process;

			try {
				await waitForPreviewReady(started, port);
			} catch (error) {
				if (error instanceof SessionPreviewError) {
					throw error;
				}
				throw sessionPreviewError("start_failed");
			}

			let exposedResult: { url: string; port: number };
			try {
				exposedResult = await sandbox.exposePort(port, { hostname: host });
			} catch {
				throw sessionPreviewError("expose_failed");
			}

			if (exposedResult.port !== port) {
				throw sessionPreviewError("expose_failed");
			}

			const url = validatePreviewUrl({
				url: exposedResult.url,
				port,
				hostname: host,
				local,
			});
			return { status: "running", url, port, reused: false };
		} catch (error) {
			return await failAfterAllocation(deps, {
				sandbox,
				port,
				processId,
				sessionId: options.sessionId,
				projectId: options.projectId,
				userId: options.userId,
				error,
			});
		}
	} finally {
		await releaseProjectPreviewLease(deps, {
			projectId: options.projectId,
			userId: options.userId,
			token,
		});
	}
}

export type StopSessionPreviewResult = { status: "stopped" };

export async function stopSessionPreview(
	options: {
		db: SessionPreviewDb;
		env: Env;
		projectId: string;
		sessionId: string;
		userId: string;
		requestUrl?: string;
	},
	injected?: Partial<SessionPreviewDeps>,
): Promise<StopSessionPreviewResult> {
	const deps: SessionPreviewDeps = {
		...defaultDeps(options.db, options.env),
		...injected,
		db: options.db,
		env: options.env,
	};

	const { token } = await acquireProjectPreviewLease(deps, {
		projectId: options.projectId,
		userId: options.userId,
	});

	try {
		const session = await loadOwnedActiveSession({
			db: deps.db,
			projectId: options.projectId,
			sessionId: options.sessionId,
			userId: options.userId,
		});
		if (!session) {
			throw sessionPreviewError("not_found");
		}
		if (session.previewPort == null) {
			return { status: "stopped" };
		}
		if (!isSessionPreviewPort(session.previewPort)) {
			throw sessionPreviewError("cleanup_failed");
		}

		const project = await loadOwnedProject(
			deps.db,
			options.projectId,
			options.userId,
		);
		if (!project?.sandboxId) {
			throw sessionPreviewError("not_ready");
		}

		const sandbox = deps.getSandbox(deps.env, project.sandboxId);
		const processId = sessionPreviewProcessId(options.sessionId);
		const cleaned = await cleanupPreviewRuntime({
			sandbox,
			port: session.previewPort,
			processId,
		});

		if (!cleaned.unexposed || !cleaned.processGone) {
			throw sessionPreviewError("cleanup_failed");
		}

		await clearSessionPreviewPort(deps, {
			sessionId: options.sessionId,
			projectId: options.projectId,
			userId: options.userId,
			port: session.previewPort,
		});

		return { status: "stopped" };
	} finally {
		await releaseProjectPreviewLease(deps, {
			projectId: options.projectId,
			userId: options.userId,
			token,
		});
	}
}

/**
 * Archive an active session after confirmed preview cleanup under the D1 lease.
 */
export async function archiveSessionWithPreviewCleanup(
	options: {
		db: SessionPreviewDb;
		env: Env;
		projectId: string;
		sessionId: string;
		userId: string;
	},
	injected?: Partial<SessionPreviewDeps>,
): Promise<{ id: string }> {
	const deps: SessionPreviewDeps = {
		...defaultDeps(options.db, options.env),
		...injected,
		db: options.db,
		env: options.env,
	};

	const { token } = await acquireProjectPreviewLease(deps, {
		projectId: options.projectId,
		userId: options.userId,
	});

	try {
		const session = await loadOwnedActiveSession({
			db: deps.db,
			projectId: options.projectId,
			sessionId: options.sessionId,
			userId: options.userId,
		});
		if (!session) {
			throw sessionPreviewError("not_found");
		}

		if (session.previewPort != null) {
			if (!isSessionPreviewPort(session.previewPort)) {
				throw sessionPreviewError("cleanup_failed");
			}
			const project = await loadOwnedProject(
				deps.db,
				options.projectId,
				options.userId,
			);
			if (!project?.sandboxId) {
				throw sessionPreviewError("not_ready");
			}
			const sandbox = deps.getSandbox(deps.env, project.sandboxId);
			const processId = sessionPreviewProcessId(options.sessionId);
			const cleaned = await cleanupPreviewRuntime({
				sandbox,
				port: session.previewPort,
				processId,
			});
			if (!cleaned.unexposed || !cleaned.processGone) {
				throw sessionPreviewError("cleanup_failed");
			}
			await clearSessionPreviewPort(deps, {
				sessionId: options.sessionId,
				projectId: options.projectId,
				userId: options.userId,
				port: session.previewPort,
			});
		}

		const [archived] = await deps.db
			.update(workspaceSessions)
			.set({ status: "archived", updatedAt: sql`(unixepoch())` })
			.where(
				and(
					eq(workspaceSessions.id, options.sessionId),
					eq(workspaceSessions.projectId, options.projectId),
					eq(workspaceSessions.userId, options.userId),
					eq(workspaceSessions.status, "active"),
				),
			)
			.returning({ id: workspaceSessions.id });

		if (!archived) {
			throw sessionPreviewError("not_found");
		}
		return archived;
	} finally {
		await releaseProjectPreviewLease(deps, {
			projectId: options.projectId,
			userId: options.userId,
			token,
		});
	}
}

/**
 * Delete a project under the external D1 lifecycle lease.
 * Sets durable tombstone, destroys sandbox last, then deletes D1 row.
 */
export async function deleteProjectWithPreviewFence(
	options: {
		db: SessionPreviewDb;
		env: Env;
		projectId: string;
		userId: string;
		destroySandbox: (args: { env: Env; sandboxId: string }) => Promise<void>;
	},
	injected?: Partial<SessionPreviewDeps>,
): Promise<{ id: string }> {
	const deps: SessionPreviewDeps = {
		...defaultDeps(options.db, options.env),
		...injected,
		db: options.db,
		env: options.env,
	};

	const { token } = await acquireProjectPreviewLease(deps, {
		projectId: options.projectId,
		userId: options.userId,
		allowDeleting: true,
	});

	let sandboxId: string | null = null;
	let tombstoned = false;

	try {
		const project = await loadOwnedProject(
			deps.db,
			options.projectId,
			options.userId,
		);
		if (!project) {
			throw sessionPreviewError("not_found");
		}
		sandboxId = project.sandboxId;

		const [tombstone] = await deps.db
			.update(projects)
			.set({
				status: "failed",
				deletingAt: deps.nowSeconds(),
				updatedAt: sql`(unixepoch())`,
			})
			.where(
				and(
					eq(projects.id, options.projectId),
					eq(projects.userId, options.userId),
					eq(projects.previewLockToken, token),
				),
			)
			.returning({ id: projects.id });

		if (!tombstone) {
			throw sessionPreviewError("not_found");
		}
		tombstoned = true;

		if (sandboxId) {
			await options.destroySandbox({
				env: options.env,
				sandboxId,
			});
		}

		const deleted = await deps.db
			.delete(projects)
			.where(
				and(
					eq(projects.id, options.projectId),
					eq(projects.userId, options.userId),
					eq(projects.previewLockToken, token),
					sql`${projects.deletingAt} IS NOT NULL`,
				),
			)
			.returning({ id: projects.id });

		if (!deleted[0]) {
			throw sessionPreviewError("not_found");
		}

		// Row deletion consumes the lease — no release.
		return deleted[0];
	} catch (error) {
		if (tombstoned) {
			// Keep tombstone; only release D1 lease so delete can be retried.
			await releaseProjectPreviewLease(deps, {
				projectId: options.projectId,
				userId: options.userId,
				token,
			});
			throw error;
		}
		await releaseProjectPreviewLease(deps, {
			projectId: options.projectId,
			userId: options.userId,
			token,
		});
		throw error;
	}
}
