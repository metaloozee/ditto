import { DurableObject } from "cloudflare:workers";
import type { Context } from "@earendil-works/chord";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
} from "@earendil-works/chord/context";
import {
	Harness,
	type HarnessOptions,
	type Storage,
	type TaskId,
} from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { cooperativeFixture } from "./pi-durable-cooperative-fixture.ts";
import { fixtureDatabase } from "./pi-durable-local.ts";

const WORK_MS = 1000;
const DRAIN_MS = 1000;
const VERSION = "pi-1.0.1/ditto-host-1";

type Invocation = {
	id: string;
	generation: number;
	started: number;
	yield_at: number;
	end_at: number;
	state: "active" | "draining" | "closed" | "failed";
};
type Effect = {
	id: string;
	kind: "model" | "tool";
	invocation: string;
	epoch: number;
	attempt: number;
	executor: number;
	deadline: number;
	state: "admitted" | "result-recorded" | "pi-committed";
};
export type HostFault =
	| "read"
	| "intent"
	| "admission"
	| "result"
	| "fence"
	| "account"
	| "before-submit"
	| "after-submit"
	| "after-close"
	| "alarm";
export type LocalAuthority = {
	current: boolean;
	generation: number;
	executor: number;
	liveExecutors?: number;
	priorTerminated?: string;
};
export type HostGuard = {
	admit(
		kind: Effect["kind"],
		operation: string,
		context: Context,
	): Promise<string>;
	result(effect: string, context: Context, evidence: string): Promise<void>;
};
export type HostFixtureDependencies = {
	now(): number;
	authority(): Promise<LocalAuthority>;
	options(guard: HostGuard): HarnessOptions;
	piStorage?(storage: Storage): Storage;
	fault?(point: HostFault): void;
	budgets?: { workMs: number; drainMs: number };
	wakeup?: {
		getAlarm(): Promise<number | null>;
		setAlarm(deadline: number): Promise<void>;
	};
};

/** Disposable L1 host candidate. Plaintext and local authority are not product contracts. */
export class PiDurableHost {
	private harness!: Harness;
	private denied = false;
	private sealed = false;
	private closing: Promise<void> | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private active: Invocation | undefined;
	private failure: unknown;

	private constructor(
		private storage: DurableObjectStorage,
		private dependencies: HostFixtureDependencies,
	) {}

