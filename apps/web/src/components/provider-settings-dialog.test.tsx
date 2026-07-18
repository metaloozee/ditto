import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ProviderSettingsDialog", () => {
	it("states account-level scope and anthropic caveats in source", () => {
		const source = readFileSync(
			resolve(import.meta.dirname, "./provider-settings-dialog.tsx"),
			"utf8",
		);
		expect(source).toMatch(/apply to all of your projects/i);
		expect(source).toMatch(/extra usage billed/i);
		expect(source).toMatch(/localhost redirect/i);
		expect(source).toMatch(/Disconnect/);
		expect(source).toMatch(/type=\{prompt\.type === "secret" \? "password"/);
	});
});
