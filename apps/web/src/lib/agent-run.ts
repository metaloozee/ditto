import type { ExecEvent } from "@cloudflare/sandbox";
import { parseSSEStream } from "@cloudflare/sandbox";
import { nanoid } from "nanoid";
import { credentialSecretValues } from "#/lib/account-provider-credentials";
import { agentGitCallbackUrl, mintAgentGitJwt } from "#/lib/agent-git-jwt";
import {
	parseRunnerStdoutLine,
	type RunnerOut,
	splitStdoutBuffer,
} from "#/lib/agent-stream-protocol";
import { dittoGitAuthorEnv } from "#/lib/ditto-git-identity";
import { getProjectSandbox, type SandboxEnvVar } from "#/lib/sandbox-bootstrap";
import {
	redactSecrets,
	redactStructured,
	StreamingSecretRedactor,
} from "#/lib/secret-redaction";
import { withSessionWorkspaceLock } from "#/lib/session-workspace-lock";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

const RUNNER_CLI = "/opt/ditto-runner/dist/cli.js";
const AGENT_COMMAND_TIMEOUT_MS = 600_000;

/** Max characters retained from stderr for exit/empty-response diagnostics. */
export const STDERR_TAIL_MAX_CHARS = 4096;

/**
 * Append a chunk to a rolling diagnostic tail. Storage is capped so a noisy
 * multi-minute runner cannot grow unbounded memory; the final error surface
 * still uses only the last 400 characters after trim + redaction.
 */
export function appendRollingTail(
	current: string,
	chunk: string,
	maxChars: number = STDERR_TAIL_MAX_CHARS,
): string {
	if (!chunk) {
		return current;
	}
	if (maxChars <= 0) {
		return "";
	}
	// Prefer keeping only the new chunk when it alone exceeds the cap.
	if (chunk.length >= maxChars) {
		return chunk.slice(-maxChars);
	}
	const combined = current + chunk;
	if (combined.length <= maxChars) {
		return combined;
	}
	return combined.slice(-maxChars);
}

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function projectEnvRecord(
	envVars: readonly SandboxEnvVar[] | undefined,
): Record<string, string> {
	const record: Record<string, string> = {};
	for (const { key, value } of envVars ?? []) {
		if (key) {
			record[key] = value;
		}
	}
	return record;
}

