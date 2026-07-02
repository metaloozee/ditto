/**
 * Ditto agent runner.
 *
 * Runs **inside the sandbox container** (not the Worker). Imports the Pi SDK,
 * owns the agent loop, and exposes the Ditto NDJSON contract on stdin/stdout.
 * Diagnostics go to stderr only — stdout stays clean NDJSON.
 *
 * Commands (stdin, one NDJSON object per line):
 *   { type: "prompt", id, message }
 *   { type: "reply", requestId, answer }
 *   { type: "abort", id }
 *
 * Events (stdout, one NDJSON object per line): see RunnerEvent in
 * src/lib/runner-protocol.ts.
 */

import { getModel, Type } from "@earendil-works/pi-ai";
import {
	AuthStorage,
	createAgentSession,
	createExtensionRuntime,
	defineTool,
	ModelRegistry,
	type ResourceLoader,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import {
	mapSdkEventToDitto,
	planRunnerCommand,
	serializeRunnerEvent,
	type RunnerCommand,
	type RunnerEvent,
} from "../../src/lib/runner-protocol";

const RUNNER_VERSION = "1";

/** Active run id (the `prompt.id` of the current run). null before the first
 * prompt and after the runner stops accepting commands. */
let currentRunId: string | null = null;
/** Guards against double `done` emission for the current run. */
let runDone = false;
/** Pending ask-user requests, keyed by requestId. The `reply` command
 * resolves the stored promise. */
const pendingInputs = new Map<string, (answer: string) => void>();

function writeEvent(event: RunnerEvent): void {
	process.stdout.write(`${serializeRunnerEvent(event)}\n`);
}

function logDiag(message: string): void {
	process.stderr.write(`${message}\n`);
}

function trimCompact(value: string, maxLength = 2000): string {
	const compact = value.trim();
	if (compact.length <= maxLength) {
		return compact;
	}
	return `${compact.slice(0, maxLength)}\n...[truncated]`;
}

/** Split a "provider/model" specifier. Re-implemented locally so the runner
 * does not import from `src/` at runtime. */
function getModelParts(specifier: string): {
	provider: string;
	model: string;
} {
	const slashIndex = specifier.indexOf("/");

	if (slashIndex <= 0 || slashIndex === specifier.length - 1) {
		throw new Error("Invalid model specifier.");
	}

	return {
		provider: specifier.slice(0, slashIndex),
		model: specifier.slice(slashIndex + 1),
	};
}

/** Emit a redacted `error` + `done{failed}` for the active run and exit. */
function failRun(message: string): void {
	if (currentRunId && !runDone) {
		writeEvent({ type: "error", runId: currentRunId, message: trimCompact(message) });
		runDone = true;
		writeEvent({ type: "done", runId: currentRunId, status: "failed" });
	}
	logDiag(`runner error: ${message}`);
	process.exit(1);
}

function isRunnerCommand(value: unknown): value is RunnerCommand {
	if (!value || typeof value !== "object") {
		return false;
	}
	const cmd = value as Record<string, unknown>;
	if (cmd.type === "prompt") {
		return typeof cmd.id === "string" && typeof cmd.message === "string";
	}
	if (cmd.type === "reply") {
		return typeof cmd.requestId === "string" && typeof cmd.answer === "string";
	}
	if (cmd.type === "abort") {
		return typeof cmd.id === "string";
	}
	return false;
}

async function main(): Promise<void> {
	const MODEL_SPECIFIER = process.env.MODEL_SPECIFIER;
	const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY;

	if (!MODEL_SPECIFIER) {
		writeEvent({ type: "error", runId: "", message: "MODEL_SPECIFIER is not set." });
		writeEvent({ type: "done", runId: "", status: "failed" });
		process.exit(1);
	}

	let provider: string;
	let modelId: string;
	try {
		const parts = getModelParts(MODEL_SPECIFIER);
		provider = parts.provider;
		modelId = parts.model;
	} catch {
		writeEvent({
			type: "error",
			runId: "",
			message: `Malformed MODEL_SPECIFIER: ${MODEL_SPECIFIER}`,
		});
		writeEvent({ type: "done", runId: "", status: "failed" });
		process.exit(1);
	}

	// Hardened resource loader: no project-local extensions, skills, prompt
	// templates, or themes are discovered from imported repos (the SDK
	// equivalent of --no-extensions/--no-skills/--no-prompt-templates/
	// --no-themes). Context files (AGENTS.md) are also disabled for the spike;
	// phase 3 may re-enable a constrained walk. A minimal explicit system
	// prompt is supplied so the agent keeps tool-use guidance without any
	// project-local APPEND_SYSTEM.md.
	const resourceLoader: ResourceLoader = {
		getExtensions: () => ({
			extensions: [],
			errors: [],
			runtime: createExtensionRuntime(),
		}),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () =>
			"You are Ditto's coding agent running inside a sandbox. " +
			"Use the available tools to read, edit, and run commands in the " +
			"workspace to fulfill the user's request. Be concise.",
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};

	const authStorage = AuthStorage.create();
	if (OPENCODE_API_KEY) {
		authStorage.setRuntimeApiKey(provider, OPENCODE_API_KEY);
	}
	const modelRegistry = ModelRegistry.create(authStorage);
	const model = modelRegistry.find(provider, modelId) ?? getModel(provider, modelId);
	if (!model) {
		writeEvent({
			type: "error",
			runId: "",
			message: `Unknown model: ${MODEL_SPECIFIER}`,
		});
		writeEvent({ type: "done", runId: "", status: "failed" });
		process.exit(1);
	}

	// Ask-user tool: emits a Ditto input_request event and awaits the reply
	// command. Does NOT call ctx.ui.input or rely on extension_ui_* RPC.
	const askUserTool = defineTool({
		name: "ask_user",
		label: "Ask User",
		description: "Ask the Ditto user a concise clarification question.",
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask the user." }),
			placeholder: Type.Optional(
				Type.String({ description: "Placeholder hint for the input." }),
			),
		}),
		async execute(_toolCallId, params) {
			const requestId = randomUUID();
			const { question } = params;
			const placeholder = params.placeholder;
			const runId = currentRunId ?? "";
			const inputEvent: RunnerEvent = placeholder
				? { type: "input_request", runId, requestId, question, placeholder }
				: { type: "input_request", runId, requestId, question };
			writeEvent(inputEvent);
			const answer = await new Promise<string>((resolve) => {
				pendingInputs.set(requestId, resolve);
			});
			return {
				content: [{ type: "text", text: answer }],
				details: { question, answer },
			};
		},
	});

	const { session } = await createAgentSession({
		customTools: [askUserTool],
		sessionManager: SessionManager.inMemory(),
		resourceLoader,
		authStorage,
		modelRegistry,
		model,
	});

	writeEvent({ type: "ready", runnerVersion: RUNNER_VERSION, model: MODEL_SPECIFIER });

	session.subscribe((event) => {
		if (!currentRunId) {
			return;
		}
		const events = mapSdkEventToDitto(
			event as Record<string, unknown>,
			currentRunId,
		);
		for (const evt of events) {
			if (evt.type === "done") {
				if (runDone) {
					continue;
				}
				runDone = true;
			}
			writeEvent(evt);
			if (evt.type === "done" && evt.status === "failed") {
				process.exit(1);
			}
		}
	});

	const handleRunError = (err: unknown): void => {
		const message = err instanceof Error ? err.message : String(err);
		failRun(message);
	};

	const rl = createInterface({ input: process.stdin });

	rl.on("line", (line) => {
		if (!line.trim()) {
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			logDiag(`non-JSON stdin line ignored: ${line.slice(0, 160)}`);
			return;
		}
		if (!isRunnerCommand(parsed)) {
			logDiag("stdin line is not a valid RunnerCommand; ignored.");
			return;
		}
		const dispatch = planRunnerCommand(parsed, (id) => pendingInputs.has(id));
		if (!dispatch) {
			logDiag(`no-op command (type=${parsed.type}); ignored.`);
			return;
		}
		switch (dispatch.action) {
			case "prompt": {
				if (parsed.type !== "prompt") {
					return;
				}
				currentRunId = parsed.id;
				runDone = false;
				try {
					session.prompt(dispatch.message).then(undefined, handleRunError);
				} catch (err) {
					handleRunError(err);
				}
				break;
			}
			case "resolveInput": {
				const resolve = pendingInputs.get(dispatch.requestId);
				if (resolve) {
					resolve(dispatch.answer);
					pendingInputs.delete(dispatch.requestId);
				}
				break;
			}
			case "abort": {
				session.abort().then(undefined, handleRunError);
				break;
			}
		}
	});

	rl.on("close", () => {
		let exitCode = 0;
		if (currentRunId && !runDone) {
			runDone = true;
			writeEvent({ type: "done", runId: currentRunId, status: "failed" });
			exitCode = 1;
		}
		session.dispose();
		process.exit(exitCode);
	});
}

main().catch((err) => {
	const message = err instanceof Error ? err.message : String(err);
	writeEvent({ type: "error", runId: currentRunId ?? "", message: trimCompact(message) });
	if (currentRunId && !runDone) {
		writeEvent({ type: "done", runId: currentRunId, status: "failed" });
	}
	process.exit(1);
});
