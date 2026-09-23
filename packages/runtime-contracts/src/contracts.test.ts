import { describe, expect, it } from "vitest";
import {
	parseBrainEnvelopeV1,
	parseBrowserCommandV1,
	parseCommandV1,
	parseContinuationV1,
	parseEffectV1,
	parseEncryptedRecordEnvelopeV1,
	parseReceiptV1,
	RUNTIME_LIMITS,
} from "./index.js";
import { decodeJsonText } from "./json.js";

const command = {
	version: 1,
	kind: "prompt",
	commandId: "cmd",
	commandSeq: 1,
	userId: "user",
	projectId: "proj",
	workspaceSessionId: "sess",
	runtimeOwnerVersion: 1,
	acceptedAt: 10,
	deadlineAt: 20,
	userMessageId: "user-msg",
	assistantMessageId: "asst-msg",
	text: "hello",
};

const receipt = {
	version: 1,
	receiptId: "rcpt",
	commandId: "cmd",
	userId: "user",
	projectId: "proj",
	workspaceSessionId: "sess",
	commandSeq: 1,
	status: "admitted",
	queueDeadlineAt: 20,
	queuePosition: 1,
	projectionVersion: 0,
};

describe("runtime contracts", () => {
	it("rejects unknown versions and fields", () => {
		expect(() => parseCommandV1({ ...command, version: 2 })).toThrow(/version/);
		expect(() =>
			parseCommandV1({ ...command, brainIdentityId: "duplicate-authority" }),
		).toThrow(/unknown field/);
	});

	it("rejects duplicate and escaped duplicate authority fields in raw JSON", () => {
		const duplicate = `{"version":1,"kind":"prompt","commandId":"cmd","commandSeq":1,"userId":"user","userId":"other","projectId":"proj","workspaceSessionId":"sess","runtimeOwnerVersion":1,"acceptedAt":10,"deadlineAt":20,"userMessageId":"user-msg","assistantMessageId":"asst-msg","text":"hello"}`;
		expect(() => parseCommandV1(duplicate)).toThrow(
			/Duplicate JSON key userId/,
		);
		const escaped = `{"version":1,"kind":"prompt","commandId":"cmd","commandSeq":1,"userId":"user","\\u0075serId":"other","projectId":"proj","workspaceSessionId":"sess","runtimeOwnerVersion":1,"acceptedAt":10,"deadlineAt":20,"userMessageId":"user-msg","assistantMessageId":"asst-msg","text":"hello"}`;
		expect(() => parseCommandV1(escaped)).toThrow(/Duplicate JSON key userId/);
	});

	it("rejects malformed discriminated unions and unimplemented kinds", () => {
		expect(() => parseCommandV1({ ...command, kind: "follow_up" })).toThrow(
			/unknown field|targetRunId/,
		);
		expect(() =>
			parseCommandV1({
				...command,
				kind: "stop",
				text: undefined,
				userMessageId: undefined,
				assistantMessageId: undefined,
			}),
		).toThrow(/targetRunId|unknown field|invalid_field/);
		expect(() =>
			parseCommandV1({ ...command, kind: "project_delete" }),
		).toThrow(/kind/);
		expect(() =>
			parseCommandV1({ ...command, kind: "abandon_failed_run" }),
		).toThrow(/kind/);
		expect(() =>
			parseBrowserCommandV1({
				version: 1,
				idempotencyKey: "key",
				kind: "restore_checkpoint_acknowledging_loss",
				projectId: "proj",
			}),
		).toThrow(/kind/);
	});

	it("parses cancel without a target run", () => {
		const cancel = parseCommandV1({
			version: 1,
			kind: "cancel",
			commandId: "cmd",
			commandSeq: 2,
			userId: "user",
			projectId: "proj",
			workspaceSessionId: "sess",
			runtimeOwnerVersion: 1,
			acceptedAt: 10,
			deadlineAt: 20,
			targetCommandId: "queued-cmd",
		});
		expect(cancel).toMatchObject({
			kind: "cancel",
			targetCommandId: "queued-cmd",
		});
		expect("targetRunId" in cancel).toBe(false);
	});

	it("keeps browser input free of runtime authority", () => {
		expect(
			parseBrowserCommandV1({
				version: 1,
				idempotencyKey: "key",
				kind: "prompt",
				projectId: "proj",
				text: "hello",
			}),
		).toMatchObject({ kind: "prompt", text: "hello" });
		expect(() =>
			parseBrowserCommandV1({
				version: 1,
				idempotencyKey: "key",
				kind: "prompt",
				projectId: "proj",
				text: "hello",
				userId: "user",
			}),
		).toThrow(/unknown field/);
		expect(() =>
			parseBrowserCommandV1({
				version: 1,
				idempotencyKey: "key",
				kind: "prompt",
				projectId: "proj",
				text: "hello",
				runtimeOwnerVersion: 1,
			}),
		).toThrow(/unknown field/);
	});

	it("requires receipt identity, queue and projection fields", () => {
		expect(parseReceiptV1(receipt)).toMatchObject({
			receiptId: "rcpt",
			userId: "user",
			queueDeadlineAt: 20,
			projectionVersion: 0,
		});
		expect(() =>
			parseReceiptV1({
				version: 1,
				receiptId: "rcpt",
				commandId: "cmd",
				status: "admitted",
			}),
		).toThrow(/userId|invalid_field/);
	});

	it("enforces character and encoded-byte bounds", () => {
		expect(() =>
			parseCommandV1({
				...command,
				text: "x".repeat(RUNTIME_LIMITS.commandTextCharacters + 1),
			}),
		).toThrow(/character limit/);
		expect(() =>
			parseCommandV1({ ...command, commandId: "😀".repeat(33) }),
		).toThrow(/byte limit/);
		const oversized = `${"x".repeat(RUNTIME_LIMITS.commandBodyBytes + 1)}`;
		expect(() => parseCommandV1(oversized)).toThrow(/byte limit|JSON/);
	});

	it("rejects invalid integers and oversized envelopes", () => {
		expect(() => parseCommandV1({ ...command, commandSeq: 1.5 })).toThrow(
			/safe integer/,
		);
		expect(() =>
			parseCommandV1({ ...command, runtimeOwnerVersion: 0 }),
		).toThrow(/safe integer/);
		const envelope = {
			version: 1,
			brainIdentityId: "b",
			brainIncarnationId: "bi",
			runId: "r",
			attempt: 1,
			runEpoch: 1,
			operationId: "o",
			expectedCommittedPosition: 0,
			payload: {},
		};
		expect(() => parseBrainEnvelopeV1({ ...envelope, attempt: 1.5 })).toThrow(
			/safe integer/,
		);
		expect(() =>
			parseBrainEnvelopeV1({
				...envelope,
				payload: { data: "x".repeat(RUNTIME_LIMITS.deliveryEnvelopeBytes) },
			}),
		).toThrow(/byte limit/);
	});

	it("parses effect identity without forwarding extras", () => {
		const effect = {
			version: 1,
			runId: "r",
			assistantEntryId: "a",
			toolCallId: "t",
			attempt: 1,
			executorIncarnationId: "e",
			runEpoch: 1,
			lifecycleGeneration: 1,
			deadline: 1,
			arguments: {},
			outcomePolicy: "reconcile",
			state: "prepared",
		};
		expect(parseEffectV1(effect)).toEqual(effect);
		expect(() =>
			parseEffectV1({ ...effect, identityId: "caller-asserted" }),
		).toThrow(/unknown field/);
	});

	it("parses encrypted-record envelopes without ciphertext or object keys", () => {
		const envelope = {
			version: 1,
			algorithm: "aes-256-gcm",
			keyVersion: "k1",
			nonce: "n1",
			ciphertextBytes: 32,
			chunkCount: 1,
			digest: "deadbeef",
			associatedData: {
				ownerKind: "workspace_session",
				ownerId: "sess",
				recordId: "rec",
				formatVersion: 1,
			},
		};
		expect(parseEncryptedRecordEnvelopeV1(envelope)).toEqual(envelope);
		expect(() =>
			parseEncryptedRecordEnvelopeV1({
				...envelope,
				objectKey: "r2://secret",
			}),
		).toThrow(/unknown field/);
	});

	it("rejects literal and escaped prototype keys as unknown fields", () => {
		expect(() =>
			parseBrowserCommandV1(
				'{"version":1,"kind":"prompt","idempotencyKey":"key","projectId":"p","text":"hello","__proto__":"ignored"}',
			),
		).toThrow(/unknown field/);
		expect(() =>
			parseBrowserCommandV1(
				'{"version":1,"kind":"prompt","idempotencyKey":"key","projectId":"p","text":"hello","\\u005f_proto__":"ignored"}',
			),
		).toThrow(/unknown field/);
	});

	it("returns a bounded contract error for deeply nested JSON", () => {
		const nested = `[${"[".repeat(8000)}0${"]".repeat(8000)}]`;
		expect(() => parseBrowserCommandV1(nested)).toThrow(/JSON|nesting|byte/);
		try {
			parseBrowserCommandV1("[".repeat(8000) + "0" + "]".repeat(8000));
			throw new Error("expected nested JSON to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).name).not.toBe("RangeError");
		}
	});

	it("preserves prototype keys as own data on raw continuation JSON", () => {
		const raw = decodeJsonText(
			'{"keep":true,"__proto__":{"polluted":true}}',
			RUNTIME_LIMITS.brainControlRecordBytes,
		) as Record<string, unknown>;
		expect(Object.hasOwn(raw, "__proto__")).toBe(true);
		expect(Object.hasOwn(raw, "keep")).toBe(true);
		expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);
		expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
		const continuation = parseContinuationV1({
			version: 1,
			piVersion: "0.85.1",
			adapterVersion: "1",
			journalVersion: 1,
			entries: [raw],
			selectedLeafId: "leaf",
			compactionBoundaries: [],
			settings: {},
			extensionState: {},
			acceptedCommandPosition: 0,
			consumedCommandPosition: 0,
			providerRecords: [],
			unresolvedEffects: [],
			checkpointPairId: "pair",
			mutationGeneration: 0,
		});
		const entry = continuation.entries[0] as Record<string, unknown>;
		expect(Object.hasOwn(entry, "__proto__")).toBe(true);
	});
});
