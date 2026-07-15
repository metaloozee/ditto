import fs from "node:fs";
import path from "node:path";
import {
	AuthStorage,
	createAgentSession,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	type ControlRequest,
	type ControlResponse,
	startControlServer,
} from "./control-channel.js";
import { dittoGitCustomTools } from "./ditto-git-tools.js";
import {
	extractUserTextFromMessageStart,
	type FollowUpCorrelation,
	pickAssistantText,
	type RunnerOut,
	runnerOutputFromAgentEvent,
} from "./protocol.js";

export type RunAgentOptions = {
	runId: string;
	cwd: string;
	conversationId: string;
	modelSpecifier: string;
	prompt: string;
	agentDir: string;
	sessionsDir: string;
	onEvent: (msg: RunnerOut) => void;
};

function resolveModel(
	modelSpecifier: string,
	modelRegistry: ModelRegistry,
): { model?: ReturnType<ModelRegistry["find"]>; error?: string } {
	const slash = modelSpecifier.indexOf("/");
	if (slash === -1) {
		return { error: `Unknown model: ${modelSpecifier}` };
	}

	const provider = modelSpecifier.slice(0, slash);
	const modelId = modelSpecifier.slice(slash + 1);
	const model = modelRegistry.find(provider, modelId);
	if (!model) {
		return { error: `Unknown model: ${modelSpecifier}` };
	}

	return { model };
}

function shortErrorMessage(err: unknown): string {
	if (err instanceof Error && err.message.trim().length > 0) {
		return err.message.slice(0, 500);
	}
	return "Agent run failed";
}

