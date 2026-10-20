import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLocalBashOperations,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";

/**
 * Execution-only handler for one typed tool operation. The runtime owns
 * admission; this side validates identity, journals the attempt and reports
 * an exact outcome. It never decides replay policy.
 */

const TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"] as const;
type Tool = (typeof TOOLS)[number];
const CLASS: Record<Tool, "observation" | "mutation" | "shell"> = {
	read: "observation",
	grep: "observation",
	find: "observation",
	ls: "observation",
	write: "mutation",
	edit: "mutation",
	bash: "shell",
};
const OPERATION_KEYS = [
	"version",
	"operationId",
	"workspaceSessionId",
	"executorGeneration",
	"epoch",
	"deadlineAt",
	"tool",
	"arguments",
];
export const MAX_OPERATION_BYTES = 112_000;
const MAX_TEXT_BYTES = 51_200 + 1024;
const MAX_MESSAGE_BYTES = 2048;
const SHELL_ENV_KEYS = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TZ"];

export type ToolOperation = {
	version: 1;
	operationId: string;
	workspaceSessionId: string;
	executorGeneration: number;
	epoch: number;
	deadlineAt: number;
	tool: Tool;
	arguments: Record<string, unknown>;
};
export type ToolOutcome =
	| {
			version: 1;
			operationId: string;
			status: "completed";
			isError: boolean;
			text: string;
			truncated: boolean;
	  }
	| {
			version: 1;
			operationId: string;
			status: "rejected";
			reason: "invalid" | "generation" | "expired" | "conflict";
			message: string;
	  }
	| {
			version: 1;
			operationId: string;
			status: "pending" | "unknown";
			message: string;
	  };
export type ExecutorState = { workspaceSessionId: string; generation: number };
type Journal = {
	digest: string;
	pid: number;
	state: "started" | "completed";
	mutation?: { path: string; before: string; after: string };
	outcome?: ToolOutcome;
};
export type ExecutorOptions = {
	root: string;
	stateDir: string;
	now?: () => number;
	/** Test seam: called after the durable start record, before the tool runs. */
	afterStart?: (operation: ToolOperation) => Promise<void> | void;
};

const IMAGE_UNSUPPORTED =
	"Image and binary attachments are not supported in remote tool results.";
const IMAGE_SIGNATURES = [
	[0x89, 0x50, 0x4e, 0x47],
	[0xff, 0xd8, 0xff],
	[0x47, 0x49, 0x46, 0x38],
	[0x42, 0x4d],
];
async function isImage(file: string) {
	const handle = await fsp.open(file, "r");
	try {
		const head = Buffer.alloc(12);
		const { bytesRead } = await handle.read(head, 0, 12, 0);
		const bytes = head.subarray(0, bytesRead);
		return (
			IMAGE_SIGNATURES.some((signature) =>
				signature.every((byte, index) => bytes[index] === byte),
			) ||
			(bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
				bytes.subarray(8, 12).toString("latin1") === "WEBP")
		);
	} finally {
		await handle.close();
	}
}
const digest = (value: string | Buffer) =>
	createHash("sha256").update(value).digest("hex");
