import { describe, expect, it } from "vitest";
import { containerIdForSandbox } from "./workspace-runtime-policy";

describe("workspace runtime policy", () => {
	it("maps sandbox ids through the namespace without product credentials", () => {
		expect(
			containerIdForSandbox(
				{
					Sandbox: {
						idFromName: (name) => ({ toString: () => `id:${name}` }),
					},
				},
				"sbx-1",
			),
		).toBe("id:sbx-1");
	});
});
