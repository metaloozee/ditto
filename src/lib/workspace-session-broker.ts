import { DurableObject } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "#/db";
import { agentRunEvents, agentRuns, projects } from "#/db/schema";
import {
	buildJsonlWriteCommand,
	getPiModelParts,
	getTextField,
	JsonlBuffer,
	type PiRpcCommand,
	type PiRpcEvent,
	type PiRpcResponse,
	quoteShellArg,
	trimCompact,
} from "#/lib/pi-rpc";
import { serializeSandboxBackup } from "#/lib/sandbox-backup";
import {
	backupSandboxWorkspace,
	getProjectSandbox,
} from "#/lib/sandbox-bootstrap";
import {
	createAgentRunEventPayload,
	WORKSPACE_PATH,
} from "#/lib/workspace-policy";

type BrokerSocketAttachment = {
	connectedAt: number;
};

type BrokerState = {
	sessionId?: string;
	userId?: string;
	projectId?: string;
	sandboxId?: string;
	activeRunId?: string;
	isMutating?: boolean;
	piProcessId?: string;
	fifoPath?: string;
	pendingUiRequestId?: string;
	canceledRunIds?: string[];
};

type StartRequest = {
	sessionId: string;
	userId: string;
	projectId: string;
	sandboxId: string;
	runId: string;
	message: string;
	modelSpecifier: string;
	isMutating: boolean;
};

type ReplyRequest = {
	runId: string;
	answer: string;
};

type AbortRequest = {
	runId: string;
};

export type WorkspaceSessionBrokerFrame =
	| { type: "snapshot"; state: BrokerState }
	| { type: "assistant_delta"; runId: string; text: string }
	| { type: "tool_progress"; runId: string; text: string }
	| { type: "needs_input"; runId: string; question: string; requestId: string }
	| { type: "done"; runId: string; status: "completed" | "failed" | "canceled" }
	| { type: "error"; message: string };

const BROKER_STATE_KEY = "broker-state";
const COMMAND_TIMEOUT_MS = 30_000;
const PROCESS_STREAM_ENCODING = "utf8";

