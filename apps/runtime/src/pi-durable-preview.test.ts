import { describe, expect, it } from "vitest";
import {
	candidateSandboxName,
	newPreviewToken,
	parseCandidatePreviewHost,
	previewToken,
	previewTokenDigest,
} from "./pi-durable-preview.ts";

const uuid = "0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f";

describe("candidate preview helpers", () => {
	it("prefixes the sandbox name", () => {
		expect(candidateSandboxName("abc")).toBe("c-abc");
	});

	it("reads the bearer from a preview url", () => {
		expect(
			previewToken("http://10000-c-workspace-ab12_x.localhost:5173/"),
		).toBe("ab12_x");
		expect(previewToken("http://localhost/")).toBeUndefined();
		expect(previewToken("http://10000.localhost/")).toBeUndefined();
		expect(
			previewToken("http://10000-c-workspace-abcdefghijklmnopq.localhost/"),
		).toBeUndefined();
		expect(
			previewToken("http://10000-c-workspace-ab+cd.localhost/"),
		).toBeUndefined();
		expect(previewToken("not a url")).toBeUndefined();
	});

	it("mints distinct 16-character tokens", () => {
		expect(newPreviewToken()).toMatch(/^[a-z0-9]{16}$/);
		const tokens = new Set(Array.from({ length: 1000 }, newPreviewToken));
		expect(tokens.size).toBe(1000);
	});

	it("digests as lowercase sha-256 hex", async () => {
		expect(await previewTokenDigest("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("parses only candidate preview hosts", () => {
		expect(parseCandidatePreviewHost(`10000-c-${uuid}-tok.ayn.wtf`)).toEqual({
			workspaceSessionId: uuid,
			token: "tok",
		});
		expect(
			parseCandidatePreviewHost(`10000-C-${uuid.toUpperCase()}-Tok.LOCALHOST`),
		).toEqual({ workspaceSessionId: uuid, token: "tok" });
		for (const host of [
			`10000-${uuid}-tok.ayn.wtf`,
			`3000-c-${uuid}-tok.ayn.wtf`,
			"10000-c-notauuid-tok.ayn.wtf",
			`x.10000-c-${uuid}-tok.ayn.wtf`,
			`10000-c-${uuid}-tok.ayn.wtf.evil.com`,
			`10000-c-${uuid}-tok.workers.dev`,
		])
			expect(parseCandidatePreviewHost(host)).toBeUndefined();
	});
});
