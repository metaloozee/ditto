import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
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
	attempt?: number;
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
	/** Project values for this one shell command; never journaled. */
	values?: Record<string, string>;
	/** The values transport was malformed; the operation is refused, not run. */
	malformedValues?: boolean;
};

/** Environment variable that carries one run's project values to this process. */
export const EXEC_VALUES_ENV = "DITTO_EXEC_VALUES";
const VALUE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REDACTION = "[REDACTED]";
/** Shorter values are delivered but not redacted, so ordinary output survives. */
const REDACT_MIN = 8;

/**
 * Removes this run's project values from the process environment before any
 * tool code runs, so only the shell child receives them.
 */
export function takeExecValues(
	env: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
	const raw = env[EXEC_VALUES_ENV];
	delete env[EXEC_VALUES_ENV];
	if (raw === undefined) return undefined;
	const parsed = JSON.parse(raw) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("Malformed project values");
	const values: Record<string, string> = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (
			!VALUE_KEY.test(key) ||
			typeof value !== "string" ||
			value.includes("\0")
		)
			throw new Error("Malformed project values");
		values[key] = value;
	}
	return values;
}

function redactValues(text: string, secrets: readonly string[]) {
	let out = text;
	for (const secret of secrets) out = out.split(secret).join(REDACTION);
	return out;
}

/**
 * Redacts values across output chunks: a suffix that could begin a value is
 * held until the next chunk shows whether it does.
 */
export function valueRedactor(values: readonly string[]) {
	const secrets = values.filter((value) => value.length >= REDACT_MIN);
	const decoder = new StringDecoder("utf8");
	let buffer = "";
	const holdFrom = (text: string) => {
		let from = text.length;
		for (const secret of secrets)
			for (
				let length = Math.min(text.length, secret.length - 1);
				length >= 1;
				length--
			)
				if (text.endsWith(secret.slice(0, length))) {
					from = Math.min(from, text.length - length);
					break;
				}
		return from;
	};
	return {
		secrets,
		push(chunk: Buffer): string {
			buffer = redactValues(buffer + decoder.write(chunk), secrets);
			const from = holdFrom(buffer);
			const out = buffer.slice(0, from);
			buffer = buffer.slice(from);
			return out;
		},
		flush(): string {
			const out = redactValues(buffer + decoder.end(), secrets);
			buffer = "";
			return out;
		},
	};
}

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
	if (options.malformedValues)
		return reject(id, "invalid", "Malformed project values");
	if (options.values && operation.tool !== "bash")
		return reject(id, "invalid", "Project values are only for shell commands");
	const base = path.join(options.stateDir, "operations", digest(id));
	const journalFile = `${base}.json`;
	const operationDigest = digest(canonical(operation));
	const now = options.now ?? Date.now;
	let attempt = 0;
	// Journal first: a reconciliation must see prior work even after the
	// executor moved to another generation.
	for (let round = 0; round < 16; round++) {
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
			if (alive(journal.pid)) return pending(id);
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
			attempt = Math.max(attempt, journal.attempt ?? 1);
		}
		const state = await readExecutorState(options.stateDir);
		if (!state || state.workspaceSessionId !== operation.workspaceSessionId)
			return reject(id, "invalid", "Executor workspace mismatch");
		if (state.generation !== operation.executorGeneration)
			return reject(id, "generation", "Executor generation mismatch");
		if (now() >= operation.deadlineAt)
			return reject(id, "expired", "Operation deadline passed before dispatch");
		// Each attempt is claimed exclusively, so overlapping requests for one
		// operation never run it twice.
		const next = attempt + 1;
		const claimed = await claim(`${base}.${next}.claim`);
		if (claimed === "claimed") {
			attempt = next;
			break;
		}
		if (claimed === "held") return pending(id);
		// The claimant died. If it never wrote its start record the attempt did
		// not run; otherwise the journal above now describes it.
		const after = await fsp
			.readFile(journalFile, "utf8")
			.then((text) => JSON.parse(text) as Journal)
			.catch(() => undefined);
		if (!after || (after.attempt ?? 1) < next) attempt = next;
		if (round === 15) return pending(id);
	}
	const started: Journal = {
		digest: operationDigest,
		pid: process.pid,
		attempt,
		state: "started",
	};
	await writeDurable(journalFile, JSON.stringify(started));
	await options.afterStart?.(operation);
	const outcome = await run(operation, options, now, async (mutation) => {
		started.mutation = mutation;
		await writeDurable(journalFile, JSON.stringify(started));
	});
	await writeDurable(
		journalFile,
		JSON.stringify({ ...started, state: "completed", outcome }),
	);
	return outcome;
}

