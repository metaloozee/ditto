import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { createDb } from "#/db";
import {
	archives,
	projects,
	sandboxIdentities,
	workspaceSessions,
} from "#/db/schema";
import { getProjectSandbox } from "#/lib/sandbox-bootstrap";
import { SessionWorkspaceBusyError } from "#/lib/session-workspace-lock-error";
import {
	sessionPreviewProcessId,
	WORKSPACE_SESSION_PREVIEW_PORT,
} from "#/lib/workspace-policy";
import {
	cancelProjectWork,
	WorkspaceRuntimeError,
	type WorkspaceRuntimeLease,
	withWorkspaceRuntimeLease,
} from "#/lib/workspace-runtime";
import { WORKSPACE_IDLE_TIMEOUT_MS } from "#/lib/workspace-runtime-capacity";
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
	| "cleanup_failed"
	| "not_durable";

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
	not_durable: "Workspace recovery has uncheckpointed mutations.",
};

export function sessionPreviewError(
	code: SessionPreviewErrorCode,
): SessionPreviewError {
	return new SessionPreviewError(code, ERROR_MESSAGES[code]);
}

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
	getSandbox: (env: Env, sandboxId: string) => SessionPreviewSandbox;
	withWorkspaceRuntimeLease: typeof withWorkspaceRuntimeLease;
	/** Test-only controlled barrier. */
	barrier?: (label: string) => Promise<void>;
};

function defaultDeps(db: SessionPreviewDb, env: Env): SessionPreviewDeps {
	return {
		db,
		env,
		nowSeconds: () => Math.floor(Date.now() / 1000),
		getSandbox: (e, id) =>
			getProjectSandbox(e, id) as unknown as SessionPreviewSandbox,
		withWorkspaceRuntimeLease,
	};
}

type ProjectRow = typeof projects.$inferSelect;

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
	if (port !== WORKSPACE_SESSION_PREVIEW_PORT) {
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

async function markPreviewStarted(
	deps: SessionPreviewDeps,
	options: { sessionId: string; projectId: string; userId: string },
): Promise<void> {
	await deps.db
		.update(workspaceSessions)
		.set({
			previewStartedAt: sql`(unixepoch())`,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceSessions.id, options.sessionId),
				eq(workspaceSessions.projectId, options.projectId),
				eq(workspaceSessions.userId, options.userId),
				eq(workspaceSessions.status, "active"),
			),
		);
}

async function clearPreviewStarted(
	deps: SessionPreviewDeps,
	options: { sessionId: string; projectId: string; userId: string },
): Promise<void> {
	await deps.db
		.update(workspaceSessions)
		.set({
			previewStartedAt: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceSessions.id, options.sessionId),
				eq(workspaceSessions.projectId, options.projectId),
				eq(workspaceSessions.userId, options.userId),
			),
		);
}

/**
 * Post-allocation failure boundary: cleanup once, then rethrow fixed error.
 * On incomplete cleanup, throw cleanup_failed and retain the D1 port lease.
 */
