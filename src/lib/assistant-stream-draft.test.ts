import { describe, expect, it } from "vitest";
import { AssistantStreamDraft } from "./assistant-stream-draft";

describe("AssistantStreamDraft", () => {
	it("accumulates deltas and consumes one persisted assistant message", () => {
		const draft = new AssistantStreamDraft();

		draft.append("run-1", "Here is ");
		draft.append("run-1", "package.json");

		expect(draft.consume("run-1")).toBe("Here is package.json");
		expect(draft.consume("run-1")).toBeNull();
	});

	it("resets when a different run starts streaming", () => {
		const draft = new AssistantStreamDraft();

		draft.append("run-1", "old");
		draft.append("run-2", "new");

		expect(draft.consume("run-1")).toBeNull();
		expect(draft.consume("run-2")).toBe("new");
	});
});
