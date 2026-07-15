import { describe, expect, it } from "vitest";
import { normalizeEnvVarKey } from "#/lib/env-vars";

describe("normalizeEnvVarKey", () => {
	it("accepts underscore-style names", () => {
		expect(normalizeEnvVarKey("NODE_ENV")).toBe("NODE_ENV");
		expect(normalizeEnvVarKey("VITE_APP_TITLE")).toBe("VITE_APP_TITLE");
	});

	it("trims accepted names", () => {
		expect(normalizeEnvVarKey(" NODE_ENV ")).toBe("NODE_ENV");
	});

	it.each([
		["blank", ""],
		["whitespace-only", "   "],
		["spaces", "NODE ENV"],
		["equals signs", "NODE_ENV=value"],
		["newlines", "NODE_ENV\nVITE_APP_TITLE"],
	])("rejects %s keys", (_label, key) => {
		expect(normalizeEnvVarKey(key)).toBeNull();
	});
});