async function failAfterAllocation(options: {
	sandbox: SessionPreviewSandbox;
	port: number;
	processId: string;
	error: unknown;
}): Promise<never> {
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

async function withPreviewLease<T>(
	deps: SessionPreviewDeps,
	options: {
		projectId: string;
		sessionId: string;
		userId: string;
		ensureReady?: boolean;
	},
	run: (lease: WorkspaceRuntimeLease) => Promise<T>,
): Promise<T> {
	try {
		return await deps.withWorkspaceRuntimeLease(
			{
				env: deps.env,
				db: deps.db,
				userId: options.userId,
				projectId: options.projectId,
				sessionId: options.sessionId,
				purpose: "preview",
				lock: "none",
				ensureReady: options.ensureReady,
			},
			async (lease) => {
				if (lease.projectEnv != null) {
					throw sessionPreviewError("start_failed");
				}
				return await run(lease);
			},
		);
	} catch (error) {
		if (error instanceof SessionWorkspaceBusyError) {
			throw sessionPreviewError("busy");
		}
		if (error instanceof WorkspaceRuntimeError) {
			if (error.code === "not_found") {
				throw sessionPreviewError("not_found");
			}
			if (error.code === "not_ready") {
				throw sessionPreviewError("not_ready");
			}
			throw sessionPreviewError("start_failed");
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
	await deps.barrier?.("after_lease");

	const project = await loadOwnedProject(
		deps.db,
		options.projectId,
		options.userId,
	);
	if (!project || project.status === "deleting") {
		throw sessionPreviewError("not_found");
	}
	if (
		project.status !== "ready" ||
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

	return await withPreviewLease(
		deps,
		{
			projectId: options.projectId,
			sessionId: options.sessionId,
			userId: options.userId,
			ensureReady: true,
		},
		async (lease) => {
			const cwd = lease.workspacePath;
			const sandbox = lease.sandbox as unknown as SessionPreviewSandbox;
			const processId = sessionPreviewProcessId(options.sessionId);

			const port = WORKSPACE_SESSION_PREVIEW_PORT;
			await discoverPreviewCommand({ sandbox, cwd, port });
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
				if (!active) {
					throw sessionPreviewError("not_found");
				}
				const readyProject = await loadOwnedProject(
					deps.db,
					options.projectId,
					options.userId,
				);
				if (!readyProject || readyProject.status !== "ready") {
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
					await markPreviewStarted(deps, {
						sessionId: options.sessionId,
						projectId: options.projectId,
						userId: options.userId,
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
					await markPreviewStarted(deps, {
						sessionId: options.sessionId,
						projectId: options.projectId,
						userId: options.userId,
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
					const existing = await sandbox
						.getProcess(processId)
						.catch(() => null);
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
				await markPreviewStarted(deps, {
					sessionId: options.sessionId,
					projectId: options.projectId,
					userId: options.userId,
				});
				return { status: "running", url, port, reused: false };
			} catch (error) {
				return await failAfterAllocation({
					sandbox,
					port,
					processId,
					error,
				});
			}
		},
	);
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

	const session = await loadOwnedActiveSession({
		db: deps.db,
		projectId: options.projectId,
		sessionId: options.sessionId,
		userId: options.userId,
	});
	if (!session) {
		throw sessionPreviewError("not_found");
	}
	if (session.previewStartedAt == null) {
		return { status: "stopped" };
	}
	const port = WORKSPACE_SESSION_PREVIEW_PORT;

	const project = await loadOwnedProject(
		deps.db,
		options.projectId,
		options.userId,
	);
	if (!project || project.status !== "ready") {
		throw sessionPreviewError("not_ready");
	}

	const processId = sessionPreviewProcessId(options.sessionId);
	const cleaned = await withPreviewLease(
		deps,
		{
			projectId: options.projectId,
			sessionId: options.sessionId,
			userId: options.userId,
			ensureReady: false,
		},
		async (lease) =>
			cleanupPreviewRuntime({
				sandbox: lease.sandbox as unknown as SessionPreviewSandbox,
				port,
				processId,
			}),
	);

	if (!cleaned.unexposed || !cleaned.processGone) {
		throw sessionPreviewError("cleanup_failed");
	}

	const { checkpoint, getWorkspaceRecoveryState } = await import(
		"#/lib/workspace-recovery"
	);
	const recovery = await getWorkspaceRecoveryState(deps.db, options.sessionId);
	if (recovery?.pending) {
		const { withWorkspaceRuntimeLease } = await import(
			"#/lib/workspace-runtime"
		);
		try {
			const result = await withWorkspaceRuntimeLease(
				{
					env: deps.env,
					db: deps.db,
					userId: options.userId,
					projectId: options.projectId,
					sessionId: options.sessionId,
					purpose: "backup_restore",
					lock: "acquire",
				},
				async (lease) =>
					checkpoint({
						db: deps.db,
						env: deps.env,
						lease,
						userId: options.userId,
					}),
			);
			if (result.state === "degraded" || result.state === "failed") {
				await clearPreviewStarted(deps, {
					sessionId: options.sessionId,
					projectId: options.projectId,
					userId: options.userId,
				});
				throw sessionPreviewError("not_durable");
			}
		} catch (error) {
			await clearPreviewStarted(deps, {
				sessionId: options.sessionId,
				projectId: options.projectId,
				userId: options.userId,
			});
			if (error instanceof SessionPreviewError) {
				throw error;
			}
			throw sessionPreviewError("not_durable");
		}
	}
	await clearPreviewStarted(deps, {
		sessionId: options.sessionId,
		projectId: options.projectId,
		userId: options.userId,
	});

	return { status: "stopped" };
}

export async function interruptPreviewForCheckpoint(options: {
	db: SessionPreviewDb;
	env: Env;
	projectId: string;
	sessionId: string;
	userId: string;
}): Promise<void> {
	const deps = defaultDeps(options.db, options.env);
	const processId = sessionPreviewProcessId(options.sessionId);
	try {
		await withPreviewLease(
			deps,
			{
				projectId: options.projectId,
				sessionId: options.sessionId,
				userId: options.userId,
				ensureReady: false,
			},
			async (lease) => {
				await cleanupPreviewRuntime({
					sandbox: lease.sandbox as unknown as SessionPreviewSandbox,
					port: WORKSPACE_SESSION_PREVIEW_PORT,
					processId,
				});
			},
		);
	} catch {
		// Preview may already be stopped; checkpoint still proceeds.
	}
}

async function previewLastTrafficAt(
	env: Env,
	sandboxId: string,
): Promise<number | null> {
	const namespace = env.Sandbox as {
		idFromName: (name: string) => unknown;
		get: (id: unknown) => {
			getPreviewLastTrafficAt?: () => Promise<number | null>;
		};
	};
	try {
		const stub = namespace.get(namespace.idFromName(sandboxId));
		const value = await stub.getPreviewLastTrafficAt?.();
		return typeof value === "number" ? value : null;
	} catch {
		return null;
	}
}

export async function maybeRestartPreviewAfterCheckpoint(options: {
	db: SessionPreviewDb;
	env: Env;
	projectId: string;
	sessionId: string;
	userId: string;
	requestUrl?: string;
	nowMs?: number;
}): Promise<boolean> {
	const deps = defaultDeps(options.db, options.env);
	const session = await loadOwnedActiveSession({
		db: options.db,
		projectId: options.projectId,
		sessionId: options.sessionId,
		userId: options.userId,
	});
	if (!session?.sandboxIdentityId) {
		await clearPreviewStarted(deps, options);
		return false;
	}
	const { createSandboxAuthority } = await import("#/lib/sandbox-authority");
	const identity = await createSandboxAuthority(options.db).getIdentity(
		session.sandboxIdentityId,
	);
	if (!identity || identity.retiredAt != null) {
		await clearPreviewStarted(deps, options);
		return false;
	}
	const lastTraffic = await previewLastTrafficAt(
		options.env,
		identity.sandboxId,
	);
	const nowMs = options.nowMs ?? Date.now();
	const recent =
		lastTraffic != null && nowMs - lastTraffic <= WORKSPACE_IDLE_TIMEOUT_MS;
	if (!recent) {
		await clearPreviewStarted(deps, options);
		return false;
	}
	const requestUrl =
		options.requestUrl ??
		(options.env.PREVIEW_BASE_HOST
			? `https://${options.env.PREVIEW_BASE_HOST}/`
			: "http://localhost/");
	await startSessionPreview({
		db: options.db,
		env: options.env,
		projectId: options.projectId,
		sessionId: options.sessionId,
		userId: options.userId,
		requestUrl,
	});
	return true;
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

	const session = await loadOwnedActiveSession({
		db: deps.db,
		projectId: options.projectId,
		sessionId: options.sessionId,
		userId: options.userId,
	});
	if (!session) {
		throw sessionPreviewError("not_found");
	}

	const project = await loadOwnedProject(
		deps.db,
		options.projectId,
		options.userId,
	);
	const port = WORKSPACE_SESSION_PREVIEW_PORT;
	if (session.previewStartedAt != null) {
		if (!project || project.status !== "ready") {
			throw sessionPreviewError("not_ready");
		}
		const processId = sessionPreviewProcessId(options.sessionId);
		const cleaned = await withPreviewLease(
			deps,
			{
				projectId: options.projectId,
				sessionId: options.sessionId,
				userId: options.userId,
				ensureReady: false,
			},
			async (lease) =>
				cleanupPreviewRuntime({
					sandbox: lease.sandbox as unknown as SessionPreviewSandbox,
					port,
					processId,
				}),
		);
		if (!cleaned.unexposed || !cleaned.processGone) {
			throw sessionPreviewError("cleanup_failed");
		}
		await clearPreviewStarted(deps, {
			sessionId: options.sessionId,
			projectId: options.projectId,
			userId: options.userId,
		});
	}

	const { checkpoint, requireDurable, WorkspaceRecoveryError } = await import(
		"#/lib/workspace-recovery"
	);
	try {
		await deps.withWorkspaceRuntimeLease(
			{
				env: deps.env,
				db: deps.db,
				userId: options.userId,
				projectId: options.projectId,
				sessionId: options.sessionId,
				purpose: "backup_restore",
				lock: "acquire",
			},
			async (lease) =>
				checkpoint({
					db: deps.db,
					env: deps.env,
					lease,
					userId: options.userId,
				}),
		);
		await requireDurable(deps.db, options.sessionId);
	} catch (error) {
		if (
			error instanceof WorkspaceRecoveryError &&
			error.code === "not_durable"
		) {
			throw sessionPreviewError("not_durable");
		}
		throw error;
	}

	if (session.sandboxIdentityId) {
		const { createSandboxAuthority } = await import("#/lib/sandbox-authority");
		const { destroySandbox } = await import("#/lib/sandbox-bootstrap");
		const { releaseCapacitySlot } = await import(
			"#/lib/workspace-runtime-capacity"
		);
		const authority = createSandboxAuthority(deps.db);
		const identity = await authority.getIdentity(session.sandboxIdentityId);
		if (identity && identity.retiredAt == null) {
			await authority.retireIdentity(identity.id);
			try {
				await destroySandbox({
					env: deps.env,
					sandboxId: identity.sandboxId,
				});
			} catch {
				// Identity is already retired so the ID cannot be reused.
			}
		}
		await releaseCapacitySlot({
			db: deps.db,
			sessionId: options.sessionId,
			nowMs: Date.now(),
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
}

/** Revoke project authority before runtime and archive cleanup. */
export async function deleteProjectRuntime(
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
	const project = await loadOwnedProject(
		deps.db,
		options.projectId,
		options.userId,
	);
	if (!project) {
		throw sessionPreviewError("not_found");
	}
	const [tombstone] = await deps.db
		.update(projects)
		.set({ status: "deleting", updatedAt: sql`(unixepoch())` })
		.where(
			and(
				eq(projects.id, options.projectId),
				eq(projects.userId, options.userId),
			),
		)
		.returning({ id: projects.id });
	if (!tombstone) {
		throw sessionPreviewError("not_found");
	}

	const sessions = await deps.db
		.select()
		.from(workspaceSessions)
		.where(eq(workspaceSessions.projectId, options.projectId));
	const identities = await deps.db
		.select()
		.from(sandboxIdentities)
		.where(eq(sandboxIdentities.projectId, options.projectId));
	const { createSandboxAuthority } = await import("#/lib/sandbox-authority");
	const authority = createSandboxAuthority(deps.db);
	for (const identity of identities) {
		if (identity.retiredAt == null) {
			await authority.retireIdentity(identity.id);
		}
	}
	const nowSeconds = deps.nowSeconds();
	await cancelProjectWork({
		db: deps.db,
		projectId: options.projectId,
		userId: options.userId,
		nowMs: nowSeconds * 1000,
	});

	const [leasedSession] = await deps.db
		.select({ id: workspaceSessions.id })
		.from(workspaceSessions)
		.where(
			and(
				eq(workspaceSessions.projectId, options.projectId),
				isNotNull(workspaceSessions.runtimeLeaseId),
				gt(
					workspaceSessions.runtimeLeaseExpiresAt,
					new Date(nowSeconds * 1000),
				),
			),
		)
		.limit(1);
	if (leasedSession) {
		throw sessionPreviewError("busy");
	}

	for (const session of sessions) {
		if (session.previewStartedAt == null || !session.sandboxIdentityId) {
			continue;
		}
		const identity = identities.find(
			(row) => row.id === session.sandboxIdentityId,
		);
		if (!identity) {
			continue;
		}
		try {
			await cleanupPreviewRuntime({
				sandbox: deps.getSandbox(deps.env, identity.sandboxId),
				port: WORKSPACE_SESSION_PREVIEW_PORT,
				processId: sessionPreviewProcessId(session.id),
			});
		} catch {
			// Retired authority prevents reuse while runtime cleanup retries.
		}
	}
	let destroyFailed = false;
	for (const identity of identities) {
		try {
			await options.destroySandbox({
				env: options.env,
				sandboxId: identity.sandboxId,
			});
		} catch {
			destroyFailed = true;
		}
	}
	if (destroyFailed) {
		throw sessionPreviewError("cleanup_failed");
	}

	const { abandonArchiveForProjectDeletion } = await import(
		"#/lib/sandbox-archive"
	);
	const ownerIds = [
		options.projectId,
		...sessions.map((session) => session.id),
	];
	for (const ownerId of ownerIds) {
		const archiveRows = await deps.db
			.select({ id: archives.id })
			.from(archives)
			.where(eq(archives.ownerId, ownerId));
		for (const row of archiveRows) {
			await abandonArchiveForProjectDeletion(deps.db, row.id, nowSeconds);
		}
	}

	const [deleted] = await deps.db
		.delete(projects)
		.where(
			and(
				eq(projects.id, options.projectId),
				eq(projects.userId, options.userId),
				eq(projects.status, "deleting"),
			),
		)
		.returning({ id: projects.id });
	if (!deleted) {
		throw sessionPreviewError("not_found");
	}
	return deleted;
}
