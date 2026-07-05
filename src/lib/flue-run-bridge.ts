import { DurableObject } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "#/db";
import {
	agentRunEvents,
	agentRuns,
	projects,
	runArtifacts,
	snapshots,
} from "#/db/schema";
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
import {
	buildDiffReadyPayload,
	buildRunDiffArtifactPlan,
	MAX_RUN_DIFF_ARTIFACT_BYTES,
	parseChangedFilesFromGitStatus,
} from "#/lib/run-diff-artifact";
import {
	buildSnapshotCheckpointPlan,
	checkpointPointerAfterR2Write,
	computeWorkspaceDigest,
} from "#/lib/run-snapshot-checkpoint";
import { serializeSandboxBackup } from "#/lib/sandbox-backup";
import {
	backupSandboxWorkspace,
	getProjectSandbox,
} from "#/lib/sandbox-bootstrap";
import { redactSecrets } from "#/lib/secret-redaction";
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

type RunDiffArtifactInsert = {
	runId: string;
	projectId: string;
	kind: "diff";
	r2Key: string;
	contentType: string;
	byteLength: number;
};

type RunDiffArtifactResult = {
	artifactInsert: RunDiffArtifactInsert | null;
	diffReadyEvent: FlueProjectedEvent | null;
};

const FLUE_RUN_BRIDGE_STATE_KEY = "flue-run-bridge-state";
const FINAL_CHANGE_SUMMARY_TIMEOUT_MS = 15_000;
const FINAL_CHANGE_SUMMARY_MAX_LENGTH = 4000;
const FINAL_CHANGE_SUMMARY_TRUNCATION_MARKER = "\n...[truncated]";
const PERIODIC_CHECKPOINT_INTERVAL_MS = 120_000;
const RUN_DIFF_ARTIFACT_TIMEOUT_MS = 15_000;
const RUN_DIFF_GIT_DIFF_COMMAND =
	"git diff --no-ext-diff --find-renames --binary -- . ':(exclude).env' ':(exclude).env.*' ':(exclude)**/.env' ':(exclude)**/.env.*' ':(exclude).npmrc' ':(exclude)**/.npmrc'";

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

export function buildFinalChangeSummaryEvent(input: {
	status: TerminalStatus;
	summary: string;
}): FlueProjectedEvent {
	return {
		type: "tool_finished",
		payload: createAgentRunEventPayload({
			toolName: "final_change_summary",
			status: input.status,
			result: compactFinalChangeSummary(input.summary),
		}),
	};
}