/** Exclusive create with the claimant's pid already inside (link never replaces). */
async function claim(file: string): Promise<"claimed" | "held" | "dead"> {
	const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
	await fsp.writeFile(temporary, String(process.pid), { mode: 0o600 });
	try {
		await fsp.link(temporary, file);
		return "claimed";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const holder = Number(await fsp.readFile(file, "utf8"));
		return holder === process.pid || alive(holder) ? "held" : "dead";
	} finally {
		await fsp.rm(temporary, { force: true });
	}
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

/** Resolves symlinks through the nearest existing ancestor. */
async function realTarget(file: string): Promise<string> {
	try {
		return await fsp.realpath(file);
	} catch {
		const parent = path.dirname(file);
		if (parent === file) return file;
		return path.join(await realTarget(parent), path.basename(file));
	}
}

async function run(
	operation: ToolOperation,
	options: ExecutorOptions,
	now: () => number,
	recordMutation: (mutation: Journal["mutation"] & {}) => Promise<void>,
): Promise<ToolOutcome> {
	const id = operation.operationId;
	const root = options.root;
	const stateRoot = await realTarget(path.resolve(options.stateDir));
	// File tools never touch executor state; the journal is the outcome record.
	const allowed = async (file: string) => {
		const target = await realTarget(path.resolve(root, file));
		if (target === stateRoot || target.startsWith(`${stateRoot}${path.sep}`))
			throw new Error(`EACCES: executor state is not accessible: ${file}`);
		return file;
	};
	const signal = AbortSignal.timeout(Math.max(1, operation.deadlineAt - now()));
	const secrets = valueRedactor(Object.values(options.values ?? {})).secrets;
	const redact = (text: string) => redactValues(text, secrets);
	const mutate = async (file: string, content: string) => {
		await allowed(file);
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
					readFile: async (file) => fsp.readFile(await allowed(file)),
					access: async (file) =>
						fsp.access(await allowed(file), fs.constants.R_OK),
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
						await fsp.mkdir(await allowed(dir), { recursive: true });
					},
				},
			});
			break;
		case "edit":
			tool = createEditToolDefinition(root, {
				operations: {
					readFile: async (file) => fsp.readFile(await allowed(file)),
					writeFile: mutate,
					access: async (file) =>
						fsp.access(
							await allowed(file),
							fs.constants.R_OK | fs.constants.W_OK,
						),
				},
			});
			break;
		case "bash": {
			const local = createLocalBashOperations();
			const values = options.values ?? {};
			tool = createBashToolDefinition(root, {
				exposeSessionEnvironment: false,
				operations: {
					// Output is redacted before the tool buffers, truncates or spills it.
					exec: async (command, cwd, execOptions) => {
						const redactor = valueRedactor(Object.values(values));
						const emit = (text: string) => {
							if (text) execOptions.onData(Buffer.from(text, "utf8"));
						};
						try {
							return await local.exec(command, cwd, {
								...execOptions,
								onData: (data) => emit(redactor.push(data)),
							});
						} finally {
							emit(redactor.flush());
						}
					},
				},
				spawnHook: (context) => ({
					...context,
					// Image defaults win, so a project value cannot redirect PATH or HOME.
					env: {
						...Object.fromEntries(
							Object.entries(values).filter(
								([key]) => !SHELL_ENV_KEYS.includes(key),
							),
						),
						...Object.fromEntries(
							SHELL_ENV_KEYS.flatMap((key) =>
								process.env[key] === undefined ? [] : [[key, process.env[key]]],
							),
						),
					} as NodeJS.ProcessEnv,
				}),
			});
			break;
		}
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
		const text = redact(result.content.map((part) => part.text ?? "").join(""));
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
		const message = redact(
			error instanceof Error ? error.message : "Tool failed",
		);
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
function pending(operationId: string): ToolOutcome {
	return {
		version: 1,
		operationId,
		status: "pending",
		message: "Operation still running",
	};
}
function unknown(operationId: string, message: string): ToolOutcome {
	return { version: 1, operationId, status: "unknown", message };
}
