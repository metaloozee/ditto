import type { DirectoryBackup, ExecEvent } from "@cloudflare/sandbox";
import { parseSSEStream } from "@cloudflare/sandbox";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import { projects } from "#/db/schema";
import {
	parseRunnerStdoutLine,
	type RunnerOut,
	splitStdoutBuffer,
} from "#/lib/agent-stream-protocol";
import { serializeSandboxBackup } from "#/lib/sandbox-backup";
import {
	backupSandboxWorkspace,
	getProjectSandbox,
} from "#/lib/sandbox-bootstrap";
import { redactSecrets } from "#/lib/secret-redaction";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

const RUNNER_CLI = "/opt/ditto-runner/dist/cli.js";
const AGENT_COMMAND_TIMEOUT_MS = 600_000;

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function finalizeAgentRun(options: {
	db: ReturnType<typeof createDb>;
	project: typeof projects.$inferSelect;
	backup: DirectoryBackup;
}): Promise<typeof projects.$inferSelect> {
	const [updatedProject] = await options.db
		.update(projects)
		.set({
			status: "ready",
			sandboxBackup: serializeSandboxBackup(options.backup),
			sandboxBackupCreatedAt: sql`(unixepoch())`,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(projects.id, options.project.id),
				eq(projects.userId, options.project.userId),
			),
		)
		.returning();

	if (!updatedProject) {
		throw new Error("Failed to update project sandbox state after agent run.");
	}

	return updatedProject;
}

export async function runAgentInSandbox(options: {
	env: Env;
	sandboxId: string;
	projectId: string;
	conversationId: string;
	model: string;
	prompt: string;
	onRunnerMessage: (msg: RunnerOut) => void | Promise<void>;
	signal?: AbortSignal;
}): Promise<{
	ok: boolean;
	assistantText: string;
	backupStored: boolean;
	backup?: DirectoryBackup;
	backupError?: string;
}> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	const shell = await sandbox.createSession({
		id: `agent-${options.conversationId}`,
		cwd: WORKSPACE_PATH,
		env: {
			OPENCODE_API_KEY: options.env.OPENCODE_API_KEY,
		},
		commandTimeoutMs: AGENT_COMMAND_TIMEOUT_MS,
	});

	let ok = true;
	let assistantText = "";
	let stdoutBuffer = "";

	const secretValues = [options.env.OPENCODE_API_KEY].filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);

	const handleRunnerLine = async (line: string) => {
		const msg = parseRunnerStdoutLine(line);
		if (!msg) {
			return;
		}
		await options.onRunnerMessage(msg);
		if (msg.kind === "assistant_delta") {
			assistantText += msg.delta;
		}
		if (msg.kind === "error") {
			ok = false;
		}
		if (msg.kind === "done") {
			ok = msg.ok;
			if (msg.assistantText) {
				assistantText = msg.assistantText;
			}
		}
	};

	try {
		await shell.mkdir(`${WORKSPACE_PATH}/.ditto/sessions`, {
			recursive: true,
		});
		await shell.mkdir(`${WORKSPACE_PATH}/.ditto/jobs`, { recursive: true });
		await shell.mkdir(`${WORKSPACE_PATH}/.ditto/pi-agent`, {
			recursive: true,
		});

		const jobPath = `${WORKSPACE_PATH}/.ditto/jobs/${nanoid()}.json`;
		await shell.writeFile(
			jobPath,
			JSON.stringify({
				conversationId: options.conversationId,
				model: options.model,
				prompt: options.prompt,
				cwd: WORKSPACE_PATH,
			}),
		);

		const stream = await shell.execStream(
			`node ${RUNNER_CLI} --job ${quoteShellArg(jobPath)}`,
			{ cwd: WORKSPACE_PATH, signal: options.signal },
		);

		for await (const event of parseSSEStream<ExecEvent>(
			stream,
			options.signal,
		)) {
			if (options.signal?.aborted) {
				ok = false;
				break;
			}

			if (event.type === "stdout" && event.data) {
				const split = splitStdoutBuffer(stdoutBuffer, event.data);
				stdoutBuffer = split.rest;
				for (const line of split.lines) {
					await handleRunnerLine(line);
				}
			}

			if (event.type === "stderr" && event.data) {
				// stderr is logged only via runner protocol; avoid leaking secrets
				void redactSecrets(event.data, secretValues);
			}

			if (event.type === "error") {
				ok = false;
				const message = redactSecrets(
					event.error ?? event.data ?? "Agent run failed.",
					secretValues,
				);
				await options.onRunnerMessage({
					v: 1,
					kind: "error",
					message,
				});
			}

			if (event.type === "complete") {
				if (stdoutBuffer.trim()) {
					await handleRunnerLine(stdoutBuffer);
					stdoutBuffer = "";
				}
				if ((event.exitCode ?? 0) !== 0 && !assistantText.trim()) {
					ok = false;
				}
			}
		}
	} finally {
		try {
			await sandbox.deleteSession(shell.id);
		} catch {
			// best-effort cleanup
		}
	}

	let backup: DirectoryBackup | undefined;
	let backupStored = false;
	let backupError: string | undefined;

	try {
		backup = await backupSandboxWorkspace({
			env: options.env,
			sandboxId: options.sandboxId,
			projectId: options.projectId,
		});
		backupStored = true;
	} catch (error) {
		backupError = redactSecrets(
			error instanceof Error ? error.message : "Backup failed.",
			secretValues,
		);
	}

	return {
		ok,
		assistantText,
		backupStored,
		backup,
		backupError,
	};
}
