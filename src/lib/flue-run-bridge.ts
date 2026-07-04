import { DurableObject } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "#/db";
import { agentRunEvents, agentRuns, projects } from "#/db/schema";
import { AssistantStreamDraft } from "#/lib/assistant-stream-draft";
import {
	createFlueDispatchAdapter,
	createServiceBindingDispatchFetch,
	createServiceBindingStreamFetch,
	type FlueStreamPollResult,
	PROJECT_CODER_AGENT_NAME,
} from "#/lib/flue-dispatch-adapter";
import {
	type FlueEventInput,
	type FlueProjectedEvent,
	mapFlueEventToDittoEvents,
} from "#/lib/flue-event-projection";
import { createAgentRunEventPayload } from "#/lib/workspace-policy";
import type { WorkspaceSessionBrokerFrame } from "#/lib/workspace-session-broker";

export type FlueRunBridgeState = {
	sessionId?: string;
	userId?: string;
	projectId?: string;
	sandboxId?: string;
	activeRunId?: string;
	flueAgentName?: string;
	flueAgentInstanceId?: string;
	flueStreamPath?: string;
	streamOffset?: string;
	streamCursor?: string | null;
	streamClosed?: boolean;
	canceledRunIds?: string[];
	isMutating?: boolean;
	fencingToken?: number;
};

type FlueRunBridgeSocketAttachment = {
	connectedAt: number;
};

type StartRequest = {
	sessionId: string;
	userId: string;
	projectId: string;
	sandboxId: string;
	runId: string;
	message: string;
	modelSpecifier: string;
} & (
	| { isMutating: false; fencingToken?: never }
	| { isMutating: true; fencingToken: number }
);

type AbortRequest = {
	runId: string;
};

type TerminalStatus = "completed" | "failed";
type DoneStatus = TerminalStatus | "canceled";

export type TerminalEventInput = {
	runId: string;
	projectId: string;
	sessionId: string;
	assistantText: string | null;
	status: TerminalStatus;
};

const FLUE_RUN_BRIDGE_STATE_KEY = "flue-run-bridge-state";

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
	if (input.isMutating !== false && input.isMutating !== true) {
		throw new Error("Invalid mutating mode.");
	}
	if (input.isMutating === true && typeof input.fencingToken !== "number") {
		throw new Error("Mutating Flue runs require a fencing token.");
	}

	const base = {
		sessionId: requireString(input, "sessionId"),
		userId: requireString(input, "userId"),
		projectId: requireString(input, "projectId"),
		sandboxId: requireString(input, "sandboxId"),
		runId: requireString(input, "runId"),
		message: requireString(input, "message"),
		modelSpecifier: requireString(input, "modelSpecifier"),
	};

	return input.isMutating === true
		? {
				...base,
				isMutating: true,
				fencingToken: input.fencingToken as number,
			}
		: { ...base, isMutating: false };
}

function parseAbortRequest(value: unknown): AbortRequest {
	if (!value || typeof value !== "object") {
		throw new Error("Invalid abort request.");
	}

	const input = value as Record<string, unknown>;
	return { runId: requireString(input, "runId") };
}

function isFlueEventInput(value: unknown): value is FlueEventInput {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as FlueEventInput).type === "string"
	);
}

export function createFlueAgentInstanceId(
	projectId: string,
	sandboxId: string,
): string {
	if (!projectId.trim()) {
		throw new Error("Missing projectId.");
	}
	if (!sandboxId.trim()) {
		throw new Error("Missing sandboxId.");
	}

	return `${projectId}:${sandboxId}`;
}

export function applyFlueStreamCursor(
	state: FlueRunBridgeState,
	pollResult: Pick<FlueStreamPollResult, "nextOffset" | "cursor" | "closed">,
): FlueRunBridgeState {
	return {
		...state,
		streamOffset: pollResult.nextOffset,
		streamCursor: pollResult.cursor,
		streamClosed: pollResult.closed,
	};
}

export function shouldResumeFlueStream(
	state: FlueRunBridgeState,
): state is FlueRunBridgeState & {
	activeRunId: string;
	flueAgentName: string;
	flueAgentInstanceId: string;
} {
	return Boolean(
		state.activeRunId &&
			state.flueAgentName &&
			state.flueAgentInstanceId &&
			state.streamClosed !== true &&
			state.canceledRunIds?.includes(state.activeRunId) !== true,
	);
}

