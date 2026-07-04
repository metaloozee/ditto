import { getSandbox } from "@cloudflare/sandbox";
import { type AgentRouteHandler, createAgent, defineTool } from "@flue/runtime";
import { cloudflareSandbox } from "@flue/runtime/cloudflare";
import * as v from "valibot";

type FlueProjectCoderEnv = {
	Sandbox: Parameters<typeof getSandbox>[0];
};

const WORKSPACE_PATH = "/workspace";
const MAX_OUTPUT_BYTES = 50 * 1024;
const DEFAULT_MAX_ENTRIES = 100;
const HARD_MAX_ENTRIES = 200;
const COMMAND_TIMEOUT_MS = 30_000;

export const route: AgentRouteHandler = async (_c, next) => next();

const instructions = `You are Ditto's project-coder agent.

Inspect the repository before answering. You are running in /workspace for the existing project sandbox.

Only read-only tools are enabled in this phase. Do not claim to have edited files, installed dependencies, run mutating commands, pushed to GitHub, opened PRs, deployed, or changed external systems.

Cite concrete file paths, git status or diff evidence, or command output when answering.

If a request requires edits or mutation, ask for clarification and explain that mutating Flue tools are not enabled yet.`;

function resolveWorkspacePath(inputPath: string): string {
	if (inputPath.includes("\0")) {
		throw new Error("Path contains invalid byte.");
	}

	if (inputPath.startsWith("/")) {
		throw new Error("Path must be relative.");
	}

	const trimmedPath = inputPath.trim();
	if (trimmedPath === "" || trimmedPath === "." || trimmedPath === "./") {
		return WORKSPACE_PATH;
	}

	const segments = trimmedPath.split("/").filter((segment) => segment !== "");
	if (segments.some((segment) => segment === "..")) {
		throw new Error("Path traversal is not allowed.");
	}

	const resolvedPath =
		segments.length === 0
			? WORKSPACE_PATH
			: `${WORKSPACE_PATH}/${segments.join("/")}`;
	if (
		resolvedPath !== WORKSPACE_PATH &&
		!resolvedPath.startsWith(`${WORKSPACE_PATH}/`)
	) {
		throw new Error("Path must stay inside workspace.");
	}

	return resolvedPath;
}

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function capOutput(value: string, maxBytes = MAX_OUTPUT_BYTES): string {
	const bytes = new TextEncoder().encode(value);
	if (bytes.length <= maxBytes) {
		return value;
	}

	const truncated = new TextDecoder().decode(bytes.slice(0, maxBytes));
	return `${truncated}\n\n[Output truncated to ${maxBytes} bytes.]`;
}

function normalizeMaxEntries(value: number | undefined): number {
	if (value === undefined) {
		return DEFAULT_MAX_ENTRIES;
	}

	if (!Number.isFinite(value) || value < 1) {
		throw new Error("maxEntries must be a positive number.");
	}

	return Math.min(Math.floor(value), HARD_MAX_ENTRIES);
}

export default createAgent<unknown, FlueProjectCoderEnv>(({ id, env }) => {
	const [projectId, sandboxId = id] = id.split(":", 2);
	const sandbox = getSandbox(env.Sandbox, sandboxId);
	const isDirectory = async (path: string) => {
		const result = await sandbox.exec(`test -d ${quoteShellArg(path)}`, {
			cwd: WORKSPACE_PATH,
			timeout: 5_000,
		});
		return result.exitCode === 0;
	};
	const runCommand = async (command: string) => {
		const result = await sandbox.exec(command, {
			cwd: WORKSPACE_PATH,
			timeout: COMMAND_TIMEOUT_MS,
		});
		const output = [
			`exitCode: ${result.exitCode}`,
			result.stdout ? `stdout:\n${result.stdout}` : "",
			result.stderr ? `stderr:\n${result.stderr}` : "",
		]
			.filter(Boolean)
			.join("\n");

		return capOutput(output);
	};
	const tools = [
		defineTool({
			name: "read_file",
			description:
				"Read a text file from the project workspace. Paths must be relative to /workspace.",
			parameters: v.object({
				path: v.string(),
				offset: v.optional(v.number()),
				limit: v.optional(v.number()),
			}),
			async execute(args) {
				const path = resolveWorkspacePath(args.path);
				const exists = await sandbox.exists(path);
				if (!exists.exists) {
					throw new Error("File does not exist.");
				}

				if (await isDirectory(path)) {
					throw new Error("Path is a directory.");
				}

				const file = await sandbox.readFile(path);
				if (file.isBinary) {
					throw new Error("File is binary.");
				}

				const offset = args.offset ?? 0;
				const limit = args.limit ?? MAX_OUTPUT_BYTES;
				if (!Number.isFinite(offset) || offset < 0) {
					throw new Error("offset must be a non-negative number.");
				}
				if (!Number.isFinite(limit) || limit < 1) {
					throw new Error("limit must be a positive number.");
				}

				return capOutput(file.content.slice(offset, offset + limit));
			},
		}),
		defineTool({
			name: "list_directory",
			description:
				"List entries directly inside a workspace directory. Paths must be relative to /workspace.",
			parameters: v.object({
				path: v.optional(v.string()),
				maxEntries: v.optional(v.number()),
			}),
			async execute(args) {
				const path = resolveWorkspacePath(args.path ?? "");
				const maxEntries = normalizeMaxEntries(args.maxEntries);
				const exists = await sandbox.exists(path);
				if (!exists.exists) {
					throw new Error("Directory does not exist.");
				}
				if (!(await isDirectory(path))) {
					throw new Error("Path is not a directory.");
				}

				const listed = await sandbox.listFiles(path, {
					recursive: false,
					includeHidden: true,
				});
				const entries = listed.files
					.slice(0, maxEntries)
					.map((file) => `${file.type}\t${file.relativePath}`)
					.join("\n");
				const truncation =
					listed.files.length > maxEntries
						? `\n[Directory listing truncated to ${maxEntries} entries.]`
						: "";

				return entries ? `${entries}${truncation}` : "[Directory is empty.]";
			},
		}),
		defineTool({
			name: "git_status",
			description: "Show concise git branch and status information.",
			parameters: v.object({}),
			async execute() {
				return runCommand("git status --short --branch");
			},
		}),
		defineTool({
			name: "git_diff",
			description:
				"Show the current git diff, optionally scoped to a relative workspace path.",
			parameters: v.object({
				path: v.optional(v.string()),
				statOnly: v.optional(v.boolean()),
			}),
			async execute(args) {
				const command = args.statOnly ? "git diff --stat" : "git diff";
				if (!args.path) {
					return runCommand(command);
				}

				const path = resolveWorkspacePath(args.path);
				return runCommand(`${command} -- ${quoteShellArg(path)}`);
			},
		}),
		defineTool({
			name: "run_readonly_command",
			description: "Run one exact allowlisted read-only command in /workspace.",
			parameters: v.object({
				command: v.picklist([
					"pwd",
					"git log --oneline -10",
					"git status --short",
					"git diff --stat",
					"ls -la",
				]),
			}),
			async execute(args) {
				return runCommand(args.command);
			},
		}),
	];

	return {
		model: "anthropic/claude-sonnet-4-6",
		instructions,
		metadata: { projectId },
		tools,
		sandbox: cloudflareSandbox(sandbox),
	};
});
