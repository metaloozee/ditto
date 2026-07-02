import { describe, expect, it } from "vitest";
import {
	mapSdkEventToDitto,
	parseRunnerEvent,
	planRunnerCommand,
	RunnerEventBuffer,
	redactSecrets,
	serializeRunnerCommand,
	serializeRunnerEvent,
} from "./runner-protocol";

describe("Runner protocol", () => {
	it("parses documented event frames", () => {
		expect(
			parseRunnerEvent(
				JSON.stringify({
					type: "ready",
					runnerVersion: "1",
					model: "opencode-go/qwen3.7-plus",
				}),
			),
		).toMatchObject({ type: "ready", runnerVersion: "1" });

		expect(
			parseRunnerEvent(
				JSON.stringify({
					type: "assistant_delta",
					runId: "run-1",
					text: "Hello ",
				}),
			),
		).toMatchObject({ type: "assistant_delta", runId: "run-1" });

		expect(
			parseRunnerEvent(
				JSON.stringify({
					type: "input_request",
					runId: "run-1",
					requestId: "req-1",
					question: "Which file?",
				}),
			),
		).toMatchObject({ type: "input_request", requestId: "req-1" });

		expect(
			parseRunnerEvent(
				JSON.stringify({ type: "done", runId: "run-1", status: "completed" }),
			),
		).toMatchObject({ type: "done", status: "completed" });
	});

	it("rejects non-JSON output", () => {
		expect(() => parseRunnerEvent("Starting runner...")).toThrow(
			"Runner emitted non-JSON output: Starting runner...",
		);
	});

	it("rejects unknown event types", () => {
		expect(() => parseRunnerEvent(JSON.stringify({ type: "bogus" }))).toThrow(
			"Runner emitted an unknown event type.",
		);
	});

	it("uses strict LF-delimited JSONL framing", () => {
		const buffer = new RunnerEventBuffer();

		expect(
			buffer.push('{"type":"ready","runnerVersion":"1","model":"m"}\r\n'),
		).toMatchObject([{ type: "ready" }]);
		expect(
			buffer.push('{"type":"done","runId":"r","status":"completed"}'),
		).toEqual([]);
		expect(buffer.push("\n")).toMatchObject([{ type: "done" }]);
	});

	it("serializes commands and events as one JSON line that round-trips", () => {
		const command = { type: "prompt", id: "run-1", message: "hi" } as const;
		const serializedCommand = serializeRunnerCommand(command);
		expect(JSON.parse(serializedCommand)).toEqual(command);

		const event = {
			type: "done",
			runId: "run-1",
			status: "completed",
		} as const;
		const serializedEvent = serializeRunnerEvent(event);
		expect(JSON.parse(serializedEvent)).toEqual(event);
		expect(parseRunnerEvent(serializedEvent)).toMatchObject(event);
	});

	describe("mapSdkEventToDitto", () => {
		it("maps message_update text_delta to assistant_delta", () => {
			const event = {
				type: "message_update",
				message: {},
				assistantMessageEvent: {
					type: "text_delta",
					contentIndex: 0,
					delta: "Hello ",
					partial: {},
				},
			};
			expect(mapSdkEventToDitto(event, "run-1")).toEqual([
				{ type: "assistant_delta", runId: "run-1", text: "Hello " },
			]);
		});

		it("maps tool_execution_start to tool_started", () => {
			expect(
				mapSdkEventToDitto(
					{
						type: "tool_execution_start",
						toolName: "read_file",
						label: "Read",
					},
					"run-1",
				),
			).toEqual([
				{
					type: "tool_started",
					runId: "run-1",
					toolName: "read_file",
					label: "Read",
				},
			]);
		});

		it("maps tool_execution_update to tool_progress", () => {
			expect(
				mapSdkEventToDitto(
					{
						type: "tool_execution_update",
						partialResult: {
							content: [{ type: "text", text: "working..." }],
						},
					},
					"run-1",
				),
			).toEqual([
				{ type: "tool_progress", runId: "run-1", text: "working..." },
			]);
		});

		it("maps tool_execution_end to tool_finished only (no file_changed)", () => {
			const result = mapSdkEventToDitto(
				{ type: "tool_execution_end", toolName: "read_file", result: "ok" },
				"run-1",
			);
			expect(result).toEqual([
				{
					type: "tool_finished",
					runId: "run-1",
					toolName: "read_file",
					status: "completed",
				},
			]);
			expect(result.some((e) => e.type === "file_changed")).toBe(false);
		});

		it("maps agent_end to done(completed)", () => {
			expect(mapSdkEventToDitto({ type: "agent_end" }, "run-1")).toEqual([
				{ type: "done", runId: "run-1", status: "completed" },
			]);
		});

		it("maps extension_error to error then done(failed)", () => {
			expect(
				mapSdkEventToDitto(
					{ type: "extension_error", message: "boom" },
					"run-1",
				),
			).toEqual([
				{ type: "error", runId: "run-1", message: "boom" },
				{ type: "done", runId: "run-1", status: "failed" },
			]);
		});

		it("returns no events for unknown types", () => {
			expect(mapSdkEventToDitto({ type: "queue_update" }, "run-1")).toEqual([]);
			expect(mapSdkEventToDitto({ type: "message_start" }, "run-1")).toEqual(
				[],
			);
		});
	});

	describe("planRunnerCommand", () => {
		const pending = new Set(["req-1"]);
		const hasPendingInput = (id: string) => pending.has(id);

		it("dispatches prompt commands", () => {
			expect(
				planRunnerCommand(
					{ type: "prompt", id: "run-1", message: "list files" },
					hasPendingInput,
				),
			).toEqual({ action: "prompt", message: "list files" });
		});

		it("dispatches reply commands with a pending input request", () => {
			expect(
				planRunnerCommand(
					{ type: "reply", requestId: "req-1", answer: "yes" },
					hasPendingInput,
				),
			).toEqual({
				action: "resolveInput",
				requestId: "req-1",
				answer: "yes",
			});
		});

		it("ignores reply commands for unknown request ids", () => {
			expect(
				planRunnerCommand(
					{ type: "reply", requestId: "nope", answer: "yes" },
					hasPendingInput,
				),
			).toBeNull();
		});

		it("dispatches abort commands", () => {
			expect(
				planRunnerCommand({ type: "abort", id: "run-1" }, hasPendingInput),
			).toEqual({ action: "abort" });
		});
	});

	describe("redactSecrets", () => {
		it("redacts concrete secret strings wherever they appear", () => {
			expect(
				redactSecrets("token=live-secret-value-123-suffix", [
					"live-secret-value-123",
				]),
			).toBe("token=[REDACTED]-suffix");
		});

		it("does not redact concrete secrets shorter than 8 characters", () => {
			expect(redactSecrets("short abc123 value", ["abc123"])).toBe(
				"short abc123 value",
			);
		});

		it("redacts GitHub tokens by pattern", () => {
			const token = `ghp_${"a".repeat(40)}`;
			expect(redactSecrets(`token=${token}`, [])).toBe("token=[REDACTED]");
		});

		it("redacts PEM private-key blocks as a unit", () => {
			const key = [
				"-----BEGIN RSA PRIVATE KEY-----",
				"fake-key-material",
				"-----END RSA PRIVATE KEY-----",
			].join("\n");
			expect(redactSecrets(`before\n${key}\nafter`, [])).toBe(
				"before\n[REDACTED]\nafter",
			);
		});

		it("redacts AWS access key ids by pattern", () => {
			expect(redactSecrets("aws AKIAABCDEFGHIJKLMNOP ok", [])).toBe(
				"aws [REDACTED] ok",
			);
		});

		it("redacts provider API keys by pattern", () => {
			const key = `sk-test-${"b".repeat(24)}`;
			expect(redactSecrets(`provider ${key}`, [])).toBe("provider [REDACTED]");
		});

		it("returns non-secret text unchanged", () => {
			const text = "read /workspace/src/index.ts and wrote normal log output";
			expect(redactSecrets(text, [])).toBe(text);
		});

		it("redacts multiple secrets in one string", () => {
			const githubToken = `ghs_${"c".repeat(40)}`;
			expect(
				redactSecrets(`one secret-value-123 two ${githubToken}`, [
					"secret-value-123",
				]),
			).toBe("one [REDACTED] two [REDACTED]");
		});

		it("applies regex patterns when concrete secrets is empty", () => {
			const key = `sk-ant-${"d".repeat(24)}`;
			expect(redactSecrets(`anthropic ${key}`, [])).toBe(
				"anthropic [REDACTED]",
			);
		});
	});
});
