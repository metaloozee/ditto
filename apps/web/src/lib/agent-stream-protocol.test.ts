import { describe, expect, it } from "vitest";
import {
	encodeSseEvent,
	parseRunnerStdoutLine,
	splitStdoutBuffer,
} from "./agent-stream-protocol";

describe("agent-stream-protocol", () => {
	it("encodeSseEvent formats SSE frames", () => {
		expect(encodeSseEvent("meta", { sessionId: "s1" })).toBe(
			'event: meta\ndata: {"sessionId":"s1"}\n\n',
		);
	});

	it("parseRunnerStdoutLine accepts v:1 runner messages", () => {
		expect(
			parseRunnerStdoutLine(
				JSON.stringify({
					v: 1,
					kind: "assistant_delta",
					delta: "hi",
				}),
			),
		).toEqual({ v: 1, kind: "assistant_delta", delta: "hi" });
		expect(parseRunnerStdoutLine("not json")).toBeNull();
		expect(parseRunnerStdoutLine(JSON.stringify({ v: 2 }))).toBeNull();
	});

	it("accepts strict control events and rejects malformed correlation", () => {
		const event = {
			v: 1,
			kind: "control_event",
			event: {
				type: "follow_up_started",
				requestId: "request-1",
				runId: "run-1",
				sessionId: "session-1",
				text: "next",
				userMessageId: "user-2",
				assistantMessageId: "assistant-2",
			},
		};
		expect(parseRunnerStdoutLine(JSON.stringify(event))).toEqual(event);
		expect(
			parseRunnerStdoutLine(
				JSON.stringify({
					...event,
					event: { ...event.event, assistantMessageId: undefined },
				}),
			),
		).toBeNull();
		expect(
			parseRunnerStdoutLine(
				JSON.stringify({ ...event, event: { ...event.event, extra: true } }),
			),
		).toBeNull();
	});

	it("splitStdoutBuffer splits on newlines and keeps partial tail", () => {
		expect(splitStdoutBuffer("line1\nli", "ne2\nline3\npar")).toEqual({
			lines: ["line1", "line2", "line3"],
			rest: "par",
		});
		expect(splitStdoutBuffer("", "single")).toEqual({
			lines: [],
			rest: "single",
		});
	});
});