async function runAgentInSandboxLocked(options: {
	env: Env;
	sandboxId: string;
	projectId: string;
	userId: string;
	conversationId: string;
	runId: string;
	cwd: string;
	model: string;
	prompt: string;
	/** Runtime credential JSON for DITTO_PI_CREDENTIAL (no real OAuth refresh). */
	runtimeCredentialJson: string;
	envVars?: readonly SandboxEnvVar[];
	onRunnerMessage: (msg: RunnerOut) => void | Promise<void>;
}): Promise<{
	ok: boolean;
	assistantText: string;
}> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	const gitCallbackToken = await mintAgentGitJwt({
		secret: options.env.BETTER_AUTH_SECRET,
		projectId: options.projectId,
		sessionId: options.conversationId,
		userId: options.userId,
		sandboxId: options.sandboxId,
	});
	const projectEnv = projectEnvRecord(options.envVars);
	const shell = await sandbox.createSession({
		id: `agent-${options.conversationId}`,
		cwd: options.cwd,
		env: {
			...projectEnv,
			DITTO_PI_CREDENTIAL: options.runtimeCredentialJson,
			DITTO_GIT_CALLBACK_URL: agentGitCallbackUrl(options.env),
			DITTO_GIT_CALLBACK_TOKEN: gitCallbackToken,
			...dittoGitAuthorEnv(),
		},
		commandTimeoutMs: AGENT_COMMAND_TIMEOUT_MS,
	});

	let ok = true;
	let assistantText = "";
	let stdoutBuffer = "";
	let stderrTail = "";
	let sawRunnerDone = false;
	let errorEmitted = false;

	let credentialLeaves: string[] = [];
	try {
		credentialLeaves = credentialSecretValues(
			JSON.parse(options.runtimeCredentialJson) as unknown,
		);
	} catch {
		credentialLeaves = [];
	}
	const secretValues = [
		options.runtimeCredentialJson,
		...credentialLeaves,
		gitCallbackToken,
		...Object.values(projectEnv),
	].filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);

	// One streaming redactor per run so secrets split across deltas are held back.
	const streamRedactor = new StreamingSecretRedactor(secretValues);

	const flushAssistantText = async () => {
		const delta = streamRedactor.flush();
		if (!delta) {
			return;
		}
		assistantText += delta;
		await options.onRunnerMessage({
			v: 1,
			kind: "assistant_delta",
			delta,
		});
	};

	const emitError = async (message: string) => {
		if (errorEmitted) {
			return;
		}
		errorEmitted = true;
		ok = false;
		// Flush any held assistant text before the error so trailing safe text is not lost.
		await flushAssistantText();
		await options.onRunnerMessage({
			v: 1,
			kind: "error",
			message: redactSecrets(message, secretValues),
		});
	};

	const handleRunnerLine = async (line: string) => {
		const msg = parseRunnerStdoutLine(line);
		if (!msg) {
			return;
		}

		if (msg.kind === "assistant_delta") {
			const sanitized = streamRedactor.push(msg.delta);
			if (sanitized) {
				assistantText += sanitized;
				await options.onRunnerMessage({
					v: 1,
					kind: "assistant_delta",
					delta: sanitized,
				});
			}
			return;
		}

		if (msg.kind === "agent_event") {
			// A tool event breaks the assistant text stream, so no secret can span
			// this boundary. Release held safe text before forwarding the tool.
			await flushAssistantText();
			await options.onRunnerMessage({
				v: 1,
				kind: "agent_event",
				event: redactStructured(msg.event, secretValues),
			});
			return;
		}

		if (msg.kind === "control_event") {
			await flushAssistantText();
			await options.onRunnerMessage({
				v: 1,
				kind: "control_event",
				event: redactStructured(msg.event, secretValues) as typeof msg.event,
			});
			return;
		}

		if (msg.kind === "error") {
			ok = false;
			errorEmitted = true;
			await flushAssistantText();
			await options.onRunnerMessage({
				v: 1,
				kind: "error",
				message: redactSecrets(msg.message, secretValues),
			});
			return;
		}

		if (msg.kind === "done") {
			sawRunnerDone = true;
			ok = msg.ok;
			await flushAssistantText();
			// Prefer sanitized accumulated text; still scrub runner-provided assistantText.
			const doneText = redactSecrets(
				msg.assistantText || assistantText,
				secretValues,
			);
			assistantText = doneText;
			await options.onRunnerMessage({
				v: 1,
				kind: "done",
				sessionId: msg.sessionId,
				assistantText: doneText,
				ok: msg.ok,
			});
			return;
		}

		// ready (and any future non-secret kinds): pass through after light string scrub
		if (msg.kind === "ready") {
			await options.onRunnerMessage({
				v: 1,
				kind: "ready",
				sessionId: msg.sessionId,
				model: msg.model,
			});
			return;
		}

		await options.onRunnerMessage(msg);
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
				runId: options.runId,
				conversationId: options.conversationId,
				model: options.model,
				prompt: options.prompt,
				cwd: options.cwd,
			}),
		);

		const stream = await shell.execStream(
			`node ${RUNNER_CLI} --job ${quoteShellArg(jobPath)}`,
			{ cwd: options.cwd },
		);

		// Intentionally not abortable: client navigations/disconnects must not tear
		// down long agent runs mid-stream (would leave empty assistant rows in D1).
		// Cost/side effects continue until the sandbox process exits.
		for await (const event of parseSSEStream<ExecEvent>(stream)) {
			if (event.type === "stdout" && event.data) {
				const split = splitStdoutBuffer(stdoutBuffer, event.data);
				stdoutBuffer = split.rest;
				for (const line of split.lines) {
					await handleRunnerLine(line);
				}
			}

			if (event.type === "stderr" && event.data) {
				stderrTail = appendRollingTail(stderrTail, event.data);
			}

			if (event.type === "error") {
				await emitError(event.error ?? event.data ?? "Agent run failed.");
			}

			if (event.type === "complete") {
				if (stdoutBuffer.trim()) {
					await handleRunnerLine(stdoutBuffer);
					stdoutBuffer = "";
				}
				// Flush any held streaming suffix so trailing safe text is not lost
				// when the runner omits a done event (done/error paths already flush).
				await flushAssistantText();
				const exitCode = event.exitCode ?? 0;
				if (exitCode !== 0) {
					const stderrHint = redactSecrets(
						stderrTail.trim().slice(-400),
						secretValues,
					);
					await emitError(
						stderrHint.length > 0
							? `Agent exited with code ${exitCode}: ${stderrHint}`
							: `Agent exited with code ${exitCode}.`,
					);
				} else if (!sawRunnerDone && !assistantText.trim()) {
					const stderrHint = redactSecrets(
						stderrTail.trim().slice(-400),
						secretValues,
					);
					await emitError(
						stderrHint.length > 0
							? `Agent produced no response: ${stderrHint}`
							: "Agent produced no response.",
					);
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

	return {
		ok,
		assistantText,
	};
}

export async function runAgentInSandbox(
	options: Parameters<typeof runAgentInSandboxLocked>[0],
): ReturnType<typeof runAgentInSandboxLocked> {
	return await withSessionWorkspaceLock({
		env: options.env,
		sandboxId: options.sandboxId,
		sessionId: options.conversationId,
		run: () => runAgentInSandboxLocked(options),
	});
}
