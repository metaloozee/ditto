import { describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/sandbox", () => ({
	getSandbox: vi.fn(),
}));

vi.mock("@flue/runtime/cloudflare", () => ({
	cloudflareSandbox: vi.fn(),
}));

describe("flue agent route contract", () => {
	it("exposes the direct HTTP route entrypoint", async () => {
		// The Flue runtime only exposes POST /agents/:name/:id when the agent module exports route.
		const module = await import("../../.flue/agents/project-coder");

		expect(typeof module.route).toBe("function");
		expect(module.default).toBeDefined();
	});
});
