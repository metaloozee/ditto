import { Container } from "@cloudflare/containers";
import { and, eq, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { workspaceBot } from "./db/workspace-schema.ts";
import type { AuthEnv } from "./lib/auth.ts";
import type {
	ChiefOfStaff,
	ComputerPolicy,
	ComputerStatus,
	IsolationCheck,
	IsolationReport,
	Member,
	OpenFaults,
	OpenedWorkspace,
	PrivateSessions,
	PrivateSessionsRefusal,
	PrivateSessionsRefused,
	WorkspaceRpc,
} from "./workspace-rpc.ts";

/** The image's control port: readiness, the filter's decisions and the fence's result. */
const CONTROL_PORT = 8081;
const READY_TIMEOUT_MS = 180_000;
const IDLE_SECONDS = 5 * 60;
const MAX_HOSTS = 200;
const ISOLATION_ATTEMPTS = 3;
const ISOLATION_RETRY_MS = 1_000;
const HOST =
	/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * The shared computer's instance as the Workspace object drives it. Everything the object does
 * to the instance goes through this one seam.
 */
export interface Instance {
	readonly running: boolean;
	/** Starts the instance under `policy` and resolves once its control port answers. */
	start(policy: ComputerPolicy): Promise<void>;
	destroy(): Promise<void>;
	/** A request to the running instance's control port, which counts as use. */
	control(path: string, init?: RequestInit): Promise<Response>;
}

/** What the image reports at `/isolation` once its fence applied: only the filter has a route out. */
const FENCED = "filter-user-only";

const STOPPED: PrivateSessions = {
	available: false,
	reason: "stopped",
	detail: "The computer is stopped. Start it to check its isolation.",
};

const sameHosts = (a: string[], b: string[]) =>
	new Set(a).size === new Set(b).size && a.every((host) => b.includes(host));

/**
 * Judges the instance's answer at `/isolation` (null if none came) against the policy it was
 * started with. Anything short of this workspace's ID, the same list and the fence fails.
 */
function checkIsolation(policy: ComputerPolicy, answer: IsolationReport): IsolationCheck {
	const checkedAt = new Date().toISOString();
	const failed = (reason: PrivateSessionsRefusal, detail: string): IsolationCheck => ({
		checkedAt,
		policy: false,
		fence: false,
		problem: { reason, detail },
	});
	if (answer === null || answer.status === 404) {
		return failed("report-missing", "The computer did not report its isolation.");
	}
	if (answer.status !== 200) {
		return failed("report-unreadable", `The isolation report answered ${answer.status}.`);
	}
	let report: unknown;
	try {
		report = JSON.parse(answer.body);
	} catch {
		return failed("report-unreadable", "The isolation report is not JSON.");
	}
	const { workspace, isolation, hosts } = (report ?? {}) as Record<string, unknown>;
	if (
		typeof workspace !== "string" ||
		typeof isolation !== "string" ||
		!Array.isArray(hosts) ||
		!hosts.every((host) => typeof host === "string")
	) {
		return failed("report-unreadable", "The isolation report lacks its workspace, fence or hosts.");
	}
	const policyHolds = workspace === policy.workspaceId && sameHosts(hosts, policy.hosts);
	const fence = isolation === FENCED;
	const problem: IsolationCheck["problem"] = !policyHolds
		? {
				reason: "policy-mismatch",
				detail:
					workspace === policy.workspaceId
						? `The computer enforces ${JSON.stringify(hosts)}, not the ${JSON.stringify(policy.hosts)} it was started with.`
						: `The computer runs as workspace ${JSON.stringify(workspace)}, not this one.`,
			}
		: !fence
			? {
					reason: "fence-absent",
					detail: `The computer reports isolation ${JSON.stringify(isolation)}: something besides the filter has a route out.`,
				}
			: null;
	return { checkedAt, policy: policyHolds, fence, problem };
}

/** Thrown by the private-session gate; its `refusal` says why. */
export class PrivateSessionsUnavailable extends Error {
	constructor(readonly refusal: PrivateSessionsRefused) {
		super(refusal.detail);
	}
}

/**
 * Test stage only: an instance with no container, whose control port answers `/isolation` with
 * `report` (404 when null), so tests choose isolation states local Docker cannot produce. Its
 * first `unreachable` asks fail as a dropped connection would.
 */
class SyntheticInstance implements Instance {
	running = false;
	constructor(
		public report: IsolationReport,
		public unreachable = 0,
	) {}
	async start(): Promise<void> {
		this.running = true;
	}
	async destroy(): Promise<void> {
		this.running = false;
	}
	async control(path: string): Promise<Response> {
		if (this.unreachable > 0) {
			this.unreachable--;
			throw new Error("The synthetic control port dropped the connection");
		}
		if (path !== "/isolation" || this.report === null) return new Response(null, { status: 404 });
		return new Response(this.report.body, { status: this.report.status });
	}
}

/** `value` as a normalized exact host name, or null if it isn't one. */
function exactHost(value: unknown): string | null {
	const name = typeof value === "string" ? value.trim().toLowerCase() : "";
	return HOST.test(name) ? name : null;
}

/** The approved hosts from a request body, normalized, or why they were refused. */
function parseHosts(body: unknown): string[] | string {
	const hosts = (body as { hosts?: unknown } | null)?.hosts;
	if (!Array.isArray(hosts)) return "Send { hosts: string[] }";
	if (hosts.length > MAX_HOSTS) return `At most ${MAX_HOSTS} hosts`;
	const normalized = new Set<string>();
	for (const host of hosts) {
		const name = exactHost(host);
		if (name === null) return `Not an exact host name: ${JSON.stringify(host)}`;
		normalized.add(name);
	}
	return [...normalized];
}

/**
 * One per workspace, owning who may open it, its bot membership (the permanent Chief of Staff
 * so far) and its shared computer.
 */
export class Workspace extends Container<AuthEnv> implements WorkspaceRpc {
	readonly #container: Instance;
	/** Test stage only: replaces the container once a test supplies an isolation report. */
	#synthetic: SyntheticInstance | undefined;
	/** The start in flight, so a racing start waits for it instead of starting again. */
	#starting: Promise<void> | undefined;
	/** Requests answered since the object woke, so tests can see that refusals never arrive. */
	#requests = 0;

	constructor(ctx: DurableObjectState<{}>, env: AuthEnv) {
		super(ctx, env);
		// The library's own idle timer: only use of the instance renews it, never a status read.
		this.sleepAfter = Number(env.COMPUTER_IDLE_SECONDS ?? IDLE_SECONDS);
		const container = () => {
			if (!this.ctx.container) throw new Error("This Durable Object has no container");
			return this.ctx.container;
		};
		this.#container = {
			get running() {
				return container().running;
			},
			start: ({ workspaceId, hosts }) =>
				this.startAndWaitForPorts({
					// The instance learns its workspace and list only from these variables.
					startOptions: {
						envVars: { WORKSPACE_ID: workspaceId, APPROVED_HOSTS: hosts.join(",") },
						enableInternet: true,
					},
					ports: [CONTROL_PORT],
					cancellationOptions: { portReadyTimeoutMS: READY_TIMEOUT_MS },
				}),
			destroy: () => this.destroy(),
			control: (path, init) =>
				this.containerFetch(new Request(`http://instance${path}`, init), CONTROL_PORT),
		};
	}

	get #instance(): Instance {
		return this.#synthetic ?? this.#container;
	}

	/**
	 * Admits the workspace's owner, claiming it on first open, and provisions the permanent
	 * Chief of Staff once. Then brings the D1 bot list in line with membership; a failed update
	 * leaves the open intact for the next open or a reconcile to repair. Never starts the
	 * shared computer.
	 */
	async open(
		workspaceId: string,
		accountId: string,
		faults: OpenFaults = {},
	): Promise<OpenedWorkspace> {
		const owner = await this.ctx.storage.get<string>("owner");
		if (owner !== undefined && owner !== accountId) return { refused: "not the owner" };
		if (owner === undefined) await this.ctx.storage.put("owner", accountId);
		await this.ctx.storage.put("workspaceId", workspaceId);

		let chiefOfStaff = await this.ctx.storage.get<ChiefOfStaff>("chiefOfStaff");
		if (!chiefOfStaff) {
			chiefOfStaff = { id: `bot-${crypto.randomUUID()}`, name: "Ditto" };
			await this.ctx.storage.put("chiefOfStaff", chiefOfStaff);
		}

		try {
			if (faults.failProjection && this.env.TEST_HOOKS === "on") {
				throw new Error("The test stage failed the bot-list update");
			}
			await this.reconcileBotList();
		} catch (error) {
			console.error("The bot-list projection update failed", error);
		}

		return {
			workspaceId,
			chiefOfStaff,
			computer: (await this.#status()).computer,
		};
	}

	async members(): Promise<Member[]> {
		const chiefOfStaff = await this.ctx.storage.get<ChiefOfStaff>("chiefOfStaff");
		return chiefOfStaff ? [chiefOfStaff] : [];
	}

	/**
	 * Rebuilds the workspace's D1 bot list from membership in one batch: removes rows with no
	 * matching member and upserts each member by its stable key, so a replay changes nothing.
	 */
	async reconcileBotList(): Promise<void> {
		const workspaceId = await this.ctx.storage.get<string>("workspaceId");
		if (workspaceId === undefined) return;
		const members = await this.members();
		const db = drizzle(this.env.DB);
		await db.batch([
			db.delete(workspaceBot).where(
				and(
					eq(workspaceBot.workspaceId, workspaceId),
					notInArray(
						workspaceBot.botId,
						members.map((member) => member.id),
					),
				),
			),
			...members.map((member) =>
				db
					.insert(workspaceBot)
					.values({ workspaceId, botId: member.id, name: member.name })
					.onConflictDoUpdate({
						target: [workspaceBot.workspaceId, workspaceBot.botId],
						set: { name: member.name },
					}),
			),
		]);
	}

	evict(): void {
		this.ctx.abort("evicted by the test stage");
	}

	/** The lifetime deadline, scheduled through the library at start. Public so it can fire. */
	async lifetimeEnded(): Promise<void> {
		await this.#stop();
	}

	override async onActivityExpired(): Promise<void> {
		await this.#stop();
	}

	/** However the instance ended, nothing about it carries over to the next one. */
	override async onStop(): Promise<void> {
		await this.#forgetInstance();
	}

	/**
	 * The gateway forwards only the owner's requests, with the server-resolved workspace ID in
	 * `x-ditto-workspace-id`.
	 */
	override async fetch(request: Request): Promise<Response> {
		this.#requests++;
		if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			const { 0: client, 1: server } = new WebSocketPair();
			server.accept();
			server.addEventListener("message", (event) => server.send(event.data));
			return new Response(null, { status: 101, webSocket: client });
		}
		const url = new URL(request.url);
		const route = `${request.method} ${url.pathname}`;
		try {
			if (route === "GET /computer") return Response.json(await this.#status());
			if (route === "POST /computer/start") {
				const workspaceId = request.headers.get("x-ditto-workspace-id");
				if (!workspaceId) return Response.json({ error: "No workspace" }, { status: 400 });
				return Response.json(await this.#start(workspaceId));
			}
			if (route === "POST /computer/stop") return Response.json(await this.#stop());
			if (route === "POST /computer/reach") {
				const { host } = ((await request.json().catch(() => null)) ?? {}) as { host?: unknown };
				const name = exactHost(host);
				if (name === null) {
					return Response.json({ error: "Send { host } as an exact host name" }, { status: 400 });
				}
				// A request to a stopped container would start it.
				if (!this.#instance.running) return Response.json({ error: "Stopped" }, { status: 409 });
				// Only a host to try goes in; the instance reads its list and never writes it.
				return await this.#instance.control(`/reach?host=${name}`, { method: "POST" });
			}
			if (route === "GET /hosts") return Response.json({ hosts: await this.#hosts() });
			if (route === "PUT /hosts") {
				const hosts = parseHosts(await request.json().catch(() => null));
				if (typeof hosts === "string") return Response.json({ error: hosts }, { status: 400 });
				// A running instance keeps the list it started with until its next start, and private
				// sessions report `list-changed` meanwhile. The filter re-reads its list file, but only
				// root writes that file, at start: the control port runs as the browser user, beside
				// Chrome and the bots, so letting it rewrite the list would let them widen their own.
				await this.ctx.storage.put("hosts", hosts);
				return Response.json({ hosts });
			}
			if (this.env.TEST_HOOKS === "on" && route === "PUT /__test/computer/synthetic") {
				if (this.#container.running) return Response.json({ error: "Running" }, { status: 409 });
				const { isolation, unreachable = 0 } = (await request.json()) as {
					isolation: IsolationReport;
					unreachable?: number;
				};
				// Only the report changes, so a running synthetic instance keeps running.
				if (this.#synthetic) Object.assign(this.#synthetic, { report: isolation, unreachable });
				else this.#synthetic = new SyntheticInstance(isolation, unreachable);
				return new Response(null, { status: 204 });
			}
			if (this.env.TEST_HOOKS === "on" && route === "POST /__test/computer/private-session") {
				// Stands in for #20's cookie restore: does nothing but pass the gate.
				try {
					await this.#privateSessionGate();
				} catch (error) {
					if (!(error instanceof PrivateSessionsUnavailable)) throw error;
					return Response.json(error.refusal, { status: 409 });
				}
				return new Response(null, { status: 204 });
			}
			const control = /^\/__test\/computer\/control(\/.*)$/.exec(url.pathname)?.[1];
			if (this.env.TEST_HOOKS === "on" && control) {
				if (!this.#instance.running) return Response.json({ error: "Stopped" }, { status: 409 });
				return await this.#instance.control(control + url.search, { method: request.method });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return Response.json({ error: message }, { status: 500 });
		}
		if (route !== "GET /") return Response.json({ error: "Not found" }, { status: 404 });
		return Response.json({
			object: "Workspace",
			container: this.ctx.container !== undefined,
			running: this.ctx.container?.running ?? false,
			requests: this.#requests,
		});
	}

	/** The approved exact-host list, which starts empty, so a new workspace denies every host. */
	async #hosts(): Promise<string[]> {
		return (await this.ctx.storage.get<string[]>("hosts")) ?? [];
	}

	/** Reads only the object's own state, so polling it neither starts nor keeps the instance. */
	async #status(): Promise<ComputerStatus> {
		const privateSessions = await this.#privateSessions();
		if (!this.#instance.running) return { computer: "stopped", privateSessions };
		const [deadline] = await this.listSchedules("lifetimeEnded");
		return {
			computer: "running",
			policy: (await this.ctx.storage.get<ComputerPolicy>("instancePolicy")) ?? null,
			deadline: deadline ? new Date(deadline.time * 1000).toISOString() : null,
			isolation: (await this.ctx.storage.get<IsolationCheck>("isolation")) ?? null,
			privateSessions,
		};
	}

	/**
	 * The gate for private sessions. Restoring a private cookie or exposing a signed-in computer
	 * (#20) must call this first and go no further if it throws. It passes only while an instance
	 * runs whose start recorded this workspace's policy behind the fence (ADR-0004), and whose
	 * list is still the approved one.
	 */
	async #privateSessionGate(): Promise<void> {
		const sessions = await this.#privateSessions();
		if (!sessions.available) throw new PrivateSessionsUnavailable(sessions);
	}

	/** Whether the gate would pass, and why not. Reads only the object's own state. */
	async #privateSessions(): Promise<PrivateSessions> {
		const refused = (reason: PrivateSessionsRefusal, detail: string): PrivateSessionsRefused => ({
			available: false,
			reason,
			detail,
		});
		if (!this.#instance.running) return STOPPED;
		const isolation = await this.ctx.storage.get<IsolationCheck>("isolation");
		const policy = await this.ctx.storage.get<ComputerPolicy>("instancePolicy");
		if (this.#starting || !isolation || !policy) {
			return refused("unchecked", "The computer's isolation is not checked yet for this start.");
		}
		if (isolation.problem) return { available: false, ...isolation.problem };
		if (!sameHosts(policy.hosts, await this.#hosts())) {
			return refused(
				"list-changed",
				"The approved list changed after the computer started. Restart it to enforce the new list.",
			);
		}
		return { available: true };
	}

	/**
	 * Starts the shared computer under the server-resolved workspace ID and the current list, or
	 * reuses the running one.
	 */
	async #start(workspaceId: string): Promise<ComputerStatus & { reused: boolean }> {
		if (this.#starting) {
			await this.#starting;
			return { ...(await this.#status()), reused: true };
		}
		if (this.#instance.running) return { ...(await this.#status()), reused: true };

		const lifetime = Number(this.env.COMPUTER_LIFETIME_SECONDS);
		if (!Number.isFinite(lifetime) || lifetime <= 0) {
			throw new Error("COMPUTER_LIFETIME_SECONDS must be a positive number");
		}
		const policy: ComputerPolicy = { workspaceId, hosts: await this.#hosts() };
		this.#starting = (async () => {
			await this.ctx.storage.delete("isolation");
			await this.ctx.storage.put("instancePolicy", policy);
			this.deleteSchedules("lifetimeEnded");
			await this.schedule(new Date(Date.now() + lifetime * 1000), "lifetimeEnded");
			try {
				await this.#instance.start(policy);
				// Idle time counts from when the instance is ready.
				this.renewActivityTimeout();
				await this.ctx.storage.put("isolation", await this.#checkIsolation(policy));
			} catch (error) {
				await this.#stop();
				throw error;
			}
		})();
		try {
			await this.#starting;
		} finally {
			this.#starting = undefined;
		}
		return { ...(await this.#status()), reused: false };
	}

	/** Destroys the instance. Everything the object holds, the list included, survives it. */
	async #stop(): Promise<ComputerStatus> {
		if (this.#instance.running) await this.#instance.destroy();
		await this.#forgetInstance();
		return { computer: "stopped", privateSessions: STOPPED };
	}

	/**
	 * Asks the instance, right after its start, what it enforces. A request that fails outright
	 * is asked again a few times before the report counts as missing, so one dropped connection
	 * doesn't refuse private sessions for the instance's whole life. Any answer, even an error
	 * status, is judged as it is. Runs inside the start, while the gate still says `unchecked`.
	 */
	async #checkIsolation(policy: ComputerPolicy): Promise<IsolationCheck> {
		for (let attempt = 1; attempt <= ISOLATION_ATTEMPTS; attempt++) {
			try {
				const response = await this.#instance.control("/isolation");
				return checkIsolation(policy, { status: response.status, body: await response.text() });
			} catch (error) {
				console.error(`The isolation report did not arrive (attempt ${attempt})`, error);
			}
			if (attempt < ISOLATION_ATTEMPTS) await scheduler.wait(ISOLATION_RETRY_MS);
		}
		return checkIsolation(policy, null);
	}

	async #forgetInstance(): Promise<void> {
		this.deleteSchedules("lifetimeEnded");
		// A pass belongs to one instance, so it never carries over to the next.
		await this.ctx.storage.delete(["instancePolicy", "isolation"]);
	}
}
