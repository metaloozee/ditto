import { WorkerEntrypoint } from "cloudflare:workers";
import { Container } from "@cloudflare/containers";
import { Sandbox as BaseSandbox, type ISandbox } from "@cloudflare/sandbox";
import {
	initializeJournalTables,
	recordConstructorObservation,
} from "./journal.js";
import { parseRuntimeKeyring, type RuntimeKeyring } from "./runtime-crypto.js";
import {
	createCoordinatorSqlFromDurableObject,
	SessionCoordinator,
	type SessionRuntimeHandoffAck,
} from "./session-runtime.js";

export const IDLE_TIMEOUT = "10m";
export const LOCAL_TOPOLOGY = {
	runtimeClasses: ["SessionRuntime", "Sandbox"],
	brainImage: "packages/session-brain/Dockerfile",
	executorImage: "Dockerfile",
	runtimeEntrypoint: "RuntimeEntrypoint",
	productEntrypoint: "ProductEntrypoint",
} as const;

export interface RuntimeIdentity {
	containerId: string;
	className: "SessionRuntime" | "Sandbox";
	incarnation: string;
}

export interface RuntimeCommand {
	workspaceSessionId: string;
	commandId: string;
}

export function denyUnlessBrain(callerRole: string): void {
	if (callerRole !== "trusted-brain")
		throw new Error("brain authority required");
}

export function runtimeIdentity(
	containerId: string,
	className: RuntimeIdentity["className"],
	incarnation: string,
): RuntimeIdentity {
	if (!containerId || !incarnation)
		throw new Error("runtime identity is incomplete");
	return { containerId, className, incarnation };
}

export function isIsolatedReplacement(
	previous: RuntimeIdentity,
	next: RuntimeIdentity,
	sharesWorkspace: boolean,
): boolean {
	return (
		previous.incarnation !== next.incarnation &&
		previous.containerId !== next.containerId &&
		!sharesWorkspace
	);
}

export function readinessIsCompletion(state: {
	ready: boolean;
	terminal: boolean;
}): boolean {
	return state.ready && state.terminal;
}

export interface WakeStorage {
	put(key: string, value: unknown): Promise<void>;
}
export type WakeScheduler = (
	when: Date | number,
	callback: string,
	payload?: unknown,
) => Promise<unknown>;
export async function persistWakeupBeforeSchedule(
	storage: WakeStorage,
	schedule: WakeScheduler,
	when: Date | number,
	intent: Record<string, unknown>,
): Promise<void> {
	await storage.put("runtime:wakeup", intent);
	await schedule(when, "reconcileWakeup", intent);
}

interface RawArchiveSandbox {
	readFile(
		path: string,
		options: { encoding: "none" },
	): Promise<{
		content: ReadableStream<Uint8Array>;
		size: number;
	}>;
	writeFile(
		path: string,
		content: ReadableStream<Uint8Array>,
	): Promise<unknown>;
	exec(command: string): Promise<{ exitCode: number }>;
}

function assertCommand(result: { exitCode: number }, operation: string): void {
	if (result.exitCode !== 0) throw new Error(`${operation} failed`);
}

export async function streamArchiveOut(
	sandbox: RawArchiveSandbox,
	archivePath: string,
): Promise<ReadableStream<Uint8Array>> {
	assertCommand(
		await sandbox.exec(`ditto-archive pack ${archivePath}`),
		"archive pack",
	);
	const result = await sandbox.readFile(archivePath, { encoding: "none" });
	return result.content;
}

export async function streamArchiveIn(
	sandbox: RawArchiveSandbox,
	archivePath: string,
	content: ReadableStream<Uint8Array>,
): Promise<void> {
	await sandbox.writeFile(archivePath, content);
	assertCommand(
		await sandbox.exec(`ditto-archive unpack ${archivePath}`),
		"archive unpack",
	);
}

export class SessionRuntime extends Container<Env> {
	defaultPort = 3000;
	sleepAfter = IDLE_TIMEOUT;
	#coordinator: SessionCoordinator | null = null;

	constructor(ctx: DurableObjectState<object>, env: Env) {
		super(ctx, env);
		void this.ctx.blockConcurrencyWhile(async () => {
			const sql = createCoordinatorSqlFromDurableObject(this.ctx);
			initializeJournalTables(sql);
			recordConstructorObservation(sql, {
				observationId: this.ctx.id.toString(),
				source: "constructor",
				identity: this.ctx.id.toString(),
				className: "SessionRuntime",
				incarnation: "unstarted",
				lifecycleGeneration: 1,
				observedAt: Date.now(),
			});
		});
	}

