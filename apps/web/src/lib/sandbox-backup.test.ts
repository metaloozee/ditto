import { describe, expect, it } from "vitest";
import { parseSandboxBackup, serializeSandboxBackup } from "./sandbox-backup";

describe("sandbox backup helpers", () => {
	it("serializes and parses an opaque archive id", () => {
		const archiveId = "11111111-1111-4111-8111-111111111111";
		expect(serializeSandboxBackup(archiveId)).toBe(archiveId);
		expect(parseSandboxBackup(archiveId)).toBe(archiveId);
	});

	it("returns null for invalid JSON leftover DirectoryBackup handles", () => {
		expect(parseSandboxBackup("{")).toBeNull();
		expect(
			parseSandboxBackup(JSON.stringify({ id: "backup-1", dir: "/workspace" })),
		).toBeNull();
	});

	it("returns null when the id is missing or empty", () => {
		expect(parseSandboxBackup(null)).toBeNull();
		expect(parseSandboxBackup("")).toBeNull();
		expect(parseSandboxBackup("   ")).toBeNull();
	});

	it("rejects ids that are not opaque archive tokens", () => {
		expect(parseSandboxBackup("id with spaces")).toBeNull();
		expect(parseSandboxBackup("https://example.com/archive")).toBeNull();
	});
});
