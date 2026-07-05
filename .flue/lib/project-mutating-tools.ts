import { getSandbox } from "@cloudflare/sandbox";
import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import {
	type ProjectCoordinatorState,
	validateProjectCoordinatorLease,
} from "../../src/lib/project-coordinator";
import { redactSecrets } from "../../src/lib/secret-redaction";

type MutatingProjectToolEnv = {
	Sandbox: Parameters<typeof getSandbox>[0];
	ProjectCoordinator: DurableObjectNamespace;
};

export type MutatingProjectToolContext = {
	projectId: string;
	runId: string;
	sessionId: string;
	sandboxId: string;
	fencingToken: number;
};

const WORKSPACE_PATH = "/workspace";
const MAX_OUTPUT_BYTES = 50 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;

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

export function resolveWorkspacePath(inputPath: string): string {
	if (inputPath.includes("\0")) {
		throw new Error("Path contains invalid byte.");
	}

	if (inputPath.startsWith("/")) {
		throw new Error("Path must be relative.");
	}

	const trimmedPath = inputPath.trim();
	if (trimmedPath === "" || trimmedPath === "." || trimmedPath === "./") {
		throw new Error("Path must identify a file inside the workspace.");
	}

	const segments = trimmedPath.split("/").filter((segment) => segment !== "");
	if (segments.some((segment) => segment === "..")) {
		throw new Error("Path traversal is not allowed.");
	}

	const resolvedPath = `${WORKSPACE_PATH}/${segments.join("/")}`;
	if (!resolvedPath.startsWith(`${WORKSPACE_PATH}/`)) {
		throw new Error("Path must stay inside workspace.");
	}

	return resolvedPath;
}

async function getCoordinatorState(
	env: MutatingProjectToolEnv,
	projectId: string,
): Promise<ProjectCoordinatorState> {
	const coordinatorId = env.ProjectCoordinator.idFromName(projectId);
	const coordinator = env.ProjectCoordinator.get(coordinatorId) as {
		fetch(request: Request): Promise<Response>;
	};
	const response = await coordinator.fetch(
		new Request("https://project-coordinator/status"),
	);
	if (!response.ok) {
		throw new Error("Project coordinator status check failed.");
	}

	return (await response.json()) as ProjectCoordinatorState;
}

export async function assertFreshMutatingLease(
	env: MutatingProjectToolEnv,
	context: MutatingProjectToolContext,
): Promise<void> {
	const state = await getCoordinatorState(env, context.projectId);
	const result = validateProjectCoordinatorLease(
		state,
		{
			projectId: context.projectId,
			runId: context.runId,
			fencingToken: context.fencingToken,
		},
		new Date().toISOString(),
	);

	if (!result.valid) {
		throw new Error(result.message);
	}
}

async function runWorkspaceCommand(
	sandbox: ReturnType<typeof getSandbox>,
	command: string,
	timeout = COMMAND_TIMEOUT_MS,
): Promise<string> {
	const result = await sandbox.exec(command, {
		cwd: WORKSPACE_PATH,
		timeout,
	});
	const output = [
		`exitCode: ${result.exitCode}`,
		result.stdout ? `stdout:\n${result.stdout}` : "",
		result.stderr ? `stderr:\n${result.stderr}` : "",
	]
		.filter(Boolean)
		.join("\n");

	return capOutput(redactSecrets(output));
}

async function workspaceChangeSummary(
	sandbox: ReturnType<typeof getSandbox>,
): Promise<string> {
	const [status, diffStat] = await Promise.all([
		runWorkspaceCommand(sandbox, "git status --short", 15_000),
		runWorkspaceCommand(sandbox, "git diff --stat", 15_000),
	]);

	return `git status --short:\n${status}\n\ngit diff --stat:\n${diffStat}`;
}

export function createMutatingProjectTools(
	env: MutatingProjectToolEnv,
	context: MutatingProjectToolContext,
): ToolDefinition[] {
	const sandbox = getSandbox(env.Sandbox, context.sandboxId);

	return [
		defineTool({
			name: "write_file",
			description:
				"Replace a text file in the project workspace. Paths must be relative to /workspace.",
			parameters: v.object({
				path: v.string(),
				content: v.string(),
			}),
			async execute(args) {
				await assertFreshMutatingLease(env, context);
				const path = resolveWorkspacePath(args.path);
				await sandbox.writeFile(path, args.content);
				return workspaceChangeSummary(sandbox);
			},
		}),
		defineTool({
			name: "replace_text",
			description:
				"Replace one exact text occurrence in a workspace file. Paths must be relative to /workspace.",
			parameters: v.object({
				path: v.string(),
				search: v.string(),
				replace: v.string(),
			}),
			async execute(args) {
				await assertFreshMutatingLease(env, context);
				if (!args.search) {
					throw new Error("search must not be empty.");
				}

				const path = resolveWorkspacePath(args.path);
				const file = await sandbox.readFile(path);
				if (file.isBinary) {
					throw new Error("File is binary.");
				}
				const nextContent = file.content.replace(args.search, args.replace);
				if (nextContent === file.content) {
					throw new Error("Search text was not found.");
				}
				await sandbox.writeFile(path, nextContent);
				return workspaceChangeSummary(sandbox);
			},
		}),
		defineTool({
			name: "run_mutating_command",
			description:
				"Run one exact allowlisted project command in /workspace after validating the mutating lease.",
			parameters: v.object({
				command: v.picklist([
					"pnpm install",
					"pnpm test",
					"pnpm lint",
					"pnpm build",
					"pnpm flue:build",
					"pnpm exec tsc --noEmit --pretty false",
				]),
			}),
			async execute(args) {
				await assertFreshMutatingLease(env, context);
				const commandOutput = await runWorkspaceCommand(sandbox, args.command);
				const summary = await workspaceChangeSummary(sandbox);
				return `${commandOutput}\n\n${summary}`;
			},
		}),
		defineTool({
			name: "git_status",
			description: "Show concise git status information for the workspace.",
			parameters: v.object({}),
			async execute() {
				return runWorkspaceCommand(
					sandbox,
					"git status --short --branch",
					15_000,
				);
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
					return runWorkspaceCommand(sandbox, command, 15_000);
				}

				const path = resolveWorkspacePath(args.path);
				return runWorkspaceCommand(
					sandbox,
					`${command} -- ${quoteShellArg(path)}`,
					15_000,
				);
			},
		}),
	];
}
