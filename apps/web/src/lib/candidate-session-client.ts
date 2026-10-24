import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "#/components/ui/toast";
import {
	type CandidateModelsV1,
	type ConfigurationSelectionV1,
	parseCandidateModelsV1,
} from "../../../../packages/runtime-contracts/src/configuration.js";
import {
	type BrowserCommandV2,
	parseReceiptV2,
	type ReceiptV2,
} from "../../../../packages/runtime-contracts/src/product-command.js";
import type {
	ObservationEventV1,
	ObservationSnapshotV1,
	RuntimeObservationV1,
} from "../../../../packages/runtime-contracts/src/projection.js";
import type {
	WorkspaceActionDenial,
	WorkspaceActionKind,
	WorkspaceActionResultV1,
} from "../../../../packages/runtime-contracts/src/workspace-action.js";
import type { ConnectionStatus } from "./codex-credential-do";

export const CANDIDATE_RUNTIME_OWNER = "pi_durable_v1";

export class CandidateRequestError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(status: number, code: string) {
		super(code);
		this.name = "CandidateRequestError";
		this.status = status;
		this.code = code;
	}
}

export function newIdempotencyKey(): string {
	return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function errorFrom(response: Response): Promise<CandidateRequestError> {
	let code = "unknown";
	try {
		const body: unknown = await response.json();
		if (isRecord(body) && typeof body.code === "string") code = body.code;
	} catch {
		// Keep the generic code when the error body is not JSON.
	}
	return new CandidateRequestError(response.status, code);
}

async function postJson(
	path: string,
	payload: string,
	signal?: AbortSignal,
): Promise<Response> {
	return await fetch(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: payload,
		credentials: "include",
		signal,
	});
}

const SUBMIT_RETRIES = 3;

/**
 * A network error or 503 retries with the identical serialized body, so the
 * server sees the same idempotency key and cannot admit the command twice.
 */
export async function submitCandidateCommand(
	body: BrowserCommandV2,
	options: { retryDelayMs?: number } = {},
): Promise<ReceiptV2> {
	const path =
		body.kind === "stop" ? "/api/agent/control" : "/api/agent/stream";
	const payload = JSON.stringify(body);
	const delay = options.retryDelayMs ?? 300;
	let failure: CandidateRequestError | undefined;
	for (let attempt = 0; attempt <= SUBMIT_RETRIES; attempt += 1) {
		if (attempt > 0 && delay > 0) {
			await new Promise((resolve) => setTimeout(resolve, delay * attempt));
		}
		let response: Response;
		try {
			response = await postJson(path, payload);
		} catch {
			failure = new CandidateRequestError(0, "network_error");
			continue;
		}
		if (response.status === 503) {
			failure = await errorFrom(response);
			continue;
		}
		if (response.status !== 202) throw await errorFrom(response);
		try {
			return parseReceiptV2(await response.json());
		} catch {
			throw new CandidateRequestError(502, "invalid_response");
		}
	}
	throw failure ?? new CandidateRequestError(0, "network_error");
}

async function postExpectingOk(path: string, body: unknown): Promise<unknown> {
	let response: Response;
	try {
		response = await postJson(path, JSON.stringify(body));
	} catch {
		throw new CandidateRequestError(0, "network_error");
	}
	if (response.status !== 200) throw await errorFrom(response);
	try {
		return await response.json();
	} catch {
		throw new CandidateRequestError(502, "invalid_response");
	}
}

export async function observeCandidate(input: {
	projectId: string;
	sessionId: string;
	cursor?: number;
}): Promise<RuntimeObservationV1> {
	const body = await postExpectingOk("/api/agent/observe", {
		version: 1,
		...input,
	});
	if (
		!isRecord(body) ||
		body.version !== 1 ||
		typeof body.cursor !== "number" ||
		!Array.isArray(body.events) ||
		typeof body.more !== "boolean"
	) {
		throw new CandidateRequestError(502, "invalid_response");
	}
	return body as RuntimeObservationV1;
}

