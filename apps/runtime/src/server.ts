import { WorkerEntrypoint } from "cloudflare:workers";
import { Container } from "@cloudflare/containers";
import { Sandbox as BaseSandbox, type ISandbox } from "@cloudflare/sandbox";

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

	async persistWakeup(when: Date | number, intent: Record<string, unknown>) {
		await persistWakeupBeforeSchedule(
			this.ctx.storage,
			this.schedule.bind(this),
			when,
			intent,
		);
	}

	async reconcileWakeup(_intent: Record<string, unknown>): Promise<void> {}
}

export class Sandbox extends BaseSandbox<Env> {
	enableInternet = false;
	interceptHttps = true;
	sleepAfter = IDLE_TIMEOUT;
}

export class RuntimeEntrypoint extends WorkerEntrypoint<Env> {
	async acceptProductCommand(
		callerRole: string,
		command: RuntimeCommand,
	): Promise<{ accepted: true; commandId: string }> {
		if (callerRole !== "product-control-plane")
			throw new Error("product binding required");
		return { accepted: true, commandId: command.commandId };
	}

	async projectToProduct(commandId: string): Promise<string> {
		return this.env.PRODUCT.observeRuntime(commandId);
	}

	async brainOnly(callerRole: string): Promise<"allowed"> {
		denyUnlessBrain(callerRole);
		return "allowed";
	}
}

export class ProductEntrypoint extends WorkerEntrypoint<Env> {
	async observeRuntime(commandId: string): Promise<string> {
		return `observed:${commandId}`;
	}

	async deliverToRuntime(command: RuntimeCommand): Promise<string> {
		const result = await this.env.RUNTIME.acceptProductCommand(
			"product-control-plane",
			command,
		);
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