function isWebSocketUpgrade(request: Request): boolean {
	return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

function getString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function requireString(input: Record<string, unknown>, key: string): string {
	const value = getString(input[key]);

	if (!value) {
		throw new Error(`Missing ${key}.`);
	}

	return value;
}

function parseStartRequest(value: unknown): StartRequest {
	if (!value || typeof value !== "object") {
		throw new Error("Invalid start request.");
	}

	const input = value as Record<string, unknown>;

	return {
		sessionId: requireString(input, "sessionId"),
		userId: requireString(input, "userId"),
		projectId: requireString(input, "projectId"),
		sandboxId: requireString(input, "sandboxId"),
		runId: requireString(input, "runId"),
		message: requireString(input, "message"),
		modelSpecifier: requireString(input, "modelSpecifier"),
		isMutating: input.isMutating === true,
	};
}

function parseReplyRequest(value: unknown): ReplyRequest {
	if (!value || typeof value !== "object") {
		throw new Error("Invalid reply request.");
	}

	const input = value as Record<string, unknown>;

	return {
		runId: requireString(input, "runId"),
		answer: requireString(input, "answer"),
	};
}

function parseAbortRequest(value: unknown): AbortRequest {
	if (!value || typeof value !== "object") {
		throw new Error("Invalid abort request.");
	}

	const input = value as Record<string, unknown>;

	return { runId: requireString(input, "runId") };
}

function makeProcessId(sessionId: string): string {
	return `ditto-pi-${sessionId.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function makeBrokerDir(sessionId: string): string {
	return `/tmp/ditto/pi/${sessionId.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function makePiCommand(options: {
	brokerDir: string;
	fifoPath: string;
	provider: string;
	model: string;
}): string {
	return [
		"set -euo pipefail",
		`mkdir -p ${quoteShellArg(options.brokerDir)}`,
		`rm -f ${quoteShellArg(options.fifoPath)}`,
		`mkfifo ${quoteShellArg(options.fifoPath)}`,
		[
			"exec env PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 pi --mode rpc",
			"--no-session",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--no-approve",
			"-e /opt/ditto/pi/ditto-ask-user.ts",
			`--provider ${quoteShellArg(options.provider)}`,
			`--model ${quoteShellArg(options.model)}`,
			`< ${quoteShellArg(options.fifoPath)}`,
		].join(" "),
	].join("; ");
}

export class WorkspaceSessionBroker extends DurableObject<Env> {
	private sockets = new Map<WebSocket, BrokerSocketAttachment>();
	private commandQueue: Promise<void> = Promise.resolve();
	private responseWaiters = new Map<
		string,
		{
			resolve: (response: PiRpcResponse) => void;
			reject: (error: Error) => void;
		}
	>();
	private streamStartedForProcessId: string | null = null;
	private jsonlBuffer = new JsonlBuffer();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair("ping", "pong"),
		);

		for (const socket of this.ctx.getWebSockets()) {
			const attachment = socket.deserializeAttachment();
			this.sockets.set(
				socket,
				isBrokerSocketAttachment(attachment)
					? attachment
					: { connectedAt: Date.now() },
			);
		}
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (isWebSocketUpgrade(request)) {
			return await this.acceptSocket();
		}

		if (request.method !== "POST") {
			return new Response("Method not allowed", { status: 405 });
		}

		try {
			switch (url.pathname) {
				case "/start":
					await this.start(parseStartRequest(await request.json()));
					return new Response(null, { status: 202 });
				case "/reply":
					await this.reply(parseReplyRequest(await request.json()));
					return new Response(null, { status: 202 });
				case "/abort":
					await this.abort(parseAbortRequest(await request.json()));
					return new Response(null, { status: 202 });
				default:
					return new Response("Not found", { status: 404 });
			}
		} catch (error) {
			return Response.json(
				{
					error:
						error instanceof Error ? error.message : "Broker request failed.",
				},
				{ status: 400 },
			);
		}
	}

	async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
		if (message === "ping") {
			socket.send("pong");
		}
	}

	async webSocketClose(
		socket: WebSocket,
		code: number,
		reason: string,
		_wasClean: boolean,
	) {
		this.sockets.delete(socket);
		socket.close(code, reason);
	}

	async webSocketError(socket: WebSocket) {
		this.sockets.delete(socket);
	}

	private async start(input: StartRequest): Promise<void> {
		const state: BrokerState = {
			...(await this.getState()),
			sessionId: input.sessionId,
			userId: input.userId,
			projectId: input.projectId,
			sandboxId: input.sandboxId,
			activeRunId: input.runId,
			isMutating: input.isMutating,
			pendingUiRequestId: undefined,
		};
		await this.setState(state);
		await this.ensurePiProcess(input);

		const response = await this.sendCommand({
			id: `prompt-${input.runId}`,
			type: "prompt",
			message: input.message,
		});

		if (!response.success) {
			throw new Error(response.error || "Pi rejected the prompt.");
		}
	}

	private async reply(input: ReplyRequest): Promise<void> {
		const state = await this.getState();
		if (!state.pendingUiRequestId) {
			throw new Error("No pending Pi UI request for this session.");
		}

		const response = await this.sendCommand({
			id: `reply-${input.runId}-${state.pendingUiRequestId}`,
			type: "extension_ui_response",
			requestId: state.pendingUiRequestId,
			value: input.answer,
		});

		if (!response.success) {
			throw new Error(response.error || "Pi rejected the UI response.");
		}

		await this.setState({ ...state, pendingUiRequestId: undefined });
	}

	private async abort(input: AbortRequest): Promise<void> {
		const state = await this.getState();
		await this.setState({
			...state,
			canceledRunIds: [...(state.canceledRunIds ?? []), input.runId],
		});

		try {
			await this.sendCommand({ id: `abort-${input.runId}`, type: "abort" });
		} catch {
			// Ditto has already recorded cancellation durably; abort is best effort.
		}
		this.broadcast({ type: "done", runId: input.runId, status: "canceled" });
	}

	private async ensurePiProcess(input: StartRequest): Promise<void> {
		const state = await this.getState();
		if (state.piProcessId && state.fifoPath) {
			await this.startLogStream(input.sessionId, state.piProcessId);
			return;
		}

		const sandbox = getProjectSandbox(this.env, input.sandboxId);
		const session = await sandbox.createSession({
			id: input.sessionId,
			name: `Ditto ${input.sessionId}`,
			cwd: WORKSPACE_PATH,
			env: { OPENCODE_API_KEY: this.env.OPENCODE_API_KEY },
		});
		const brokerDir = makeBrokerDir(input.sessionId);
		const fifoPath = `${brokerDir}/rpc.in`;
		const processId = makeProcessId(input.sessionId);
		const { provider, model } = getPiModelParts(input.modelSpecifier);
		const command = `bash -lc ${quoteShellArg(
			makePiCommand({ brokerDir, fifoPath, provider, model }),
		)}`;

		await session.startProcess(command, {
			processId,
			autoCleanup: false,
			cwd: WORKSPACE_PATH,
			env: { OPENCODE_API_KEY: this.env.OPENCODE_API_KEY },
			onExit: (code) => {
				if (code && code !== 0) {
					this.handlePiFailure(new Error(`Pi exited with code ${code}.`)).catch(
						() => undefined,
					);
				}
			},
		});

		await this.setState({
			...(await this.getState()),
			piProcessId: processId,
			fifoPath,
		});
		await this.startLogStream(input.sessionId, processId);
	}

	private async startLogStream(
		sessionId: string,
		processId: string,
	): Promise<void> {
		if (this.streamStartedForProcessId === processId) {
			return;
		}

		this.streamStartedForProcessId = processId;
		const sandbox = getProjectSandbox(
			this.env,
			(await this.getState()).sandboxId ?? "",
		);
		const session = await sandbox.createSession({
			id: sessionId,
			cwd: WORKSPACE_PATH,
		});
		const stream = await session.streamProcessLogs(processId);
		const reader = stream.getReader();
		const decoder = new TextDecoder(PROCESS_STREAM_ENCODING);

		void (async () => {
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) {
						break;
					}
					if (value) {
						await this.handlePiOutput(decoder.decode(value, { stream: true }));
					}
				}
			} catch (error) {
				await this.handlePiFailure(
					error instanceof Error ? error : new Error("Pi log stream failed."),
				);
			}
		})();
	}

	private async sendCommand(command: PiRpcCommand): Promise<PiRpcResponse> {
		const state = await this.getState();
		if (!state.fifoPath || !state.sessionId || !state.sandboxId) {
			throw new Error("Pi process is not ready.");
		}
		if (!command.id) {
			throw new Error("Pi command id is required.");
		}

		const responsePromise = new Promise<PiRpcResponse>((resolve, reject) => {
			this.responseWaiters.set(command.id ?? "", { resolve, reject });
		});

		this.commandQueue = this.commandQueue.then(async () => {
			const sandbox = getProjectSandbox(this.env, state.sandboxId ?? "");
			const session = await sandbox.createSession({
				id: state.sessionId,
				cwd: WORKSPACE_PATH,
			});
			const result = await session.exec(
				buildJsonlWriteCommand(state.fifoPath ?? "", command),
				{ cwd: WORKSPACE_PATH, timeout: COMMAND_TIMEOUT_MS },
			);

			if (!result.success) {
				throw new Error(
					trimCompact(result.stderr || result.stdout || "Pi write failed."),
				);
			}
		});

		try {
			await this.commandQueue;
			return await responsePromise;
		} catch (error) {
			this.responseWaiters.delete(command.id);
			throw error;
		}
	}

	private async handlePiOutput(chunk: string): Promise<void> {
		for (const event of this.jsonlBuffer.push(chunk)) {
			await this.handlePiEvent(event);
		}
	}

	private async handlePiEvent(event: PiRpcEvent): Promise<void> {
		if (event.type === "response") {
			const waiter = event.id ? this.responseWaiters.get(event.id) : undefined;
			if (waiter) {
				this.responseWaiters.delete(event.id ?? "");
				waiter.resolve(event);
			}
			return;
		}

		const state = await this.getState();
		const runId = state.activeRunId;
		if (!runId || state.canceledRunIds?.includes(runId)) {
			return;
		}
		if (await this.isRunCanceled(runId)) {
			await this.clearCanceledRun(state);
			return;
		}

		switch (event.type) {
			case "message_update": {
				const text = getTextField(event, ["delta", "text", "content"]);
				if (text) {
					this.broadcast({ type: "assistant_delta", runId, text });
				}
				return;
			}
			case "message_end": {
				const text = getTextField(event, ["text", "content"]);
				if (text) {
					await this.insertEvent("message", {
						role: "assistant",
						text: trimCompact(text, 8000),
					});
				}
				return;
			}
			case "tool_execution_start":
				await this.insertEvent("tool_started", {
					toolName: getTextField(event, ["toolName", "name"]) ?? "tool",
				});
				return;
			case "tool_execution_update": {
				const text = getTextField(event, ["output", "text", "message"]);
				if (text) {
					this.broadcast({
						type: "tool_progress",
						runId,
						text: trimCompact(text),
					});
				}
				return;
			}
			case "tool_execution_end":
				await this.insertEvent("tool_finished", {
					toolName: getTextField(event, ["toolName", "name"]) ?? "tool",
					status: getTextField(event, ["status"]) ?? "completed",
				});
				await this.emitWorkspaceChanges();
				return;
			case "extension_ui_request":
				await this.handleUiRequest(event);
				return;
			case "agent_end":
				await this.completeRun();
				return;
			case "extension_error":
				await this.failRun(
					getTextField(event, ["error", "message"]) ?? "Pi extension error.",
				);
				return;
		}
	}

	private async handleUiRequest(event: Record<string, unknown>): Promise<void> {
		const state = await this.getState();
		if (!state.activeRunId || !state.projectId || !state.sessionId) {
			return;
		}

		const requestId =
			getTextField(event, ["requestId", "id"]) ?? crypto.randomUUID();
		const question =
			getTextField(event, ["question", "prompt", "message"]) ??
			"The agent needs input.";

		const db = createDb(this.env);
		await db.batch([
			db
				.update(agentRuns)
				.set({
					status: "needs_input",
					question,
					recommendedAnswer: getTextField(event, ["placeholder"]),
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(agentRuns.id, state.activeRunId)),
			db.insert(agentRunEvents).values({
				runId: state.activeRunId,
				projectId: state.projectId,
				sessionId: state.sessionId,
				type: "needs_input",
				payload: createAgentRunEventPayload({
					requestId,
					question,
					placeholder: getTextField(event, ["placeholder"]),
				}),
			}),
		]);
		await this.setState({ ...state, pendingUiRequestId: requestId });
		this.broadcast({
			type: "needs_input",
			runId: state.activeRunId,
			question,
			requestId,
		});
	}

	private async completeRun(): Promise<void> {
		const state = await this.getState();
		if (
			!state.activeRunId ||
			state.canceledRunIds?.includes(state.activeRunId)
		) {
			return;
		}
		if (await this.isRunCanceled(state.activeRunId)) {
			await this.clearCanceledRun(state);
			return;
		}

		if (state.isMutating && state.sandboxId && state.projectId) {
			const backup = await backupSandboxWorkspace({
				env: this.env,
				sandboxId: state.sandboxId,
				projectId: state.projectId,
			});
			await createDb(this.env)
				.update(projects)
				.set({
					sandboxBackup: serializeSandboxBackup(backup),
					sandboxBackupCreatedAt: sql`(unixepoch())`,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(projects.id, state.projectId));
		}

		await this.finishRun("completed");
	}

	private async failRun(reason: string): Promise<void> {
		const state = await this.getState();
		if (!state.activeRunId) {
			return;
		}
		if (await this.isRunCanceled(state.activeRunId)) {
			await this.clearCanceledRun(state);
			return;
		}

		await this.insertEvent("error", { reason: trimCompact(reason) });
		await this.finishRun("failed");
	}

	private async handlePiFailure(error: Error): Promise<void> {
		await this.failRun(error.message);
	}

	private async finishRun(status: "completed" | "failed"): Promise<void> {
		const state = await this.getState();
		if (!state.activeRunId || !state.projectId || !state.sessionId) {
			return;
		}
		if (state.canceledRunIds?.includes(state.activeRunId)) {
			return;
		}
		if (await this.isRunCanceled(state.activeRunId)) {
			await this.clearCanceledRun(state);
			return;
		}

		const db = createDb(this.env);
		await db.batch([
			db
				.update(agentRuns)
				.set({
					status,
					finishedAt: sql`(unixepoch())`,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(agentRuns.id, state.activeRunId)),
			db
				.update(projects)
				.set({
					activeAgentRunId: null,
					activeAgentRunStartedAt: null,
					updatedAt: sql`(unixepoch())`,
				})
				.where(
					and(
						eq(projects.id, state.projectId),
						eq(projects.activeAgentRunId, state.activeRunId),
					),
				),
			db.insert(agentRunEvents).values({
				runId: state.activeRunId,
				projectId: state.projectId,
				sessionId: state.sessionId,
				type: "done",
				payload: createAgentRunEventPayload({ status }),
			}),
		]);
		this.broadcast({ type: "done", runId: state.activeRunId, status });
		await this.setState({
			...state,
			activeRunId: undefined,
			pendingUiRequestId: undefined,
		});
	}

	private async isRunCanceled(runId: string): Promise<boolean> {
		const [run] = await createDb(this.env)
			.select({ status: agentRuns.status })
			.from(agentRuns)
			.where(eq(agentRuns.id, runId))
			.limit(1);

		return run?.status === "canceled";
	}

	private async clearCanceledRun(state: BrokerState): Promise<void> {
		if (!state.activeRunId) {
			return;
		}

		if (state.projectId) {
			await createDb(this.env)
				.update(projects)
				.set({
					activeAgentRunId: null,
					activeAgentRunStartedAt: null,
					updatedAt: sql`(unixepoch())`,
				})
				.where(
					and(
						eq(projects.id, state.projectId),
						eq(projects.activeAgentRunId, state.activeRunId),
					),
				);
		}

		this.broadcast({
			type: "done",
			runId: state.activeRunId,
			status: "canceled",
		});
		await this.setState({
			...state,
			activeRunId: undefined,
			pendingUiRequestId: undefined,
			canceledRunIds: [...(state.canceledRunIds ?? []), state.activeRunId],
		});
	}

	private async insertEvent(
		type: typeof agentRunEvents.$inferInsert.type,
		payload: Record<string, unknown>,
	): Promise<void> {
		const state = await this.getState();
		if (!state.activeRunId || !state.projectId || !state.sessionId) {
			return;
		}

		await createDb(this.env)
			.insert(agentRunEvents)
			.values({
				runId: state.activeRunId,
				projectId: state.projectId,
				sessionId: state.sessionId,
				type,
				payload: createAgentRunEventPayload(payload),
			});
	}

	private async emitWorkspaceChanges(): Promise<void> {
		const state = await this.getState();
		if (!state.sandboxId) {
			return;
		}

		const sandbox = getProjectSandbox(this.env, state.sandboxId);
		const session = await sandbox.createSession({
			id: state.sessionId,
			cwd: WORKSPACE_PATH,
		});
		const result = await session.exec("git status --short", {
			cwd: WORKSPACE_PATH,
			timeout: COMMAND_TIMEOUT_MS,
		});

		if (!result.success || !result.stdout.trim()) {
			return;
		}

		const paths = result.stdout
			.split("\n")
			.map((line) => line.slice(3).trim())
			.filter(Boolean)
			.slice(0, 20);

		for (const path of paths) {
			await this.insertEvent("file_changed", { path });
		}

		await this.insertEvent("diff_ready", {
			changedFiles: paths.length,
			truncated:
				result.stdout.split("\n").filter(Boolean).length > paths.length,
		});
	}

	private async acceptSocket(): Promise<Response> {
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
		const attachment: BrokerSocketAttachment = { connectedAt: Date.now() };

		server.serializeAttachment(attachment);
		this.ctx.acceptWebSocket(server);
		this.sockets.set(server, attachment);
		this.sendFrame(server, {
			type: "snapshot",
			state: await this.getState(),
		});
		const state = await this.getState();
		if (state.sessionId && state.piProcessId) {
			void this.startLogStream(state.sessionId, state.piProcessId).catch((error) =>
				this.handlePiFailure(error),
			);
		}

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	private async getState(): Promise<BrokerState> {
		return (await this.ctx.storage.get<BrokerState>(BROKER_STATE_KEY)) ?? {};
	}

	private async setState(state: BrokerState): Promise<void> {
		await this.ctx.storage.put(BROKER_STATE_KEY, state);
		this.broadcast({ type: "snapshot", state });
	}

	private broadcast(frame: WorkspaceSessionBrokerFrame): void {
		for (const socket of this.sockets.keys()) {
			this.sendFrame(socket, frame);
		}
	}

	private sendFrame(
		socket: WebSocket,
		frame: WorkspaceSessionBrokerFrame,
	): void {
		socket.send(JSON.stringify(frame));
	}
}

function isBrokerSocketAttachment(
	value: unknown,
): value is BrokerSocketAttachment {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as BrokerSocketAttachment).connectedAt === "number"
	);
}
