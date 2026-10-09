import { DurableObject } from "cloudflare:workers";
import type { Context } from "@earendil-works/chord";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type AgentChange,
	type CommitPublication,
	Harness,
	type HarnessOptions,
	type HookApi,
	ROOT_CONVERSATION_ID,
	type Storage,
	type TaskId,
	type TaskRecord,
	type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import {
	type ModelAttemptV1,
	parseModelAttemptV1,
} from "../../../packages/runtime-contracts/src/model.js";
import {
	digestText,
	isRuntimeCiphertext,
	isUnboundSelection,
	openHostField,
	type RetainedStorageBinding,
	sealHostField,
	UNBOUND_SELECTION,
} from "./host-private.ts";
import { cooperativeFixture } from "./pi-durable-cooperative-fixture.ts";
import { fixtureDatabase } from "./pi-durable-local.ts";
import {
	ADAPTER_COMPAT,
	ENGINE_COMPAT,
	EncryptedPiStorage,
	EncryptedStorageError,
	PROVIDER_COMPAT,
	TASK_COMPAT,
	TOOL_COMPAT,
} from "./pi-durable-storage.ts";
import {
	type PreparedSummary,
	preparedSummary,
	SUMMARY_POLICY,
	type SummarySelection,
	summaryText,
	summaryTranscript,
	validateSummaryResponse,
} from "./pi-durable-summary.ts";

const WORK_MS = 1000;
const DRAIN_MS = 1000;
const VERSION = "pi-1.0.1/ditto-host-3";

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
	// Retained 002 invocation endpoint; correlated effects use operation_deadline.
	deadline: number;
	operation_deadline?: number | null;
	state: "admitted" | "result-recorded" | "pi-committed";
	correlation?: string | null;
};
export type HostFault =
	| "read"
	| "intent"
	| "admission"
	| "preparation"
	| "preparation-write"
	| "preparation-flush"
	| "result"
	| "summary-result-write"
	| "summary-result-flush"
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
	expectedContentWrites?: boolean;
	priorTerminated?: string;
};
class EffectDenied extends Error {
	constructor(
		readonly reason: "reservation" | "recovery-deadline" | "authority",
		readonly run?: string,
	) {
		super(
			reason === "reservation"
				? "Unresolved effect blocks admission: competing reservation"
				: reason === "recovery-deadline"
					? "Run recovery deadline expired"
					: "Run authority revoked",
		);
	}
}
type PublicTask = TaskRecord<unknown, unknown, unknown>;
type Run = {
	id: string;
	epoch: number;
	state:
		| "queued"
		| "running"
		| "recovering"
		| "stopping"
		| "complete"
		| "failed"
		| "canceled";
	interrupted_at: number | null;
	recovery_at: number | null;
};
type Command = {
	id: string;
	run: string;
	user: string;
	assistant: string;
	sequence: number;
	submission: number | null;
	state: "accepted" | "submitted" | "settled";
};
type TaskMapping = {
	task: number;
	kind: string;
	conversation: number;
	owner: string;
	command: string;
	selection: string;
	prepared: string | null;
	digest: string | null;
};
export type ModelRequest = {
	model: { provider: string; id: string };
	transcript: unknown;
	options: Record<string, unknown>;
};
export type ToolRequest = {
	task: TaskId;
	conversation: number;
	call: string;
	name: "cooperative_remote";
	arguments: Record<string, unknown>;
	operation:
		| { kind: "shell" }
		| { kind: "read"; newObservation: boolean }
		| { kind: "write"; expectedContent: string };
	replay: "never" | "new-observation" | "expected-content";
};
export type EffectCorrelation = {
	version: 1 | 2;
	command: string;
	run: string;
	user: string;
	assistant: string;
	submission: number;
	task: number;
	call: string | null;
	operation: string;
	piAttempt: number;
	arguments: string;
	replay: "never" | "new-observation" | "expected-content" | "pi-retry";
	generation: number;
	taskInput: string;
	prepared: string;
	digest: string;
};

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid public record");
	return value as Record<string, unknown>;
}
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "undefined";
}
export async function requestDigest(value: unknown) {
	const text = canonical(value);
	if (new TextEncoder().encode(text).byteLength > 128_000)
		throw new Error("Oversized synthetic request");
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return [...new Uint8Array(hash)]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
}
export function semanticTranscript(value: unknown) {
	const context = record(value);
	if (!Array.isArray(context.messages)) throw new Error("Missing messages");
	return {
		...context,
		messages: context.messages.map((message) => {
			const { timestamp: _timestamp, ...rest } = record(message);
			return rest;
		}),
	};
}
function preparedTask(task: PublicTask) {
	const cp = record(task.state.checkpoint);
	if (
		task.version !== 1 ||
		task.background ||
		task.abortRequested ||
		task.conversationId !== ROOT_CONVERSATION_ID ||
		task.state.status !== "running"
	)
		throw new Error("Incompatible producer");
	if (!Number.isSafeInteger(cp.attempt) || Number(cp.attempt) <= 0)
		throw new Error("Invalid Pi attempt");
	if (task.kind === "pi.generation") {
		if (
			cp.phase !== "request" ||
			!Number.isSafeInteger(cp.cutoff) ||
			Number(cp.cutoff) <= 0
		)
			throw new Error("Missing generation checkpoint");
	} else if (task.kind === "pi.compaction") {
		if (
			cp.phase !== "summarize" ||
			!Number.isSafeInteger(cp.firstKept) ||
			Number(cp.firstKept) <= 0 ||
			!Number.isSafeInteger(cp.tail) ||
			Number(cp.tail) < Number(cp.firstKept) ||
			!Number.isSafeInteger(cp.maxTokens) ||
			Number(cp.maxTokens) <= 0
		)
			throw new Error("Invalid compaction checkpoint");
	} else throw new Error("Unsupported producer");
	const { phase: _phase, attempt: _attempt, until: _until, ...tuple } = cp;
	return canonical(tuple);
}

export type ModelDispatch = {
	readonly attempt: Readonly<ModelAttemptV1>;
	claim(attempt: unknown): Promise<void>;
};

export type HostGuard = {
	summarize(
		api: HookApi,
		selection: SummarySelection,
		context: Context,
	): Promise<{ summary: string } | { decline: true }>;
	bindGeneration(api: HookApi, digest: string, context: Context): Promise<void>;
	bindCompaction(
		api: HookApi,
		selection: { firstKept: number; entries: number[]; digest: string },
		context: Context,
	): Promise<void>;
	model(
		request: ModelRequest,
		context: Context,
		start: (dispatch: ModelDispatch) => Promise<AssistantMessage>,
	): Promise<{ effect: string; response: Promise<AssistantMessage> }>;
	tool(
		request: ToolRequest,
		context: Context,
		start: () => Promise<ToolExecutionResult>,
	): Promise<{ effect: string; response: Promise<ToolExecutionResult> }>;
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
	operationMs?: { model: number; tool: number };
	prepareModel?(context: Context): Promise<void>;
	beforeRetrySeal?: () => Promise<unknown>;
	wakeup?: {
		getAlarm(): Promise<number | null>;
		setAlarm(deadline: number): Promise<void>;
	};
	retained?: RetainedStorageBinding;
};

