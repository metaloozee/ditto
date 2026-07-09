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
	extractTextDelta,
	pickAssistantText,
	type RunnerOut,
} from "./protocol.js";

export type RunAgentOptions = {
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

		const { session: agentSession } = await createAgentSession({
			cwd: options.cwd,
			agentDir: options.agentDir,
			model: resolved.model,
			authStorage,
			modelRegistry,
			sessionManager,
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: true },
			}),
			tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
		});
		session = agentSession;

		options.onEvent({
			v: 1,
			kind: "ready",
			sessionId: options.conversationId,
			model: options.modelSpecifier,
		});

		let deltas = "";
		unsubscribe = session.subscribe((event) => {
			options.onEvent({ v: 1, kind: "agent_event", event });
			const delta = extractTextDelta(event);
			if (delta) {
				deltas += delta;
				options.onEvent({ v: 1, kind: "assistant_delta", delta });
			}
		});

		try {
			await session.prompt(options.prompt);
			assistantText = pickAssistantText(deltas, session.messages);
			ok = true;
		} catch (err) {
			assistantText = pickAssistantText(deltas, session.messages);
			emitError(shortErrorMessage(err));
		}
	} catch (err) {
		emitError(shortErrorMessage(err));
	} finally {
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
