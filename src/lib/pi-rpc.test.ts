import { describe, expect, it } from "vitest";
import { buildJsonlWriteCommand, JsonlBuffer, parsePiRpcEvent } from "./pi-rpc";

describe("Pi RPC protocol", () => {
	it("parses documented response frames", () => {
		expect(
			parsePiRpcEvent(
				JSON.stringify({
					id: "req-1",
					type: "response",
					command: "prompt",
					success: true,
				}),
			),
		).toMatchObject({ id: "req-1", type: "response", success: true });
	});

	it("parses documented streaming event frames", () => {
		expect(
			parsePiRpcEvent(
				JSON.stringify({
					type: "message_update",
					message: {},
					assistantMessageEvent: {
						type: "text_delta",
						contentIndex: 0,
						delta: "Hello ",
						partial: {},
					},
				}),
			),
		).toMatchObject({ type: "message_update" });
	});

	it("parses documented extension UI request frames", () => {
		expect(
			parsePiRpcEvent(
				JSON.stringify({
					type: "extension_ui_request",
					id: "uuid-3",
					method: "input",
					title: "Enter a value",
					placeholder: "type something...",
				}),
			),
		).toMatchObject({ type: "extension_ui_request", id: "uuid-3" });
	});

	it("uses strict LF-delimited JSONL framing", () => {
		const buffer = new JsonlBuffer();

		expect(buffer.push('{"type":"agent_start"}\r\n')).toMatchObject([
			{ type: "agent_start" },
		]);
		expect(buffer.push('{"type":"turn_start"}')).toEqual([]);
		expect(buffer.push("\n")).toMatchObject([{ type: "turn_start" }]);
	});

	it("rejects non-JSON output", () => {
		expect(() => parsePiRpcEvent("Starting Pi...")).toThrow(
			"Pi RPC emitted non-JSON output: Starting Pi...",
		);
	});

	it("writes commands as one JSON line", () => {
		expect(
			buildJsonlWriteCommand("/tmp/rpc.in", {
				type: "extension_ui_response",
				id: "uuid-3",
				value: "answer",
			}),
		).toContain(
			JSON.stringify({
				type: "extension_ui_response",
				id: "uuid-3",
				value: "answer",
			}),
		);
	});
});
