import { describe, expect, it } from "vitest";
import {
	parseArchiveCompletionResultV1,
	parseArchiveCompletionV1,
} from "./checkpoint.js";
import {
	CONTINUATION_SEED_BYTES,
	parseContinuationImportV1,
	parseContinuationSeedV1,
} from "./lifecycle.js";
import { parseBrowserCommandV2, parseCommandV2 } from "./product-command.js";

const archive = {
	version: 1,
	kind: "workspace_archive",
	formatVersion: 1,
	compatibilityKey: "ditto-workspace-archive-v1",
	objectKey: "checkpoints/session/pair.tar.gz",
	byteCount: 10,
	extractedBytes: 20,
	digest: "a".repeat(64),
	sourceCommit: "b".repeat(40),
};
const seed = {
	version: 1,
	sourceSessionId: "session",
	sourcePairId: "pair-2",
	selection: { model: "faux-1", thinking: "off" },
	messages: [{ role: "user", content: "Synthetic" }],
	messagesDigest: "c".repeat(64),
	archive,
};

describe("lifecycle contracts", () => {
	it("admits an archive with no payload beyond its session", () => {
		const browser = {
			version: 2,
			kind: "archive_session",
			idempotencyKey: "archive",
			projectId: "project",
			sessionId: "session",
		};
		expect(parseBrowserCommandV2(browser)).toEqual(browser);
		const command = {
			version: 2,
			kind: "archive_session",
			commandId: "archive",
			commandSeq: 3,
			userId: "owner",
			projectId: "project",
			workspaceSessionId: "session",
			runtimeOwnerVersion: 1,
			receiptId: "receipt",
			acceptedAt: 100,
			deadlineAt: 900_100,
			payloadDigest: "ab".repeat(32),
		};
		expect(parseCommandV2(command)).toEqual(command);
		for (const extra of [
			{ text: "Synthetic" },
			{ targetRunId: "run" },
			{ committedPairId: "pair" },
		]) {
			expect(() => parseBrowserCommandV2({ ...browser, ...extra })).toThrow();
			expect(() => parseCommandV2({ ...command, ...extra })).toThrow();
		}
		expect(() =>
			parseBrowserCommandV2({ ...browser, sessionId: undefined }),
		).toThrow();
	});

	it("parses an archive completion and its exact acknowledgment", () => {
		const completion = {
			version: 1,
			archiveCommandId: "archive",
			cutoffSeq: 2,
			finalPairId: "pair-2",
			mutationGeneration: 2,
			conversationGeneration: 1,
		};
		expect(parseArchiveCompletionV1(completion)).toEqual(completion);
		for (const bad of [
			{ mutationGeneration: 0 },
			{ conversationGeneration: 0 },
			{ cutoffSeq: -1 },
			{ finalPairId: "" },
			{ extra: true },
		])
			expect(() =>
				parseArchiveCompletionV1({ ...completion, ...bad }),
			).toThrow();
		expect(
			parseArchiveCompletionResultV1(
				{ archiveCommandId: "archive", outcome: "applied" },
				completion,
			),
		).toEqual({ archiveCommandId: "archive", outcome: "applied" });
		expect(() =>
			parseArchiveCompletionResultV1(
				{ archiveCommandId: "other", outcome: "applied" },
				completion,
			),
		).toThrow();
	});

	it("bounds a continuation seed and matches its import acknowledgment", () => {
		expect(parseContinuationSeedV1(seed)).toEqual(seed);
		expect(parseContinuationSeedV1(JSON.stringify(seed))).toEqual(seed);
		expect(
			parseContinuationSeedV1({ ...seed, selection: null }).selection,
		).toBeNull();
		for (const bad of [
			{ messages: {} },
			{ messagesDigest: "short" },
			{ selection: { model: "real-model", thinking: "off" } },
			{ archive: { ...archive, digest: "x" } },
			{ tasks: [] },
		])
			expect(() => parseContinuationSeedV1({ ...seed, ...bad })).toThrow();
		expect(() =>
			parseContinuationSeedV1({
				...seed,
				messages: ["x".repeat(CONTINUATION_SEED_BYTES + 16 * 1024)],
			}),
		).toThrow();
		const ack = {
			version: 1,
			sourceSessionId: "session",
			sourcePairId: "pair-2",
			messagesDigest: seed.messagesDigest,
			messageCount: 1,
		};
		expect(parseContinuationImportV1(ack, seed)).toEqual(ack);
		expect(() =>
			parseContinuationImportV1({ ...ack, sourcePairId: "pair-1" }, seed),
		).toThrow();
	});
});