export async function listCandidateModels(input: {
	projectId: string;
	sessionId?: string;
}): Promise<CandidateModelsV1> {
	const body = await postExpectingOk("/api/agent/models", {
		version: 1,
		...input,
	});
	try {
		return parseCandidateModelsV1(body);
	} catch {
		throw new CandidateRequestError(502, "invalid_response");
	}
}

export async function runWorkspaceAction(input: {
	kind: WorkspaceActionKind;
	projectId: string;
	sessionId: string;
	message?: string;
}): Promise<WorkspaceActionResultV1> {
	const body = await postExpectingOk("/api/agent/workspace-action", {
		version: 1,
		...input,
	});
	if (!isRecord(body) || typeof body.status !== "string") {
		throw new CandidateRequestError(502, "invalid_response");
	}
	return body as WorkspaceActionResultV1;
}

/** False only when this deployment has no candidate runtime bound. */
export async function probeCandidateRuntime(
	projectId: string,
): Promise<boolean> {
	try {
		await postExpectingOk("/api/agent/models", { version: 1, projectId });
		return true;
	} catch (error) {
		if (
			error instanceof CandidateRequestError &&
			error.status === 400 &&
			error.code === "candidate_admission_ineligible"
		) {
			return false;
		}
		throw error;
	}
}

const DENIAL_MESSAGES: Record<WorkspaceActionDenial, string> = {
	busy: "The workspace is busy. Try again shortly.",
	restore_in_progress: "A restore is in progress.",
	archived: "This session is archived.",
	backup_overdue: "Waiting for a backup before changes.",
	blocked: "This session needs review.",
	unavailable: "The workspace isn't available.",
	capacity: "No workspace slot is free right now.",
};

export function describeWorkspaceDenial(reason: WorkspaceActionDenial): string {
	return DENIAL_MESSAGES[reason];
}

export const CANDIDATE_UNSUPPORTED_ACTION_TOOLTIP =
	"Not available for this session yet.";

// Observation

type ObservationRun = ObservationSnapshotV1["runs"][number];
type ObservationAssistant = ObservationSnapshotV1["assistants"][number];

export type ObservationState = {
	cursor: number;
	runs: ObservationRun[];
	assistants: ObservationAssistant[];
	health: ObservationSnapshotV1["health"];
};

const TERMINAL_RUN_STATES = new Set(["complete", "failed", "canceled"]);

export function isTerminalRunState(state: string): boolean {
	return TERMINAL_RUN_STATES.has(state);
}

function assistantChanged(
	before: ObservationAssistant | undefined,
	after: ObservationAssistant,
): boolean {
	return (
		!before ||
		before.state !== after.state ||
		before.reason !== after.reason ||
		before.version !== after.version
	);
}

function applyEvent(
	runs: ObservationRun[],
	assistants: ObservationAssistant[],
	event: ObservationEventV1,
	changed: Set<string>,
): void {
	if (event.kind === "run") {
		const run = runs.find((item) => item.id === event.target);
		if (run) run.state = event.state;
		else runs.push({ id: event.target, state: event.state, epoch: 0 });
		return;
	}
	if (event.state !== "complete" && event.state !== "failed") return;
	const assistant = assistants.find((item) => item.id === event.target);
	if (!assistant) {
		assistants.push({
			id: event.target,
			run: event.run,
			state: event.state,
			reason: event.reason,
			version: event.version,
			applied: false,
		});
		changed.add(event.target);
		return;
	}
	if (
		assistant.state !== event.state ||
		assistant.reason !== event.reason ||
		assistant.version !== event.version
	) {
		assistant.state = event.state;
		assistant.reason = event.reason;
		assistant.version = event.version;
		changed.add(event.target);
	}
}

const EMPTY_HEALTH: ObservationSnapshotV1["health"] = {
	projectionLag: 0,
	safetyStopped: false,
};

/**
 * A snapshot replaces everything and subsumes the events that came with it.
 * A cursor read applies only events past the cursor; the rest are duplicates.
 */
