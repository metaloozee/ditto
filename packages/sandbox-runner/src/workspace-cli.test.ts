import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDirectRun } from "./workspace-cli.js";

describe("isDirectRun", () => {
	let dir: string;
	let file: string;
	let url: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-cli-"));
		file = path.join(dir, "workspace-cli.js");
		fs.writeFileSync(file, "");
		url = pathToFileURL(file).href;
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("is true when invoked through a symlink", () => {
		const link = path.join(dir, "ditto-workspace");
		fs.symlinkSync(file, link);
		expect(isDirectRun(link, url)).toBe(true);
	});

	it("is true for the real path", () => {
		expect(isDirectRun(file, url)).toBe(true);
	});

	it("is false for an unrelated file", () => {
		const other = path.join(dir, "other.js");
		fs.writeFileSync(other, "");
		expect(isDirectRun(other, url)).toBe(false);
	});

	it("is false without argv1", () => {
		expect(isDirectRun(undefined, url)).toBe(false);
	});

	it("is false for a dangling path", () => {
		expect(isDirectRun(path.join(dir, "missing"), url)).toBe(false);
	});
});