	static async open(
		storage: DurableObjectStorage,
		dependencies: HostFixtureDependencies,
	) {
		const host = new PiDurableHost(storage, dependencies);
		host.transition("intent", () => {
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_meta (id INTEGER PRIMARY KEY, version TEXT, epoch INTEGER, fenced INTEGER, interrupted_at INTEGER, recovery_at INTEGER)",
			);
			storage.sql.exec(
				"INSERT OR IGNORE INTO host_meta VALUES (1, ?, 1, 0, NULL, NULL)",
				VERSION,
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_invocations (id TEXT PRIMARY KEY, generation INTEGER, started INTEGER, yield_at INTEGER, end_at INTEGER, state TEXT)",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_effects (id TEXT PRIMARY KEY, kind TEXT, invocation TEXT, epoch INTEGER, attempt INTEGER, executor INTEGER, deadline INTEGER, state TEXT, evidence TEXT)",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_inbox (id TEXT PRIMARY KEY, content TEXT, state TEXT, submission TEXT)",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_wakeups (id TEXT PRIMARY KEY, deadline INTEGER)",
			);
		});
		await host.durable();
		host.read(() => {
			if (
				storage.sql.exec("SELECT version FROM host_meta").one().version !==
				VERSION
			)
				throw new Error("Incompatible host state");
		});
		const authority = await dependencies.authority();
		const previous = host.latest();
		if (previous?.state === "failed")
			throw new Error("Failed invocation requires review");
		if (previous && previous.state !== "closed") {
			if (
				!authority.current ||
				authority.generation <= previous.generation ||
				authority.priorTerminated !== previous.id
			)
				throw new Error("Prior host termination required");
			host.transition("account", () => {
				storage.sql.exec("UPDATE host_meta SET fenced = 1");
				storage.sql.exec(
					"UPDATE host_invocations SET state = 'closed' WHERE id = ?",
					previous.id,
				);
				storage.sql.exec(
					"INSERT OR REPLACE INTO host_wakeups VALUES ('reconcile', ?)",
					previous.end_at,
				);
			});
			await host.durable();
		}
		const piStorage = await SqliteStorage.open(fixtureDatabase(storage));
		host.harness = await Harness.open(
			dependencies.piStorage?.(piStorage) ?? piStorage,
			dependencies.options({
				admit: (kind, operation, context) =>
					host.admit(kind, operation, context),
				result: (effect, context, evidence) =>
					host.result(effect, context, evidence),
			}),
			BACKGROUND_CONTEXT,
		);
		try {
			await host.repairWakeup();
		} catch (error) {
			await host.harness.close(BACKGROUND_CONTEXT);
			throw error;
		}
		return host;
	}

	private read<T>(operation: () => T): T {
		try {
			this.dependencies.fault?.("read");
			return operation();
		} catch (error) {
			this.denied = true;
			throw error;
		}
	}
	private transition<T>(point: HostFault, operation: () => T): T {
		try {
			this.dependencies.fault?.(point);
			return this.storage.transactionSync(operation);
		} catch (error) {
			this.denied = true;
			throw error;
		}
	}
	private async durable(context: Context = BACKGROUND_CONTEXT) {
		try {
			context.abortSignal?.throwIfAborted();
			await awaitWithContext(this.storage.sync(), context);
			context.abortSignal?.throwIfAborted();
		} catch (error) {
			this.denied = true;
			throw error;
		}
	}
	private latest(): Invocation | undefined {
		return this.read(
			() =>
				this.storage.sql
					.exec<Invocation>(
						"SELECT * FROM host_invocations ORDER BY rowid DESC LIMIT 1",
					)
					.toArray()[0],
		);
	}
	private unresolved(): Effect[] {
		return this.read(() =>
			this.storage.sql
				.exec<Effect>(
					"SELECT * FROM host_effects WHERE state = 'admitted' OR (kind = 'tool' AND state = 'result-recorded')",
				)
				.toArray(),
		);
	}
	private assertLive() {
		if (this.denied || this.sealed) throw new Error("Host admission denied");
	}
	private async check(
		authority: LocalAuthority,
		context: Context = BACKGROUND_CONTEXT,
	) {
		context.abortSignal?.throwIfAborted();
		if (this.denied || this.sealed || !authority.current)
			throw new Error("Host admission denied");
		if (authority.executor !== 1 || (authority.liveExecutors ?? 1) !== 1)
			throw new Error("Executor generation/capacity denied");
		this.read(() => {
			if (
				this.storage.sql.exec("SELECT version FROM host_meta").one().version !==
				VERSION
			)
				throw new Error("Incompatible host state");
		});
		for (const effect of this.unresolved()) {
			if (effect.state !== "result-recorded") continue;
			const operation = effect.id.slice(effect.invocation.length + 1);
			const taskNumber = Number(operation.split(":")[0]);
			if (!Number.isSafeInteger(taskNumber) || taskNumber <= 0)
				throw new Error("Invalid effect task identity");
			const task = await awaitWithContext(
				this.harness.getTask(taskNumber as TaskId, context),
				context,
			);
			context.abortSignal?.throwIfAborted();
			if (this.denied || this.sealed) throw new Error("Host admission denied");
			// Pi's terminal receipt follows its atomic tool-result/terminal-task commit.
			const callId = operation.slice(operation.indexOf(":") + 1);
			if (
				task?.kind === "pi.tool" &&
				task.version === 1 &&
				typeof task.input === "object" &&
				task.input !== null &&
				"callId" in task.input &&
				task.input.callId === callId &&
				task.state.status === "terminal" &&
				task.state.outcome.status === "completed"
			) {
				this.transition("result", () =>
					this.storage.sql.exec(
						"UPDATE host_effects SET state = 'pi-committed' WHERE id = ? AND state = 'result-recorded'",
						effect.id,
					),
				);
				await this.durable(context);
			}
		}
		this.assertLive();
		if (this.unresolved().length)
			throw new Error("Unresolved effect blocks admission");
		if (
			this.active &&
			(authority.generation !== this.active.generation ||
				this.dependencies.now() >= this.active.yield_at)
		)
			throw new Error("Invocation authority expired");
	}

	async inspect() {
		return this.harness.inspect(BACKGROUND_CONTEXT);
	}
	async history() {
		const root = await this.harness.root(BACKGROUND_CONTEXT);
		return root.entries({}, 20, undefined, BACKGROUND_CONTEXT);
	}
	async observe() {
		const root = await this.harness.root(BACKGROUND_CONTEXT);
		await root.context(BACKGROUND_CONTEXT);
		const watch = await root.watch(BACKGROUND_CONTEXT);
		await watch.stop();
		const graph = await this.harness.watchTaskGraph(BACKGROUND_CONTEXT);
		await graph.stop();
	}

	async accept(id: string, content: string) {
		if (this.sealed) throw new Error("Host sealed");
		this.transition("intent", () => {
			const existing = this.storage.sql
				.exec<{ content: string }>(
					"SELECT content FROM host_inbox WHERE id = ?",
					id,
				)
				.toArray()[0];
			if (existing && existing.content !== content)
				throw new Error("Conflicting input");
			this.storage.sql.exec(
				"INSERT OR IGNORE INTO host_inbox VALUES (?, ?, 'accepted', NULL)",
				id,
				content,
			);
			this.storage.sql.exec(
				"INSERT OR IGNORE INTO host_wakeups VALUES (?, ?)",
				`inbox:${id}`,
				this.dependencies.now(),
			);
		});
		await this.durable();
		await this.repairWakeup();
		return { id };
	}

	async schedule(id: string, duplicateInvocation?: string) {
		if (duplicateInvocation) {
			const previous = this.latest();
			if (previous?.id !== duplicateInvocation)
				throw new Error("Stale invocation delivery");
			return previous;
		}
		let authority = await this.dependencies.authority();
		await this.check(authority);
		if (
			(await this.harness.inspect(BACKGROUND_CONTEXT)).tasks.some(
				(task) => task.state.kind === "blocked",
			)
		)
			throw new Error("Incompatible Pi task state");
		authority = await this.dependencies.authority();
		await this.check(authority);
		if (!this.active) {
			this.active = this.transition("intent", () => {
				this.assertLive();
				const prior = this.latest();
				if (prior && prior.state !== "closed")
					throw new Error("Prior invocation not accounted");
				const now = this.dependencies.now();
				const workMs = this.dependencies.budgets?.workMs ?? WORK_MS;
				const drainMs = this.dependencies.budgets?.drainMs ?? DRAIN_MS;
				if (
					!Number.isSafeInteger(workMs) ||
					workMs <= 0 ||
					!Number.isSafeInteger(drainMs) ||
					drainMs <= 0
				)
					throw new Error("Invalid host budgets");
				const invocation: Invocation = {
					id: crypto.randomUUID(),
					generation: authority.generation,
					started: now,
					yield_at: now + workMs,
					end_at: now + workMs + drainMs,
					state: "active",
				};
				this.storage.sql.exec(
					"INSERT INTO host_invocations VALUES (?, ?, ?, ?, ?, ?)",
					invocation.id,
					invocation.generation,
					invocation.started,
					invocation.yield_at,
					invocation.end_at,
					invocation.state,
				);
				this.storage.sql.exec("UPDATE host_meta SET fenced = 0");
				this.storage.sql.exec(
					"INSERT OR REPLACE INTO host_wakeups VALUES ('yield', ?)",
					invocation.yield_at,
				);
				return invocation;
			});
			await this.durable();
			this.timer = setTimeout(
				() => {
					void this.yield().catch((error: unknown) => {
						this.failure = error;
						this.denied = true;
					});
				},
				Math.max(0, this.active.yield_at - this.dependencies.now()),
			);
		}
		const invocation = this.active;
		await this.repairWakeup();
		const root = await this.harness.root(BACKGROUND_CONTEXT);
		if ((await root.agent(BACKGROUND_CONTEXT)).model === undefined) {
			await this.check(await this.dependencies.authority());
			this.assertLive();
			await root.configure(
				{ model: { provider: "faux", modelId: "faux-1" } },
				BACKGROUND_CONTEXT,
			);
		}
		const input = this.read(() =>
			this.storage.sql
				.exec<{ content: string; state: string }>(
					"SELECT content, state FROM host_inbox WHERE id = ?",
					id,
				)
				.one(),
		);
		if (input.state !== "submitted") {
			this.transition("intent", () =>
				this.storage.sql.exec(
					"UPDATE host_inbox SET state = 'submitting' WHERE id = ?",
					id,
				),
			);
			await this.durable();
			await this.check(await this.dependencies.authority());
			try {
				this.dependencies.fault?.("before-submit");
				this.assertLive();
				const submission = await root.submit(
					{ type: "input", content: input.content, requestId: id },
					BACKGROUND_CONTEXT,
				);
				this.dependencies.fault?.("after-submit");
				this.transition("intent", () => {
					this.storage.sql.exec(
						"UPDATE host_inbox SET state = 'submitted', submission = ? WHERE id = ?",
						submission.id,
						id,
					);
					this.storage.sql.exec(
						"DELETE FROM host_wakeups WHERE id = ?",
						`inbox:${id}`,
					);
				});
				await this.durable();
			} catch (error) {
				this.denied = true;
				throw error;
			}
		} else {
			await this.check(await this.dependencies.authority());
			this.assertLive();
			this.harness.resume();
		}
		return invocation;
	}

	async admit(kind: Effect["kind"], operation: string, context: Context) {
		context.abortSignal?.throwIfAborted();
		const authority = await awaitWithContext(
			this.dependencies.authority(),
			context,
		);
		context.abortSignal?.throwIfAborted();
		await this.check(authority, context);
		const invocation = this.active;
		if (!invocation) throw new Error("Passive host has no effect budget");

		const id = `${invocation.id}:${operation}`;
		this.transition("admission", () => {
			context.abortSignal?.throwIfAborted();
			this.assertLive();
			if (
				this.storage.sql.exec("SELECT fenced FROM host_meta").one().fenced !== 0
			)
				throw new Error("Durable fence");
			if (
				this.storage.sql
					.exec("SELECT id FROM host_effects WHERE id = ?", id)
					.toArray().length
			)
				throw new Error("Effect already admitted");
			const epoch = this.storage.sql
				.exec<{ epoch: number }>("SELECT epoch FROM host_meta")
				.one().epoch;
			this.storage.sql.exec(
				"INSERT INTO host_effects VALUES (?, ?, ?, ?, 1, ?, ?, 'admitted', NULL)",
				id,
				kind,
				invocation.id,
				epoch,
				kind === "tool" ? authority.executor : 0,
				invocation.end_at,
			);
		});
		await this.durable(context);
		context.abortSignal?.throwIfAborted();
		// A close or authority change during the durability await must prevent dispatch.
		const fresh = await awaitWithContext(
			this.dependencies.authority(),
			context,
		);
		context.abortSignal?.throwIfAborted();
		if (
			this.denied ||
			this.sealed ||
			!fresh.current ||
			fresh.executor !== 1 ||
			(fresh.liveExecutors ?? 1) !== 1 ||
			fresh.generation !== invocation.generation ||
			(kind === "tool" && fresh.executor !== authority.executor) ||
			this.dependencies.now() >= invocation.yield_at
		)
			throw new Error("Admission revoked during preparation");
		return id;
	}
	async result(effect: string, context: Context, evidence: string) {
		context.abortSignal?.throwIfAborted();
		if (new TextEncoder().encode(evidence).byteLength > 8192) {
			this.denied = true;
			throw new Error("Oversized synthetic result evidence");
		}
		const parsed: unknown = JSON.parse(evidence);
		if (parsed === undefined)
			throw new Error("Missing synthetic result evidence");
		if (this.denied || this.sealed) throw new Error("Host result denied");
		this.transition("result", () => {
			this.storage.sql
				.exec(
					"UPDATE host_effects SET state = 'result-recorded', evidence = ? WHERE id = ? AND invocation = ? AND epoch = (SELECT epoch FROM host_meta) AND state = 'admitted' RETURNING id",
					evidence,
					effect,
					this.active?.id ?? "",
				)
				.one();
		});
		await this.durable(context);
		context.abortSignal?.throwIfAborted();
		if (this.denied || this.sealed) throw new Error("Host result sealed");
	}

	async yield() {
		if (this.closing) return this.closing;
		this.sealed = true;
		clearTimeout(this.timer);
		this.closing = this.closeAndAccount();
		return this.closing;
	}
	private async closeAndAccount() {
		let fenceError: unknown;
		try {
			this.transition("fence", () => {
				const interrupted = this.dependencies.now();
				this.storage.sql.exec(
					"UPDATE host_meta SET fenced = 1, interrupted_at = COALESCE(interrupted_at, ?), recovery_at = COALESCE(recovery_at, ?)",
					interrupted,
					interrupted + 15 * 60_000,
				);
				if (this.active)
					this.storage.sql.exec(
						"UPDATE host_invocations SET state = 'draining' WHERE id = ?",
						this.active.id,
					);
				this.storage.sql.exec("DELETE FROM host_wakeups WHERE id = 'yield'");
				this.storage.sql.exec(
					"INSERT OR REPLACE INTO host_wakeups VALUES ('reconcile', ?)",
					this.active?.end_at ?? this.dependencies.now() + DRAIN_MS,
				);
			});
			await this.durable();
			await this.repairWakeup();
		} catch (error) {
			fenceError = error;
		}
		await this.harness.close(BACKGROUND_CONTEXT);
		if (fenceError) throw fenceError;
		try {
			this.dependencies.fault?.("after-close");
		} catch (error) {
			this.denied = true;
			throw error;
		}
		if (this.active && this.dependencies.now() >= this.active.end_at) {
			this.denied = true;
			this.transition("account", () =>
				this.storage.sql.exec(
					"UPDATE host_invocations SET state = 'failed' WHERE id = ?",
					this.active?.id ?? "",
				),
			);
			await this.durable();
			throw new Error("Actual close exceeded end deadline");
		}
		this.transition("account", () => {
			if (this.active)
				this.storage.sql.exec(
					"UPDATE host_invocations SET state = 'closed' WHERE id = ?",
					this.active.id,
				);
			this.storage.sql.exec("DELETE FROM host_wakeups WHERE id = 'yield'");
		});
		await this.durable();
	}
	async repairWakeup() {
		const next = this.read(
			() =>
				this.storage.sql
					.exec<{ deadline: number }>(
						"SELECT MIN(deadline) AS deadline FROM host_wakeups",
					)
					.one().deadline,
		);
		if (next == null) return;
		this.dependencies.fault?.("alarm");
		const wakeup = this.dependencies.wakeup ?? this.storage;
		const existing = await wakeup.getAlarm();
		if (existing === null || next < existing) await wakeup.setAlarm(next);
	}
	async reserveWakeup(
		kind: "retry" | "effect" | "projection" | "checkpoint",
		deadline: number,
	) {
		this.transition("intent", () =>
			this.storage.sql.exec(
				"INSERT OR REPLACE INTO host_wakeups VALUES (?, ?)",
				kind,
				deadline,
			),
		);
		await this.durable();
		await this.repairWakeup();
	}
	async alarm() {
		if (
			this.sealed ||
			this.denied ||
			(!this.active && this.unresolved().length)
		)
			return;
		if (this.active) {
			if (this.dependencies.now() >= this.active.yield_at) await this.yield();
			else await this.repairWakeup();
			return;
		}
		await this.repairWakeup();
		if (this.sealed || this.denied || this.unresolved().length) return;
		const input = this.read(
			() =>
				this.storage.sql
					.exec<{ id: string; state: string }>(
						"SELECT id, state FROM host_inbox ORDER BY rowid LIMIT 1",
					)
					.toArray()[0],
		);
		if (!input) return;
		const tasks = (await this.inspect()).tasks;
		this.assertLive();
		// Pi owns the retry checkpoint; this only reserves its next host wakeup.
		const deadlines = tasks.map((task) => {
			const checkpoint = task.record.state.checkpoint;
			return task.state.kind === "ready" &&
				task.record.kind === "pi.generation" &&
				task.record.version === 1 &&
				!task.record.abortRequested &&
				checkpoint &&
				typeof checkpoint === "object" &&
				!Array.isArray(checkpoint) &&
				checkpoint.phase === "retry" &&
				typeof checkpoint.until === "number" &&
				Number.isFinite(checkpoint.until) &&
				checkpoint.until > this.dependencies.now()
				? checkpoint.until
				: undefined;
		});
		const future = deadlines.filter(
			(deadline): deadline is number => deadline !== undefined,
		);
		const retryAt =
			input.state === "submitted" &&
			future.length > 0 &&
			future.length === tasks.length
				? Math.min(...future)
				: undefined;
		this.transition("intent", () => {
			this.assertLive();
			this.storage.sql.exec(
				"DELETE FROM host_wakeups WHERE id IN ('reconcile', 'pi-retry')",
			);
			if (retryAt !== undefined)
				this.storage.sql.exec(
					"INSERT INTO host_wakeups VALUES ('pi-retry', ?)",
					retryAt,
				);
		});
		await this.durable();
		if (retryAt !== undefined) {
			await this.repairWakeup();
			return;
		}
		await this.schedule(input.id);
	}
	async awaitClosure() {
		if (!this.closing) return false;
		await this.closing;
		return true;
	}
	get backgroundFailure() {
		return this.failure;
	}
}

