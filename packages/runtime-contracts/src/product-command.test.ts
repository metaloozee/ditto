import { describe, expect, it } from "vitest";
import { parseBrowserCommandV1 } from "./command.js";
import {
	parseBrowserCommandV2,
	parseCommandHandoffAckV2,
	parseCommandV2,
} from "./product-command.js";

const prompt = {
	version: 2,
	kind: "prompt",
	idempotencyKey: "key",
	projectId: "project",
	text: "Synthetic prompt",
};
const command = {
	version: 2,
	kind: "prompt",
	commandId: "command",
	commandSeq: 1,
	userId: "owner",
	projectId: "project",
	workspaceSessionId: "session",
	runtimeOwnerVersion: 1,
	receiptId: "receipt",
	acceptedAt: 100,
	deadlineAt: 900_100,
	payloadDigest: "ab".repeat(32),
	userMessageId: "user-message",
	assistantMessageId: "assistant-message",
	text: "Synthetic prompt",
};

describe("candidate command version 2", () => {
	it("keeps the four command meanings separate and preserves exact text", () => {
		expect(
			parseBrowserCommandV2({ ...prompt, text: "  Synthetic prompt  " }),
		).toEqual({
			...prompt,
			text: "  Synthetic prompt  ",
		});
		for (const value of [
			{
				...prompt,
				kind: "follow_up",
				sessionId: "session",
				targetRunId: "run",
			},
			{
				version: 2,
				kind: "stop",
				idempotencyKey: "stop",
				projectId: "project",
				sessionId: "session",
				targetRunId: "run",
			},
			{
				version: 2,
				kind: "cancel",
				idempotencyKey: "cancel",
				projectId: "project",
				sessionId: "session",
				targetCommandId: "command",
			},
		])
			expect(parseBrowserCommandV2(value)).toEqual(value);
	});
	it.each([
		"thinkingLevel",
		"userId",
		"commandId",
		"commandSeq",
		"runtimeOwnerVersion",
		"executorId",
		"runtimeOwner",
		"receiptId",
		"deadlineAt",
	])("rejects browser authority or configuration field %s", (field) => {
		expect(() =>
			parseBrowserCommandV2({ ...prompt, [field]: "caller" }),
		).toThrow();
	});
	it.each([
		"abandon_failed_run",
		"retry_known_safe",
		"acknowledge_uncertainty_and_start_new_action",
		"retry_backup",
		"restart_preview",
	])("does not admit recovery kind %s", (kind) => {
		expect(() => parseBrowserCommandV2({ ...prompt, kind })).toThrow();
	});
	it("admits an explicit restore only with acknowledged loss and a restore that directly follows its cutoff", () => {
		const fields = {
			committedPairId: "pair-1",
			expectedMutationGeneration: 2,
			expectedRecoveryPosition: 4,
			unbackedLossAcknowledged: true,
		};
		const browser = {
			version: 2,
			kind: "restore_checkpoint_acknowledging_loss",
			idempotencyKey: "restore",
			projectId: "project",
			sessionId: "session",
			...fields,
		};
		expect(parseBrowserCommandV2(browser)).toEqual(browser);
		const restore = {
			version: 2,
			kind: "restore_checkpoint_acknowledging_loss",
			commandId: "restore",
			commandSeq: 5,
			userId: "owner",
			projectId: "project",
			workspaceSessionId: "session",
			runtimeOwnerVersion: 1,
			receiptId: "receipt",
			acceptedAt: 100,
			deadlineAt: 900_100,
			payloadDigest: "ab".repeat(32),
			...fields,
		};
		expect(parseCommandV2(restore)).toEqual(restore);
		for (const bad of [
			{ unbackedLossAcknowledged: false },
			{ unbackedLossAcknowledged: "true" },
			{ unbackedLossAcknowledged: undefined },
			{ expectedMutationGeneration: 0 },
			{ expectedRecoveryPosition: -1 },
			{ committedPairId: "" },
			{ text: "Synthetic prompt" },
		]) {
			expect(() => parseBrowserCommandV2({ ...browser, ...bad })).toThrow();
			expect(() => parseCommandV2({ ...restore, ...bad })).toThrow();
		}
		expect(() =>
			parseBrowserCommandV2({ ...browser, sessionId: undefined }),
		).toThrow();
		expect(() => parseCommandV2({ ...restore, commandSeq: 6 })).toThrow(
			/directly follow/,
		);
	});
	it("uses UTF-8 bytes at the host boundary, never truncating or changing V1 limits", () => {
		for (const text of [
			"a".repeat(8192),
			"é".repeat(4096),
			"😀".repeat(2048),
		]) {
			expect(parseBrowserCommandV2({ ...prompt, text })).toMatchObject({
				text,
			});
			expect(parseCommandV2({ ...command, text })).toMatchObject({ text });
			expect(() =>
				parseBrowserCommandV2({ ...prompt, text: text + "a" }),
			).toThrow(/byte limit/);
			expect(() => parseCommandV2({ ...command, text: text + "a" })).toThrow(
				/byte limit/,
			);
		}
		expect(
			parseBrowserCommandV1({
				...prompt,
				version: 1,
				text: "a".repeat(32_000),
				thinkingLevel: "high",
			}),
		).toMatchObject({ thinkingLevel: "high" });
	});
	it.each([undefined, 1, 3, "2"])("fails closed on version %s", (version) => {
		expect(() => parseBrowserCommandV2({ ...prompt, version })).toThrow();
		expect(() => parseCommandV2({ ...command, version })).toThrow();
	});
	it("requires exact message/run target fields for each command kind", () => {
		expect(parseCommandV2(command)).toEqual(command);
		expect(() => parseCommandV2({ ...command, targetRunId: "run" })).toThrow();
		expect(() => parseCommandV2({ ...command, kind: "follow_up" })).toThrow();
		expect(
			parseCommandV2({ ...command, kind: "follow_up", targetRunId: "run" }),
		).toMatchObject({ targetRunId: "run" });
		expect(() =>
			parseBrowserCommandV2({
				...prompt,
				kind: "follow_up",
				targetRunId: "run",
			}),
		).toThrow();
		expect(() =>
			parseBrowserCommandV2({ ...prompt, targetCommandId: "command" }),
		).toThrow();
	});
	it("rejects malformed, duplicate and oversized bodies before interpretation", () => {
		expect(() => parseBrowserCommandV2('{"version":2,"version":2}')).toThrow(
			/Duplicate/,
		);
		expect(() => parseBrowserCommandV2({ ...prompt, text: " " })).toThrow();
		expect(() =>
			parseBrowserCommandV2({ ...prompt, idempotencyKey: "x".repeat(129) }),
		).toThrow();
		expect(() =>
			parseBrowserCommandV2(
				JSON.stringify({ ...prompt, text: "a".repeat(65_536) }),
			),
		).toThrow(/JSON exceeds/);
		for (const changed of [
			{ commandSeq: 0 },
			{ runtimeOwnerVersion: 0 },
			{ acceptedAt: -1 },
			{ deadlineAt: command.deadlineAt + 1 },
			{ payloadDigest: "not-a-digest" },
			{ receiptId: "" },
			{ assistantMessageId: "" },
		])
			expect(() => parseCommandV2({ ...command, ...changed })).toThrow();
	});
	it("parses only bounded version-2 acknowledgments with exact membership fields", () => {
		const ack = {
			version: 2,
			commandId: "command",
			ownerVersion: 1,
			acceptedPosition: 3,
			receiptId: "receipt",
		};
		expect(parseCommandHandoffAckV2(ack)).toEqual(ack);
		for (const changed of [
			{ version: 1 },
			{ ownerVersion: 0 },
			{ acceptedPosition: 0 },
			{ receiptId: "" },
			{ extra: true },
		]) {
			expect(() => parseCommandHandoffAckV2({ ...ack, ...changed })).toThrow();
		}
	});
});