	private async loadKeyring(): Promise<RuntimeKeyring> {
		return parseRuntimeKeyring({
			currentVersion: this.env.RUNTIME_ENCRYPTION_CURRENT_KEY_VERSION,
			keys: JSON.parse(this.env.RUNTIME_ENCRYPTION_KEYS) as unknown,
		});
	}

	private async coordinator(identity?: {
		ownerId: string;
		workspaceSessionId: string;
		projectId: string;
	}): Promise<SessionCoordinator> {
		if (this.#coordinator) return this.#coordinator;
		const keyring = await this.loadKeyring();
		this.#coordinator = new SessionCoordinator({
			sql: createCoordinatorSqlFromDurableObject(this.ctx),
			keyring,
			adapters: {
				reconstructCommand: async () => null,
				readCurrentAuthority: async () => null,
				applyProjections: async () => [],
			},
			scheduler: {
				schedule: (when, callback, payload) =>
					this.schedule(when, callback, payload),
			},
			clock: { now: () => Date.now() },
			identity: identity ?? {
				ownerId: "unknown",
				workspaceSessionId: this.ctx.id.toString(),
				projectId: "unknown",
			},
		});
		this.#coordinator.initialize();
		return this.#coordinator;
	}

	async persistWakeup(when: Date | number, intent: Record<string, unknown>) {
		await persistWakeupBeforeSchedule(
			this.ctx.storage,
			this.schedule.bind(this),
			when,
			intent,
		);
	}

	async reconcileWakeup(_intent: Record<string, unknown>): Promise<void> {
		try {
			await (await this.coordinator()).reconcile();
		} catch {
			await (await this.coordinator()).repairSchedule(Date.now());
		}
	}

	async acceptCommand(input: {
		commandId: string;
		ownerVersion: number;
	}): Promise<SessionRuntimeHandoffAck> {
		return (await this.coordinator()).acceptCommand(input);
	}

	async control(input: {
		commandId: string;
		ownerVersion: number;
	}): Promise<SessionRuntimeHandoffAck> {
		return (await this.coordinator()).control(input);
	}

	async readSnapshot(): Promise<unknown> {
		return (await this.coordinator()).readSnapshot();
	}

	async fetch(): Promise<Response> {
		return new Response("Not found", { status: 404 });
	}
}

export class Sandbox extends BaseSandbox<Env> {
	enableInternet = false;
	interceptHttps = true;
	sleepAfter = IDLE_TIMEOUT;
}

export class RuntimeEntrypoint extends WorkerEntrypoint<Env> {
	async modelConfiguration(): Promise<{
		configured: boolean;
		protocolVersion: number;
	}> {
		return { configured: false, protocolVersion: 1 };
	}

	async deliver(input: {
		commandId: string;
		ownerVersion: number;
	}): Promise<SessionRuntimeHandoffAck> {
		const stub = this.env.SessionRuntime.getByName(input.commandId);
		return stub.acceptCommand(input);
	}

	async control(input: {
		commandId: string;
		ownerVersion: number;
	}): Promise<SessionRuntimeHandoffAck> {
		const stub = this.env.SessionRuntime.getByName(input.commandId);
		return stub.control(input);
	}

	async readSnapshot(input: { sessionId: string }): Promise<unknown> {
		const stub = this.env.SessionRuntime.getByName(input.sessionId);
		return stub.readSnapshot();
	}

	async projectToProduct(commandId: string): Promise<string> {
		return this.env.PRODUCT.observeRuntime(commandId);
	}

	async brainOnly(): Promise<"allowed"> {
		return "allowed";
	}
}

export class ProductEntrypoint extends WorkerEntrypoint<Env> {
	async observeRuntime(commandId: string): Promise<string> {
		return `observed:${commandId}`;
	}

	async deliverToRuntime(command: RuntimeCommand): Promise<string> {
		const result = await this.env.RUNTIME.deliver({
			commandId: command.commandId,
			ownerVersion: 1,
		});
		return result.commandId;
	}
}

export function sandboxSupportsRawArchive(
	sandbox: ISandbox,
): Pick<ISandbox, "readFile" | "writeFile"> {
	return sandbox;
}

export default {
	fetch(): Response {
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
