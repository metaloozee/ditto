import { describe, expect, it, vi } from "vitest";

vi.mock("#/db", () => ({
	createDb: () => ({}),
}));

vi.mock("#/lib/account-provider-credentials", () => ({
	createCredentialRepository: vi.fn((db) => db),
	listConnections: vi.fn(async () => [
		{
			providerId: "anthropic",
			authType: "oauth",
			status: "connected",
			lastErrorCode: null,
			models: [{ providerId: "anthropic", modelId: "claude", name: "Claude" }],
		},
	]),
	deleteCredentialWithLease: vi.fn(async () => true),
}));

vi.mock("#/lib/provider-auth-service", () => ({
	getProviderCatalog: vi.fn(async () => ({
		providers: [
			{
				providerId: "anthropic",
				name: "Anthropic",
				authMethods: [{ type: "oauth", label: "Claude" }],
				models: [],
			},
		],
	})),
	listAccountModels: vi.fn(async () => [
		{
			providerId: "opencode",
			modelId: "deepseek-v4-flash-free",
			name: "DeepSeek V4 Flash Free",
		},
	]),
}));

import { providerAuthRouter } from "#/integrations/trpc/routers/provider-auth";

describe("providerAuth router", () => {
	it("exposes catalog/connections/models/disconnect without secrets", async () => {
		const ctx = {
			env: {},
			session: { user: { id: "user-1" } },
		};
		const caller = providerAuthRouter.createCaller(ctx as never);
		const catalog = await caller.catalog();
		expect(catalog.providers[0]?.providerId).toBe("anthropic");
		const connections = await caller.connections();
		expect(JSON.stringify(connections)).not.toMatch(/sk-|refresh|accessToken/);
		const models = await caller.models();
		expect(models.models[0]?.id).toContain("opencode/");
		const disconnected = await caller.disconnect({ providerId: "anthropic" });
		expect(disconnected.deleted).toBe(true);
	});
});