export async function runAgent(
	options: RunAgentOptions,
): Promise<{ ok: boolean; assistantText: string }> {
	let assistantText = "";
	let ok = false;
	let errorEmitted = false;
	let unsubscribe: (() => void) | undefined;
	let controlServer: Awaited<ReturnType<typeof startControlServer>> | undefined;
	let abortPromise: Promise<void> | undefined;
	let stopping = false;
	let promptActive = false;
	let initialUserMessageSeen = false;
	const pendingFollowUps: FollowUpCorrelation[] = [];
	let session:
		| Awaited<ReturnType<typeof createAgentSession>>["session"]
		| undefined;

	const emitError = (message: string) => {
		if (errorEmitted) return;
		options.onEvent({ v: 1, kind: "error", message });
		errorEmitted = true;
	};

	try {
		fs.mkdirSync(options.agentDir, { recursive: true });
		fs.mkdirSync(options.sessionsDir, { recursive: true });

		const authPath = path.join(options.agentDir, "auth.json");
		const authStorage = AuthStorage.create(authPath);
		if (process.env.OPENCODE_API_KEY) {
			authStorage.setRuntimeApiKey("opencode-go", process.env.OPENCODE_API_KEY);
		}

		const modelRegistry = ModelRegistry.create(authStorage);
		const resolved = resolveModel(options.modelSpecifier, modelRegistry);
		if (resolved.error || !resolved.model) {
			emitError(resolved.error ?? `Unknown model: ${options.modelSpecifier}`);
			return { ok: false, assistantText: "" };
		}

		const sessionFile = path.join(
			options.sessionsDir,
			`${options.conversationId}.jsonl`,
		);
		const sessionManager = SessionManager.open(sessionFile);

		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: true },
			followUpMode: "one-at-a-time",
		});
		const { session: agentSession } = await createAgentSession({
			cwd: options.cwd,
			agentDir: options.agentDir,
			model: resolved.model,
			authStorage,
			modelRegistry,
			sessionManager,
			settingsManager,
			tools: [
				"read",
				"bash",
				"edit",
				"write",
				"grep",
				"find",
				"ls",
				"ditto_push_branch",
				"ditto_open_pull_request",
			],
			customTools: [...dittoGitCustomTools],
		});
		session = agentSession;

		const reject = (
			request: ControlRequest,
			message: string,
		): ControlResponse => ({
			accepted: false,
			requestId: request.requestId,
			message,
		});
		const handleControl = async (
			request: ControlRequest,
		): Promise<ControlResponse> => {
			if (stopping) return reject(request, "Agent run is stopping");
			if (!promptActive || !session?.isStreaming) {
				return reject(request, "Agent run is no longer streaming");
			}
			if (request.action === "follow_up") {
				if (request.model !== options.modelSpecifier) {
					return reject(request, "The active model has changed");
				}
				try {
					await session.followUp(request.text);
				} catch (error) {
					return reject(request, shortErrorMessage(error));
				}
				pendingFollowUps.push({
					requestId: request.requestId,
					runId: request.runId,
					sessionId: request.sessionId,
					text: request.text,
					userMessageId: request.userMessageId,
					assistantMessageId: request.assistantMessageId,
				});
				return {
					accepted: true,
					action: "follow_up",
					requestId: request.requestId,
					runId: request.runId,
					sessionId: request.sessionId,
					userMessageId: request.userMessageId,
					assistantMessageId: request.assistantMessageId,
				};
			}

			stopping = true;
			const removed = session.clearQueue();
			for (let index = 0; index < removed.followUp.length; index += 1) {
				const metadata = pendingFollowUps.shift();
				if (!metadata) break;
				options.onEvent({
					v: 1,
					kind: "control_event",
					event: { type: "follow_up_cancelled", ...metadata },
				});
			}
			options.onEvent({
				v: 1,
				kind: "control_event",
				event: {
					type: "stop_requested",
					runId: options.runId,
					sessionId: options.conversationId,
				},
			});
			abortPromise = session.abort();
			abortPromise.catch(() => undefined);
			return {
				accepted: true,
				action: "stop",
				requestId: request.requestId,
				runId: request.runId,
				sessionId: request.sessionId,
				removedFollowUpCount: removed.followUp.length,
			};
		};

		unsubscribe = session.subscribe((event) => {
			const userText = extractUserTextFromMessageStart(event);
			if (userText !== null) {
				if (!initialUserMessageSeen) {
					initialUserMessageSeen = true;
				} else {
					const metadata = pendingFollowUps.shift();
					if (metadata) {
						options.onEvent({
							v: 1,
							kind: "control_event",
							event: { type: "follow_up_started", ...metadata, text: userText },
						});
					}
				}
			}
			const output = runnerOutputFromAgentEvent(event);
			if (!output) return;
			if (output.kind === "assistant_delta") {
				deltas += output.delta;
			}
			options.onEvent(output);
		});

		controlServer = await startControlServer({
			runId: options.runId,
			sessionId: options.conversationId,
			handle: handleControl,
		});

		options.onEvent({
			v: 1,
			kind: "ready",
			sessionId: options.conversationId,
			model: options.modelSpecifier,
		});

		let deltas = "";
		try {
			promptActive = true;
			await session.prompt(options.prompt);
			assistantText = pickAssistantText(deltas, session.messages);
			ok = !stopping;
		} catch (err) {
			assistantText = pickAssistantText(deltas, session.messages);
			if (!stopping) emitError(shortErrorMessage(err));
		} finally {
			promptActive = false;
		}
	} catch (err) {
		if (!stopping) emitError(shortErrorMessage(err));
	} finally {
		try {
			await controlServer?.close();
		} catch (err) {
			if (!stopping) emitError(shortErrorMessage(err));
		}
		if (abortPromise) {
			try {
				await abortPromise;
			} catch (err) {
				if (!stopping) emitError(shortErrorMessage(err));
			}
		}
		unsubscribe?.();
		try {
			session?.dispose();
		} catch (err) {
			console.error(shortErrorMessage(err));
		}

		options.onEvent({
			v: 1,
			kind: "done",
			sessionId: options.conversationId,
			assistantText,
			ok,
		});
	}

	return { ok, assistantText };
}
