import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import type { FileEntry } from "@earendil-works/pi-coding-agent";
import {
	ADAPTER_VERSION,
	CHECKPOINT_VERSION,
	PI_VERSION,
	type RecoveryCheckpoint,
} from "./pi-recovery.ts";

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
export function assistantToolUse(input: {
	provider: string;
	model: string;
	api: string;
	timestamp: number;
	calls: Array<{
		id: string;
		name: string;
		arguments: Record<string, unknown>;
	}>;
}): AssistantMessage {
	return {
		role: "assistant",
		provider: input.provider,
		model: input.model,
		api: input.api,
		timestamp: input.timestamp,
		content: input.calls.map(
			(call): ToolCall => ({ type: "toolCall", ...call }),
		),
		usage,
		stopReason: "toolUse",
	};
}
export interface RestorationFixture {
	fileEntries: FileEntry[];
	leafId: string;
	settings: RecoveryCheckpoint["settings"];
	extensionState: Record<string, unknown>;
}
export function buildRestorationFixture(cwd: string): RestorationFixture {
	const first = assistantToolUse({
		provider: "offline",
		model: "offline-1",
		api: "faux",
		timestamp: 2,
		calls: [{ id: "call-old", name: "tool_a", arguments: { n: 0 } }],
	});
	const active = assistantToolUse({
		provider: "offline",
		model: "offline-1",
		api: "faux",
		timestamp: 4,
		calls: [
			{ id: "call-a", name: "tool_a", arguments: { n: 1 } },
			{ id: "call-b", name: "tool_b", arguments: { n: 2 } },
		],
	});
	return {
		fileEntries: [
			{
				type: "session",
				version: 3,
				id: "session-fixture",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd,
			},
			{
				type: "message",
				id: "ent-u1",
				parentId: null,
				timestamp: "2026-01-01T00:00:01.000Z",
				message: { role: "user", content: "start", timestamp: 1 },
			},
			{
				type: "message",
				id: "ent-a0",
				parentId: "ent-u1",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: first,
			},
			{
				type: "message",
				id: "ent-r0",
				parentId: "ent-a0",
				timestamp: "2026-01-01T00:00:03.000Z",
				message: {
					role: "toolResult",
					toolCallId: "call-old",
					toolName: "tool_a",
					content: [{ type: "text", text: "tool_a:0" }],
					isError: false,
					timestamp: 3,
				},
			},
			{
				type: "message",
				id: "ent-a1",
				parentId: "ent-r0",
				timestamp: "2026-01-01T00:00:04.000Z",
				message: active,
			},
			{
				type: "compaction",
				id: "ent-comp",
				parentId: "ent-a1",
				timestamp: "2026-01-01T00:00:05.000Z",
				summary: "retained summary",
				firstKeptEntryId: "ent-r0",
				tokensBefore: 100,
			},
			{
				type: "custom",
				id: "ent-custom",
				parentId: "ent-comp",
				timestamp: "2026-01-01T00:00:06.000Z",
				customType: "image-owned",
				data: { phase: "ready" },
			},
			{
				type: "message",
				id: "ent-u2",
				parentId: "ent-custom",
				timestamp: "2026-01-01T00:00:07.000Z",
				message: { role: "user", content: "continue", timestamp: 7 },
			},
		],
		leafId: "ent-u2",
		settings: {
			compaction: {
				enabled: true,
				reserveTokens: 16_384,
				keepRecentTokens: 20_000,
			},
			retry: { enabled: false, maxRetries: 0, baseDelayMs: 1000 },
		},
		extensionState: { phase: "ready" },
	};
}
export function checkpointFromFixture(
	fixture: RestorationFixture,
): RecoveryCheckpoint {
	return {
		checkpointVersion: CHECKPOINT_VERSION,
		adapterVersion: ADAPTER_VERSION,
		piVersion: PI_VERSION,
		sessionVersion: 3,
		fileEntries: structuredClone(fixture.fileEntries),
		leafId: fixture.leafId,
		settings: structuredClone(fixture.settings),
		extensionState: structuredClone(fixture.extensionState),
		acceptedCommandIds: [],
		consumedCommandIds: [],
		committedProviderResponses: [],
		actualToolResults: [],
		attempt: 1,
		epoch: 1,
		incarnation: "brain-1",
		terminal: false,
	};
}