export function shouldIgnoreFlueRunEvent(
	state: FlueRunBridgeState,
	runId: string,
	canceledStatuses: readonly string[],
): boolean {
	return (
		state.activeRunId !== runId ||
		state.canceledRunIds?.includes(runId) === true ||
		canceledStatuses.includes(runId)
	);
}

export function buildTerminalEvents(input: TerminalEventInput): Array<{
	runId: string;
	projectId: string;
	sessionId: string;
	type: "message" | "done";
	payload: string;
}> {
	return [
		...(input.assistantText
			? [
					{
						runId: input.runId,
						projectId: input.projectId,
						sessionId: input.sessionId,
						type: "message" as const,
						payload: createAgentRunEventPayload({
							role: "assistant",
							text: input.assistantText,
						}),
					},
				]
			: []),
		{
			runId: input.runId,
			projectId: input.projectId,
			sessionId: input.sessionId,
			type: "done",
			payload: createAgentRunEventPayload({ status: input.status }),
		},
	];
}

export class FlueRunBridge extends DurableObject<Env> {
	private sockets = new Map<WebSocket, FlueRunBridgeSocketAttachment>();
	private assistantDraft = new AssistantStreamDraft();
	private consumingRunId: string | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair("ping", "pong"),
		);

		for (const socket of this.ctx.getWebSockets()) {
			const attachment = socket.deserializeAttachment();
			this.sockets.set(
				socket,
				isFlueRunBridgeSocketAttachment(attachment)
					? attachment
					: { connectedAt: Date.now() },
			);
		}

		this.ctx.waitUntil(this.resumeFlueStreamIfNeeded("constructor"));
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
						error instanceof Error
							? error.message
							: "Flue run bridge request failed.",
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
		this.assistantDraft.clear(input.runId);
		const flueAgentInstanceId = createFlueAgentInstanceId(
			input.projectId,
			input.sandboxId,
		);
		const nextState: FlueRunBridgeState = {
			...(await this.getState()),
			sessionId: input.sessionId,
			userId: input.userId,
			projectId: input.projectId,
			sandboxId: input.sandboxId,
			activeRunId: input.runId,
			flueAgentName: PROJECT_CODER_AGENT_NAME,
			flueAgentInstanceId,
			flueStreamPath: undefined,
			streamCursor: null,
			streamClosed: false,
			isMutating: input.isMutating,
			fencingToken:
				input.isMutating === true ? input.fencingToken : undefined,
		};
		await this.setState(nextState);

		try {
			const adapter = this.createAdapter();
			const receipt =
				input.isMutating === true
					? await adapter.dispatchMutatingProjectRun({
							projectId: input.projectId,
							sessionId: input.sessionId,
							runId: input.runId,
							userId: input.userId,
							sandboxId: input.sandboxId,
							message: input.message,
							modelSpecifier: input.modelSpecifier,
							fencingToken: input.fencingToken,
						})
					: await adapter.dispatch({
							agentName: PROJECT_CODER_AGENT_NAME,
							agentInstanceId: flueAgentInstanceId,
							message: input.message,
						});

			await createDb(this.env)
				.update(agentRuns)
				.set({
					flueAgentName: receipt.agentName,
					flueAgentInstanceId: receipt.agentInstanceId,
					...(receipt.submissionId
						? { flueSubmissionId: receipt.submissionId }
						: {}),
					flueStreamOffset: receipt.streamOffset,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(agentRuns.id, input.runId));

			await this.setState({
				...(await this.getState()),
				flueAgentName: receipt.agentName,
				flueAgentInstanceId: receipt.agentInstanceId,
				flueStreamPath: new URL(receipt.streamUrl, "https://flue.internal")
					.pathname,
				streamOffset: receipt.streamOffset,
			});
			await this.resumeFlueStreamIfNeeded("start");
		} catch (error) {
			await this.failRunAfterDispatchError(
				input,
				error instanceof Error ? error.message : "Flue dispatch failed.",
			);
		}
	}

	private async abort(input: AbortRequest): Promise<void> {
		const state = await this.getState();
		const nextState: FlueRunBridgeState = {
			...state,
			activeRunId:
				state.activeRunId === input.runId ? undefined : state.activeRunId,
			canceledRunIds: [...(state.canceledRunIds ?? []), input.runId],
		};
		await this.setState(nextState);

		if (state.activeRunId === input.runId && state.projectId) {
			await this.notifyProjectCoordinator(
				state.projectId,
				input.runId,
				"canceled",
			);
		}

		this.broadcast({ type: "done", runId: input.runId, status: "canceled" });
	}

	private async resumeFlueStreamIfNeeded(
		_reason: "constructor" | "socket" | "start",
	): Promise<void> {
		const state = await this.getState();
		if (!shouldResumeFlueStream(state)) {
			return;
		}
		if (this.consumingRunId === state.activeRunId) {
			return;
		}

		const runId = state.activeRunId;
		this.consumingRunId = runId;
		this.ctx.waitUntil(
			this.consumeFlueStream(runId).finally(() => {
				if (this.consumingRunId === runId) {
					this.consumingRunId = null;
				}
			}),
		);
	}

	private async consumeFlueStream(runId: string): Promise<void> {
		const adapter = this.createAdapter();

		while (true) {
			const state = await this.getState();
			if (shouldIgnoreFlueRunEvent(state, runId, [])) {
				return;
			}
			if (!state.flueAgentName || !state.flueAgentInstanceId) {
				return;
			}
			if (await this.isRunCanceled(runId)) {
				await this.clearCanceledRun(state, runId);
				return;
			}

			const pollResult = state.flueStreamPath
				? await adapter.pollStreamPath({
						streamPath: state.flueStreamPath,
						offset: state.streamOffset ?? "0",
						cursor: state.streamCursor,
					})
				: await adapter.poll({
						agentName: state.flueAgentName,
						agentInstanceId: state.flueAgentInstanceId,
						offset: state.streamOffset ?? "0",
						cursor: state.streamCursor,
					});
			await this.setState(applyFlueStreamCursor(state, pollResult));
			await persistFlueStreamOffset(
				this.env,
				runId,
				state.streamOffset,
				pollResult.nextOffset,
			);

			for (const event of pollResult.events) {
				const latestState = await this.getState();
				if (shouldIgnoreFlueRunEvent(latestState, runId, [])) {
					return;
				}
				if (await this.isRunCanceled(runId)) {
					await this.clearCanceledRun(latestState, runId);
					return;
				}
				if (!isFlueEventInput(event)) {
					continue;
				}

				const projection = mapFlueEventToDittoEvents(event);
				if (projection.assistantDelta) {
					this.assistantDraft.append(runId, projection.assistantDelta);
					this.broadcast({
						type: "assistant_delta",
						runId,
						text: projection.assistantDelta,
					});
				}

				if (projection.events.length > 0) {
					await this.insertProjectedEvents(runId, projection.events);
				}

				for (const frame of projection.frames) {
					if (frame.type === "assistant_delta" && !projection.assistantDelta) {
						this.broadcast({
							type: "assistant_delta",
							runId,
							text: frame.text,
						});
					} else if (frame.type === "tool_progress") {
						this.broadcast({ type: "tool_progress", runId, text: frame.text });
					} else if (frame.type === "error") {
						this.broadcast({ type: "error", message: frame.message });
					}
				}

				if (projection.terminalStatus) {
					await this.finishRun(runId, projection.terminalStatus);
					return;
				}
			}

			if (pollResult.closed) {
				await this.finishRun(runId, "completed");
				return;
			}
		}
	}

	private async finishRun(
		runId: string,
		status: TerminalStatus,
	): Promise<void> {
		const state = await this.getState();
		if (
			shouldIgnoreFlueRunEvent(state, runId, []) ||
			!state.projectId ||
			!state.sessionId
		) {
			return;
		}
		if (await this.isRunCanceled(runId)) {
			await this.clearCanceledRun(state, runId);
			return;
		}

		const assistantText = this.assistantDraft.consume(runId);
		const db = createDb(this.env);
		await db.batch([
			db
				.update(agentRuns)
				.set({
					status,
					finishedAt: sql`(unixepoch())`,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(agentRuns.id, runId)),
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
						eq(projects.activeAgentRunId, runId),
					),
				),
			db.insert(agentRunEvents).values(
				buildTerminalEvents({
					runId,
					projectId: state.projectId,
					sessionId: state.sessionId,
					assistantText,
					status,
				}),
			),
		]);

		await this.notifyProjectCoordinator(state.projectId, runId, status);
		this.broadcast({ type: "done", runId, status });
		await this.setState({
			...state,
			activeRunId: undefined,
			isMutating: undefined,
			fencingToken: undefined,
			streamCursor: undefined,
			streamClosed: undefined,
		});
	}

	private async failRunAfterDispatchError(
		input: StartRequest,
		message: string,
	): Promise<void> {
		const db = createDb(this.env);
		await db.batch([
			db
				.update(agentRuns)
				.set({
					status: "failed",
					finishedAt: sql`(unixepoch())`,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(agentRuns.id, input.runId)),
			db.insert(agentRunEvents).values([
				{
					runId: input.runId,
					projectId: input.projectId,
					sessionId: input.sessionId,
					type: "error",
					payload: createAgentRunEventPayload({ message }),
				},
				{
					runId: input.runId,
					projectId: input.projectId,
					sessionId: input.sessionId,
					type: "done",
					payload: createAgentRunEventPayload({ status: "failed" }),
				},
			]),
		]);

		await this.notifyProjectCoordinator(input.projectId, input.runId, "failed");
		this.broadcast({ type: "done", runId: input.runId, status: "failed" });
		await this.setState({
			...(await this.getState()),
			activeRunId: undefined,
			isMutating: undefined,
			fencingToken: undefined,
			streamCursor: undefined,
			streamClosed: undefined,
		});
	}

	private async clearCanceledRun(
		state: FlueRunBridgeState,
		runId: string,
	): Promise<void> {
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
						eq(projects.activeAgentRunId, runId),
					),
				);
			await this.notifyProjectCoordinator(state.projectId, runId, "canceled");
		}

		this.broadcast({ type: "done", runId, status: "canceled" });
		await this.setState({
			...state,
			activeRunId: undefined,
			isMutating: undefined,
			fencingToken: undefined,
			streamCursor: undefined,
			streamClosed: undefined,
			canceledRunIds: [...(state.canceledRunIds ?? []), runId],
		});
	}

	private async insertProjectedEvents(
		runId: string,
		events: FlueProjectedEvent[],
	): Promise<void> {
		const state = await this.getState();
		if (
			shouldIgnoreFlueRunEvent(state, runId, []) ||
			!state.projectId ||
			!state.sessionId ||
			(await this.isRunCanceled(runId))
		) {
			return;
		}

		await createDb(this.env)
			.insert(agentRunEvents)
			.values(
				events.map((event) => ({
					runId,
					projectId: state.projectId as string,
					sessionId: state.sessionId as string,
					type: event.type,
					payload: event.payload,
				})),
			);
	}

	private async isRunCanceled(runId: string): Promise<boolean> {
		const [run] = await createDb(this.env)
			.select({ status: agentRuns.status })
			.from(agentRuns)
			.where(eq(agentRuns.id, runId))
			.limit(1);

		return run?.status === "canceled";
	}

	private createAdapter() {
		return createFlueDispatchAdapter({
			dispatchFetch: createServiceBindingDispatchFetch(this.env.FLUE_WORKER),
			streamFetch: createServiceBindingStreamFetch(this.env.FLUE_WORKER),
		});
	}

	private async notifyProjectCoordinator(
		projectId: string,
		runId: string,
		status: DoneStatus,
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

	private async acceptSocket(): Promise<Response> {
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
		const attachment: FlueRunBridgeSocketAttachment = {
			connectedAt: Date.now(),
		};

		server.serializeAttachment(attachment);
		this.ctx.acceptWebSocket(server);
		this.sockets.set(server, attachment);
		this.sendFrame(server, {
			type: "snapshot",
			state: await this.getState(),
		});
		await this.resumeFlueStreamIfNeeded("socket");

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	private async getState(): Promise<FlueRunBridgeState> {
		return (
			(await this.ctx.storage.get<FlueRunBridgeState>(
				FLUE_RUN_BRIDGE_STATE_KEY,
			)) ?? {}
		);
	}

	private async setState(state: FlueRunBridgeState): Promise<void> {
		await this.ctx.storage.put(FLUE_RUN_BRIDGE_STATE_KEY, state);
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

export async function persistFlueStreamOffset(
	env: Env,
	runId: string,
	currentOffset: string | undefined,
	nextOffset: string,
): Promise<void> {
	if (currentOffset === nextOffset) {
		return;
	}

	await createDb(env)
		.update(agentRuns)
		.set({
			flueStreamOffset: nextOffset,
			updatedAt: sql`(unixepoch())`,
		})
		.where(eq(agentRuns.id, runId));
}

function isFlueRunBridgeSocketAttachment(
	value: unknown,
): value is FlueRunBridgeSocketAttachment {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as FlueRunBridgeSocketAttachment).connectedAt === "number"
	);
}
