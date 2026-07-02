import { describe, expect, it } from "vitest";
import {
	buildFifoWriteCommand,
	makeBrokerDir,
	makeProcessId,
	makeRunnerCommand,
} from "./runner-command";

describe("runner supervisor command helpers", () => {
	it("sanitizes session ids for process ids and broker dirs", () => {
		expect(makeProcessId("session/with spaces")).toBe(
			"ditto-runner-session-with-spaces",
		);
		expect(makeBrokerDir("session/with spaces")).toBe(
			"/tmp/ditto/runner/session-with-spaces",
		);
	});

	it("starts the runner without directly redirecting stdin from the FIFO", () => {
		const command = makeRunnerCommand({
			brokerDir: "/tmp/ditto/runner/s1",
			fifoPath: "/tmp/ditto/runner/s1/runner.in",
			modelSpecifier: "openai/gpt-4.1",
		});

		expect(command).toContain("mkfifo '/tmp/ditto/runner/s1/runner.in'");
		expect(command).toContain(
			"while true; do cat '/tmp/ditto/runner/s1/runner.in'; done | exec env",
		);
		expect(command).toContain("tsx /opt/ditto/sandbox/runner/index.ts");
		expect(command).not.toContain("< '/tmp/ditto/runner/s1/runner.in'");
	});

	it("quotes FIFO writes as one NDJSON line", () => {
		expect(
			buildFifoWriteCommand("/tmp/a fifo", '{"type":"abort","id":"r1"}'),
		).toBe('printf %s \'{"type":"abort","id":"r1"}\n\' > \'/tmp/a fifo\'');
	});
});
