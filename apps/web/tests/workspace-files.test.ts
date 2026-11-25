import { describe, expect, it } from "vite-plus/test";

import { fileKey, requestedFileKey } from "../src/lib/workspace-files.ts";

describe("the workspace file key scheme", () => {
	it("keeps each kind of file under its workspace ID", () => {
		expect(fileKey("ws-1a2b", "published", "task-7/report.pdf")).toBe(
			"ws-1a2b/published/task-7/report.pdf",
		);
		expect(fileKey("ws-1a2b", "screenshots", "bot-3/0001.png")).toBe(
			"ws-1a2b/screenshots/bot-3/0001.png",
		);
		expect(fileKey("ws-1a2b", "home", "2026-11-25T10-00-00Z.tar.zst")).toBe(
			"ws-1a2b/home/2026-11-25T10-00-00Z.tar.zst",
		);
	});

	it("refuses a name that could leave its prefix or be read two ways", () => {
		for (const name of ["", "../x", "a/../../x", "./x", "a//b", "a/", "a\\b", "a\u0000b"]) {
			expect(fileKey("ws-1a2b", "published", name), JSON.stringify(name)).toBeNull();
		}
		expect(fileKey("ws/../other", "published", "x")).toBeNull();
	});

	it("reads a request path's percent-encoding once per segment", () => {
		expect(requestedFileKey("ws-1a2b", "published/Q3%20report.pdf")).toBe(
			"ws-1a2b/published/Q3 report.pdf",
		);
		for (const path of [
			"published/..%2Fx",
			"published/%2e%2e",
			"ws-other/published/x",
			"published/%E0%A4%A",
		]) {
			expect(requestedFileKey("ws-1a2b", path), path).toBeNull();
		}
	});
});
