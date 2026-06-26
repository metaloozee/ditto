import { describe, expect, it } from "vitest";
import {
	AGENT_RUN_EVENT_TYPES,
	createAgentRunEventPayload,
	isActiveAgentRunStatus,
	makeSessionTitleFromMessage,
	PROJECT_MEMORY_PATH,
} from "./workspace-policy";

describe("workspace policy", () => {
	it("identifies only active agent run statuses", () => {
		expect(isActiveAgentRunStatus("pending")).toBe(true);
		expect(isActiveAgentRunStatus("running")).toBe(true);
		expect(isActiveAgentRunStatus("needs_input")).toBe(true);
		expect(isActiveAgentRunStatus("completed")).toBe(false);
		expect(isActiveAgentRunStatus("failed")).toBe(false);
		expect(isActiveAgentRunStatus("canceled")).toBe(false);
	});

	it("creates a compact session title from the first message", () => {
		expect(makeSessionTitleFromMessage("center the div")).toBe(
			"center the div",
		);
		expect(makeSessionTitleFromMessage("center   the\n div please")).toBe(
			"center the div...",
		);
	});

	it("exports the project memory path", () => {
		expect(PROJECT_MEMORY_PATH).toBe("/workspace/.ditto/project-memory.md");
	});

	it("includes question and lock event types", () => {
		expect(AGENT_RUN_EVENT_TYPES).toContain("needs_input");
		expect(AGENT_RUN_EVENT_TYPES).toContain("lock_rejected");
	});

	it("adds the event payload schema version", () => {
		expect(
			JSON.parse(
				createAgentRunEventPayload({ role: "user", text: "center the div" }),
			),
		).toEqual({ schemaVersion: 1, role: "user", text: "center the div" });
	});
});