export function reduceObservation(
	state: ObservationState | null,
	observation: RuntimeObservationV1,
): { state: ObservationState; changedAssistants: string[] } {
	const changed = new Set<string>();
	if (observation.snapshot) {
		const snapshot = observation.snapshot;
		const before = new Map(
			(state?.assistants ?? []).map((item) => [item.id, item]),
		);
		for (const assistant of snapshot.assistants) {
			if (assistantChanged(before.get(assistant.id), assistant)) {
				changed.add(assistant.id);
			}
		}
		return {
			state: {
				cursor: observation.cursor,
				runs: snapshot.runs.map((run) => ({ ...run })),
				assistants: snapshot.assistants.map((item) => ({ ...item })),
				health: snapshot.health,
			},
			changedAssistants: [...changed],
		};
	}
	const base: ObservationState = state ?? {
		cursor: 0,
		runs: [],
		assistants: [],
		health: EMPTY_HEALTH,
	};
	const runs = base.runs.map((run) => ({ ...run }));
	const assistants = base.assistants.map((item) => ({ ...item }));
	for (const event of observation.events) {
		if (event.position <= base.cursor) continue;
		applyEvent(runs, assistants, event, changed);
	}
	return {
		state: {
			cursor: observation.cursor,
			runs,
			assistants,
			health: base.health,
		},
		changedAssistants: [...changed],
	};
}

export function activeRun(
	state: ObservationState | null,
): ObservationRun | undefined {
	const open = state?.runs.filter((run) => !isTerminalRunState(run.state));
	return open?.[open.length - 1];
}

export function isAssistantSettled(
	state: ObservationState | null,
	assistantId: string,
): boolean {
	return Boolean(state?.assistants.some((item) => item.id === assistantId));
}

export const FAST_POLL_MS = 1000;
export const SLOW_POLL_MS = 10_000;

export function nextPollDelay(input: {
	state: ObservationState | null;
	unsettledAssistantIds: readonly string[];
	more?: boolean;
}): number {
	if (input.more) return 0;
	const busy =
		activeRun(input.state) !== undefined ||
		input.unsettledAssistantIds.some(
			(id) => !isAssistantSettled(input.state, id),
		);
	return busy ? FAST_POLL_MS : SLOW_POLL_MS;
}

// Turns: the optimistic rows between a receipt and the projected messages.

export type CandidateTurn = {
	commandId: string;
	kind: "prompt" | "follow_up";
	userMessageId: string;
	assistantMessageId: string;
	text: string;
};

const turnsBySession = new Map<string, CandidateTurn[]>();

export function readCandidateTurns(sessionId: string): CandidateTurn[] {
	return turnsBySession.get(sessionId) ?? [];
}

export function storeCandidateTurn(
	sessionId: string,
	turn: CandidateTurn,
): void {
	const turns = readCandidateTurns(sessionId).filter(
		(item) => item.commandId !== turn.commandId,
	);
	turnsBySession.set(sessionId, [...turns, turn]);
}

export function dropCandidateTurns(
	sessionId: string,
	assistantMessageIds: readonly string[],
): void {
	const drop = new Set(assistantMessageIds);
	const remaining = readCandidateTurns(sessionId).filter(
		(turn) => !drop.has(turn.assistantMessageId),
	);
	if (remaining.length === 0) turnsBySession.delete(sessionId);
	else turnsBySession.set(sessionId, remaining);
}

/** The run a follow-up or Stop addresses: the open run, else the newest unsettled prompt. */
export function currentRunId(
	state: ObservationState | null,
	turns: readonly CandidateTurn[],
): string | undefined {
	const open = activeRun(state);
	if (open) return open.id;
	for (let index = turns.length - 1; index >= 0; index -= 1) {
		const turn = turns[index];
		if (
			turn?.kind === "prompt" &&
			!isAssistantSettled(state, turn.assistantMessageId)
		) {
			return turn.commandId;
		}
	}
	return undefined;
}

