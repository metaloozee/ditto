import { describe, expect, it } from "vitest";
import { sanitizeEnvVars } from "#/lib/project-env-vars";

describe("sanitizeEnvVars", () => {
	it("preserves value whitespace byte-for-byte", () => {
		const value = " leading\ntrailing ";
		expect(sanitizeEnvVars([{ key: " SECRET_KEY ", value }])).toEqual([
			{ key: "SECRET_KEY", value },
		]);
	});
});
