import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserCommandV2 } from "../../../../packages/runtime-contracts/src/product-command.js";
import type {
	ObservationSnapshotV1,
	RuntimeObservationV1,
} from "../../../../packages/runtime-contracts/src/projection.js";
import {
	CandidateRequestError,
	currentRunId,
	nextPollDelay,
	type ObservationState,
	probeCandidateRuntime,
	reduceObservation,
	selectionToAttach,
	submitCandidateCommand,
} from "./candidate-session-client";

const receipt = {
	version: 2,
	receiptId: "rcpt-1",
	commandId: "cmd-1",
	workspaceSessionId: "sess-1",
	commandSeq: 1,
	ownerVersion: 1,
	queueDeadlineAt: 1000,
	userMessageId: "user-1",
	assistantMessageId: "asst-1",
};

const prompt: BrowserCommandV2 = {
	version: 2,
	kind: "prompt",
	idempotencyKey: "key-1",
	projectId: "proj-1",
	text: "hello",
};

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("submitCandidateCommand", () => {
	it("parses a 202 receipt", async () => {
		const fetchMock = vi.fn(async () => json(202, receipt));
		vi.stubGlobal("fetch", fetchMock);

		await expect(submitCandidateCommand(prompt)).resolves.toMatchObject({
			commandId: "cmd-1",
			workspaceSessionId: "sess-1",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/agent/stream",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("sends stop to the control route", async () => {
		const fetchMock = vi.fn(async (_path: string) => json(202, receipt));
		vi.stubGlobal("fetch", fetchMock);

		await submitCandidateCommand(
			{
				version: 2,
				kind: "stop",
				idempotencyKey: "key-2",
				projectId: "proj-1",
				sessionId: "sess-1",
				targetRunId: "cmd-1",
			},
			{ retryDelayMs: 0 },
		);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/agent/control");
	});

	it("retries a network error and a 503 with the identical body and key", async () => {
		const fetchMock = vi
			.fn<(path: string, init: { body: string }) => Promise<Response>>()
			.mockRejectedValueOnce(new TypeError("offline"))
			.mockResolvedValueOnce(json(503, { code: "runtime_unavailable" }))
			.mockResolvedValueOnce(json(202, receipt));
		vi.stubGlobal("fetch", fetchMock);

		await submitCandidateCommand(prompt, { retryDelayMs: 0 });

		expect(fetchMock).toHaveBeenCalledTimes(3);
		const bodies = fetchMock.mock.calls.map((call) => call[1].body);
		expect(new Set(bodies).size).toBe(1);
		expect(JSON.parse(bodies[0]).idempotencyKey).toBe("key-1");
	});

	it("gives up after three retries", async () => {
		const fetchMock = vi.fn(async () =>
			json(503, { code: "runtime_unavailable" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			submitCandidateCommand(prompt, { retryDelayMs: 0 }),
		).rejects.toMatchObject({ status: 503, code: "runtime_unavailable" });
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("throws a 409 with its code and does not retry", async () => {
		const fetchMock = vi.fn(async () =>
			json(409, { code: "runtime_owner_mismatch" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const error = await submitCandidateCommand(prompt).catch(
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(CandidateRequestError);
		expect(error).toMatchObject({
			status: 409,
			code: "runtime_owner_mismatch",
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("probeCandidateRuntime", () => {
	it("is false only for candidate_admission_ineligible", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json(400, { code: "candidate_admission_ineligible" })),
		);
		await expect(probeCandidateRuntime("proj-1")).resolves.toBe(false);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				json(200, {
					version: 1,
					status: "disconnected",
					models: [],
					selection: null,
				}),
			),
		);
		await expect(probeCandidateRuntime("proj-1")).resolves.toBe(true);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json(400, { code: "invalid_request" })),
		);
		await expect(probeCandidateRuntime("proj-1")).rejects.toMatchObject({
			code: "invalid_request",
		});
	});
});

function snapshot(
	overrides: Partial<ObservationSnapshotV1> = {},
): ObservationSnapshotV1 {
	return {
		runs: [{ id: "run-1", state: "running", epoch: 1 }],
		assistants: [],
		health: { projectionLag: 0, safetyStopped: false },
		...overrides,
	};
}

function observation(
	overrides: Partial<RuntimeObservationV1>,
): RuntimeObservationV1 {
	return { version: 1, cursor: 0, events: [], more: false, ...overrides };
}

describe("reduceObservation", () => {
	it("replaces runs, assistants and health from a snapshot", () => {
		const { state, changedAssistants } = reduceObservation(
			null,
			observation({
				cursor: 5,
				snapshot: snapshot({
					assistants: [
						{
							id: "asst-1",
							run: "run-1",
							state: "complete",
							reason: null,
							version: 1,
							applied: true,
						},
					],
				}),
			}),
		);
		expect(state.cursor).toBe(5);
		expect(state.runs).toEqual([{ id: "run-1", state: "running", epoch: 1 }]);
		expect(changedAssistants).toEqual(["asst-1"]);
	});

	it("applies events after the cursor and ignores duplicates and older ones", () => {
		const start = reduceObservation(
			null,
			observation({ cursor: 5, snapshot: snapshot() }),
		).state;

		const next = reduceObservation(
			start,
			observation({
				cursor: 7,
				events: [
					{
						position: 4,
						kind: "run",
						target: "run-1",
						run: "run-1",
						state: "failed",
						reason: null,
						version: 1,
					},
					{
						position: 5,
						kind: "run",
						target: "run-1",
						run: "run-1",
						state: "failed",
						reason: null,
						version: 1,
					},
					{
						position: 6,
						kind: "run",
						target: "run-1",
						run: "run-1",
						state: "complete",
						reason: null,
						version: 1,
					},
					{
						position: 7,
						kind: "assistant",
						target: "asst-1",
						run: "run-1",
						state: "complete",
						reason: null,
						version: 1,
					},
				],
			}),
		);
		expect(next.state.runs[0]?.state).toBe("complete");
		expect(next.state.assistants.map((item) => item.id)).toEqual(["asst-1"]);
		expect(next.state.cursor).toBe(7);
		expect(next.changedAssistants).toEqual(["asst-1"]);

		const replay = reduceObservation(
			next.state,
			observation({
				cursor: 7,
				events: [
					{
						position: 7,
						kind: "assistant",
						target: "asst-1",
						run: "run-1",
						state: "complete",
						reason: null,
						version: 1,
					},
				],
			}),
		);
		expect(replay.changedAssistants).toEqual([]);
		expect(replay.state).toEqual(next.state);
	});

	it("lists an assistant again only when its state, reason or version moved", () => {
		const base = reduceObservation(
			null,
			observation({
				cursor: 3,
				snapshot: snapshot({
					assistants: [
						{
							id: "asst-1",
							run: "run-1",
							state: "failed",
							reason: "run_failed",
							version: 1,
							applied: false,
						},
						{
							id: "asst-2",
							run: "run-1",
							state: "complete",
							reason: null,
							version: 1,
							applied: true,
						},
					],
				}),
			}),
		).state;

		const next = reduceObservation(
			base,
			observation({
				cursor: 4,
				events: [
					{
						position: 4,
						kind: "assistant",
						target: "asst-1",
						run: "run-1",
						state: "failed",
						reason: "checkpoint_restored",
						version: 2,
					},
				],
			}),
		);
		expect(next.changedAssistants).toEqual(["asst-1"]);
		expect(next.state.assistants[0]?.reason).toBe("checkpoint_restored");
		expect(next.state.assistants[1]?.version).toBe(1);
	});

	it("discards earlier state when a stale cursor gets a replacement snapshot", () => {
		const old = reduceObservation(
			null,
			observation({
				cursor: 50,
				snapshot: snapshot({
					runs: [{ id: "old-run", state: "running", epoch: 1 }],
					assistants: [
						{
							id: "old-asst",
							run: "old-run",
							state: "complete",
							reason: null,
							version: 1,
							applied: true,
						},
					],
				}),
			}),
		).state;

		const replaced = reduceObservation(
			old,
			observation({
				cursor: 2,
				snapshot: snapshot({
					runs: [{ id: "run-9", state: "queued", epoch: 1 }],
				}),
			}),
		);
		expect(replaced.state.cursor).toBe(2);
		expect(replaced.state.runs.map((run) => run.id)).toEqual(["run-9"]);
		expect(replaced.state.assistants).toEqual([]);
		expect(replaced.changedAssistants).toEqual([]);
	});
});

describe("polling and run helpers", () => {
	const idle: ObservationState = {
		cursor: 1,
		runs: [{ id: "run-1", state: "complete", epoch: 1 }],
		assistants: [
			{
				id: "asst-1",
				run: "run-1",
				state: "complete",
				reason: null,
				version: 1,
				applied: true,
			},
		],
		health: { projectionLag: 0, safetyStopped: false },
	};

	it("polls fast while a run is open or a receipt is unsettled, slow otherwise", () => {
		expect(nextPollDelay({ state: idle, unsettledAssistantIds: [] })).toBe(
			10_000,
		);
		expect(
			nextPollDelay({ state: idle, unsettledAssistantIds: ["asst-2"] }),
		).toBe(1000);
		expect(
			nextPollDelay({
				state: { ...idle, runs: [{ id: "run-2", state: "running", epoch: 1 }] },
				unsettledAssistantIds: [],
			}),
		).toBe(1000);
		expect(
			nextPollDelay({ state: idle, unsettledAssistantIds: [], more: true }),
		).toBe(0);
	});

	it("targets the open run, else the newest unsettled prompt", () => {
		const turn = {
			commandId: "cmd-2",
			kind: "prompt" as const,
			userMessageId: "user-2",
			assistantMessageId: "asst-2",
			text: "again",
		};
		expect(currentRunId(idle, [turn])).toBe("cmd-2");
		expect(currentRunId(idle, [])).toBeUndefined();
		expect(
			currentRunId(
				{ ...idle, runs: [{ id: "run-7", state: "running", epoch: 1 }] },
				[turn],
			),
		).toBe("run-7");
	});
});

describe("selectionToAttach", () => {
	it("attaches only a selection the server has not accepted", () => {
		const chosen = { model: "faux-1", thinking: "high" } as const;
		expect(selectionToAttach(chosen, null)).toEqual(chosen);
		expect(selectionToAttach(chosen, { ...chosen })).toBeUndefined();
		expect(
			selectionToAttach(chosen, { model: "faux-2", thinking: "high" }),
		).toEqual(chosen);
		expect(selectionToAttach(null, null)).toBeUndefined();
	});
});