export function isRunTerminal(
	state: ObservationState | null,
	runId: string,
): boolean {
	const run = state?.runs.find((item) => item.id === runId);
	return run !== undefined && isTerminalRunState(run.state);
}

// Model selection

export function defaultSelection(
	models: CandidateModelsV1,
): ConfigurationSelectionV1 | null {
	if (models.selection) return models.selection;
	const first = models.models[0];
	const thinking = first?.thinking[0];
	return first && thinking ? { model: first.id, thinking } : null;
}

export function sameSelection(
	a: ConfigurationSelectionV1 | null,
	b: ConfigurationSelectionV1 | null,
): boolean {
	return a?.model === b?.model && a?.thinking === b?.thinking;
}

/** Attach a selection only when the server has not already accepted it. */
export function selectionToAttach(
	chosen: ConfigurationSelectionV1 | null,
	accepted: ConfigurationSelectionV1 | null,
): ConfigurationSelectionV1 | undefined {
	if (!chosen || sameSelection(chosen, accepted)) return undefined;
	return chosen;
}

// Hooks

/** True once the deployment is known to bind a candidate runtime. */
export function useCandidateProbe(
	projectId: string,
	enabled: boolean,
): boolean {
	const [bound, setBound] = useState<{ projectId: string; value: boolean }>();
	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		probeCandidateRuntime(projectId).then(
			(value) => {
				if (!cancelled) setBound({ projectId, value });
			},
			() => {
				if (!cancelled) setBound({ projectId, value: false });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [projectId, enabled]);
	return enabled && bound?.projectId === projectId && bound.value;
}

export function useCandidateObservation(options: {
	projectId: string;
	sessionId: string | undefined;
	enabled: boolean;
	onAssistantsChanged: (assistantIds: string[]) => void;
}) {
	const { projectId, sessionId, enabled } = options;
	const [observation, setObservation] = useState<ObservationState | null>(null);
	const [turns, setTurns] = useState<CandidateTurn[]>(() =>
		enabled && sessionId ? readCandidateTurns(sessionId) : [],
	);
	const turnsRef = useRef<CandidateTurn[]>(turns);
	const changedRef = useRef(options.onAssistantsChanged);
	changedRef.current = options.onAssistantsChanged;
	const pokeRef = useRef<() => void>(() => {});

	const syncTurns = useCallback((next: CandidateTurn[]) => {
		turnsRef.current = next;
		setTurns(next);
	}, []);

	useEffect(() => {
		if (!enabled || !sessionId) {
			syncTurns([]);
			return;
		}
		syncTurns(readCandidateTurns(sessionId));
	}, [enabled, sessionId, syncTurns]);

	useEffect(() => {
		setObservation(null);
		if (!enabled || !sessionId) {
			pokeRef.current = () => {};
			return;
		}
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let current: ObservationState | null = null;
		let cursor: number | undefined;

		const schedule = (delay: number) => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			if (cancelled || document.visibilityState === "hidden") return;
			timer = setTimeout(() => void tick(), delay);
		};
		const tick = async () => {
			timer = undefined;
			if (cancelled || document.visibilityState === "hidden") return;
			let more = false;
			try {
				const result = await observeCandidate({
					projectId,
					sessionId,
					cursor,
				});
				if (cancelled) return;
				const reduced = reduceObservation(current, result);
				current = reduced.state;
				cursor = result.cursor;
				more = result.more;
				setObservation(reduced.state);
				if (reduced.changedAssistants.length > 0) {
					changedRef.current(reduced.changedAssistants);
				}
			} catch {
				// Keep polling; a failed read changes no state.
			}
			if (cancelled) return;
			schedule(
				nextPollDelay({
					state: current,
					unsettledAssistantIds: turnsRef.current.map(
						(turn) => turn.assistantMessageId,
					),
					more,
				}),
			);
		};
		const onVisibility = () => {
			if (document.visibilityState === "visible") schedule(0);
			else if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
		};
		pokeRef.current = () => schedule(0);
		document.addEventListener("visibilitychange", onVisibility);
		schedule(0);
		return () => {
			cancelled = true;
			if (timer !== undefined) clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisibility);
			pokeRef.current = () => {};
		};
	}, [enabled, projectId, sessionId]);

	const addTurn = useCallback(
		(targetSessionId: string, turn: CandidateTurn) => {
			storeCandidateTurn(targetSessionId, turn);
			if (targetSessionId === sessionId) {
				syncTurns(readCandidateTurns(targetSessionId));
			}
			pokeRef.current();
		},
		[sessionId, syncTurns],
	);
	const dropTurns = useCallback(
		(assistantMessageIds: string[]) => {
			if (!sessionId) return;
			dropCandidateTurns(sessionId, assistantMessageIds);
			syncTurns(readCandidateTurns(sessionId));
		},
		[sessionId, syncTurns],
	);
	const poke = useCallback(() => pokeRef.current(), []);

	return { observation, turns, addTurn, dropTurns, poke };
}