/** Disposable L1 host candidate. Plaintext and local authority are not product contracts. */
export class PiDurableHost {
	private harness!: Harness;
	private options!: HarnessOptions;
	private customBindings = new WeakMap<AbortSignal, PreparedSummary>();
	private piRecords!: Storage;
	private denied = false;
	private sealed = false;
	private closing: Promise<void> | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private active: Invocation | undefined;
	private failure: unknown;
	private providerQueue = Promise.resolve();
	private ownerQueue: Promise<void> = Promise.resolve();
	private ownerAbort = new AbortController();
	private providerCallbacks = 0;
	private bindings = new WeakMap<
		AbortSignal,
		{ task: number; digest?: string; stock?: true }
	>();
	private storageBarrier = false;
	private privatePlain = new Map<string, string>();
	private privateDigest = new Map<string, string>();
	private privateEnvelope = new Map<string, string>();
	private privateQueue: Promise<void> = Promise.resolve();
	private queueError: unknown;

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
				"CREATE TABLE IF NOT EXISTS host_model_dispatch (effect TEXT PRIMARY KEY, request_digest TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0 CHECK(claimed IN (0,1)))",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_inbox (id TEXT PRIMARY KEY, content TEXT, state TEXT, submission TEXT)",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_wakeups (id TEXT PRIMARY KEY, deadline INTEGER)",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_runs (id TEXT PRIMARY KEY, epoch INTEGER, state TEXT, interrupted_at INTEGER, recovery_at INTEGER)",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_commands (id TEXT PRIMARY KEY, run TEXT, user TEXT UNIQUE, assistant TEXT UNIQUE, sequence INTEGER UNIQUE, submission INTEGER, state TEXT)",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_members (assistant TEXT PRIMARY KEY, run TEXT, state TEXT)",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_projections (assistant TEXT PRIMARY KEY, run TEXT, state TEXT, version INTEGER)",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_tasks (task INTEGER PRIMARY KEY, kind TEXT, conversation INTEGER, owner TEXT, command TEXT, selection TEXT, prepared TEXT, digest TEXT)",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_controls (id TEXT PRIMARY KEY, run TEXT, state TEXT)",
			);
			storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS host_safety (id INTEGER PRIMARY KEY, reason TEXT)",
			);
			const columns = storage.sql
				.exec<{ name: string }>("PRAGMA table_info(host_effects)")
				.toArray();
			if (!columns.some((column) => column.name === "correlation"))
				storage.sql.exec(
					"ALTER TABLE host_effects ADD COLUMN correlation TEXT",
				);
			if (!columns.some((column) => column.name === "retry_evidence"))
				storage.sql.exec(
					"ALTER TABLE host_effects ADD COLUMN retry_evidence TEXT",
				);
			if (!columns.some((column) => column.name === "operation_deadline"))
				storage.sql.exec(
					"ALTER TABLE host_effects ADD COLUMN operation_deadline INTEGER",
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
				// Without an exact trusted termination time, start is the durable lower bound.
				host.interruptRuns(previous.started);
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
		await host.assertRetainedGate();
		const piStorage = dependencies.retained
			? await EncryptedPiStorage.open(storage, dependencies.retained)
			: await SqliteStorage.open(fixtureDatabase(storage));
		try {
			host.piRecords = dependencies.piStorage?.(piStorage) ?? piStorage;
			if (dependencies.retained) await host.revealPrivate();
		} catch (error) {
			await piStorage.close(BACKGROUND_CONTEXT);
			throw error;
		}
		host.options = dependencies.options({
			summarize: (api, selection, context) =>
				host.summarize(api, selection, context),
			bindGeneration: (api, digest, context) =>
				host.bindTask("pi.generation", api, {}, digest, context),
			bindCompaction: (api, selection, context) =>
				host.bindTask(
					"pi.compaction",
					api,
					selection,
					undefined,
					context,
					true,
				),
			model: (request, context, start) => host.model(request, context, start),
			tool: (request, context, start) => host.tool(request, context, start),
			admit: (kind, operation, context) => host.admit(kind, operation, context),
			result: (effect, context, evidence) =>
				host.result(effect, context, evidence),
		});
		host.harness = await Harness.open(
			host.piRecords,
			host.options,
			BACKGROUND_CONTEXT,
		);
		host.harness.subscribeCommits((publication) =>
			host.captureRetry(publication),
		);
		try {
			await host.reconcileSafety();
			await host.repairWakeup();
		} catch (error) {
			await host.harness.close(BACKGROUND_CONTEXT);
			throw error;
		}
		return host;
	}

	private async assertRetainedGate() {
		const meta = this.storage.sql
			.exec<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'host_retained_meta'",
			)
			.toArray();
		if (!this.dependencies.retained) {
			if (meta.length > 0)
				throw new Error("Retained storage requires encryption binding");
			return;
		}
		this.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS host_retained_meta (id INTEGER PRIMARY KEY CHECK (id = 1), format_version INTEGER NOT NULL, engine_compat TEXT NOT NULL, task_compat TEXT NOT NULL, tool_compat TEXT NOT NULL, provider_compat TEXT NOT NULL, adapter_compat TEXT NOT NULL)",
		);
		this.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS host_effect_route (id TEXT PRIMARY KEY, run TEXT NOT NULL, operation TEXT NOT NULL, task INTEGER NOT NULL)",
		);
		this.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS host_seal (record_id TEXT PRIMARY KEY, digest TEXT NOT NULL)",
		);
		this.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS host_retry_intent (effect_id TEXT PRIMARY KEY, task INTEGER NOT NULL, attempt INTEGER NOT NULL, until_at INTEGER NOT NULL, seq INTEGER NOT NULL, state TEXT NOT NULL)",
		);
		const row = this.storage.sql
			.exec<{
				format_version: number;
				engine_compat: string;
				task_compat: string;
				tool_compat: string;
				provider_compat: string;
				adapter_compat: string;
			}>(
				"SELECT format_version, engine_compat, task_compat, tool_compat, provider_compat, adapter_compat FROM host_retained_meta WHERE id = 1",
			)
			.toArray()[0];
		if (!row) {
			this.assertNoPlaintextPrivate();
			this.storage.sql.exec(
				"INSERT INTO host_retained_meta VALUES (1, 1, ?, ?, ?, ?, ?)",
				ENGINE_COMPAT,
				TASK_COMPAT,
				TOOL_COMPAT,
				PROVIDER_COMPAT,
				ADAPTER_COMPAT,
			);
			return;
		}
		if (
			row.format_version !== 1 ||
			row.engine_compat !== ENGINE_COMPAT ||
			row.task_compat !== TASK_COMPAT ||
			row.tool_compat !== TOOL_COMPAT ||
			row.provider_compat !== PROVIDER_COMPAT ||
			row.adapter_compat !== ADAPTER_COMPAT
		)
			throw new Error("Incompatible retained storage");
	}
	private assertNoPlaintextPrivate() {
		const statements = [
			"SELECT content AS value FROM host_inbox",
			"SELECT correlation AS value FROM host_effects WHERE correlation IS NOT NULL",
			"SELECT evidence AS value FROM host_effects WHERE evidence IS NOT NULL",
			"SELECT retry_evidence AS value FROM host_effects WHERE retry_evidence IS NOT NULL",
			"SELECT selection AS value FROM host_tasks WHERE selection IS NOT NULL",
			"SELECT prepared AS value FROM host_tasks WHERE prepared IS NOT NULL",
		];
		for (const statement of statements) {
			for (const row of this.storage.sql
				.exec<{ value: string }>(statement)
				.toArray()) {
				if (!isRuntimeCiphertext(row.value))
					throw new Error("Plaintext retained payload");
			}
		}
	}
	private async revealPrivate() {
		const binding = this.dependencies.retained;
		if (!binding) return;
		const fields = [
			...this.storage.sql
				.exec<{ record_id: string; value: string }>(
					"SELECT 'inbox:' || id || ':content' AS record_id, content AS value FROM host_inbox",
				)
				.toArray(),
			...this.storage.sql
				.exec<{ record_id: string; value: string }>(
					"SELECT 'effect:' || id || ':correlation' AS record_id, correlation AS value FROM host_effects WHERE correlation IS NOT NULL",
				)
				.toArray(),
			...this.storage.sql
				.exec<{ record_id: string; value: string }>(
					"SELECT 'effect:' || id || ':evidence' AS record_id, evidence AS value FROM host_effects WHERE evidence IS NOT NULL",
				)
				.toArray(),
			...this.storage.sql
				.exec<{ record_id: string; value: string }>(
					"SELECT 'effect:' || id || ':retry_evidence' AS record_id, retry_evidence AS value FROM host_effects WHERE retry_evidence IS NOT NULL",
				)
				.toArray(),
			...this.storage.sql
				.exec<{ record_id: string; value: string }>(
					"SELECT 'task:' || task || ':selection' AS record_id, selection AS value FROM host_tasks WHERE selection IS NOT NULL",
				)
				.toArray(),
			...this.storage.sql
				.exec<{ record_id: string; value: string }>(
					"SELECT 'task:' || task || ':prepared' AS record_id, prepared AS value FROM host_tasks WHERE prepared IS NOT NULL",
				)
				.toArray(),
		];
		for (const field of fields) {
			try {
				const plain = await openHostField(
					binding,
					field.record_id,
					field.value,
				);
				const digest = await digestText(plain);
				const seal = this.storage.sql
					.exec<{ digest: string }>(
						"SELECT digest FROM host_seal WHERE record_id = ?",
						field.record_id,
					)
					.toArray()[0];
				if (seal?.digest !== digest)
					throw new EncryptedStorageError(
						"integrity",
						"Storage integrity failure",
					);
				this.privatePlain.set(field.record_id, plain);
				this.privateDigest.set(field.record_id, digest);
				this.privateDigest.set(plain, digest);
				this.privateEnvelope.set(field.record_id, field.value);
			} catch (error) {
				if (error instanceof EncryptedStorageError) throw error;
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
			}
		}
		this.assertRetainedRoutes();
		if (
			this.storage.sql
				.exec(
					"SELECT effect_id FROM host_retry_intent WHERE state = 'pending' LIMIT 1",
				)
				.toArray().length
		)
			throw new EncryptedStorageError("integrity", "Missing retry evidence");
	}
	private assertRetainedRoutes() {
		if (!this.dependencies.retained) return;
		const routes = this.storage.sql
			.exec<{
				id: string;
				run: string;
				operation: string;
				task: number;
			}>("SELECT id, run, operation, task FROM host_effect_route")
			.toArray();
		const effects = this.storage.sql
			.exec<{ id: string }>(
				"SELECT id FROM host_effects WHERE correlation IS NOT NULL",
			)
			.toArray();
		if (routes.length !== effects.length)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		for (const effect of effects) {
			const route = routes.find((row) => row.id === effect.id);
			const parsed: unknown = JSON.parse(
				this.requiredPlain(`effect:${effect.id}:correlation`),
			);
			if (!route || !this.routeMatches(route, parsed))
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
		}
	}
	private routeMatches(
		route: { run: string; operation: string; task: number },
		parsed: unknown,
	): boolean {
		if (typeof parsed !== "object" || parsed === null) return false;
		const value = parsed as {
			run?: unknown;
			operation?: unknown;
			task?: unknown;
		};
		return (
			value.run === route.run &&
			value.operation === route.operation &&
			value.task === route.task
		);
	}
	private assertSeals() {
		if (!this.dependencies.retained) return;
		for (const [recordId, plain] of this.privatePlain) {
			const digest = this.privateDigest.get(recordId);
			const seal = this.storage.sql
				.exec<{ digest: string }>(
					"SELECT digest FROM host_seal WHERE record_id = ?",
					recordId,
				)
				.toArray()[0];
			const stored = this.storedEnvelope(recordId);
			if (
				!digest ||
				seal?.digest !== digest ||
				digest !== this.privateDigest.get(plain) ||
				stored == null ||
				this.privateEnvelope.get(recordId) !== stored
			)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
		}
		this.assertRetainedRoutes();
	}
	private storedEnvelope(recordId: string): string | null {
		const inbox = /^inbox:(.+):content$/.exec(recordId);
		if (inbox) {
			const row = this.storage.sql
				.exec<{ content: string }>(
					"SELECT content FROM host_inbox WHERE id = ?",
					inbox[1],
				)
				.toArray()[0];
			return row?.content ?? null;
		}
		const effect = /^effect:(.+):(correlation|evidence|retry_evidence)$/.exec(
			recordId,
		);
		if (effect) {
			const column = effect[2];
			const row = this.storage.sql
				.exec<{ value: string | null }>(
					`SELECT ${column} AS value FROM host_effects WHERE id = ?`,
					effect[1],
				)
				.toArray()[0];
			return row?.value ?? null;
		}
		const task = /^task:(\d+):(selection|prepared)$/.exec(recordId);
		if (task) {
			const column = task[2];
			const row = this.storage.sql
				.exec<{ value: string | null }>(
					`SELECT ${column} AS value FROM host_tasks WHERE task = ?`,
					Number(task[1]),
				)
				.toArray()[0];
			return row?.value ?? null;
		}
		return null;
	}
	private assertCachedEnvelope(recordId: string, stored: string | null) {
		if (!this.dependencies.retained) return;
		const expected = this.privateEnvelope.get(recordId);
		if (
			stored == null ||
			expected === undefined ||
			stored !== expected ||
			!isRuntimeCiphertext(stored)
		)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
	}
	private opened(recordId: string, stored: string | null): string | null {
		if (!this.dependencies.retained || stored == null) return stored;
		this.assertCachedEnvelope(recordId, stored);
		return this.requiredPlain(recordId);
	}
	private rememberPlain(
		recordId: string,
		plaintext: string,
		digest: string,
		ciphertext?: string,
	) {
		this.privatePlain.set(recordId, plaintext);
		this.privateDigest.set(recordId, digest);
		this.privateDigest.set(plaintext, digest);
		if (ciphertext !== undefined)
			this.privateEnvelope.set(recordId, ciphertext);
	}
	private requiredPlain(recordId: string): string {
		const plain = this.privatePlain.get(recordId);
		if (plain === undefined)
			throw new EncryptedStorageError(
				"integrity",
				"Private payload was not revealed",
			);
		return plain;
	}
	private async seal(
		recordId: string,
		plaintext: string,
	): Promise<{ ciphertext: string; digest: string }> {
		const binding = this.dependencies.retained;
		if (!binding) return { ciphertext: plaintext, digest: "" };
		return sealHostField(binding, recordId, plaintext);
	}
	private rememberSeal(recordId: string, digest: string) {
		if (!this.dependencies.retained) return;
		this.storage.sql.exec(
			"INSERT OR REPLACE INTO host_seal VALUES (?, ?)",
			recordId,
			digest,
		);
	}
	private routeSql(column: "run" | "operation" | "task"): string {
		return this.dependencies.retained
			? `id IN (SELECT id FROM host_effect_route WHERE ${column} = ?)`
			: `json_extract(correlation, '$.${column}') = ?`;
	}
	private persistenceFailed() {
		this.denied = true;
		this.storageBarrier = true;
		try {
			this.dependencies.fault?.("fence");
			this.storage.transactionSync(() => {
				this.storage.sql.exec(
					"INSERT OR IGNORE INTO host_safety VALUES (1, 'storage-failure')",
				);
				const runs = this.dependencies.retained
					? this.storage.sql
							.exec<{ run: string }>(
								"SELECT run FROM host_effect_route WHERE id IN (SELECT id FROM host_effects WHERE state IN ('admitted','result-recorded') AND correlation IS NOT NULL)",
							)
							.toArray()
							.map((row) => row.run)
					: this.storage.sql
							.exec<{ correlation: string }>(
								"SELECT correlation FROM host_effects WHERE state IN ('admitted','result-recorded') AND correlation IS NOT NULL",
							)
							.toArray()
							.map((row) => this.correlation(row.correlation).run);
				for (const run of runs) this.terminal(run, "failed");
			});
		} catch {
			/* Live denial does not depend on the marker committing. */
		}
	}
	private read<T>(operation: () => T): T {
		try {
			this.dependencies.fault?.("read");
			return operation();
		} catch (error) {
			this.persistenceFailed();
			throw error;
		}
	}
	private transition<T>(point: HostFault, operation: () => T): T {
		try {
			this.dependencies.fault?.(point);
			return this.storage.transactionSync(operation);
		} catch (error) {
			if (error instanceof EffectDenied) throw error;
			this.persistenceFailed();
			throw error;
		}
	}
	private async durable(
		context: Context = BACKGROUND_CONTEXT,
		point?: HostFault,
	) {
		try {
			if (point) this.dependencies.fault?.(point);
			context.abortSignal?.throwIfAborted();
			await this.privateQueue;
			await awaitWithContext(this.storage.sync(), context);
			context.abortSignal?.throwIfAborted();
		} catch (error) {
			this.persistenceFailed();
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
					"SELECT * FROM host_effects WHERE state = 'admitted' OR (state = 'result-recorded' AND (kind = 'tool' OR correlation IS NOT NULL))",
				)
				.toArray(),
		);
	}
	private assertLive() {
		if (this.denied || this.sealed || this.storageBarrier)
			throw new Error("Host admission denied");
	}
	private async check(
		authority: LocalAuthority,
		context: Context = BACKGROUND_CONTEXT,
		reuseSummary = false,
	) {
		context.abortSignal?.throwIfAborted();
		if (this.denied || this.sealed || !authority.current)
			throw new Error(
				this.unresolved().length
					? "Host admission denied: Unresolved effect blocks admission"
					: "Host admission denied",
			);
		if (authority.executor !== 1 || (authority.liveExecutors ?? 1) !== 1)
			throw new Error("Executor generation/capacity denied");
		this.read(() => {
			if (this.storage.sql.exec("SELECT id FROM host_safety").toArray().length)
				throw new Error("Unresolved effect or storage review block");
			if (
				this.storage.sql.exec("SELECT version FROM host_meta").one().version !==
				VERSION
			)
				throw new Error("Incompatible host state");
		});
		await this.receipts(context);
		for (const effect of this.unresolved()) {
			if (effect.state !== "result-recorded" || effect.correlation) continue;
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
		if (
			this.unresolved().length &&
			!(reuseSummary && (await this.onlyReusableSummary(context)))
		)
			throw new EffectDenied("reservation");
		if (
			this.active &&
			(authority.generation !== this.active.generation ||
				this.dependencies.now() >= this.active.yield_at)
		)
			throw new Error("Invocation authority expired");
	}

	private async onlyReusableSummary(context: Context): Promise<boolean> {
		const effects = this.unresolved();
		if (effects.length !== 1) return false;
		const effect = effects[0]!;
		if (effect.state !== "result-recorded" || !effect.correlation) return false;
		const correlation = this.correlation(
			this.opened(`effect:${effect.id}:correlation`, effect.correlation)!,
		);
		if (correlation.version !== 2) return false;
		const task = await this.harness.getTask(
			correlation.task as TaskId,
			context,
		);
		if (!task || !this.customTaskMatches(task, correlation, true)) return false;
		const row = this.storage.sql
			.exec<{ evidence: string }>(
				"SELECT evidence FROM host_effects WHERE id = ?",
				effect.id,
			)
			.one();
		try {
			const evidence: unknown = JSON.parse(
				this.opened(`effect:${effect.id}:evidence`, row.evidence)!,
			);
			validateSummaryResponse(
				evidence,
				preparedSummary(JSON.parse(correlation.prepared)),
			);
			summaryText(evidence);
		} catch {
			return false;
		}
		this.assertSeals();
		return this.run(correlation.run).epoch === effect.epoch;
	}
	private command(id: string) {
		return this.read(() =>
			this.storage.sql
				.exec<Command>("SELECT * FROM host_commands WHERE id = ?", id)
				.one(),
		);
	}
	private run(id: string) {
		return this.read(() =>
			this.storage.sql
				.exec<Run>("SELECT * FROM host_runs WHERE id = ?", id)
				.one(),
		);
	}
	private mapping(task: number) {
		const row = this.read(
			() =>
				this.storage.sql
					.exec<TaskMapping>("SELECT * FROM host_tasks WHERE task = ?", task)
					.toArray()[0],
		);
		if (!row || !this.dependencies.retained) return row;
		return {
			...row,
			selection: this.selectionPlain(task, row.selection),
			prepared:
				row.prepared == null
					? null
					: this.opened(`task:${task}:prepared`, row.prepared),
		};
	}
	private selectionPlain(task: number, stored: string): string {
		if (!this.dependencies.retained) return stored;
		if (stored === "pending" || !isRuntimeCiphertext(stored))
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		this.assertCachedEnvelope(`task:${task}:selection`, stored);
		const plain = this.requiredPlain(`task:${task}:selection`);
		return isUnboundSelection(plain) ? "pending" : plain;
	}
	private terminal(run: string, state: "complete" | "failed" | "canceled") {
		const current = this.storage.sql
			.exec<Run>("SELECT * FROM host_runs WHERE id = ?", run)
			.one();
		if (["complete", "failed", "canceled"].includes(current.state)) return;
		this.storage.sql.exec(
			"UPDATE host_runs SET state = ?, epoch = epoch + 1 WHERE id = ?",
			state,
			run,
		);
		this.storage.sql.exec(
			"INSERT OR REPLACE INTO host_projections SELECT assistant, run, ?, COALESCE((SELECT version + 1 FROM host_projections p WHERE p.assistant = m.assistant), 1) FROM host_members m WHERE run = ? AND state = 'pending'",
			state === "complete" ? "complete" : "failed",
			run,
		);
		this.storage.sql.exec(
			"UPDATE host_members SET state = ? WHERE run = ? AND state = 'pending'",
			state === "complete" ? "complete" : "failed",
			run,
		);
		this.storage.sql.exec(
			"UPDATE host_commands SET state = 'settled' WHERE run = ?",
			run,
		);
		this.storage.sql.exec(
			"DELETE FROM host_wakeups WHERE id = ?",
			`recovery:${run}`,
		);
	}
	private block(reason: string, run?: string) {
		this.denied = true;
		this.transition("fence", () => {
			this.storage.sql.exec(
				"INSERT OR REPLACE INTO host_safety VALUES (1, ?)",
				reason,
			);
			this.storage.sql.exec("UPDATE host_meta SET fenced = 1");
			if (run) this.terminal(run, "failed");
		});
	}
	private async reconcileSafety() {
		const unknown = this.read(() =>
			this.storage.sql
				.exec<Effect & { correlation: string | null }>(
					"SELECT * FROM host_effects WHERE state = 'admitted'",
				)
				.toArray(),
		);
		for (const effect of unknown) {
			if (effect.correlation) {
				const correlation = this.correlation(
					this.opened(`effect:${effect.id}:correlation`, effect.correlation)!,
				);
				this.block("outcome-unknown", correlation.run);
			}
		}
		await this.expire();
		await this.durable();
	}
	private correlation(text: string): EffectCorrelation {
		const value = record(JSON.parse(text));
		if (value.version !== 1 && value.version !== 2)
			throw new Error("Incompatible correlation version");
		if (
			value.version === 2 &&
			(!String(value.operation).startsWith("ditto-summary-1/") ||
				value.replay !== "never" ||
				value.piAttempt !== 1)
		)
			throw new Error("Invalid custom summary correlation");
		for (const key of [
			"command",
			"run",
			"user",
			"assistant",
			"operation",
			"arguments",
			"replay",
			"taskInput",
			"prepared",
			"digest",
		])
			if (typeof value[key] !== "string")
				throw new Error("Invalid correlation");
		for (const key of ["submission", "task", "piAttempt", "generation"])
			if (!Number.isSafeInteger(value[key]) || Number(value[key]) <= 0)
				throw new Error("Invalid correlation identity");
		if (value.call !== null && typeof value.call !== "string")
			throw new Error("Invalid call identity");
		if (
			!["never", "new-observation", "expected-content", "pi-retry"].includes(
				String(value.replay),
			)
		)
			throw new Error("Invalid replay policy");
		if (new TextEncoder().encode(text).byteLength > 128_000)
			throw new Error("Oversized correlation");
		return value as EffectCorrelation;
	}
	private async liveInputs(context: Context) {
		const root = await awaitWithContext(this.harness.root(context), context);
		const view = await awaitWithContext(root.viewState(context), context);
		try {
			const run = view.value.docs["pi.live"]?.run;
			if (!run) return undefined;
			const value = record(run);
			if (!Number.isSafeInteger(value.taskId) || !Array.isArray(value.inputs))
				throw new Error("Invalid Pi run membership");
			return {
				task: Number(value.taskId),
				inputs: value.inputs.map((id) => {
					if (!Number.isSafeInteger(id)) throw new Error("Invalid submission");
					return Number(id);
				}),
			};
		} finally {
			view.dispose();
		}
	}
	private async mappedCommand(
		task: PublicTask,
		context: Context,
	): Promise<Command> {
		const existing = this.mapping(Number(task.id));
		if (existing) return this.command(existing.command);
		const live = await this.liveInputs(context);
		let owner: PublicTask = task;
		for (let depth = 0; owner.owner !== undefined && depth < 8; depth++) {
			const parent = await awaitWithContext(
				this.harness.getTask(owner.owner, context),
				context,
			);
			if (
				!parent ||
				parent.conversationId !== task.conversationId ||
				parent.version !== 1 ||
				parent.background
			)
				throw new Error("Foreign owner");
			owner = parent;
		}
		if (!live || live.task !== Number(owner.id) || live.inputs.length !== 1)
			throw new Error("Missing trusted submission membership");
		const submission = await awaitWithContext(
			this.harness.submission(
				live.inputs[0] as import("@earendil-works/pi-durable").SubmissionId,
				context,
			),
			context,
		);
		const status = await submission?.status(context);
		if (
			!status ||
			status.type !== "input" ||
			status.status !== "placed" ||
			!status.requestId
		)
			throw new Error("Missing placed command");
		const command = this.command(status.requestId);
		if (command.submission !== null && command.submission !== Number(status.id))
			throw new Error("Submission conflict");
		this.transition("intent", () => {
			this.storage.sql.exec(
				"UPDATE host_commands SET submission = ?, state = 'submitted' WHERE id = ?",
				Number(status.id),
				command.id,
			);
			this.storage.sql.exec(
				"UPDATE host_inbox SET submission = ?, state = 'submitted' WHERE id = ?",
				Number(status.id),
				command.id,
			);
		});
		await this.durable(context);
		return this.command(command.id);
	}
	private async bindTask(
		kind: string,
		api: HookApi,
		selection: unknown,
		digest: string | undefined,
		context: Context,
		stock = false,
	) {
		try {
			context.abortSignal?.throwIfAborted();
			this.assertLive();
			const task = await awaitWithContext(
				this.harness.getTask(api.taskId, context),
				context,
			);
			if (
				!task ||
				task.kind !== kind ||
				task.version !== 1 ||
				task.background ||
				task.abortRequested ||
				task.conversationId !== ROOT_CONVERSATION_ID ||
				task.conversationId !== api.conversationId
			)
				throw new Error("Untrusted hook mapping");
			const command = await this.mappedCommand(task, context);
			const run = this.run(command.run);
			if (!["running", "recovering"].includes(run.state))
				throw new Error("Terminal run cannot bind");
			const old = this.mapping(Number(task.id));
			const mapping = {
				task: Number(task.id),
				kind,
				conversation: Number(task.conversationId),
				owner: canonical(task.owner ?? null),
				command: command.id,
				selection: canonical(selection),
			};
			if (
				old &&
				(old.kind !== kind ||
					old.owner !== mapping.owner ||
					old.command !== command.id ||
					(old.selection !== "pending" && old.selection !== mapping.selection))
			)
				throw new Error("Changed trusted task mapping");
			const selectionId = `task:${mapping.task}:selection`;
			const observed = this.read(
				() =>
					this.storage.sql
						.exec<{ selection: string }>(
							"SELECT selection FROM host_tasks WHERE task = ?",
							mapping.task,
						)
						.toArray()[0],
			);
			const epoch = run.epoch;
			const sealedSelection = await this.seal(
				selectionId,
				this.dependencies.retained && mapping.selection === "pending"
					? UNBOUND_SELECTION
					: mapping.selection,
			);
			const bound = this.transition("intent", () => {
				const live = this.storage.sql
					.exec<Run>("SELECT * FROM host_runs WHERE id = ?", command.run)
					.one();
				if (
					live.epoch !== epoch ||
					!["running", "recovering"].includes(live.state)
				)
					return "conflict" as const;
				const current = this.storage.sql
					.exec<{ selection: string }>(
						"SELECT selection FROM host_tasks WHERE task = ?",
						mapping.task,
					)
					.toArray()[0];
				if ((current?.selection ?? null) !== (observed?.selection ?? null))
					return "conflict" as const;
				if (!current) {
					this.storage.sql.exec(
						"INSERT INTO host_tasks (task,kind,conversation,owner,command,selection) VALUES (?,?,?,?,?,?)",
						mapping.task,
						kind,
						mapping.conversation,
						mapping.owner,
						command.id,
						sealedSelection.ciphertext,
					);
					this.rememberSeal(selectionId, sealedSelection.digest);
					return "inserted" as const;
				}
				const plain = this.dependencies.retained
					? this.selectionPlain(mapping.task, current.selection)
					: current.selection;
				if (plain !== "pending" && plain !== mapping.selection)
					return "conflict" as const;
				if (plain === "pending") {
					this.storage.sql.exec(
						"UPDATE host_tasks SET selection = ? WHERE task = ? AND selection = ?",
						sealedSelection.ciphertext,
						mapping.task,
						current.selection,
					);
					this.rememberSeal(selectionId, sealedSelection.digest);
					return "updated" as const;
				}
				return "kept" as const;
			});
			if (bound === "conflict") throw new Error("Changed trusted task mapping");
			this.rememberPlain(
				selectionId,
				mapping.selection === "pending" && this.dependencies.retained
					? UNBOUND_SELECTION
					: mapping.selection,
				sealedSelection.digest,
				bound === "inserted" || bound === "updated"
					? sealedSelection.ciphertext
					: undefined,
			);
			await this.durable(context);
			context.abortSignal?.throwIfAborted();
			this.assertLive();
			if (!context.abortSignal) throw new Error("Missing invocation signal");
			this.bindings.set(context.abortSignal, {
				task: Number(task.id),
				digest,
				...(stock ? { stock: true as const } : {}),
			});
		} catch (error) {
			this.denied = true;
			throw error;
		}
	}
	private customTaskMatches(
		task: PublicTask,
		correlation: EffectCorrelation,
		passive = false,
	): boolean {
		const mapping = this.mapping(Number(task.id));
		const prepared = preparedSummary(JSON.parse(correlation.prepared));
		return (
			correlation.version === 2 &&
			correlation.call === null &&
			correlation.operation === `${SUMMARY_POLICY}/${task.id}` &&
			prepared.policy === SUMMARY_POLICY &&
			prepared.task === Number(task.id) &&
			prepared.conversation === Number(task.conversationId) &&
			task.kind === "pi.compaction" &&
			task.version === 1 &&
			!task.background &&
			!task.abortRequested &&
			(task.state.status === "running" ||
				(passive && task.state.status === "pending")) &&
			record(task.state.checkpoint).phase === "select" &&
			mapping?.prepared === correlation.prepared &&
			mapping.digest === correlation.digest &&
			mapping.selection === prepared.selection &&
			mapping.command === correlation.command &&
			mapping.owner === canonical(task.owner ?? null) &&
			canonical(task.input) === correlation.taskInput
		);
	}
	private ownerTransition<T>(
		context: Context,
		operation: (context: Context) => Promise<T>,
	): Promise<T> {
		context = withAbortSignal(this.ownerAbort.signal, context);
		const pending = this.ownerQueue.then(async () => {
			context.abortSignal?.throwIfAborted();
			this.assertLive();
			return operation(context);
		});
		this.ownerQueue = pending.then(
			() => undefined,
			() => undefined,
		);
		return awaitWithContext(pending, context);
	}
	async configure(
		change: Pick<AgentChange, "model" | "thinkingLevel">,
		context: Context = BACKGROUND_CONTEXT,
	): Promise<void> {
		return this.ownerTransition(context, async (context) => {
			await this.check(
				await awaitWithContext(this.dependencies.authority(), context),
				context,
				true,
			);
			const root = await this.harness.root(context);
			this.assertLive();
			try {
				await root.configure(change, context);
				context.abortSignal?.throwIfAborted();
				await this.durable(context);
			} catch (error) {
				if (!context.abortSignal?.aborted) this.persistenceFailed();
				throw error;
			}
		});
	}
	private async summarize(
		api: HookApi,
		selection: SummarySelection,
		context: Context,
	): Promise<{ summary: string } | { decline: true }> {
		await this.bindTask(
			"pi.compaction",
			api,
			{
				firstKept: Number(selection.firstKept),
				entries: selection.entries.map((entry) => Number(entry.id)),
				digest: await requestDigest(selection.messages),
			},
			undefined,
			context,
		);
		const task = await this.harness.getTask(api.taskId, context);
		if (
			!task ||
			task.state.status !== "running" ||
			record(task.state.checkpoint).phase !== "select"
		)
			throw new Error("Custom summary requires trusted selection phase");
		let mapping = this.mapping(Number(api.taskId))!;
		const command = this.command(mapping.command),
			run = this.run(command.run);
		if (mapping.prepared === null)
			await this.ownerTransition(context, async (context) => {
				mapping = this.mapping(Number(api.taskId))!;
				if (mapping.prepared !== null) return;
				const agent = await (await this.harness.root(context)).agent(context);
				if (!agent.model) throw new Error("Missing custom summary model");
				const model = this.options.models.getModel(
					agent.model.provider,
					agent.model.modelId,
				);
				if (!model) throw new Error("Unavailable custom summary model");
				const stream = this.options.settings?.stream ?? {};
				if (stream.headers || stream.deferred)
					throw new Error("Unsupported custom summary options");
				const prepared: PreparedSummary = {
					policy: SUMMARY_POLICY,
					task: Number(api.taskId),
					conversation: Number(api.conversationId),
					selection: mapping.selection,
					model: agent.model,
					thinkingLevel: agent.thinkingLevel,
					options: {
						...stream,
						cacheRetention: "none",
						maxRetries: 0,
						maxTokens: Math.min(1024, model.maxTokens),
						...(agent.thinkingLevel === "off"
							? {}
							: { reasoning: agent.thinkingLevel }),
					},
					transcript: summaryTranscript(selection),
				};
				const plain = canonical(prepared),
					digest = await awaitWithContext(
						requestDigest(semanticTranscript(prepared.transcript)),
						context,
					);
				const recordId = `task:${Number(api.taskId)}:prepared`,
					sealed = await awaitWithContext(this.seal(recordId, plain), context);
				context.abortSignal?.throwIfAborted();
				this.transition("preparation", () => {
					if (
						canonical(this.mapping(Number(api.taskId))) !==
							canonical(mapping) ||
						this.run(command.run).epoch !== run.epoch
					)
						throw new Error("Custom preparation changed");
					this.assertLive();
					this.storage.sql.exec(
						"UPDATE host_tasks SET prepared = ?, digest = ? WHERE task = ? AND prepared IS NULL",
						sealed.ciphertext,
						digest,
						Number(api.taskId),
					);
					this.rememberSeal(recordId, sealed.digest);
					this.dependencies.fault?.("preparation-write");
				});
				this.rememberPlain(recordId, plain, sealed.digest, sealed.ciphertext);
				await this.durable(context, "preparation-flush");
				mapping = this.mapping(Number(api.taskId))!;
			});
		const prepared = preparedSummary(JSON.parse(mapping.prepared!));
		if (
			prepared.policy !== SUMMARY_POLICY ||
			prepared.task !== Number(api.taskId) ||
			prepared.conversation !== Number(api.conversationId) ||
			prepared.selection !== mapping.selection ||
			canonical(prepared.transcript) !==
				canonical(summaryTranscript(selection)) ||
			(await requestDigest(semanticTranscript(prepared.transcript))) !==
				mapping.digest
		)
			throw new Error("Custom summary preparation mismatch");
		if (!context.abortSignal)
			throw new Error("Missing custom summary invocation signal");
		this.customBindings.set(context.abortSignal, prepared);
		try {
			const rows = this.storage.sql
				.exec<Effect & { correlation: string; evidence: string | null }>(
					`SELECT * FROM host_effects WHERE ${this.routeSql("task")}`,
					Number(api.taskId),
				)
				.toArray();
			if (rows.length) {
				if (rows.length !== 1)
					throw new Error("Custom summary attempt conflict");
				const effect = rows[0]!,
					correlation = this.correlation(
						this.opened(`effect:${effect.id}:correlation`, effect.correlation)!,
					);
				if (
					!this.customTaskMatches(task, correlation) ||
					effect.state !== "result-recorded" ||
					!effect.evidence
				)
					throw new Error("Custom summary unresolved attempt");
				const authority = await awaitWithContext(
					this.dependencies.authority(),
					context,
				);
				this.exactAuthority(correlation, effect.epoch);
				if (
					!authority.current ||
					authority.executor !== 1 ||
					(authority.liveExecutors ?? 1) !== 1 ||
					authority.generation !== this.active?.generation ||
					this.dependencies.now() >= this.active.yield_at ||
					this.unresolved().some((row) => row.id !== effect.id)
				)
					throw new Error("Custom result reuse authority denied");
				const message: unknown = JSON.parse(
					this.opened(`effect:${effect.id}:evidence`, effect.evidence)!,
				);
				this.assertSeals();
				validateSummaryResponse(message, prepared);
				return { summary: summaryText(message) };
			}
			if (this.dependencies.prepareModel)
				await awaitWithContext(
					this.dependencies.prepareModel(context),
					context,
				);
			context.abortSignal.throwIfAborted();
			if (this.run(command.run).epoch !== run.epoch)
				throw new Error("Stale custom summary epoch");
			const model = this.options.models.getModel(
				prepared.model.provider,
				prepared.model.modelId,
			);
			if (!model) throw new Error("Unavailable prepared summary model");
			const message = await this.options.models.completeSimple(
				model,
				prepared.transcript,
				{ ...prepared.options, signal: context.abortSignal },
			);
			context.abortSignal.throwIfAborted();
			const effect = this.storage.sql
				.exec<{ id: string; state: string; evidence: string }>(
					`SELECT id,state,evidence FROM host_effects WHERE ${this.routeSql("task")}`,
					Number(api.taskId),
				)
				.toArray()[0];
			if (!effect || effect.state !== "result-recorded")
				throw new Error("Custom summary result was not persisted");
			if (
				canonical(
					JSON.parse(
						this.opened(`effect:${effect.id}:evidence`, effect.evidence)!,
					),
				) !== canonical(message)
			)
				throw new Error("Custom summary consumed result mismatch");
			if (this.run(command.run).state === "failed") return { decline: true };
			this.assertLive();
			return { summary: summaryText(message) };
		} finally {
			this.customBindings.delete(context.abortSignal);
		}
	}
	private async customModel(
		prepared: PreparedSummary,
		request: ModelRequest,
		digest: string,
		context: Context,
		start: (dispatch: ModelDispatch) => Promise<AssistantMessage>,
	) {
		const task = await this.harness.getTask(prepared.task as TaskId, context),
			mapping = this.mapping(prepared.task);
		if (
			!task ||
			!mapping ||
			mapping.prepared !== canonical(prepared) ||
			mapping.digest !== digest ||
			request.model.provider !== prepared.model.provider ||
			request.model.id !== prepared.model.modelId ||
			canonical(request.transcript) !== canonical(prepared.transcript) ||
			canonical(
				Object.fromEntries(
					Object.entries(request.options).filter(([key]) => key !== "signal"),
				),
			) !== canonical(prepared.options)
		)
			throw new Error("Custom summary exact request mismatch");
		const command = this.command(mapping.command);
		if (!command.submission) throw new Error("Missing summary submission");
		const correlation: EffectCorrelation = {
			version: 2,
			command: command.id,
			run: command.run,
			user: command.user,
			assistant: command.assistant,
			submission: command.submission,
			task: prepared.task,
			call: null,
			operation: `${SUMMARY_POLICY}/${prepared.task}`,
			piAttempt: 1,
			arguments: canonical({
				model: request.model,
				options: prepared.options,
				transcriptDigest: digest,
			}),
			replay: "never",
			generation: this.active?.generation ?? 0,
			taskInput: canonical(task.input),
			prepared: canonical(prepared),
			digest,
		};
		if (
			!this.customTaskMatches(task, correlation) ||
			this.providerCallbacks !== 1
		)
			throw new Error("Custom summary current binding mismatch");
		const admitted = await this.admitExact("model", correlation, task, context);
		const dispatch = await this.modelDispatch(admitted, correlation, context);
		const authority = await awaitWithContext(
			this.dependencies.authority(),
			context,
		);
		const current = await this.harness.getTask(task.id, context);
		if (
			!current ||
			!this.customTaskMatches(current, correlation) ||
			this.providerCallbacks !== 1
		)
			throw new Error("Custom summary binding revoked");
		context.abortSignal?.throwIfAborted();
		this.dispatchPermit(admitted.id, correlation, admitted.epoch, authority);
		return { effect: admitted.id, response: start(dispatch) };
	}
	private async customReceipt(
		effect: Effect & { evidence: string },
		correlation: EffectCorrelation,
		task: PublicTask,
		context: Context,
	) {
		if (
			task.kind !== "pi.compaction" ||
			task.state.status !== "terminal" ||
			task.state.outcome.status !== "completed"
		)
			return;
		const evidence: unknown = JSON.parse(
			this.opened(`effect:${effect.id}:evidence`, effect.evidence)!,
		);
		validateSummaryResponse(
			evidence,
			preparedSummary(JSON.parse(correlation.prepared)),
		);
		const result = record(task.state.outcome.result),
			prepared = record(JSON.parse(correlation.prepared));
		if (
			prepared.policy !== SUMMARY_POLICY ||
			this.mapping(correlation.task)?.prepared !== correlation.prepared
		)
			throw new Error("Custom receipt policy mismatch");
		let valid = false;
		let text: string | undefined;
		try {
			text = summaryText(evidence);
		} catch {
			valid =
				this.run(correlation.run).state === "failed" &&
				canonical(result) === "{}";
		}
		if (text !== undefined) {
			const submission = result.submissionId
				? await this.piRecords.submission(
						Number(
							result.submissionId,
						) as import("@earendil-works/pi-durable").SubmissionId,
						context,
					)
				: undefined;
			const entryId =
				result.entryId ??
				(submission?.status === "done" ? submission.entry : undefined);
			const entry = entryId
				? (
						await this.piRecords.entry(
							ROOT_CONVERSATION_ID,
							Number(entryId) as import("@earendil-works/pi-durable").EntryId,
							context,
						)
					)?.entry
				: undefined;
			valid =
				entry?.kind === "pi.compaction" &&
				entry.head ===
					record(JSON.parse(String(prepared.selection))).firstKept &&
				canonical(entry.model?.[0]?.content) ===
					canonical([
						{
							type: "text",
							text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${text}\n</summary>`,
						},
					]) &&
				(!submission ||
					(submission.type === "write" &&
						submission.requestId === `compaction:${task.id}`));
		}
		if (valid) {
			this.transition("result", () =>
				this.storage.sql.exec(
					"UPDATE host_effects SET state = 'pi-committed' WHERE id = ? AND state = 'result-recorded'",
					effect.id,
				),
			);
			await this.durable(context);
		}
	}
	private async eligible(context: Context) {
		const inspection = await awaitWithContext(
			this.harness.inspect(context),
			context,
		);
		const candidates = inspection.tasks.filter((item) => {
			const task = item.record;
			if (
				task.state.status === "waiting" ||
				task.state.status === "terminal" ||
				!task.state.checkpoint
			)
				return false;
			const cp = record(task.state.checkpoint);
			return (
				(task.kind === "pi.generation" && cp.phase === "request") ||
				(task.kind === "pi.compaction" && cp.phase === "summarize")
			);
		});
		if (candidates.length !== 1)
			throw new Error("Competing or missing model producers");
		const task = await awaitWithContext(
			this.harness.getTask(candidates[0]!.record.id, context),
			context,
		);
		if (!task) throw new Error("Missing producer");
		preparedTask(task);
		return task;
	}
	private exactAuthority(correlation: EffectCorrelation, epoch: number) {
		if (this.denied || this.sealed || this.storageBarrier)
			throw new EffectDenied("authority");
		const run = this.run(correlation.run);
		if (run.recovery_at !== null && this.dependencies.now() >= run.recovery_at)
			throw new EffectDenied("recovery-deadline", run.id);
		const command = this.command(correlation.command);
		if (
			!["running", "recovering"].includes(run.state) ||
			run.epoch !== epoch ||
			command.submission !== correlation.submission ||
			command.assistant !== correlation.assistant ||
			command.user !== correlation.user ||
			command.run !== correlation.run
		)
			throw new EffectDenied("authority");
		if (
			this.storage.sql.exec("SELECT fenced FROM host_meta").one().fenced !==
				0 ||
			this.storage.sql.exec("SELECT id FROM host_safety").toArray().length
		)
			throw new EffectDenied("authority");
	}
	private dispatchPermit(
		effect: string,
		correlation: EffectCorrelation,
		epoch: number,
		authority: LocalAuthority,
	) {
		this.exactAuthority(correlation, epoch);
		if (
			!authority.current ||
			authority.generation !== correlation.generation ||
			authority.executor !== 1 ||
			(authority.liveExecutors ?? 1) !== 1 ||
			!this.active ||
			this.dependencies.now() >= this.active.yield_at
		)
			throw new Error("Final dispatch authority denied");
		const row = this.read(() =>
			this.storage.sql
				.exec<{
					state: string;
					epoch: number;
					correlation: string;
					operation_deadline: number;
				}>(
					"SELECT state,epoch,correlation,operation_deadline FROM host_effects WHERE id = ?",
					effect,
				)
				.one(),
		);
		if (this.unresolved().some((row) => row.id !== effect))
			throw new EffectDenied("reservation");
		if (
			row.state !== "admitted" ||
			row.epoch !== epoch ||
			(this.dependencies.retained
				? this.read(
						() =>
							this.storage.sql
								.exec<{ digest: string }>(
									"SELECT digest FROM host_seal WHERE record_id = ?",
									`effect:${effect}:correlation`,
								)
								.one().digest,
					)
				: row.correlation) !==
				(this.dependencies.retained
					? this.privateDigest.get(canonical(correlation))
					: canonical(correlation)) ||
			this.dependencies.now() >= row.operation_deadline
		)
			throw new Error("Final effect receipt denied");
		if (!this.dependencies.retained) return;
		this.assertSeals();
		this.assertCachedEnvelope(`effect:${effect}:correlation`, row.correlation);
		const taskRow = this.read(
			() =>
				this.storage.sql
					.exec<{ selection: string; prepared: string | null }>(
						"SELECT selection, prepared FROM host_tasks WHERE task = ?",
						correlation.task,
					)
					.toArray()[0],
		);
		if (!taskRow) return;
		this.assertCachedEnvelope(
			`task:${correlation.task}:selection`,
			taskRow.selection,
		);
		if (taskRow.prepared != null)
			this.assertCachedEnvelope(
				`task:${correlation.task}:prepared`,
				taskRow.prepared,
			);
	}
	private async modelDispatch(
		admitted: { id: string; epoch: number },
		correlation: EffectCorrelation,
		context: Context,
	): Promise<ModelDispatch> {
		const digest = await requestDigest(JSON.parse(correlation.arguments));
		const effect = this.read(() =>
			this.storage.sql
				.exec<Effect>("SELECT * FROM host_effects WHERE id = ?", admitted.id)
				.one(),
		);
		const attempt = Object.freeze(
			parseModelAttemptV1({
				version: 1,
				effectId: admitted.id,
				operationId: correlation.operation,
				runId: correlation.run,
				commandId: correlation.command,
				assistantId: correlation.assistant,
				taskId: correlation.task,
				epoch: admitted.epoch,
				attempt: effect.attempt,
				generation: correlation.generation,
				deadlineAt: effect.operation_deadline,
				requestDigest: digest,
				kind: correlation.version === 2 ? "custom_summary" : "generation",
			}),
		);
		this.transition("admission", () => {
			this.exactAuthority(correlation, admitted.epoch);
			this.storage.sql.exec(
				"INSERT INTO host_model_dispatch(effect,request_digest) VALUES (?,?)",
				admitted.id,
				digest,
			);
		});
		await this.durable(context);
		return {
			attempt,
			claim: async (input: unknown) => {
				const supplied = parseModelAttemptV1(input);
				if (canonical(supplied) !== canonical(attempt))
					throw new Error("Exact model attempt mismatch");
				context.abortSignal?.throwIfAborted();
				const authority = await awaitWithContext(
					this.dependencies.authority(),
					context,
				);
				const task = await awaitWithContext(
					this.harness.getTask(correlation.task as TaskId, context),
					context,
				);
				if (
					!task ||
					canonical(task.input) !== correlation.taskInput ||
					(correlation.version === 2
						? !this.customTaskMatches(task, correlation)
						: preparedTask(task) !== correlation.prepared ||
							Number(record(task.state.checkpoint).attempt) !==
								correlation.piAttempt)
				)
					throw new EffectDenied("authority");
				// This transition never waits on the provider or configuration owner lane.
				this.transition("admission", () => {
					this.dispatchPermit(
						admitted.id,
						correlation,
						admitted.epoch,
						authority,
					);
					const claimed = this.storage.sql
						.exec(
							"UPDATE host_model_dispatch SET claimed=1 WHERE effect=? AND request_digest=? AND claimed=0 RETURNING effect",
							admitted.id,
							digest,
						)
						.toArray();
					if (claimed.length !== 1) throw new EffectDenied("reservation");
				});
				await this.durable(context);
				context.abortSignal?.throwIfAborted();
				this.dispatchPermit(
					admitted.id,
					correlation,
					admitted.epoch,
					authority,
				);
			},
		};
	}
	private async admitExact(
		kind: "model" | "tool",
		correlation: EffectCorrelation,
		task: PublicTask,
		context: Context,
	) {
		this.assertSeals();
		context.abortSignal?.throwIfAborted();
		const authority = await awaitWithContext(
			this.dependencies.authority(),
			context,
		);
		await this.check(authority, context);
		const invocation = this.active;
		if (!invocation || authority.generation !== invocation.generation)
			throw new Error("No current budget");
		const run = this.run(correlation.run);
		this.exactAuthority(correlation, run.epoch);
		const rows = this.read(() =>
			this.storage.sql
				.exec<Effect & { correlation: string; evidence: string }>(
					`SELECT * FROM host_effects WHERE ${this.routeSql("operation")} ORDER BY attempt`,
					correlation.operation,
				)
				.toArray(),
		);
		const prior = rows.at(-1);
		if (prior) {
			if (correlation.version === 2)
				throw new Error("Custom summary attempt already reserved");
			const original = this.correlation(
				this.opened(`effect:${prior.id}:correlation`, prior.correlation)!,
			);
			const cp = record(task.state.checkpoint);
			const evidence = record(
				JSON.parse(this.opened(`effect:${prior.id}:evidence`, prior.evidence)!),
			);
			if (
				kind !== "model" ||
				prior.state !== "pi-committed" ||
				evidence.stopReason !== "error" ||
				correlation.piAttempt !== original.piAttempt + 1 ||
				cp.attempt !== correlation.piAttempt ||
				original.prepared !== correlation.prepared ||
				original.digest !== correlation.digest
			)
				throw new Error("Replay denied");
		}
		const attempt = (prior?.attempt ?? 0) + 1;
		const id = `${correlation.operation}/attempt/${attempt}`;
		const duration = this.dependencies.operationMs?.[kind] ?? 60_000;
		if (
			!Number.isSafeInteger(duration) ||
			duration <= 0 ||
			duration > 15 * 60_000
		)
			throw new Error("Invalid operation deadline");
		const correlationPlain = canonical(correlation);
		const sealedCorrelation = await this.seal(
			`effect:${id}:correlation`,
			correlationPlain,
		);
		this.transition("admission", () => {
			this.exactAuthority(correlation, run.epoch);
			if (this.unresolved().length) throw new EffectDenied("reservation");
			this.storage.sql.exec(
				"INSERT INTO host_effects (id,kind,invocation,epoch,attempt,executor,deadline,state,evidence,correlation,operation_deadline) VALUES (?,?,?,?,?,?,?,'admitted',NULL,?,?)",
				id,
				kind,
				invocation.id,
				run.epoch,
				attempt,
				kind === "tool" ? authority.executor : 0,
				invocation.end_at,
				sealedCorrelation.ciphertext,
				this.dependencies.now() + duration,
			);
			this.rememberSeal(`effect:${id}:correlation`, sealedCorrelation.digest);
			if (this.dependencies.retained)
				this.storage.sql.exec(
					"INSERT INTO host_effect_route VALUES (?, ?, ?, ?)",
					id,
					correlation.run,
					correlation.operation,
					correlation.task,
				);
		});
		this.rememberPlain(
			`effect:${id}:correlation`,
			correlationPlain,
			sealedCorrelation.digest,
			sealedCorrelation.ciphertext,
		);
		await this.durable(context);
		const fresh = await awaitWithContext(
			this.dependencies.authority(),
			context,
		);
		context.abortSignal?.throwIfAborted();
		if (
			!fresh.current ||
			fresh.generation !== invocation.generation ||
			fresh.executor !== 1 ||
			(fresh.liveExecutors ?? 1) !== 1 ||
			this.dependencies.now() >= invocation.yield_at
		)
			throw new Error("Admission revoked during preparation");
		this.exactAuthority(correlation, run.epoch);
		return { id, epoch: run.epoch };
	}
	private model(
		request: ModelRequest,
		context: Context,
		start: (dispatch: ModelDispatch) => Promise<AssistantMessage>,
	) {
		this.providerCallbacks++;
		const previous = this.providerQueue;
		let release!: () => void;
		this.providerQueue = previous.then(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		return (async () => {
			try {
				await awaitWithContext(previous, context);
				// Resolve the lane's release function before any preparation can suspend.
				await Promise.resolve();
				await this.receipts(context);
				this.assertLive();
				if (this.unresolved().length)
					throw new Error("Unresolved effect blocks admission");
				if (!context.abortSignal || this.providerCallbacks !== 1)
					throw new Error("Competing adapter callbacks");
				const transcriptDigest = await requestDigest(
					semanticTranscript(request.transcript),
				);
				const custom = this.customBindings.get(context.abortSignal!);
				if (custom)
					return await this.customModel(
						custom,
						request,
						transcriptDigest,
						context,
						start,
					);
				const task = await this.eligible(context);
				const binding = this.bindings.get(context.abortSignal);
				const mapping = this.mapping(Number(task.id));
				if (
					!mapping ||
					mapping.kind !== task.kind ||
					mapping.owner !== canonical(task.owner ?? null) ||
					mapping.conversation !== Number(task.conversationId)
				)
					throw new Error("Missing trusted task mapping");
				if (
					task.kind === "pi.compaction" &&
					((mapping.prepared &&
						record(JSON.parse(mapping.prepared)).policy !== undefined) ||
						(binding && !binding.stock))
				)
					throw new Error("Stock summary fallback denied");
				if (binding && binding.task !== Number(task.id))
					throw new Error("Hook producer mismatch");
				if (
					task.kind === "pi.generation" &&
					(!binding || binding.digest !== transcriptDigest)
				)
					throw new Error("Missing generation binding");
				const tuple = preparedTask(task),
					cp = record(task.state.checkpoint);
				if (
					task.kind === "pi.compaction" &&
					record(JSON.parse(mapping.selection)).firstKept !== cp.firstKept
				)
					throw new Error("Range mismatch");
				if (
					!binding &&
					(task.kind !== "pi.compaction" ||
						mapping.prepared !== tuple ||
						mapping.digest !== transcriptDigest)
				)
					throw new Error("Missing first summary association");
				const model = record(cp.model),
					options = record(cp.streamOptions);
				if (
					request.model.provider !== model.provider ||
					request.model.id !== model.modelId ||
					canonical(request.options.reasoning) !==
						canonical(cp.thinkingLevel === "off" ? undefined : cp.thinkingLevel)
				)
					throw new Error("Model configuration mismatch");
				const allowedOptions = new Set([
					...Object.keys(options),
					"signal",
					"reasoning",
					"apiKey",
					"headers",
					"env",
					...(task.kind === "pi.compaction"
						? ["maxTokens", "cacheRetention"]
						: []),
				]);
				if (
					["apiKey", "headers", "env"].some(
						(key) => request.options[key] !== undefined,
					)
				)
					throw new Error(
						"Credential-bearing options forbidden in synthetic fixture",
					);
				if (
					Object.keys(request.options).some((key) => !allowedOptions.has(key))
				)
					throw new Error(
						`Unexpected provider request option: ${Object.keys(request.options)
							.filter((key) => !allowedOptions.has(key))
							.join(",")}`,
					);
				for (const [key, value] of Object.entries(options))
					if (
						key === "deferred" ||
						canonical(request.options[key]) !== canonical(value)
					)
						throw new Error("Unsupported request configuration");
				if (
					task.kind === "pi.compaction" &&
					(request.options.maxTokens !== cp.maxTokens ||
						request.options.cacheRetention !== "none")
				)
					throw new Error("Summary configuration mismatch");
				const command = this.command(mapping.command),
					run = this.run(command.run);
				if (!command.submission) throw new Error("Missing submission mapping");
				const correlation: EffectCorrelation = {
					version: 1,
					command: command.id,
					run: command.run,
					user: command.user,
					assistant: command.assistant,
					submission: command.submission,
					task: Number(task.id),
					call: null,
					operation: `${task.kind}/${task.id}/${await requestDigest(JSON.parse(tuple))}`,
					piAttempt: Number(cp.attempt),
					arguments: canonical({
						model: request.model,
						transcriptDigest,
						options: Object.fromEntries(
							Object.entries(request.options).filter(
								([key]) =>
									!["signal", "apiKey", "headers", "env"].includes(key),
							),
						),
					}),
					replay: "pi-retry",
					generation: this.active?.generation ?? 0,
					taskInput: canonical(task.input),
					prepared: tuple,
					digest: transcriptDigest,
				};
				const preparedMapping = {
					...mapping,
					prepared: tuple,
					digest: transcriptDigest,
				};
				const preparedId = `task:${Number(task.id)}:prepared`;
				const sealedPrepared = await this.seal(preparedId, tuple);
				this.transition("preparation", () => {
					this.exactAuthority(correlation, run.epoch);
					if (
						canonical(this.mapping(Number(task.id))) !== canonical(mapping) ||
						this.providerCallbacks !== 1
					)
						throw new Error("Association changed before preparation commit");
					this.storage.sql.exec(
						"UPDATE host_tasks SET prepared = ?, digest = ? WHERE task = ?",
						sealedPrepared.ciphertext,
						transcriptDigest,
						Number(task.id),
					);
					this.rememberSeal(preparedId, sealedPrepared.digest);
					this.dependencies.fault?.("preparation-write");
				});
				this.rememberPlain(
					preparedId,
					tuple,
					sealedPrepared.digest,
					sealedPrepared.ciphertext,
				);
				await this.durable(context, "preparation-flush");
				if (this.dependencies.prepareModel)
					await awaitWithContext(
						this.dependencies.prepareModel(context),
						context,
					);
				if (
					canonical(await this.eligible(context)) !== canonical(task) ||
					canonical(this.mapping(Number(task.id))) !==
						canonical(preparedMapping) ||
					this.providerCallbacks !== 1
				)
					throw new Error("Association changed during preparation");
				this.exactAuthority(correlation, run.epoch);
				const admitted = await this.admitExact(
					"model",
					correlation,
					task,
					context,
				);
				const dispatch = await this.modelDispatch(
					admitted,
					correlation,
					context,
				);
				const finalAuthority = await awaitWithContext(
					this.dependencies.authority(),
					context,
				);
				if (
					canonical(await this.eligible(context)) !== canonical(task) ||
					canonical(this.mapping(Number(task.id))) !==
						canonical(preparedMapping) ||
					this.providerCallbacks !== 1
				)
					throw new Error("Association revoked before dispatch");
				context.abortSignal.throwIfAborted();
				this.dispatchPermit(
					admitted.id,
					correlation,
					admitted.epoch,
					finalAuthority,
				);
				return { effect: admitted.id, response: start(dispatch) };
			} catch (error) {
				if (
					error instanceof EffectDenied &&
					error.reason === "recovery-deadline"
				)
					await this.expire();
				if (!(error instanceof EffectDenied && error.reason === "reservation"))
					this.denied = true;
				throw error;
			} finally {
				this.providerCallbacks--;
				release?.();
			}
		})();
	}
	private async tool(
		request: ToolRequest,
		context: Context,
		start: () => Promise<ToolExecutionResult>,
	) {
		try {
			await this.receipts(context);
			this.assertLive();
			const task = await awaitWithContext(
				this.harness.getTask(request.task, context),
				context,
			);
			if (
				!task ||
				task.kind !== "pi.tool" ||
				task.version !== 1 ||
				task.background ||
				task.abortRequested ||
				task.state.status !== "running" ||
				task.conversationId !== request.conversation ||
				task.conversationId !== ROOT_CONVERSATION_ID
			)
				throw new Error("Invalid tool task");
			const input = record(task.input),
				cp = record(task.state.checkpoint);
			if (
				input.callId !== request.call ||
				cp.phase !== "execute" ||
				canonical(cp.arguments) !== canonical(request.arguments) ||
				cp.replay !== "unsafe"
			)
				throw new Error("Tool input mismatch");
			const entry = (
				await this.piRecords.entry(
					ROOT_CONVERSATION_ID,
					Number(
						input.assistant,
					) as import("@earendil-works/pi-durable").EntryId,
					context,
				)
			)?.entry;
			const message = entry?.model?.[0];
			if (
				message?.role !== "assistant" ||
				!message.content.some(
					(part) =>
						part.type === "toolCall" &&
						part.id === request.call &&
						part.name === request.name,
				)
			)
				throw new Error("Original tool call missing");
			if (request.operation.kind === "shell" && request.replay !== "never")
				throw new Error("Arbitrary shell replay forbidden");
			if (
				request.operation.kind === "read" &&
				(request.replay !== "new-observation" ||
					!request.operation.newObservation)
			)
				throw new Error("Explicit new observation required");
			if (request.operation.kind === "write") {
				const authority = await awaitWithContext(
					this.dependencies.authority(),
					context,
				);
				if (
					request.replay !== "expected-content" ||
					!authority.expectedContentWrites ||
					typeof request.arguments.expectedContent !== "string" ||
					request.arguments.expectedContent !==
						request.operation.expectedContent
				)
					throw new Error("Expected-content support required");
			}
			const command = await this.mappedCommand(task, context);
			if (!command.submission) throw new Error("Missing tool membership");
			const correlation: EffectCorrelation = {
				version: 1,
				command: command.id,
				run: command.run,
				user: command.user,
				assistant: command.assistant,
				submission: command.submission,
				task: Number(task.id),
				call: request.call,
				operation: `pi.tool/${task.id}/${request.call}`,
				piAttempt: 1,
				arguments: canonical({
					arguments: request.arguments,
					operation: request.operation,
				}),
				replay: request.replay,
				generation: this.active?.generation ?? 0,
				taskInput: canonical(task.input),
				prepared: canonical(cp),
				digest: await requestDigest(request.arguments),
			};
			const admitted = await this.admitExact(
				"tool",
				correlation,
				task,
				context,
			);
			const finalAuthority = await awaitWithContext(
				this.dependencies.authority(),
				context,
			);
			if (
				request.operation.kind === "write" &&
				!finalAuthority.expectedContentWrites
			)
				throw new Error("Expected-content authority revoked");
			if (
				canonical(await this.harness.getTask(request.task, context)) !==
				canonical(task)
			)
				throw new Error("Stale tool callback");
			context.abortSignal?.throwIfAborted();
			this.dispatchPermit(
				admitted.id,
				correlation,
				admitted.epoch,
				finalAuthority,
			);
			return { effect: admitted.id, response: start() };
		} catch (error) {
			if (error instanceof EffectDenied && error.reason === "recovery-deadline")
				await this.expire();
			if (!(error instanceof EffectDenied && error.reason === "reservation"))
				this.denied = true;
			throw error;
		}
	}
	private captureRetry(publication: CommitPublication) {
		try {
			for (const change of publication.changes) {
				if (
					change.type !== "task" ||
					!["pi.generation", "pi.compaction"].includes(change.value.kind) ||
					change.value.version !== 1 ||
					change.value.conversationId !== ROOT_CONVERSATION_ID ||
					change.value.background ||
					change.value.abortRequested
				)
					continue;
				const task = change.value,
					cp = task.state.checkpoint
						? record(task.state.checkpoint)
						: undefined;
				if (cp?.phase !== "retry") continue;
				const live = publication.changes.find(
					(value) =>
						value.type === "document" &&
						value.record.kind === "pi.live" &&
						value.conversationId === ROOT_CONVERSATION_ID,
				);
				if (!live || live.type !== "document" || !live.value) continue;
				const retry =
					task.kind === "pi.generation"
						? record(record(live.value.generation).retry)
						: Array.isArray(live.value.compactions)
							? live.value.compactions
									.map(record)
									.find((row) => row.taskId === task.id)?.retry
							: undefined;
				if (
					!retry ||
					record(retry).at !== cp.until ||
					typeof record(retry).error !== "string"
				)
					continue;
				const effects = this.storage.sql
					.exec<{ id: string; correlation: string; evidence: string }>(
						`SELECT id,correlation,evidence FROM host_effects WHERE state = 'result-recorded' AND kind = 'model' AND ${this.routeSql("task")}`,
						Number(task.id),
					)
					.toArray();
				for (const effect of effects) {
					const correlationText = this.opened(
						`effect:${effect.id}:correlation`,
						effect.correlation,
					);
					const evidenceText = this.opened(
						`effect:${effect.id}:evidence`,
						effect.evidence,
					);
					if (!correlationText || !evidenceText) continue;
					const correlation = this.correlation(correlationText),
						result = record(JSON.parse(evidenceText));
					if (
						correlation.piAttempt !== cp.attempt ||
						correlation.taskInput !== canonical(task.input) ||
						result.stopReason !== "error" ||
						result.errorMessage !== record(retry).error
					)
						continue;
					const retryPlain = canonical({
						seq: Number(publication.seq),
						task: Number(task.id),
						attempt: cp.attempt,
						until: cp.until,
						error: record(retry).error,
					});
					if (!this.dependencies.retained) {
						this.transition("result", () =>
							this.storage.sql.exec(
								"UPDATE host_effects SET retry_evidence = ? WHERE id = ?",
								retryPlain,
								effect.id,
							),
						);
						continue;
					}
					const effectId = effect.id;
					this.transition("result", () => {
						this.storage.sql.exec(
							"INSERT OR REPLACE INTO host_retry_intent (effect_id, task, attempt, until_at, seq, state) VALUES (?, ?, ?, ?, ?, 'pending')",
							effectId,
							Number(task.id),
							cp.attempt,
							cp.until,
							Number(publication.seq),
						);
					});
					this.privateQueue = this.privateQueue.then(async () => {
						try {
							const sealFailure = await this.dependencies.beforeRetrySeal?.();
							if (typeof sealFailure === "string") {
								this.queueError = sealFailure;
								this.persistenceFailed();
								return;
							}
							const recordId = `effect:${effectId}:retry_evidence`;
							const sealed = await this.seal(recordId, retryPlain);
							const wrote = this.transition("result", () => {
								const intent = this.storage.sql
									.exec<{ state: string }>(
										"SELECT state FROM host_retry_intent WHERE effect_id = ?",
										effectId,
									)
									.toArray()[0];
								if (intent?.state !== "pending") return false;
								this.storage.sql.exec(
									"UPDATE host_effects SET retry_evidence = ? WHERE id = ?",
									sealed.ciphertext,
									effectId,
								);
								this.storage.sql.exec(
									"UPDATE host_retry_intent SET state = 'sealed' WHERE effect_id = ?",
									effectId,
								);
								this.rememberSeal(recordId, sealed.digest);
								return true;
							});
							if (wrote)
								this.rememberPlain(
									recordId,
									retryPlain,
									sealed.digest,
									sealed.ciphertext,
								);
						} catch (error) {
							this.queueError =
								error instanceof Error ? error.message : "retry seal failed";
							this.persistenceFailed();
						}
					});
				}
			}
			if (
				publication.changes.some(
					(change) =>
						(change.type === "task" &&
							change.value.state.status === "terminal") ||
						(change.type === "submission" &&
							["done", "unanswered"].includes(change.value.status)),
				) &&
				this.storage.sql
					.exec(
						"SELECT id FROM host_effects WHERE correlation IS NOT NULL LIMIT 1",
					)
					.toArray().length
			) {
				this.transition("intent", () =>
					this.storage.sql.exec(
						"INSERT OR REPLACE INTO host_wakeups VALUES ('settlement',?)",
						this.dependencies.now(),
					),
				);
			}
		} catch {
			this.persistenceFailed();
		}
	}
	private async receipts(context: Context) {
		await this.privateQueue;
		const effects = this.read(() =>
			this.storage.sql
				.exec<
					Effect & {
						correlation: string | null;
						evidence: string;
						retry_evidence: string | null;
					}
				>(
					"SELECT * FROM host_effects WHERE state = 'result-recorded' AND correlation IS NOT NULL",
				)
				.toArray(),
		);
		for (const effect of effects) {
			const correlation = this.correlation(
				this.opened(`effect:${effect.id}:correlation`, effect.correlation)!,
			);
			const task = await awaitWithContext(
				this.harness.getTask(correlation.task as TaskId, context),
				context,
			);
			if (
				!task ||
				task.version !== 1 ||
				canonical(task.input) !== correlation.taskInput ||
				task.conversationId !== ROOT_CONVERSATION_ID
			)
				throw new Error("Original task receipt mismatch");
			if (correlation.version === 2) {
				await this.customReceipt(effect, correlation, task, context);
				continue;
			}
			let matches = false,
				failedCompaction = false;
			const evidence = record(
				JSON.parse(
					this.opened(`effect:${effect.id}:evidence`, effect.evidence)!,
				),
			);
			if (
				effect.kind === "model" &&
				task.kind === "pi.compaction" &&
				!task.background &&
				!task.abortRequested &&
				task.state.status === "terminal" &&
				task.state.outcome.status === "failed" &&
				evidence.stopReason === "error" &&
				typeof evidence.errorMessage === "string"
			) {
				const error = record(task.state.outcome.error),
					detail = record(error.detail ?? {}),
					prepared = record(JSON.parse(correlation.prepared)),
					model = record(prepared.model),
					mapping = this.mapping(Number(task.id));
				const latest = this.storage.sql
					.exec<{ id: string }>(
						`SELECT id FROM host_effects WHERE ${this.routeSql("operation")} ORDER BY attempt DESC LIMIT 1`,
						correlation.operation,
					)
					.one();
				failedCompaction =
					detail.reason === "model_error" &&
					error.message === `Summarization failed: ${evidence.errorMessage}` &&
					evidence.role === "assistant" &&
					evidence.provider === model.provider &&
					evidence.model === model.modelId &&
					Number.isSafeInteger(prepared.firstKept) &&
					Number(prepared.firstKept) > 0 &&
					Number.isSafeInteger(prepared.tail) &&
					Number(prepared.tail) >= Number(prepared.firstKept) &&
					mapping?.kind === task.kind &&
					mapping.command === correlation.command &&
					mapping.owner === canonical(task.owner ?? null) &&
					mapping.prepared === correlation.prepared &&
					mapping.digest === correlation.digest &&
					latest.id === effect.id &&
					correlation.operation ===
						`${task.kind}/${task.id}/${await requestDigest(prepared)}`;
			}
			if (
				effect.kind === "tool" &&
				task.kind === "pi.tool" &&
				task.state.status === "terminal" &&
				task.state.outcome.status === "completed"
			) {
				const receipt = record(task.state.outcome.result);
				const entry = (
					await this.piRecords.entry(
						ROOT_CONVERSATION_ID,
						Number(
							receipt.entryId,
						) as import("@earendil-works/pi-durable").EntryId,
						context,
					)
				)?.entry;
				const message = entry?.model?.[0];
				matches =
					entry?.byTaskId === task.id &&
					message?.role === "toolResult" &&
					message.toolCallId === correlation.call &&
					!message.isError &&
					canonical(message.content) === canonical(evidence.content);
			} else if (effect.kind === "model") {
				const cp = task.state.checkpoint
					? record(task.state.checkpoint)
					: undefined;
				if (
					evidence.stopReason === "error" &&
					cp?.phase === "retry" &&
					cp.attempt === correlation.piAttempt
				) {
					const root = await this.harness.root(context),
						view = await root.viewState(context);
					try {
						const live = view.value.docs["pi.live"];
						const retry =
							task.kind === "pi.generation"
								? record(record(live?.generation).retry)
								: Array.isArray(live?.compactions)
									? live.compactions
											.map(record)
											.find((row) => row.taskId === task.id)?.retry
									: undefined;
						matches =
							!!retry &&
							record(retry).error === evidence.errorMessage &&
							record(retry).at === cp.until;
					} finally {
						view.dispose();
					}
				} else if (
					evidence.stopReason === "error" &&
					effect.retry_evidence &&
					cp?.attempt === correlation.piAttempt + 1 &&
					preparedTask(task) === correlation.prepared
				) {
					const receipt = record(
						JSON.parse(
							this.opened(
								`effect:${effect.id}:retry_evidence`,
								effect.retry_evidence,
							)!,
						),
					);
					matches =
						receipt.task === Number(task.id) &&
						receipt.attempt === correlation.piAttempt &&
						receipt.error === evidence.errorMessage &&
						Number.isSafeInteger(receipt.seq) &&
						Number(receipt.seq) > 0 &&
						Number.isFinite(receipt.until);
				} else {
					const history = await (await this.harness.root(context)).entries(
						{},
						100,
						undefined,
						context,
					);
					matches = history.items.some(
						(entry) =>
							entry.byTaskId === task.id &&
							entry.model?.some(
								(message) => canonical(message) === canonical(evidence),
							),
					);
					if (
						task.kind === "pi.compaction" &&
						task.state.status === "terminal" &&
						task.state.outcome.status === "completed"
					) {
						const result = record(task.state.outcome.result);
						const submission = result.submissionId
							? await this.piRecords.submission(
									Number(
										result.submissionId,
									) as import("@earendil-works/pi-durable").SubmissionId,
									context,
								)
							: undefined;
						const entryId =
							result.entryId ??
							(submission?.status === "done" ? submission.entry : undefined);
						const receiptEntry = entryId
							? (
									await this.piRecords.entry(
										ROOT_CONVERSATION_ID,
										Number(
											entryId,
										) as import("@earendil-works/pi-durable").EntryId,
										context,
									)
								)?.entry
							: undefined;
						const content = Array.isArray(evidence.content)
							? evidence.content
									.map(record)
									.filter((part) => part.type === "text")
									.map((part) => part.text)
									.join("\n")
									.trim()
							: undefined;
						const message = receiptEntry?.model?.[0];
						matches =
							!!receiptEntry &&
							receiptEntry.kind === "pi.compaction" &&
							receiptEntry.head ===
								record(JSON.parse(correlation.prepared)).firstKept &&
							message?.role === "user" &&
							canonical(message.content) ===
								canonical([
									{
										type: "text",
										text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${content}\n</summary>`,
									},
								]) &&
							(!submission ||
								(submission.type === "write" &&
									submission.requestId === `compaction:${task.id}`));
					}
				}
			}
			if (matches || failedCompaction) {
				this.transition("result", () => {
					this.storage.sql.exec(
						"UPDATE host_effects SET state = 'pi-committed' WHERE id = ?",
						effect.id,
					);
					if (failedCompaction) this.terminal(correlation.run, "failed");
				});
				await this.durable(context);
			}
		}
	}
	async inspect() {
		return this.harness.inspect(BACKGROUND_CONTEXT);
	}
	async task(id: TaskId) {
		return this.harness.getTask(id, BACKGROUND_CONTEXT);
	}
	async waitIdle() {
		this.assertLive();
		await this.harness.waitForIdle(BACKGROUND_CONTEXT);
		await this.reconcile();
	}
	async compact(commandId: string) {
		await this.check(await this.dependencies.authority());
		const command = this.command(commandId);
		if (this.run(command.run).state !== "running")
			throw new Error("Compaction requires live run");
		const task = await (await this.harness.root(BACKGROUND_CONTEXT)).compact(
			undefined,
			BACKGROUND_CONTEXT,
		);
		const record = await this.harness.getTask(task, BACKGROUND_CONTEXT);
		if (!record) throw new Error("Missing compaction");
		const selectionId = `task:${Number(task)}:selection`;
		const unbound = this.dependencies.retained ? UNBOUND_SELECTION : "pending";
		const sealedSelection = await this.seal(selectionId, unbound);
		this.transition("intent", () => {
			this.storage.sql.exec(
				"INSERT INTO host_tasks (task,kind,conversation,owner,command,selection) VALUES (?,?,?,?,?,?)",
				Number(task),
				record.kind,
				Number(record.conversationId),
				canonical(record.owner ?? null),
				command.id,
				sealedSelection.ciphertext,
			);
			this.rememberSeal(selectionId, sealedSelection.digest);
		});
		this.rememberPlain(
			selectionId,
			unbound,
			sealedSelection.digest,
			sealedSelection.ciphertext,
		);
		await this.durable();
		return task;
	}
	async stop(controlId: string, runId: string) {
		const target = this.run(runId);
		this.transition("fence", () => {
			const old = this.storage.sql
				.exec<{ run: string }>(
					"SELECT run FROM host_controls WHERE id = ?",
					controlId,
				)
				.toArray()[0];
			if (old && old.run !== runId) throw new Error("Conflicting Stop");
			this.storage.sql.exec(
				"INSERT OR IGNORE INTO host_controls VALUES (?,?,'applied')",
				controlId,
				runId,
			);
			if (
				!["complete", "failed", "canceled", "stopping"].includes(target.state)
			)
				this.storage.sql.exec(
					"UPDATE host_runs SET epoch = epoch + 1, state = 'stopping' WHERE id = ?",
					runId,
				);
		});
		await this.durable();
		if (["complete", "failed", "canceled"].includes(target.state)) return;
		const live = await this.liveInputs(BACKGROUND_CONTEXT);
		if (
			live &&
			live.inputs.length &&
			live.inputs.every((id) =>
				this.read(
					() =>
						this.storage.sql
							.exec(
								"SELECT id FROM host_commands WHERE submission = ? AND run = ?",
								id,
								runId,
							)
							.toArray().length === 1,
				),
			)
		)
			await this.harness.abortTask(live.task as TaskId, BACKGROUND_CONTEXT);
		const mappings = this.read(() =>
			this.storage.sql
				.exec<{ task: number }>(
					"SELECT task FROM host_tasks WHERE command IN (SELECT id FROM host_commands WHERE run = ?)",
					runId,
				)
				.toArray(),
		);
		for (const mapping of mappings)
			await this.harness.abortTask(mapping.task as TaskId, BACKGROUND_CONTEXT);
		for (const command of this.read(() =>
			this.storage.sql
				.exec<Command>("SELECT * FROM host_commands WHERE run = ?", runId)
				.toArray(),
		)) {
			if (command.submission)
				await this.harness.abortSubmission(
					command.submission as import("@earendil-works/pi-durable").SubmissionId,
					BACKGROUND_CONTEXT,
				);
		}
		await this.reconcile();
	}
	async expire() {
		this.assertSeals();
		const overdue = this.read(() =>
			this.storage.sql
				.exec<Effect & { correlation: string | null }>(
					"SELECT * FROM host_effects WHERE operation_deadline <= ? AND state = 'admitted' AND correlation IS NOT NULL",
					this.dependencies.now(),
				)
				.toArray(),
		);
		for (const effect of overdue)
			this.block(
				"operation-deadline",
				this.correlation(
					this.opened(`effect:${effect.id}:correlation`, effect.correlation)!,
				).run,
			);
		const expired = this.read(() =>
			this.storage.sql
				.exec<Run>(
					"SELECT * FROM host_runs WHERE recovery_at <= ? AND state NOT IN ('complete','failed','canceled')",
					this.dependencies.now(),
				)
				.toArray(),
		);
		for (const run of expired)
			this.transition("account", () => {
				this.terminal(run.id, "failed");
				if (
					this.storage.sql
						.exec(
							`SELECT id FROM host_effects WHERE ${this.routeSql("run")} AND state = 'admitted'`,
							run.id,
						)
						.toArray().length
				)
					this.storage.sql.exec(
						"INSERT OR REPLACE INTO host_safety VALUES (1,'recovery-deadline')",
					);
			});
		if (expired.length) await this.durable();
	}
	async reconcileStorage() {
		const authority = await this.dependencies.authority();
		if (
			!authority.current ||
			authority.executor !== 1 ||
			(authority.liveExecutors ?? 1) !== 1 ||
			(this.active && authority.generation !== this.active.generation)
		)
			throw new Error("Reconciliation authority denied");
		const marker = this.read(
			() =>
				this.storage.sql
					.exec<{ reason: string }>("SELECT reason FROM host_safety")
					.toArray()[0],
		);
		if (marker && marker.reason !== "storage-failure")
			throw new Error("Permanent review block");
		await this.receipts(BACKGROUND_CONTEXT);
		if (this.unresolved().length)
			throw new Error("Unresolved effect disposition required");
		await this.durable();
		const fresh = await this.dependencies.authority();
		if (
			!fresh.current ||
			fresh.generation !== authority.generation ||
			fresh.executor !== authority.executor ||
			(fresh.liveExecutors ?? 1) !== 1 ||
			this.unresolved().length
		)
			throw new Error("Reconciliation changed before commit");
		this.transition("account", () =>
			this.storage.sql.exec(
				"DELETE FROM host_safety WHERE reason = 'storage-failure'",
			),
		);
		await this.durable();
		this.storageBarrier = false;
		this.denied = false;
	}
	async reconcile() {
		await this.receipts(BACKGROUND_CONTEXT);
		await this.expire();
		const runs = this.read(() =>
			this.storage.sql
				.exec<Run>(
					"SELECT * FROM host_runs WHERE state NOT IN ('complete','failed','canceled')",
				)
				.toArray(),
		);
		for (const run of runs) {
			const effects = this.read(() =>
				this.storage.sql
					.exec<Effect>(
						`SELECT * FROM host_effects WHERE ${this.routeSql("run")} AND state != 'pi-committed'`,
						run.id,
					)
					.toArray(),
			);
			if (effects.length) continue;
			if (run.state === "stopping") {
				this.transition("account", () => this.terminal(run.id, "canceled"));
				continue;
			}
			const commands = this.read(() =>
				this.storage.sql
					.exec<Command>("SELECT * FROM host_commands WHERE run = ?", run.id)
					.toArray(),
			);
			let settled = commands.length > 0,
				failed = false;
			for (const command of commands) {
				if (!command.submission) {
					settled = false;
					continue;
				}
				const submission = await this.harness.submission(
					command.submission as import("@earendil-works/pi-durable").SubmissionId,
					BACKGROUND_CONTEXT,
				);
				const status = await submission?.status(BACKGROUND_CONTEXT);
				if (!status || !["done", "unanswered"].includes(status.status))
					settled = false;
				else if (status.status === "unanswered") failed = true;
				else
					this.transition("account", () => {
						this.storage.sql.exec(
							"UPDATE host_members SET state = 'complete' WHERE assistant = ? AND state = 'pending'",
							command.assistant,
						);
						this.storage.sql.exec(
							"INSERT OR IGNORE INTO host_projections VALUES (?,?,'complete',1)",
							command.assistant,
							run.id,
						);
					});
			}
			if (settled)
				this.transition("account", () =>
					this.terminal(run.id, failed ? "failed" : "complete"),
				);
		}
		await this.durable();
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

	async accept(
		id: string,
		content: string,
		membership?: {
			run: string;
			user: string;
			assistant: string;
			sequence: number;
		},
	) {
		if (this.sealed) throw new Error("Host sealed");
		if (!id || !content || new TextEncoder().encode(content).byteLength > 8192)
			throw new Error("Invalid synthetic command");
		const inboxId = `inbox:${id}:content`;
		const sealedContent = await this.seal(inboxId, content);
		const existing = this.read(
			() =>
				this.storage.sql
					.exec<{ content: string }>(
						"SELECT content FROM host_inbox WHERE id = ?",
						id,
					)
					.toArray()[0],
		);
		let accepted = content;
		if (existing) {
			accepted = this.dependencies.retained
				? await openHostField(
						this.dependencies.retained,
						inboxId,
						existing.content,
					)
				: existing.content;
			if (accepted !== content) throw new Error("Conflicting input");
			const digest = this.dependencies.retained
				? await digestText(accepted)
				: "";
			if (this.dependencies.retained) {
				const seal = this.storage.sql
					.exec<{ digest: string }>(
						"SELECT digest FROM host_seal WHERE record_id = ?",
						inboxId,
					)
					.toArray()[0];
				if (seal?.digest !== digest)
					throw new EncryptedStorageError(
						"integrity",
						"Storage integrity failure",
					);
			}
		}
		this.transition("intent", () => {
			const current = this.storage.sql
				.exec<{ content: string }>(
					"SELECT content FROM host_inbox WHERE id = ?",
					id,
				)
				.toArray()[0];
			if ((current?.content ?? null) !== (existing?.content ?? null))
				throw new Error("Conflicting input");
			const prior = this.storage.sql
				.exec<Command>("SELECT * FROM host_commands WHERE id = ?", id)
				.toArray()[0];
			const member = membership ?? {
				run: id,
				user: `${id}:user`,
				assistant: `${id}:assistant`,
				sequence:
					prior?.sequence ??
					Number(
						this.storage.sql
							.exec(
								"SELECT COALESCE(MAX(sequence),0)+1 AS n FROM host_commands",
							)
							.one().n,
					),
			};
			if (
				!member.run ||
				!member.user ||
				!member.assistant ||
				!Number.isSafeInteger(member.sequence) ||
				member.sequence <= 0 ||
				(prior &&
					(prior.run !== member.run ||
						prior.user !== member.user ||
						prior.assistant !== member.assistant ||
						prior.sequence !== member.sequence))
			)
				throw new Error("Conflicting membership");
			this.storage.sql.exec(
				"INSERT OR IGNORE INTO host_runs VALUES (?,1,'queued',NULL,NULL)",
				member.run,
			);
			if (
				["complete", "failed", "canceled", "stopping"].includes(
					this.run(member.run).state,
				) &&
				membership
			)
				throw new Error("Follow-up requires nonterminal accepted run");
			this.storage.sql.exec(
				"INSERT OR IGNORE INTO host_commands (id,run,user,assistant,sequence,submission,state) VALUES (?,?,?,?,?,NULL,'accepted')",
				id,
				member.run,
				member.user,
				member.assistant,
				member.sequence,
			);
			this.storage.sql.exec(
				"INSERT OR IGNORE INTO host_members VALUES (?,?,'pending')",
				member.assistant,
				member.run,
			);
			this.storage.sql.exec(
				"INSERT OR IGNORE INTO host_inbox VALUES (?, ?, 'accepted', NULL)",
				id,
				sealedContent.ciphertext,
			);
			this.rememberSeal(inboxId, sealedContent.digest);
			this.storage.sql.exec(
				"INSERT OR IGNORE INTO host_wakeups VALUES (?, ?)",
				`inbox:${id}`,
				this.dependencies.now(),
			);
		});
		this.rememberPlain(
			inboxId,
			accepted,
			this.dependencies.retained
				? await digestText(accepted)
				: sealedContent.digest,
			this.dependencies.retained
				? (existing?.content ?? sealedContent.ciphertext)
				: undefined,
		);
		await this.durable();
		await this.repairWakeup();
		return { id };
	}

	private assertSchedule(run: string, epoch: number) {
		this.assertLive();
		const current = this.run(run);
		if (
			!["queued", "running", "recovering"].includes(current.state) ||
			current.epoch !== epoch
		)
			throw new Error("Targeted scheduling revoked");
	}
	async schedule(id: string, duplicateInvocation?: string) {
		this.assertSeals();
		if (duplicateInvocation) {
			const previous = this.latest();
			if (previous?.id !== duplicateInvocation)
				throw new Error("Stale invocation delivery");
			return previous;
		}
		await this.expire();
		const command = this.command(id),
			run = this.run(command.run);
		if (["complete", "failed", "canceled", "stopping"].includes(run.state))
			throw new Error(
				this.unresolved().length
					? "Unresolved effect blocks admission"
					: "Terminal or stopped run cannot schedule",
			);
		const predecessor = this.read(() =>
			this.storage.sql
				.exec(
					"SELECT id FROM host_commands WHERE sequence < ? AND state NOT IN ('submitted','settled')",
					command.sequence,
				)
				.toArray(),
		);
		if (
			command.sequence > 1 &&
			(predecessor.length ||
				!this.read(
					() =>
						this.storage.sql
							.exec(
								"SELECT id FROM host_commands WHERE sequence = ?",
								command.sequence - 1,
							)
							.toArray().length,
				))
		)
			throw new Error("Missing predecessor");
		const priorCommands = this.read(() =>
			this.storage.sql
				.exec<Command>(
					"SELECT * FROM host_commands WHERE sequence < ? AND state = 'submitted'",
					command.sequence,
				)
				.toArray(),
		);
		for (const prior of priorCommands) {
			if (!prior.submission) throw new Error("Missing predecessor submission");
			const submission = await this.piRecords.submission(
				prior.submission as import("@earendil-works/pi-durable").SubmissionId,
				BACKGROUND_CONTEXT,
			);
			if (!submission || !["done", "unanswered"].includes(submission.status))
				throw new Error("Supported turn boundary required");
		}
		let authority = await this.dependencies.authority();
		await this.check(authority, BACKGROUND_CONTEXT, true);
		if (
			(await this.harness.inspect(BACKGROUND_CONTEXT)).tasks.some(
				(task) => task.state.kind === "blocked",
			)
		)
			throw new Error("Incompatible Pi task state");
		authority = await this.dependencies.authority();
		await this.check(authority, BACKGROUND_CONTEXT, true);
		if (!this.active) {
			this.active = this.transition("intent", () => {
				this.assertSchedule(command.run, run.epoch);
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
			this.assertSchedule(command.run, run.epoch);
			await this.configure(
				{ model: { provider: "faux", modelId: "faux-1" } },
				BACKGROUND_CONTEXT,
			);
		}
		this.transition("intent", () => {
			if (["queued", "recovering"].includes(this.run(command.run).state))
				this.storage.sql.exec(
					"UPDATE host_runs SET state = 'running' WHERE id = ?",
					command.run,
				);
		});
		await this.durable();
		const input = this.read(() =>
			this.storage.sql
				.exec<{ content: string; state: string }>(
					"SELECT content, state FROM host_inbox WHERE id = ?",
					id,
				)
				.one(),
		);
		const retained = await this.piRecords.submissionByRequest(
			ROOT_CONVERSATION_ID,
			id,
			BACKGROUND_CONTEXT,
		);
		if (retained) {
			if (retained.type !== "input")
				throw new Error("Incompatible retained submission");
			this.transition("intent", () => {
				this.storage.sql.exec(
					"UPDATE host_commands SET submission = ?, state = 'submitted' WHERE id = ?",
					Number(retained.id),
					id,
				);
				this.storage.sql.exec(
					"UPDATE host_inbox SET submission = ?, state = 'submitted' WHERE id = ?",
					Number(retained.id),
					id,
				);
			});
			await this.durable();
		}
		if (input.state !== "submitted" && !retained) {
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
				this.assertSchedule(command.run, run.epoch);
				this.assertSeals();
				if (this.dependencies.retained) {
					this.assertCachedEnvelope(`inbox:${id}:content`, input.content);
					const live = await openHostField(
						this.dependencies.retained,
						`inbox:${id}:content`,
						input.content,
					);
					if (live !== this.requiredPlain(`inbox:${id}:content`))
						throw new EncryptedStorageError(
							"integrity",
							"Storage integrity failure",
						);
				}
				const submission = await root.submit(
					{
						type: "input",
						content:
							this.opened(`inbox:${id}:content`, input.content) ??
							input.content,
						requestId: id,
					},
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
						"UPDATE host_commands SET state = 'submitted', submission = ? WHERE id = ?",
						Number(submission.id),
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
			await this.check(
				await this.dependencies.authority(),
				BACKGROUND_CONTEXT,
				true,
			);
			this.assertSchedule(command.run, run.epoch);
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
				"INSERT INTO host_effects (id,kind,invocation,epoch,attempt,executor,deadline,state,evidence) VALUES (?, ?, ?, ?, 1, ?, ?, 'admitted', NULL)",
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
		try {
			await this.recordResult(effect, context, evidence);
		} catch (error) {
			if (error instanceof EffectDenied && error.reason === "recovery-deadline")
				await this.expire();
			throw error;
		}
	}
	private async recordResult(
		effect: string,
		context: Context,
		evidence: string,
	) {
		context.abortSignal?.throwIfAborted();
		if (new TextEncoder().encode(evidence).byteLength > 8192) {
			this.denied = true;
			throw new Error("Oversized synthetic result evidence");
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(evidence);
		} catch (error) {
			this.persistenceFailed();
			throw error;
		}
		if (parsed === undefined) {
			this.persistenceFailed();
			throw new Error("Missing synthetic result evidence");
		}
		const existing = this.read(() =>
			this.storage.sql
				.exec<Effect & { evidence: string | null; correlation: string | null }>(
					"SELECT * FROM host_effects WHERE id = ?",
					effect,
				)
				.one(),
		);
		const correlation = existing.correlation
			? this.correlation(
					this.opened(`effect:${effect}:correlation`, existing.correlation)!,
				)
			: undefined;
		if (existing.evidence !== null) {
			if (
				canonical(
					JSON.parse(
						this.opened(`effect:${effect}:evidence`, existing.evidence)!,
					),
				) === canonical(parsed)
			)
				return;
			this.block("conflicting-result", correlation?.run);
			await this.durable();
			throw new Error("Conflicting effect result");
		}
		if (this.denied || this.sealed) throw new Error("Host result denied");
		if (correlation) {
			const value = record(parsed);
			if (correlation.version === 2) {
				try {
					validateSummaryResponse(
						parsed,
						preparedSummary(JSON.parse(correlation.prepared)),
					);
				} catch (error) {
					this.block("result-schema", correlation.run);
					await this.durable();
					throw error;
				}
			}
			if (
				correlation.version !== 2 &&
				(!Array.isArray(value.content) ||
					value.content.some((part) => {
						const content = record(part);
						return !["text", "thinking", "toolCall"].includes(
							String(content.type),
						);
					}))
			) {
				this.block("result-schema", correlation.run);
				throw new Error("Invalid synthetic result content");
			}
			if (existing.kind === "model" && correlation.version !== 2) {
				const model = record(record(JSON.parse(correlation.prepared)).model);
				if (
					value.role !== "assistant" ||
					value.provider !== model.provider ||
					value.model !== model.modelId ||
					!["stop", "error", "aborted", "toolUse", "length"].includes(
						String(value.stopReason),
					) ||
					!Number.isFinite(value.timestamp)
				) {
					this.block("result-schema", correlation.run);
					throw new Error("Invalid synthetic model result");
				}
			}
			const task = await awaitWithContext(
				this.harness.getTask(correlation.task as TaskId, context),
				context,
			);
			if (
				!task ||
				task.version !== 1 ||
				canonical(task.input) !== correlation.taskInput ||
				task.conversationId !== ROOT_CONVERSATION_ID ||
				(existing.kind === "tool"
					? canonical(task.state.checkpoint) !== correlation.prepared
					: correlation.version === 2
						? !this.customTaskMatches(task, correlation)
						: preparedTask(task) !== correlation.prepared)
			) {
				this.block("result-identity", correlation.run);
				throw new Error("Original result identity mismatch");
			}
			this.exactAuthority(correlation, existing.epoch);
		}
		const evidenceId = `effect:${effect}:evidence`;
		const sealedEvidence = await this.seal(evidenceId, evidence);
		this.transition("result", () => {
			if (correlation) this.exactAuthority(correlation, existing.epoch);
			this.storage.sql
				.exec(
					"UPDATE host_effects SET state = 'result-recorded', evidence = ? WHERE id = ? AND invocation = ? AND (correlation IS NOT NULL OR epoch = (SELECT epoch FROM host_meta)) AND state = 'admitted' RETURNING id",
					sealedEvidence.ciphertext,
					effect,
					this.active?.id ?? "",
				)
				.one();
			this.rememberSeal(evidenceId, sealedEvidence.digest);
			if (correlation?.version === 2) {
				this.dependencies.fault?.("summary-result-write");
				try {
					summaryText(parsed);
				} catch {
					this.terminal(correlation.run, "failed");
				}
			}
			if (
				correlation &&
				existing.operation_deadline &&
				this.dependencies.now() >= existing.operation_deadline
			) {
				this.storage.sql.exec(
					"INSERT OR REPLACE INTO host_safety VALUES (1,'operation-deadline')",
				);
				this.terminal(correlation.run, "failed");
				this.denied = true;
			}
		});
		this.rememberPlain(
			evidenceId,
			evidence,
			sealedEvidence.digest,
			sealedEvidence.ciphertext,
		);
		await this.durable(
			context,
			correlation?.version === 2 ? "summary-result-flush" : undefined,
		);
		context.abortSignal?.throwIfAborted();
		if (
			correlation &&
			!(
				correlation.version === 2 &&
				this.run(correlation.run).state === "failed"
			)
		)
			this.exactAuthority(correlation, existing.epoch);
		if (this.denied || this.sealed) throw new Error("Host result sealed");
	}

	async yield() {
		if (this.closing) return this.closing;
		this.sealed = true;
		this.ownerAbort.abort();
		clearTimeout(this.timer);
		this.closing = this.closeAndAccount();
		return this.closing;
	}
	private interruptRuns(interrupted: number) {
		for (const run of this.storage.sql
			.exec<Run>(
				"SELECT * FROM host_runs WHERE state IN ('running','recovering','stopping')",
			)
			.toArray()) {
			this.storage.sql.exec(
				"UPDATE host_runs SET interrupted_at=COALESCE(interrupted_at,?), recovery_at=COALESCE(recovery_at,?), state=CASE WHEN state='running' THEN 'recovering' ELSE state END WHERE id=?",
				interrupted,
				interrupted + 15 * 60000,
				run.id,
			);
			this.storage.sql.exec(
				"INSERT OR IGNORE INTO host_wakeups VALUES (?,?)",
				`recovery:${run.id}`,
				run.recovery_at ?? interrupted + 15 * 60000,
			);
		}
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
				this.interruptRuns(interrupted);
				this.storage.sql.exec("DELETE FROM host_wakeups WHERE id = 'yield'");
				this.storage.sql.exec(
					"INSERT OR REPLACE INTO host_wakeups VALUES ('reconcile', ?)",
					this.active?.end_at ?? this.dependencies.now() + DRAIN_MS,
				);
			});
			await this.storage.sync();
			try {
				await this.privateQueue;
				if (this.queueError) this.persistenceFailed();
			} catch (error) {
				this.persistenceFailed();
				throw error;
			}
			await this.repairWakeup();
		} catch (error) {
			fenceError = error;
		}
		await this.harness.close(BACKGROUND_CONTEXT);
		await this.ownerQueue;
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
	private consumeWakeups(serviced: boolean) {
		return this.transition("account", () => {
			this.storage.sql.exec(
				"DELETE FROM host_wakeups WHERE id LIKE 'inbox:%' AND substr(id,7) IN (SELECT id FROM host_inbox WHERE state='submitted' UNION SELECT id FROM host_commands WHERE state IN ('submitted','settled'))",
			);
			const noWork =
				this.storage.sql
					.exec("SELECT id FROM host_commands WHERE state!='settled' LIMIT 1")
					.toArray().length === 0;
			const blocked =
				this.denied ||
				this.storage.sql.exec("SELECT id FROM host_safety").toArray().length >
					0;
			if (!serviced && !noWork && !blocked) return [];
			return this.storage.sql
				.exec<{ deadline: number }>(
					"DELETE FROM host_wakeups WHERE id IN ('reconcile','pi-retry','settlement') AND deadline <= ? RETURNING deadline",
					this.dependencies.now(),
				)
				.toArray()
				.map((row) => row.deadline);
		});
	}
	async repairWakeup(serviced: number[] = []) {
		const consumed = [...serviced, ...this.consumeWakeups(false)];
		const next = this.read(
			() =>
				this.storage.sql
					.exec<{ deadline: number }>(
						"SELECT MIN(deadline) AS deadline FROM host_wakeups",
					)
					.one().deadline,
		);
		const wakeup = this.dependencies.wakeup ?? this.storage;
		const existing = await wakeup.getAlarm();
		if (next == null) {
			if (
				existing !== null &&
				consumed.includes(existing) &&
				!this.dependencies.wakeup
			)
				await this.storage.deleteAlarm();
			return;
		}
		this.dependencies.fault?.("alarm");
		// Opening may have rearmed an intent that this handler subsequently consumed.
		if (existing === null || next < existing || consumed.includes(existing))
			await wakeup.setAlarm(next);
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
		const serviced = this.consumeWakeups(true);
		await this.durable();
		await this.expire();
		if (!this.sealed && !this.denied) {
			await this.reconcile();
			this.transition("account", () =>
				this.storage.sql.exec(
					"DELETE FROM host_wakeups WHERE id = 'settlement'",
				),
			);
			await this.durable();
		}
		if (
			this.sealed ||
			this.denied ||
			(!this.active && this.unresolved().length)
		) {
			await this.repairWakeup(serviced);
			return;
		}
		if (this.active) {
			if (this.dependencies.now() >= this.active.yield_at) await this.yield();
			else await this.repairWakeup();
			return;
		}
		if (this.sealed || this.denied || this.unresolved().length) return;
		const input = this.read(
			() =>
				this.storage.sql
					.exec<{ id: string; state: string }>(
						"SELECT i.id, i.state FROM host_inbox i JOIN host_commands c ON c.id = i.id WHERE c.state != 'settled' ORDER BY i.rowid LIMIT 1",
					)
					.toArray()[0],
		);
		if (!input) {
			await this.repairWakeup(serviced);
			return;
		}
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
		const consumed = this.transition("intent", () => {
			this.assertLive();
			const old = this.storage.sql
				.exec<{ deadline: number }>(
					"SELECT deadline FROM host_wakeups WHERE id IN ('reconcile','pi-retry')",
				)
				.toArray()
				.map((row) => row.deadline);
			this.storage.sql.exec(
				"DELETE FROM host_wakeups WHERE id IN ('reconcile', 'pi-retry')",
			);
			if (retryAt !== undefined)
				this.storage.sql.exec(
					"INSERT INTO host_wakeups VALUES ('pi-retry', ?)",
					retryAt,
				);
			return old;
		});
		await this.durable();
		if (retryAt !== undefined) {
			await this.repairWakeup([...serviced, ...consumed]);
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
	retained?: import("./host-private.ts").RetainedStorageBinding;
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
			retained: this.retained,
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
					guard,
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
