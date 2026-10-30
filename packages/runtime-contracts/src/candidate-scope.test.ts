import { describe, expect, it } from "vitest";
import { parseCandidateRuntimeScope } from "./candidate-scope.js";

describe("candidate runtime scope", () => {
	it("accepts a valid scope and rejects drift", () => {
		const scope = {
			version: 2,
			userId: "u",
			projectId: "p",
			workspaceSessionId: "s",
			ownerVersion: 1,
		};
		expect(parseCandidateRuntimeScope(scope)).toEqual(scope);
		const { workspaceSessionId: _omitted, ...missing } = scope;
		for (const value of [
			{ ...scope, extra: true },
			{ ...scope, version: 1 },
			{ ...scope, ownerVersion: 2 },
			missing,
		])
			expect(() => parseCandidateRuntimeScope(value)).toThrow();
	});
});