/** What the chat page hands the composer and chat for a candidate session. */
export type CandidateContext = {
	observation: ObservationState | null;
	turns: CandidateTurn[];
	addTurn: (sessionId: string, turn: CandidateTurn) => void;
	dropTurns: (assistantMessageIds: string[]) => void;
	poke: () => void;
	project: { id: string; name: string; status: ProjectStatus } | null;
};

export type ProjectStatus = "provisioning" | "ready" | "failed" | "deleting";

// Codex connection

const CODEX_QUERY_KEY = ["codex-connection"] as const;
export const CANDIDATE_MODELS_QUERY_KEY = "candidate-models" as const;

export const CODEX_CONNECTION_VIEWS: Record<
	ConnectionStatus,
	{ label: string; action: "connect" | "disconnect" | null; verb?: string }
> = {
	connected: { label: "Connected", action: "disconnect", verb: "Disconnect" },
	renewing: { label: "Renewing…", action: null },
	reconnect_required: {
		label: "Sign-in expired",
		action: "connect",
		verb: "Reconnect",
	},
	disconnected: { label: "Not connected", action: "connect", verb: "Connect" },
	unavailable: { label: "Codex is unavailable right now", action: null },
};

async function callCodexConnection(
	action: "status" | "connect" | "disconnect",
) {
	// Loaded on demand so importing this module never pulls in the Worker-only server function.
	const { codexConnection } = await import("./codex-connection.functions");
	return await codexConnection({ data: { action } });
}

export function useCodexConnection(options: { statusEnabled?: boolean } = {}) {
	const queryClient = useQueryClient();
	const statusQuery = useQuery({
		queryKey: CODEX_QUERY_KEY,
		queryFn: async (): Promise<ConnectionStatus> => {
			const { status, body } = await callCodexConnection("status");
			if (status === 200 && "status" in body) return body.status;
			return "unavailable";
		},
		retry: false,
		enabled: options.statusEnabled ?? true,
	});
	const actionMutation = useMutation({
		mutationFn: async (action: "connect" | "disconnect") => {
			const { status, body } = await callCodexConnection(action);
			if (status !== 200) {
				throw new CandidateRequestError(
					status,
					"code" in body ? body.code : "unknown",
				);
			}
		},
		onError: (error) => {
			toast.add({
				type: "error",
				description:
					error instanceof CandidateRequestError &&
					error.code === "codex_hosted_auth_unverified"
						? "Codex sign-in isn't available yet."
						: "Couldn't update the Codex connection.",
			});
		},
		onSettled: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: CODEX_QUERY_KEY }),
				queryClient.invalidateQueries({
					queryKey: [CANDIDATE_MODELS_QUERY_KEY],
				}),
			]);
		},
	});
	const status: ConnectionStatus = statusQuery.isError
		? "unavailable"
		: (statusQuery.data ?? "unavailable");
	return {
		status,
		isPending: statusQuery.isPending,
		actionPending: actionMutation.isPending,
		runAction: (action: "connect" | "disconnect") =>
			actionMutation.mutate(action),
	};
}
