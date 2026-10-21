import type { Context } from "@earendil-works/chord";
import { awaitWithContext } from "@earendil-works/chord/context";
import {
	defineExtension,
	defineTool,
	type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { encodedBytes } from "../../../packages/runtime-contracts/src/json.js";
import {
	type ProjectValueRequestV1,
	parseProjectValueGrantV1,
	redactProjectValues,
} from "../../../packages/runtime-contracts/src/project-values.js";
import {
	parseRemoteToolArguments,
	parseToolOutcomeV1,
	type RemoteToolName,
	TOOL_EFFECT_CLASS,
	type ToolOperationV1,
	type ToolOutcomeV1,
} from "../../../packages/runtime-contracts/src/tool-execution.js";
import {
	type HostGuard,
	requestDigest,
	type ToolPermit,
	type ToolRequest,
} from "./pi-durable-host.ts";

/** Project values for one shell dispatch; never part of the operation or its journal. */
export type ProjectValues = { key: string; value: string }[];
/** The only path from Pi tools to repository files and processes. */
export interface RemoteExecutor {
	dispatch(
		operation: ToolOperationV1,
		signal?: AbortSignal,
		values?: ProjectValues,
	): Promise<unknown>;
}
export type RemoteToolBinding = {
	workspaceSessionId: string;
	executor(): RemoteExecutor | undefined;
	/**
	 * Product delivery of project values for one admitted shell operation.
	 * Absent means shell commands run without project values.
	 */
	projectValues?(request: ProjectValueRequestV1): Promise<unknown>;
	now?: () => number;
};

/** Arguments are bound into a 128 KB effect correlation, so bound their encoding too. */
const MAX_ENCODED_ARGUMENTS = 100_000;
const path = (description: string) => Type.String({ description });
const optionalNumber = (description: string) =>
	Type.Optional(Type.Number({ description }));

/** Names, parameters and wording match the runner's pinned coding tools. */
const SPECS: Record<
	RemoteToolName,
	{ description: string; parameters: ReturnType<typeof Type.Object> }
> = {
	read: {
		description:
			"Read the contents of a file. Text files only; image attachments are not supported. Output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
		parameters: Type.Object({
			path: path("Path to the file to read (relative or absolute)"),
			offset: optionalNumber("Line number to start reading from (1-indexed)"),
			limit: optionalNumber("Maximum number of lines to read"),
		}),
	},
	write: {
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: Type.Object({
			path: path("Path to the file to write (relative or absolute)"),
			content: Type.String({ description: "Content to write to the file" }),
		}),
	},
	edit: {
		description:
			"Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
		parameters: Type.Object({
			path: path("Path to the file to edit (relative or absolute)"),
			edits: Type.Array(
				Type.Object({
					oldText: Type.String({
						description:
							"Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
					}),
					newText: Type.String({
						description: "Replacement text for this targeted edit.",
					}),
				}),
				{
					description:
						"One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
				},
			),
		}),
	},
	bash: {
		description:
			"Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). Optionally provide a timeout in seconds.",
		parameters: Type.Object({
			command: Type.String({ description: "Shell command to execute" }),
			timeout: optionalNumber(
				"Timeout in seconds (optional, no default timeout)",
			),
		}),
	},
	grep: {
		description:
			"Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to 100 matches or 50KB (whichever is hit first). Long lines are truncated to 500 chars.",
		parameters: Type.Object({
			pattern: Type.String({
				description: "Search pattern (regex or literal string)",
			}),
			path: Type.Optional(
				path("Directory or file to search (default: current directory)"),
			),
			glob: Type.Optional(
				Type.String({
					description:
						"Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'",
				}),
			),
			ignoreCase: Type.Optional(
				Type.Boolean({
					description: "Case-insensitive search (default: false)",
				}),
			),
			literal: Type.Optional(
				Type.Boolean({
					description:
						"Treat pattern as literal string instead of regex (default: false)",
				}),
			),
			context: optionalNumber(
				"Number of lines to show before and after each match (default: 0)",
			),
			limit: optionalNumber(
				"Maximum number of matches to return (default: 100)",
			),
		}),
	},
	find: {
		description:
			"Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to 1000 results or 50KB (whichever is hit first).",
		parameters: Type.Object({
			pattern: Type.String({
				description:
					"Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
			}),
			path: Type.Optional(
				path("Directory to search in (default: current directory)"),
			),
			limit: optionalNumber("Maximum number of results (default: 1000)"),
		}),
	},
	ls: {
		description:
			"List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to 500 entries or 50KB (whichever is hit first).",
		parameters: Type.Object({
			path: Type.Optional(
				path("Directory to list (default: current directory)"),
			),
			limit: optionalNumber(
				"Maximum number of entries to return (default: 500)",
			),
		}),
	},
};

function policy(
	name: RemoteToolName,
): Pick<ToolRequest, "operation" | "replay"> {
	const kind = TOOL_EFFECT_CLASS[name];
	if (kind === "observation")
		return {
			operation: { kind: "read", newObservation: true },
			replay: "new-observation",
		};
	return {
		operation: kind === "shell" ? { kind: "shell" } : { kind: "mutation" },
		replay: "never",
	};
}

export class RemoteToolOutcomeError extends Error {
	constructor(
		readonly outcome: ToolOutcomeV1 | { status: "transport" },
		message: string,
	) {
		super(message);
		this.name = "RemoteToolOutcomeError";
	}
}

/**
 * One reconciliation dispatch reuses the exact admitted operation. The executor
 * deduplicates by operation identity, so this classifies a lost response rather
 * than replaying work.
 */
async function dispatchExact(
	executor: RemoteExecutor,
	operation: ToolOperationV1,
	context: Context,
	values?: ProjectValues,
): Promise<ToolOutcomeV1 | undefined> {
	for (let attempt = 0; attempt < 2; attempt++) {
		context.abortSignal?.throwIfAborted();
		try {
			const raw = await awaitWithContext(
				executor.dispatch(operation, context.abortSignal, values),
				context,
			);
			return parseToolOutcomeV1(raw, operation.operationId);
		} catch (error) {
			if (context.abortSignal?.aborted) throw error;
		}
	}
	return undefined;
}

/** Pi's own output bound must never rewrite executor text, or receipts would not match. */
const OUTPUT_LIMITS = { maxBytes: 64 * 1024, maxLines: 64 * 1024 };

function result(
	outcome: Extract<ToolOutcomeV1, { status: "completed" | "rejected" }>,
) {
	return outcome.status === "completed"
		? {
				content: [{ type: "text" as const, text: outcome.text }],
				isError: outcome.isError,
			}
		: {
				content: [{ type: "text" as const, text: outcome.message }],
				isError: true,
			};
}

export function createRemoteTools(
	guard: HostGuard,
	binding: RemoteToolBinding,
) {
	/**
	 * Fetches values for exactly this admitted shell operation, then rechecks
	 * cancellation and the deadline. Any refusal is known before dispatch, so
	 * the command never runs without the values it was granted.
	 */
	const shellValues = async (
		permit: ToolPermit,
		context: Context,
	): Promise<
		| ProjectValues
		| {
				refused: {
					reason: "values" | "expired";
					message: string;
				};
		  }
	> => {
		if (!binding.projectValues) return [];
		let grant: ReturnType<typeof parseProjectValueGrantV1> | undefined;
		try {
			grant = parseProjectValueGrantV1(
				await awaitWithContext(
					binding.projectValues({
						version: 1,
						role: "repository_command",
						workspaceSessionId: binding.workspaceSessionId,
						operationId: permit.operation,
						executorGeneration: permit.generation,
						epoch: permit.epoch,
						deadlineAt: permit.deadlineAt,
					}),
					context,
				),
				permit.operation,
			);
		} catch (error) {
			if (context.abortSignal?.aborted) throw error;
		}
		context.abortSignal?.throwIfAborted();
		if ((binding.now ?? Date.now)() >= permit.deadlineAt)
			return {
				refused: {
					reason: "expired",
					message: "Operation deadline passed before dispatch",
				},
			};
		if (grant?.status !== "granted")
			return {
				refused: {
					reason: "values",
					message: "Project values are unavailable for this command",
				},
			};
		return grant.values;
	};
	// A value can outlive its command: a background child or a file the
	// command wrote can show it to a later tool. Every result is redacted
	// with all values granted since this composition opened.
	const granted = new Set<string>();
	const tools = (Object.keys(SPECS) as RemoteToolName[]).map((name) =>
		defineTool({
			name,
			description: SPECS[name].description,
			parameters: SPECS[name].parameters,
			replay: "unsafe",
			executionMode: "sequential",
			outputLimits: OUTPUT_LIMITS,
			execute: async (args, api, context): Promise<ToolExecutionResult> => {
				context.abortSignal?.throwIfAborted();
				const parsed = parseRemoteToolArguments(name, { ...args });
				if (encodedBytes(parsed) > MAX_ENCODED_ARGUMENTS)
					throw new Error("Tool arguments exceed the remote execution limit");
				const executor = binding.executor();
				if (!executor) throw new Error("Remote executor unavailable");
				let outcome: ToolOutcomeV1 | undefined;
				const start = async (permit: ToolPermit) => {
					const values =
						name === "bash" ? await shellValues(permit, context) : undefined;
					if (values && "refused" in values) {
						outcome = {
							version: 1,
							operationId: permit.operation,
							status: "rejected",
							...values.refused,
						};
						return { content: [] };
					}
					for (const entry of values ?? []) granted.add(entry.value);
					outcome = await dispatchExact(
						executor,
						{
							version: 1,
							operationId: permit.operation,
							workspaceSessionId: binding.workspaceSessionId,
							executorGeneration: permit.generation,
							epoch: permit.epoch,
							deadlineAt: permit.deadlineAt,
							tool: name,
							arguments: parsed,
						} as ToolOperationV1,
						context,
						values?.length ? values : undefined,
					);
					return { content: [] };
				};
				const admitted = await guard.tool(
					{
						task: api.taskId,
						conversation: Number(api.conversationId),
						call: api.callId,
						name,
						arguments: { ...parsed },
						...policy(name),
					},
					context,
					start,
				);
				await admitted.response;
				const known = outcome as ToolOutcomeV1 | undefined;
				// Pending, unknown and lost outcomes stay unresolved and block later effects.
				if (!known || known.status === "pending" || known.status === "unknown")
					throw new RemoteToolOutcomeError(
						known ?? { status: "transport" },
						known?.message ?? "Remote tool outcome unknown",
					);
				const settled = known as Extract<
					ToolOutcomeV1,
					{ status: "completed" | "rejected" }
				>;
				const value = result(
					settled.status === "completed"
						? {
								...settled,
								text: redactProjectValues(settled.text, [...granted]),
							}
						: settled,
				);
				await guard.result(
					admitted.effect,
					context,
					JSON.stringify({
						content: [],
						isError: value.isError,
						contentDigest: await requestDigest(value.content),
					}),
				);
				context.abortSignal?.throwIfAborted();
				return value;
			},
		}),
	);
	return {
		tools,
		extension: defineExtension({ name: "ditto-remote-tools", tools }),
	};
}

/** Cloudflare Sandbox transport for the image-owned `ditto-exec` command. */
export type SandboxProcess = {
	writeFile(path: string, content: string): Promise<unknown>;
	exec(
		command: string,
		options?: { signal?: AbortSignal; env?: Record<string, string> },
	): Promise<{ exitCode: number; stdout: string }>;
};
/** The runner reads and removes this before any tool runs; only the shell child receives the values. */
export const EXEC_VALUES_ENV = "DITTO_EXEC_VALUES";
export function sandboxExecutor(
	sandbox: SandboxProcess,
	identity: { workspaceSessionId: string },
): RemoteExecutor {
	const ready = new Set<number>();
	const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
	return {
		async dispatch(operation, signal, values) {
			if (values?.length && operation.tool !== "bash")
				throw new Error("Project values are only for shell commands");
			if (operation.workspaceSessionId !== identity.workspaceSessionId)
				throw new Error("Executor workspace mismatch");
			if (!ready.has(operation.executorGeneration)) {
				const init = await sandbox.exec(
					`ditto-exec init ${quote(identity.workspaceSessionId)} ${operation.executorGeneration}`,
					{ signal },
				);
				if (init.exitCode !== 0)
					throw new Error("Executor initialization failed");
				ready.add(operation.executorGeneration);
			}
			const file = `/var/lib/ditto-exec/requests/${await requestDigest(operation.operationId)}.json`;
			await sandbox.writeFile(file, JSON.stringify(operation));
			// Values travel in the process environment of this one run, never in
			// the request file the executor journals.
			const result = await sandbox.exec(`ditto-exec run ${quote(file)}`, {
				signal,
				...(values?.length
					? {
							env: {
								[EXEC_VALUES_ENV]: JSON.stringify(
									Object.fromEntries(
										values.map((entry) => [entry.key, entry.value]),
									),
								),
							},
						}
					: {}),
			});
			if (result.exitCode !== 0) throw new Error("Executor transport failed");
			return JSON.parse(result.stdout) as unknown;
		},
	};
}
