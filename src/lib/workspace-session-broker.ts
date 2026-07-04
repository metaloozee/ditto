import { DurableObject } from "cloudflare:workers";
import type { ExecutionSession, LogEvent } from "@cloudflare/sandbox";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "#/db";
import { agentRunEvents, agentRuns, projects } from "#/db/schema";
import { AssistantStreamDraft } from "#/lib/assistant-stream-draft";
import type { ProjectCoordinatorTerminalStatus } from "#/lib/project-coordinator";
import { clearProjectLockProjection } from "#/lib/project-lock-projection";
import {
	type RunnerCommand,
	type RunnerEvent,
	RunnerEventBuffer,
} from "#/lib/runner-protocol";
import {
	type RunnerSandboxFactory,
	RunnerSupervisor,
} from "#/lib/runner-supervisor";
import { serializeSandboxBackup } from "#/lib/sandbox-backup";
import {
	backupSandboxWorkspace,
	getProjectSandbox,
} from "#/lib/sandbox-bootstrap";
import {
	createAgentRunEventPayload,
	WORKSPACE_PATH,
} from "#/lib/workspace-policy";

const getRunnerSandbox: RunnerSandboxFactory = (env, sandboxId) =>
	getProjectSandbox(env, sandboxId) as ReturnType<RunnerSandboxFactory>;

function trimCompact(value: string, maxLength = 2000): string {
	const compact = value.trim();

	if (compact.length <= maxLength) {
		return compact;
	}

	return `${compact.slice(0, maxLength)}\n...[truncated]`;
}

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
	fencingToken?: number;
	runnerProcessId?: string;
	fifoPath?: string;
	pendingInputRequestId?: string;
	canceledRunIds?: string[];
};

