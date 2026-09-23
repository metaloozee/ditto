import { describe, expect, it } from "vitest";
import { buildRestorationFixture, checkpointFromFixture } from "./main.ts";
import {
	FIXTURE_LIMITS,
	parseAndValidateCheckpoint,
	restoreValidatedCheckpoint,
	validateCheckpoint,
} from "./pi-recovery.ts";

describe("strict Pi checkpoint restoration", () => {
	it("imports cloned entries, selects the explicit leaf, and preserves settings", () => {
		const checkpoint = checkpointFromFixture(
			buildRestorationFixture("/image/workspace"),
		);
		checkpoint.settings.compaction = {
			enabled: true,
			reserveTokens: 1234,
			keepRecentTokens: 5678,
		};
		const original = structuredClone(checkpoint);
		const restored = restoreValidatedCheckpoint(checkpoint, "/image/workspace");
		expect(restored.sessionManager.getLeafId()).toBe(checkpoint.leafId);
		expect(restored.settingsManager.getCompactionSettings()).toEqual(
			checkpoint.settings.compaction,
		);
		restored.sessionManager.appendCustomEntry("new", { value: true });
		expect(checkpoint).toEqual(original);
	});
	it("rejects byte, entry, nesting, shape, graph, leaf, and version violations before import", () => {
		const base = checkpointFromFixture(
			buildRestorationFixture("/image/workspace"),
		);
		const tooMany = structuredClone(base);
		while (tooMany.fileEntries.length <= FIXTURE_LIMITS.maxEntries) {
			const index = tooMany.fileEntries.length;
			tooMany.fileEntries.push({
				type: "custom",
				id: `extra-${index}`,
				parentId: null,
				timestamp: new Date(index).toISOString(),
				customType: "extra",
			});
		}
		expect(() => validateCheckpoint(tooMany)).toThrow(/entry limit/);
		const nested = structuredClone(base);
		let value: Record<string, unknown> = nested.extensionState;
		for (let index = 0; index < FIXTURE_LIMITS.maxNesting; index += 1) {
			value.next = {};
			value = value.next as Record<string, unknown>;
		}
		expect(() => validateCheckpoint(nested)).toThrow(/nesting/);
		const malformed = structuredClone(base);
		const assistant = malformed.fileEntries.find(
			(entry) => entry.type === "message" && entry.id === "ent-a1",
		);
		if (assistant?.type === "message")
			assistant.message = {
				role: "assistant",
				content: [{ type: "toolCall" }],
			} as never;
		expect(() => validateCheckpoint(malformed)).toThrow(/message/);
		const forward = structuredClone(base);
		const compaction = forward.fileEntries.find(
			(entry) => entry.type === "compaction",
		);
		if (compaction?.type === "compaction")
			compaction.firstKeptEntryId = "ent-u2";
		expect(() => validateCheckpoint(forward)).toThrow(/compaction/);
		const leaf = structuredClone(base);
		leaf.leafId = "missing";
		expect(() => validateCheckpoint(leaf)).toThrow(/leaf/);
		const version: Record<string, unknown> = { ...structuredClone(base) };
		version.piVersion = "newer";
		expect(() => validateCheckpoint(version)).toThrow(/version/);
	});
	it("uses UTF-8 bytes and keeps custom state entries out of model context", () => {
		const checkpoint = checkpointFromFixture(
			buildRestorationFixture("/image/workspace"),
		);
		checkpoint.extensionState = { pad: "界".repeat(FIXTURE_LIMITS.maxBytes) };
		expect(() =>
			parseAndValidateCheckpoint(JSON.stringify(checkpoint)),
		).toThrow(/byte limit/);
		const restored = restoreValidatedCheckpoint(
			checkpointFromFixture(buildRestorationFixture("/image/workspace")),
			"/image/workspace",
		);
		expect(
			restored.sessionManager
				.buildSessionContext()
				.messages.every((message) => message.role !== "custom"),
		).toBe(true);
		expect(
			restored.sessionManager
				.getEntries()
				.some((entry) => entry.type === "custom"),
		).toBe(true);
	});
});