export class PiDurableHostFixture extends DurableObject<{
	PI_HOST_FIXTURE_CLOCK_OFFSET_MS?: number;
}> {
	host: PiDurableHost | undefined;
	private opening: Promise<PiDurableHost> | undefined;
	readonly fixtures: ReturnType<typeof cooperativeFixture>[] = [];
	alarmCompletion: Promise<void> | undefined;
	alarmCalls = 0;

	async activate() {
		if (!this.opening) this.opening = this.activateAfterClosure();
		const opening = this.opening;
		try {
			this.host = await opening;
			return this.host;
		} finally {
			if (this.opening === opening) this.opening = undefined;
		}
	}

	private async activateAfterClosure() {
		if (this.host && !(await this.host.awaitClosure())) return this.host;
		const now = () =>
			Date.now() + (this.env.PI_HOST_FIXTURE_CLOCK_OFFSET_MS ?? 0);
		return PiDurableHost.open(this.ctx.storage, {
			now,
			authority: async () =>
				(await this.ctx.storage.get<LocalAuthority>("local-authority")) ?? {
					current: true,
					generation: 1,
					executor: 1,
				},
			options: (guard) => {
				const fixture = cooperativeFixture(
					"request",
					(kind, id, context) => guard.admit(kind, id, context),
					(id, context, evidence) => guard.result(id, context, evidence),
				);
				this.fixtures.push(fixture);
				return {
					now,
					models: fixture.models,
					registry: fixture.registry,
					settings: {
						extensions: [fixture.extension],
						toolExecution: "sequential",
						retry: { enabled: false },
						compaction: { enabled: false, backgroundTokens: 0 },
					},
				};
			},
		});
	}

	async retire() {
		if (!this.host) return;
		await this.host.yield();
		const prior = this.ctx.storage.sql
			.exec<{ id: string; generation: number }>(
				"SELECT id, generation FROM host_invocations ORDER BY rowid DESC LIMIT 1",
			)
			.toArray()[0];
		if (prior)
			await this.ctx.storage.put("local-authority", {
				current: true,
				generation: prior.generation + 1,
				executor: 1,
				priorTerminated: prior.id,
			} satisfies LocalAuthority);
		await this.ctx.storage.sync();
		this.host = undefined;
	}

	async alarm() {
		this.alarmCalls++;
		this.alarmCompletion = this.handleAlarm();
		await this.alarmCompletion;
	}
	private async handleAlarm() {
		const host = await this.activate();
		await host.alarm();
	}
}