type SandboxWithSessions = {
	getSession(sessionId: string): Promise<ExecutionSession>;
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
	fencingToken?: number;
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
const RUNNER_READY_TIMEOUT_MS = 30_000;

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
		fencingToken:
			typeof input.fencingToken === "number" ? input.fencingToken : undefined,
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

async function getSandboxSession(
	sandbox: SandboxWithSessions,
	sessionId: string,
): Promise<ExecutionSession> {
	return await sandbox.getSession(sessionId);
}

export class WorkspaceSessionBroker extends DurableObject<Env> {
	private sockets = new Map<WebSocket, BrokerSocketAttachment>();
	private runnerSupervisor: RunnerSupervisor;
	private runnerEventBuffer = new RunnerEventBuffer();
	private assistantDraft = new AssistantStreamDraft();
	private runnerReady = false;
	private readyPromise: Promise<void> = Promise.resolve();
	private readyResolve: () => void = () => {};

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.runnerSupervisor = new RunnerSupervisor({
			env,
			getSandbox: getRunnerSandbox,
			onLogEvent: (event) => this.handleProcessLogEvent(event),
			onFailure: (error) => this.handleRunnerFailure(error),
		});

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
		this.assistantDraft.clear();
		const state: BrokerState = {
			...(await this.getState()),
			sessionId: input.sessionId,
			userId: input.userId,
			projectId: input.projectId,
			sandboxId: input.sandboxId,
			activeRunId: input.runId,
			isMutating: input.isMutating,
			fencingToken: input.fencingToken,
			pendingInputRequestId: undefined,
		};
		await this.setState(state);
		await this.ensureRunnerProcess(input);
		await this.waitForRunnerReady();
		await this.sendRunnerCommand({
			type: "prompt",
			id: input.runId,
			message: input.message,
		});
	}

	private async reply(input: ReplyRequest): Promise<void> {
		const state = await this.getState();
		if (!state.pendingInputRequestId) {
			throw new Error("No pending input request for this session.");
		}

		await this.sendRunnerCommand({
			type: "reply",
			requestId: state.pendingInputRequestId,
			answer: input.answer,
		});

		await this.setState({ ...state, pendingInputRequestId: undefined });
	}

	private async abort(input: AbortRequest): Promise<void> {
		const state = await this.getState();
		await this.setState({
			...state,
			canceledRunIds: [...(state.canceledRunIds ?? []), input.runId],
		});

		await this.flushAssistantDraft(input.runId);
		await this.sendRunnerCommand({ type: "abort", id: input.runId }).catch(
			() => undefined,
		);
		this.broadcast({ type: "done", runId: input.runId, status: "canceled" });
	}

	private async ensureRunnerProcess(input: StartRequest): Promise<void> {
		const state = await this.getState();
		if (state.runnerProcessId && state.fifoPath) {
			const alive = await this.runnerSupervisor.isAlive(
				state.runnerProcessId,
				state.sandboxId,
			);
			if (alive && state.sandboxId) {
				await this.runnerSupervisor.startLogStream(
					state.sandboxId,
					state.runnerProcessId,
				);
				return;
			}

			await this.cleanupStaleRunner(state);
		}

		this.resetReadyWaiter();

		const runnerProcess = await this.runnerSupervisor.start({
			sessionId: input.sessionId,
			sandboxId: input.sandboxId,
			modelSpecifier: input.modelSpecifier,
		});

		await this.setState({
			...(await this.getState()),
			runnerProcessId: runnerProcess.processId,
			fifoPath: runnerProcess.fifoPath,
		});
	}

	private resetReadyWaiter(): void {
		this.runnerReady = false;
		this.readyPromise = new Promise<void>((resolve) => {
			this.readyResolve = resolve;
		});
	}

	private async cleanupStaleRunner(state: BrokerState): Promise<void> {
		if (state.activeRunId && state.projectId) {
			await this.failRun("Runner process exited unexpectedly.");
		}

		const latestState = await this.getState();
		this.runnerSupervisor.forgetLogStream();
		this.resetReadyWaiter();
		this.assistantDraft.clear();
		await this.setState({
			...latestState,
			runnerProcessId: undefined,
			fifoPath: undefined,
			pendingInputRequestId: undefined,
		});
	}

	private async waitForRunnerReady(): Promise<void> {
		if (this.runnerReady) return;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<"timeout">((resolve) => {
			timeoutId = setTimeout(() => resolve("timeout"), RUNNER_READY_TIMEOUT_MS);
		});
		const result = await Promise.race([
			this.readyPromise.then(() => "ready" as const),
			timeout,
		]);
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		if (result === "timeout") {
			throw new Error(await this.getRunnerReadyTimeoutMessage());
		}
	}

	private async getRunnerReadyTimeoutMessage(): Promise<string> {
		const fallback = "Runner did not become ready in time.";
		const state = await this.getState();
		if (!state.sessionId || !state.sandboxId) {
			return fallback;
		}

		try {
			const diagnostics = await this.runnerSupervisor.readStderrTail({
				sessionId: state.sessionId,
				sandboxId: state.sandboxId,
			});
			return diagnostics
				? `${fallback}\n\nRunner stderr:\n${diagnostics}`
				: fallback;
		} catch {
			return fallback;
		}
	}

	private async handleProcessLogEvent(event: LogEvent): Promise<void> {
		switch (event.type) {
			case "stdout":
				await this.handleRunnerOutput(event.data);
				return;
			case "stderr":
				return;
			case "exit":
				if (event.exitCode && event.exitCode !== 0) {
					await this.handleRunnerFailure(
						new Error(`Runner exited with code ${event.exitCode}.`),
					);
				}
				return;
			case "error":
				await this.handleRunnerFailure(
					new Error(event.data || "Runner log stream reported an error."),
				);
				return;
			default:
				return;
		}
	}

	private async sendRunnerCommand(command: RunnerCommand): Promise<void> {
		const state = await this.getState();
		if (!state.fifoPath || !state.sessionId || !state.sandboxId) {
			throw new Error("Runner process is not ready.");
		}

		await this.runnerSupervisor.sendCommand({
			sessionId: state.sessionId,
			sandboxId: state.sandboxId,
			fifoPath: state.fifoPath,
			command,
		});
	}

	private async handleRunnerOutput(chunk: string): Promise<void> {
		for (const event of this.runnerEventBuffer.push(chunk)) {
			await this.handleRunnerEvent(event);
		}
	}

	private async handleRunnerEvent(event: RunnerEvent): Promise<void> {
		if (event.type === "ready") {
			this.runnerReady = true;
			this.readyResolve();
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
			case "assistant_delta":
				this.assistantDraft.append(runId, event.text);
				this.broadcast({ type: "assistant_delta", runId, text: event.text });
				return;
			case "tool_started":
				await this.insertEvent("tool_started", { toolName: event.toolName });
				return;
			case "tool_progress":
				this.broadcast({
					type: "tool_progress",
					runId,
					text: trimCompact(event.text),
				});
				return;
			case "tool_finished":
				await this.insertEvent("tool_finished", {
					toolName: event.toolName,
					status: event.status,
				});
				await this.emitWorkspaceChanges();
				return;
			case "file_changed":
				await this.insertEvent("file_changed", { path: event.path });
				return;
			case "diff_ready":
				await this.insertEvent("diff_ready", {
					changedFiles: event.changedFiles,
					truncated: event.truncated,
				});
				return;
			case "input_request":
				await this.handleInputRequest(event);
				return;
			case "done":
				if (event.status === "completed") {
					await this.completeRun();
				} else if (event.status === "failed") {
					await this.failRun("Runner reported a failure.");
				}
				return;
			case "error":
				await this.insertEvent("error", {
					reason: trimCompact(event.message),
				});
				return;
		}
	}

	private async handleInputRequest(event: RunnerEvent): Promise<void> {
		if (event.type !== "input_request") return;
		const state = await this.getState();
		if (!state.activeRunId || !state.projectId || !state.sessionId) {
			return;
		}

		const db = createDb(this.env);
		await db.batch([
			db
				.update(agentRuns)
				.set({
					status: "needs_input",
					question: event.question,
					recommendedAnswer: event.placeholder ?? null,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(agentRuns.id, state.activeRunId)),
			db.insert(agentRunEvents).values({
				runId: state.activeRunId,
				projectId: state.projectId,
				sessionId: state.sessionId,
				type: "needs_input",
				payload: createAgentRunEventPayload({
					requestId: event.requestId,
					question: event.question,
					placeholder: event.placeholder,
				}),
			}),
		]);
		await this.setState({ ...state, pendingInputRequestId: event.requestId });
		this.broadcast({
			type: "needs_input",
			runId: state.activeRunId,
			question: event.question,
			requestId: event.requestId,
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

	private async handleRunnerFailure(error: Error): Promise<void> {
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

		const assistantText = this.assistantDraft.consume(state.activeRunId);
		const terminalEvents = [
			...(assistantText
				? [
						{
							runId: state.activeRunId,
							projectId: state.projectId,
							sessionId: state.sessionId,
							type: "message" as const,
							payload: createAgentRunEventPayload({
								role: "assistant",
								text: assistantText,
							}),
						},
					]
				: []),
			{
				runId: state.activeRunId,
				projectId: state.projectId,
				sessionId: state.sessionId,
				type: "done" as const,
				payload: createAgentRunEventPayload({ status }),
			},
		];

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
					...(state.isMutating ? clearProjectLockProjection(new Date()) : {}),
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
			db.insert(agentRunEvents).values(terminalEvents),
		]);
		if (state.isMutating) {
			await this.notifyProjectCoordinator(
				state.projectId,
				state.activeRunId,
				status,
			);
		}
		this.broadcast({ type: "done", runId: state.activeRunId, status });
		await this.setState({
			...state,
			activeRunId: undefined,
			pendingInputRequestId: undefined,
		});
	}

	private async flushAssistantDraft(runId: string): Promise<void> {
		const text = this.assistantDraft.consume(runId);
		if (!text) {
			return;
		}

		await this.insertEvent("message", {
			role: "assistant",
			text,
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
					...(state.isMutating ? clearProjectLockProjection(new Date()) : {}),
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
			if (state.isMutating) {
				await this.notifyProjectCoordinator(
					state.projectId,
					state.activeRunId,
					"canceled",
				);
			}
		}

		this.broadcast({
			type: "done",
			runId: state.activeRunId,
			status: "canceled",
		});
		await this.setState({
			...state,
			activeRunId: undefined,
			pendingInputRequestId: undefined,
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

	private async notifyProjectCoordinator(
		projectId: string,
		runId: string,
		status: ProjectCoordinatorTerminalStatus,
	): Promise<void> {
		const coordinator = this.env.ProjectCoordinator as DurableObjectNamespace;
		const id = coordinator.idFromName(projectId);
		const stub = coordinator.get(id);
		await stub.fetch(
			new Request("https://project-coordinator.internal/terminal", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ projectId, runId, status }),
			}),
		);
	}

	private async emitWorkspaceChanges(): Promise<void> {
		const state = await this.getState();
		if (!state.sandboxId || !state.sessionId) {
			return;
		}

		const sandbox = getProjectSandbox(this.env, state.sandboxId);
		const session = await getSandboxSession(
			sandbox as SandboxWithSessions,
			state.sessionId,
		);
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
		if (state.sandboxId && state.runnerProcessId) {
			void this.runnerSupervisor
				.startLogStream(state.sandboxId, state.runnerProcessId)
				.catch((error: Error) => this.handleRunnerFailure(error));
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