function compactFinalChangeSummary(value: string): string {
	const redacted = redactSecrets(value).trim();
	if (redacted.length <= FINAL_CHANGE_SUMMARY_MAX_LENGTH) {
		return redacted;
	}

	return `${redacted.slice(
		0,
		FINAL_CHANGE_SUMMARY_MAX_LENGTH -
			FINAL_CHANGE_SUMMARY_TRUNCATION_MARKER.length,
	)}${FINAL_CHANGE_SUMMARY_TRUNCATION_MARKER}`;
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

	async alarm(): Promise<void> {
		const state = await this.getState();
		const runId = state.activeRunId;
		if (!runId) {
			return;
		}

		await this.checkpointPeriodicMutatingRun(state, runId);

		const latestState = await this.getState();
		if (await this.shouldArmPeriodicCheckpointAlarm(latestState, runId)) {
			await this.armPeriodicCheckpointAlarm();
		}
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
			fencingToken: input.isMutating === true ? input.fencingToken : undefined,
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
			if (input.isMutating === true) {
				await this.armPeriodicCheckpointAlarm();
			}
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
		if (state.activeRunId === input.runId) {
			await this.clearPeriodicCheckpointAlarm();
		}

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
		await this.clearPeriodicCheckpointAlarm();

		const assistantText = this.assistantDraft.consume(runId);
		const finalChangeSummaryEvents = await this.buildFinalChangeSummaryEvents(
			state,
			status,
		);
		const diffArtifact = await this.buildRunDiffArtifactEvents(
			state,
			runId,
			status,
		);
		const terminalEvents = buildTerminalEvents({
			runId,
			projectId: state.projectId,
			sessionId: state.sessionId,
			assistantText,
			status,
		});
		const doneEvent = terminalEvents.at(-1);
		try {
			await this.checkpointMutatingRun(
				state as FlueRunBridgeState & {
					sandboxId: string;
					projectId: string;
					sessionId: string;
				},
				runId,
				status,
				{ periodic: false },
			);
		} catch {
			// checkpoint failure must not prevent terminal batch
		}
		const db = createDb(this.env);
		const terminalEventRows = [
			...terminalEvents.slice(0, -1),
			...finalChangeSummaryEvents,
			...(diffArtifact.diffReadyEvent ? [diffArtifact.diffReadyEvent] : []),
			...(doneEvent ? [doneEvent] : []),
		].map((event) => ({
			runId,
			projectId: state.projectId as string,
			sessionId: state.sessionId as string,
			type: event.type,
			payload: event.payload,
		}));
		const updateRunStatus = db
			.update(agentRuns)
			.set({
				status,
				finishedAt: sql`(unixepoch())`,
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(agentRuns.id, runId));
		const clearActiveRun = db
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
		const insertTerminalEvents = db
			.insert(agentRunEvents)
			.values(terminalEventRows);
		if (diffArtifact.artifactInsert) {
			await db.batch([
				updateRunStatus,
				clearActiveRun,
				insertTerminalEvents,
				db.insert(runArtifacts).values(diffArtifact.artifactInsert),
			]);
		} else {
			await db.batch([updateRunStatus, clearActiveRun, insertTerminalEvents]);
		}

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
		await this.clearPeriodicCheckpointAlarm();
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

	private async buildFinalChangeSummaryEvents(
		state: FlueRunBridgeState,
		status: TerminalStatus,
	): Promise<FlueProjectedEvent[]> {
		if (state.isMutating !== true || !state.sandboxId) {
			return [];
		}

		try {
			const sandbox = getProjectSandbox(this.env, state.sandboxId);
			const [gitStatus, diffStat] = await Promise.all([
				sandbox.exec("git status --short", {
					cwd: "/workspace",
					timeout: FINAL_CHANGE_SUMMARY_TIMEOUT_MS,
				}),
				sandbox.exec("git diff --stat", {
					cwd: "/workspace",
					timeout: FINAL_CHANGE_SUMMARY_TIMEOUT_MS,
				}),
			]);

			return [
				buildFinalChangeSummaryEvent({
					status,
					summary: [
						"git status --short:",
						gitStatus.stdout || "[no output]",
						gitStatus.stderr ? `stderr:\n${gitStatus.stderr}` : "",
						"",
						"git diff --stat:",
						diffStat.stdout || "[no output]",
						diffStat.stderr ? `stderr:\n${diffStat.stderr}` : "",
					]
						.filter((line) => line !== "")
						.join("\n"),
				}),
			];
		} catch (error) {
			return [
				buildFinalChangeSummaryEvent({
					status: "failed",
					summary:
						error instanceof Error
							? `Final change summary failed: ${error.message}`
							: "Final change summary failed.",
				}),
			];
		}
	}

	private async buildRunDiffArtifactEvents(
		state: FlueRunBridgeState,
		runId: string,
		status: TerminalStatus,
	): Promise<RunDiffArtifactResult> {
		const empty: RunDiffArtifactResult = {
			artifactInsert: null,
			diffReadyEvent: null,
		};
		if (
			state.isMutating !== true ||
			status !== "completed" ||
			!state.sandboxId ||
			!state.projectId ||
			!state.sessionId
		) {
			return empty;
		}

		try {
			const sandbox = getProjectSandbox(this.env, state.sandboxId);
			const [gitStatus, gitDiff] = await Promise.all([
				sandbox.exec("git status --short", {
					cwd: "/workspace",
					timeout: RUN_DIFF_ARTIFACT_TIMEOUT_MS,
				}),
				sandbox.exec(RUN_DIFF_GIT_DIFF_COMMAND, {
					cwd: "/workspace",
					timeout: RUN_DIFF_ARTIFACT_TIMEOUT_MS,
				}),
			]);

			const changedFiles = parseChangedFilesFromGitStatus(
				gitStatus.stdout || "",
			);
			const redactedPatch = redactSecrets(gitDiff.stdout || "");
			const plan = buildRunDiffArtifactPlan({
				projectId: state.projectId,
				runId,
				artifactId: crypto.randomUUID(),
				patch: redactedPatch,
			});

			if (redactedPatch.trim() === "") {
				return {
					artifactInsert: null,
					diffReadyEvent: {
						type: "diff_ready",
						payload: createAgentRunEventPayload(
							buildDiffReadyPayload({
								changedFiles,
								hasArtifact: false,
							}),
						),
					},
				};
			}

			if (plan.byteLength > MAX_RUN_DIFF_ARTIFACT_BYTES) {
				return {
					artifactInsert: null,
					diffReadyEvent: {
						type: "diff_ready",
						payload: createAgentRunEventPayload(
							buildDiffReadyPayload({
								changedFiles,
								byteLength: plan.byteLength,
								truncated: true,
								hasArtifact: false,
							}),
						),
					},
				};
			}

			await this.env.BACKUP_BUCKET.put(plan.r2Key, redactedPatch);

			return {
				artifactInsert: {
					runId,
					projectId: state.projectId,
					kind: "diff",
					r2Key: plan.r2Key,
					contentType: plan.contentType,
					byteLength: plan.byteLength,
				},
				diffReadyEvent: {
					type: "diff_ready",
					payload: createAgentRunEventPayload(
						buildDiffReadyPayload({
							artifactId: plan.artifactId,
							changedFiles,
							byteLength: plan.byteLength,
							contentType: plan.contentType,
							hasArtifact: true,
						}),
					),
				},
			};
		} catch (error) {
			const reason =
				error instanceof Error ? error.message : "Run diff artifact failed.";
			return {
				artifactInsert: null,
				diffReadyEvent: {
					type: "diff_ready",
					payload: createAgentRunEventPayload(
						buildDiffReadyPayload({
							changedFiles: [],
							hasArtifact: false,
							error: redactSecrets(reason),
						}),
					),
				},
			};
		}
	}

	private async checkpointMutatingRun(
		state: FlueRunBridgeState & {
			sandboxId: string;
			projectId: string;
			sessionId: string;
		},
		runId: string,
		status: TerminalStatus,
		options: { periodic?: boolean } = {},
	): Promise<void> {
		if (state.isMutating !== true || status !== "completed") {
			return;
		}

		const db = createDb(this.env);
		const periodic = options.periodic === true;

		try {
			await db.insert(agentRunEvents).values({
				runId,
				projectId: state.projectId,
				sessionId: state.sessionId,
				type: "snapshot_started",
				payload: createAgentRunEventPayload(periodic ? { periodic } : {}),
			});
			this.broadcast({
				type: "tool_progress",
				runId,
				text: "snapshot_started",
			});

			const directoryBackup = await backupSandboxWorkspace({
				env: this.env,
				sandboxId: state.sandboxId,
				projectId: state.projectId,
			});

			const sandbox = getProjectSandbox(this.env, state.sandboxId);
			const revParse = await sandbox.exec("git rev-parse HEAD", {
				cwd: "/workspace",
				timeout: 10_000,
			});
			const baseCommitSha = revParse.success
				? redactSecrets(revParse.stdout.trim()) || null
				: null;

			const [gitStatus, diffStat] = await Promise.all([
				sandbox.exec("git status --short", {
					cwd: "/workspace",
					timeout: FINAL_CHANGE_SUMMARY_TIMEOUT_MS,
				}),
				sandbox.exec("git diff --stat", {
					cwd: "/workspace",
					timeout: FINAL_CHANGE_SUMMARY_TIMEOUT_MS,
				}),
			]);

			const digest = await computeWorkspaceDigest({
				baseCommitSha,
				gitStatusShort: gitStatus.stdout || "",
				gitDiffStat: diffStat.stdout || "",
			});

			const snapshotId = crypto.randomUUID();
			const plan = buildSnapshotCheckpointPlan({
				projectId: state.projectId,
				runId,
				baseCommitSha,
				digest,
				createdAt: new Date().toISOString(),
				snapshotId,
				archiveRef: directoryBackup.id,
			});

			await this.env.BACKUP_BUCKET.put(
				plan.manifestKey,
				JSON.stringify(plan.manifest),
			);

			const pointer = checkpointPointerAfterR2Write({ ok: true }, plan);
			if (pointer.updateD1) {
				await db.batch([
					db.insert(snapshots).values({
						id: snapshotId,
						projectId: state.projectId,
						runId,
						r2Key: pointer.pointer.r2Key,
						baseCommitSha,
						digest: pointer.pointer.digest,
						status: "completed",
						completedAt: sql`(unixepoch())`,
					}),
					db
						.update(projects)
						.set({
							sandboxBackup: serializeSandboxBackup(directoryBackup),
							sandboxBackupCreatedAt: sql`(unixepoch())`,
							updatedAt: sql`(unixepoch())`,
						})
						.where(eq(projects.id, state.projectId)),
					db.insert(agentRunEvents).values({
						runId,
						projectId: state.projectId,
						sessionId: state.sessionId,
						type: "snapshot_completed",
						payload: createAgentRunEventPayload({
							snapshotId,
							digest,
							...(periodic ? { periodic } : {}),
						}),
					}),
				]);
				this.broadcast({
					type: "tool_progress",
					runId,
					text: "snapshot_completed",
				});
			}
		} catch (error) {
			const reason =
				error instanceof Error ? error.message : "Unknown checkpoint error";
			await db.insert(agentRunEvents).values({
				runId,
				projectId: state.projectId,
				sessionId: state.sessionId,
				type: "snapshot_failed",
				payload: createAgentRunEventPayload({
					reason: redactSecrets(reason),
					...(periodic ? { periodic } : {}),
				}),
			});
			this.broadcast({
				type: "tool_progress",
				runId,
				text: "snapshot_failed",
			});
		}
	}

	private async checkpointPeriodicMutatingRun(
		state: FlueRunBridgeState,
		runId: string,
	): Promise<void> {
		if (
			state.activeRunId !== runId ||
			state.isMutating !== true ||
			state.canceledRunIds?.includes(runId) === true ||
			!state.sandboxId ||
			!state.projectId ||
			!state.sessionId ||
			(await this.isRunCanceled(runId))
		) {
			return;
		}

		await this.checkpointMutatingRun(
			state as FlueRunBridgeState & {
				sandboxId: string;
				projectId: string;
				sessionId: string;
			},
			runId,
			"completed",
			{ periodic: true },
		);
	}

	private async shouldArmPeriodicCheckpointAlarm(
		state: FlueRunBridgeState,
		runId: string,
	): Promise<boolean> {
		return (
			state.activeRunId === runId &&
			state.isMutating === true &&
			state.canceledRunIds?.includes(runId) !== true &&
			(await this.isRunCanceled(runId)) === false
		);
	}

	private async armPeriodicCheckpointAlarm(): Promise<void> {
		await this.ctx.storage.setAlarm(
			Date.now() + PERIODIC_CHECKPOINT_INTERVAL_MS,
		);
	}

	private async clearPeriodicCheckpointAlarm(): Promise<void> {
		await this.ctx.storage.deleteAlarm();
	}

	private async clearCanceledRun(
		state: FlueRunBridgeState,
		runId: string,
	): Promise<void> {
		await this.clearPeriodicCheckpointAlarm();
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