function bounded(text: string, maxBytes: number) {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.byteLength <= maxBytes) return { text, cut: false };
	return {
		text: bytes.subarray(0, maxBytes).toString("utf8").replace(/�$/, ""),
		cut: true,
	};
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.keys(value)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
			)
			.join(",")}}`;
	return JSON.stringify(value);
}

export function parseToolOperation(input: unknown): ToolOperation {
	if (
		!input ||
		typeof input !== "object" ||
		Array.isArray(input) ||
		Object.keys(input).some((key) => !OPERATION_KEYS.includes(key))
	)
		throw new Error("Invalid tool operation");
	const row = input as Record<string, unknown>;
	const positive = (key: string) =>
		Number.isSafeInteger(row[key]) && Number(row[key]) >= 1;
	if (
		row.version !== 1 ||
		typeof row.operationId !== "string" ||
		!row.operationId ||
		row.operationId.length > 512 ||
		typeof row.workspaceSessionId !== "string" ||
		!row.workspaceSessionId ||
		!positive("executorGeneration") ||
		!positive("epoch") ||
		!positive("deadlineAt") ||
		!TOOLS.includes(row.tool as Tool) ||
		!row.arguments ||
		typeof row.arguments !== "object" ||
		Array.isArray(row.arguments)
	)
		throw new Error("Invalid tool operation");
	return row as ToolOperation;
}

export async function readExecutorState(
	stateDir: string,
): Promise<ExecutorState | undefined> {
	try {
		const value = JSON.parse(
			await fsp.readFile(path.join(stateDir, "executor.json"), "utf8"),
		) as ExecutorState;
		if (
			typeof value.workspaceSessionId !== "string" ||
			!Number.isSafeInteger(value.generation)
		)
			return undefined;
		return value;
	} catch {
		return undefined;
	}
}

/** Generations only move forward; an older lifecycle cannot reclaim the executor. */
export async function initializeExecutor(
	stateDir: string,
	state: ExecutorState,
): Promise<ExecutorState> {
	if (!Number.isSafeInteger(state.generation) || state.generation < 1)
		throw new Error("Invalid executor generation");
	await fsp.mkdir(path.join(stateDir, "requests"), {
		recursive: true,
		mode: 0o700,
	});
	await fsp.mkdir(path.join(stateDir, "operations"), {
		recursive: true,
		mode: 0o700,
	});
	const current = await readExecutorState(stateDir);
	if (current && current.workspaceSessionId !== state.workspaceSessionId)
		throw new Error("Executor belongs to another workspace session");
	if (current && current.generation > state.generation)
		throw new Error("Executor generation is newer");
	await writeDurable(
		path.join(stateDir, "executor.json"),
		JSON.stringify(state),
	);
	return state;
}

async function writeDurable(file: string, content: string) {
	const temporary = `${file}.${process.pid}.tmp`;
	const handle = await fsp.open(temporary, "w", 0o600);
	try {
		await handle.writeFile(content);
		await handle.sync();
	} finally {
		await handle.close();
	}
	await fsp.rename(temporary, file);
	const directory = await fsp.open(path.dirname(file), "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

async function fileDigest(file: string) {
	try {
		return digest(await fsp.readFile(file));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
		throw error;
	}
}

function alive(pid: number) {
	if (pid === process.pid) return false;
	try {
		process.kill(pid, 0);
	} catch {
		return false;
	}
	// An unreaped killed executor is a zombie, not a running operation.
	try {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		return (
			stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z"
		);
	} catch {
		return true;
	}
}

export async function executeToolOperation(
	input: unknown,
	options: ExecutorOptions,
): Promise<ToolOutcome> {
	let operation: ToolOperation;
	try {
		operation = parseToolOperation(input);
	} catch {
		const id =
			input && typeof input === "object" && "operationId" in input
				? String((input as { operationId: unknown }).operationId).slice(0, 512)
				: "invalid";
		return reject(id, "invalid", "Malformed tool operation");
	}
	const id = operation.operationId;
	const state = await readExecutorState(options.stateDir);
	if (!state || state.workspaceSessionId !== operation.workspaceSessionId)
		return reject(id, "invalid", "Executor workspace mismatch");
	if (state.generation !== operation.executorGeneration)
		return reject(id, "generation", "Executor generation mismatch");
	const journalFile = path.join(
		options.stateDir,
		"operations",
		`${digest(id)}.json`,
	);
	const operationDigest = digest(canonical(operation));
	const now = options.now ?? Date.now;
	let journal: Journal | undefined;
	try {
		journal = JSON.parse(await fsp.readFile(journalFile, "utf8")) as Journal;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			return unknown(id, "Unreadable operation journal");
	}
	if (journal) {
		if (journal.digest !== operationDigest)
			return reject(
				id,
				"conflict",
				"Operation identity reused for other input",
			);
		if (journal.state === "completed" && journal.outcome)
			return journal.outcome;
		if (alive(journal.pid))
			return {
				version: 1,
				operationId: id,
				status: "pending",
				message: "Operation still running",
			};
		const recovered = await recover(operation, journal, options.root);
		if (recovered !== "rerun") {
			if (recovered.status === "completed")
				await writeDurable(
					journalFile,
					JSON.stringify({
						...journal,
						state: "completed",
						outcome: recovered,
					}),
				);
			return recovered;
		}
	}
	if (now() >= operation.deadlineAt)
		return reject(id, "expired", "Operation deadline passed before dispatch");
	const started: Journal = {
		digest: operationDigest,
		pid: process.pid,
		state: "started",
	};
	await writeDurable(journalFile, JSON.stringify(started));
	await options.afterStart?.(operation);
	const outcome = await run(operation, options.root, now, async (mutation) => {
		started.mutation = mutation;
		await writeDurable(journalFile, JSON.stringify(started));
	});
	await writeDurable(
		journalFile,
		JSON.stringify({ ...started, state: "completed", outcome }),
	);
	return outcome;
}

async function recover(
	operation: ToolOperation,
	journal: Journal,
	root: string,
): Promise<ToolOutcome | "rerun"> {
	const id = operation.operationId;
	const kind = CLASS[operation.tool];
	if (kind === "observation") return "rerun";
	if (kind === "shell")
		return unknown(id, "Shell dispatch was interrupted; outcome unknown");
	if (!journal.mutation) return "rerun";
	const current = await fileDigest(journal.mutation.path);
	if (current === journal.mutation.after)
		return {
			version: 1,
			operationId: id,
			status: "completed",
			isError: false,
			text: `Recovered completed mutation of ${path.relative(root, journal.mutation.path) || journal.mutation.path}`,
			truncated: false,
		};
	if (current === journal.mutation.before) return "rerun";
	return unknown(
		id,
		"File changed after an interrupted mutation; outcome unknown",
	);
}

async function run(
	operation: ToolOperation,
	root: string,
	now: () => number,
	recordMutation: (mutation: Journal["mutation"] & {}) => Promise<void>,
): Promise<ToolOutcome> {
	const id = operation.operationId;
	const signal = AbortSignal.timeout(Math.max(1, operation.deadlineAt - now()));
	const mutate = async (file: string, content: string) => {
		await recordMutation({
			path: file,
			before: await fileDigest(file),
			after: digest(Buffer.from(content, "utf8")),
		});
		const temporary = `${file}.ditto-${process.pid}.tmp`;
		await fsp.writeFile(temporary, content, "utf8");
		await fsp.rename(temporary, file);
	};
	let tool: {
		execute: (...args: never[]) => Promise<unknown>;
		prepareArguments?: (input: unknown) => unknown;
	};
	switch (operation.tool) {
		case "read":
			tool = createReadToolDefinition(root, {
				operations: {
					readFile: (file) => fsp.readFile(file),
					access: (file) => fsp.access(file, fs.constants.R_OK),
					detectImageMimeType: async (file) => {
						if (await isImage(file)) throw new Error(IMAGE_UNSUPPORTED);
						return undefined;
					},
				},
			});
			break;
		case "write":
			tool = createWriteToolDefinition(root, {
				operations: {
					writeFile: mutate,
					mkdir: async (dir) => {
						await fsp.mkdir(dir, { recursive: true });
					},
				},
			});
			break;
		case "edit":
			tool = createEditToolDefinition(root, {
				operations: {
					readFile: (file) => fsp.readFile(file),
					writeFile: mutate,
					access: (file) =>
						fsp.access(file, fs.constants.R_OK | fs.constants.W_OK),
				},
			});
			break;
		case "bash":
			tool = createBashToolDefinition(root, {
				exposeSessionEnvironment: false,
				operations: createLocalBashOperations(),
				spawnHook: (context) => ({
					...context,
					env: Object.fromEntries(
						SHELL_ENV_KEYS.flatMap((key) =>
							process.env[key] === undefined ? [] : [[key, process.env[key]]],
						),
					) as NodeJS.ProcessEnv,
				}),
			});
			break;
		case "grep":
			tool = createGrepToolDefinition(root);
			break;
		case "find":
			tool = createFindToolDefinition(root);
			break;
		case "ls":
			tool = createLsToolDefinition(root);
			break;
	}
	try {
		const args = tool.prepareArguments
			? tool.prepareArguments(structuredClone(operation.arguments))
			: operation.arguments;
		const result = (await (
			tool.execute as (
				id: string,
				args: unknown,
				signal: AbortSignal,
				onUpdate: undefined,
				context: { cwd: string },
			) => Promise<unknown>
		)(id, args, signal, undefined, { cwd: root })) as {
			content: { type: string; text?: string }[];
			details?: unknown;
		};
		if (result.content.some((part) => part.type !== "text"))
			return completed(id, true, IMAGE_UNSUPPORTED, false);
		const text = result.content.map((part) => part.text ?? "").join("");
		const details = result.details as
			| { truncation?: { truncated?: boolean } }
			| undefined;
		const cut = bounded(text, MAX_TEXT_BYTES);
		return completed(
			id,
			false,
			cut.text,
			cut.cut || details?.truncation?.truncated === true,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Tool failed";
		const cut = bounded(message, MAX_TEXT_BYTES);
		return completed(id, true, cut.text, cut.cut);
	}
}

function completed(
	operationId: string,
	isError: boolean,
	text: string,
	truncated: boolean,
): ToolOutcome {
	return {
		version: 1,
		operationId,
		status: "completed",
		isError,
		text,
		truncated,
	};
}
function reject(
	operationId: string,
	reason: "invalid" | "generation" | "expired" | "conflict",
	message: string,
): ToolOutcome {
	return {
		version: 1,
		operationId,
		status: "rejected",
		reason,
		message: bounded(message, MAX_MESSAGE_BYTES).text,
	};
}
function unknown(operationId: string, message: string): ToolOutcome {
	return { version: 1, operationId, status: "unknown", message };
}
