import { describe, expect, it, vi } from "vitest";

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: vi.fn(),
	destroySandbox: vi.fn(),
}));

const {
	listAccountModels,
	providerAuthControlBodySchema,
	providerAuthStreamBodySchema,
} = await import("#/lib/provider-auth-service");
const { FALLBACK_MODEL_SPECIFIER } = await import(
	"#/lib/account-provider-credentials"
);

describe("provider-auth-service", () => {
	it("validates stream/control bodies", () => {
		expect(
			providerAuthStreamBodySchema.safeParse({
				providerId: "openai",
				authType: "api_key",
			}).success,
		).toBe(true);
		expect(
			providerAuthControlBodySchema.safeParse({
				action: "answer",
				attemptId: "a",
				promptId: "p",
				value: "x",
			}).success,
		).toBe(true);
		const cancel = providerAuthControlBodySchema.safeParse({
			action: "cancel",
			attemptId: "a",
			value: "nope",
		});
		expect(cancel.success).toBe(true);
		if (cancel.success) {
			expect(cancel.data).toEqual({ action: "cancel", attemptId: "a" });
			expect(cancel.data).not.toHaveProperty("value");
		}
	});

	it("always includes fallback model and hides needs_relogin models", async () => {
		const models = await listAccountModels({
			db: {} as never,
			userId: "user-a",
			listConnections: async () => [
				{
					providerId: "anthropic",
					status: "connected",
					models: [
						{
							providerId: "anthropic",
							modelId: "claude",
							name: "Claude",
						},
					],
				},
				{
					providerId: "openai",
					status: "needs_relogin",
					models: [
						{
							providerId: "openai",
							modelId: "gpt",
							name: "GPT",
						},
					],
				},
			],
		});
		expect(
			models.some(
				(m) => `${m.providerId}/${m.modelId}` === FALLBACK_MODEL_SPECIFIER,
			),
		).toBe(true);
		expect(models.some((m) => m.modelId === "claude")).toBe(true);
		expect(models.some((m) => m.modelId === "gpt")).toBe(false);
	});

	it("stream body rejects unknown shapes", () => {
		expect(
			providerAuthStreamBodySchema.safeParse({ providerId: "x" }).success,
		).toBe(false);
	});
});
