import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	sendAuthControlRequest,
	startAuthControlServer,
} from "./provider-auth-control.js";
import { parseAuthControlRequest } from "./provider-auth-protocol.js";

describe("provider-auth-control", () => {
	it("rejects malformed/oversized/stale controls", async () => {
		expect(() => parseAuthControlRequest(null)).toThrow();
		expect(() =>
			parseAuthControlRequest({
				attemptId: "a",
				action: "answer",
				promptId: "p",
				value: "x".repeat(20_000),
			}),
		).toThrow();

		const server = await startAuthControlServer({
			attemptId: "attempt-1",
			handle: async () => ({ accepted: true, action: "answer" }),
		});
		try {
			const stale = await sendAuthControlRequest({
				attemptId: "other",
				action: "cancel",
			}, { socketPath: server.socketPath });
			expect(stale.accepted).toBe(false);
		} finally {
			await server.close();
		}
	});

	it("answer jobs are mode 0600 and removed after one read pattern", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ditto-auth-job-"));
		const file = path.join(dir, "answer.json");
		const fd = fs.openSync(file, "w", 0o600);
		fs.writeFileSync(fd, JSON.stringify({ ok: true }));
		fs.fchmodSync(fd, 0o600);
		fs.closeSync(fd);
		expect(fs.statSync(file).mode & 0o777).toBe(0o600);
		fs.unlinkSync(file);
		expect(fs.existsSync(file)).toBe(false);
	});
});
