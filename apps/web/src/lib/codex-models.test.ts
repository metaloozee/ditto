import { describe, expect, it } from "vitest";
import { parseAccountSnapshot } from "../../../../packages/runtime-contracts/src/model.js";
import {
	buildAccountSnapshot,
	buildCodexModelsRequest,
	defaultSelectionFrom,
	parseCodexModels,
} from "./codex-models";

const levels = (...efforts: string[]) =>
	efforts.map((effort) => ({ effort, description: "x" }));
const entry = (
	slug: string,
	visibility: string,
	efforts: string[],
	extra: Record<string, unknown> = {},
) => ({
	slug,
	visibility,
	supported_reasoning_levels: levels(...efforts),
	default_reasoning_level: "medium",
	...extra,
});

const listed = [
	entry("gpt-6.1-sol", "list", ["low", "medium", "high", "xhigh", "ultra"]),
	entry("gpt-6.1-hidden", "hide", ["low", "medium"]),
	entry("gpt-6.1-mini", "list", ["low", "medium", "high"]),
	entry("gpt-6", "list", ["minimal", "low", "medium", "high", "max", "ultra"]),
	entry("gpt-5.5", "list", ["medium", "high"]),
	entry("gpt-5.4", "list", ["low", "medium"]),
	entry("gpt-5.3", "list", ["low", "medium", "high"]),
	entry("gpt-5.2", "list", ["medium"]),
	entry("gpt-5.1-hidden", "hide", ["low"]),
	entry("gpt-5.1", "list", ["low", "medium", "high", "ultra"]),
];

describe("parseCodexModels", () => {
	it("keeps listed models in server order without ultra and puts the default first", () => {
		const models = parseCodexModels({ models: listed });
		expect(models?.map((m) => m.id)).toEqual([
			"gpt-6.1-sol",
			"gpt-6.1-mini",
			"gpt-6",
			"gpt-5.5",
			"gpt-5.4",
			"gpt-5.3",
			"gpt-5.2",
			"gpt-5.1",
		]);
		for (const model of models ?? []) {
			expect(model.thinking[0]).toBe("medium");
			expect(model.thinking).not.toContain("ultra");
		}
		expect(models?.[0].thinking).toEqual(["medium", "low", "high", "xhigh"]);
	});
	it("drops fixture slugs, duplicates and ultra-only models", () => {
		const models = parseCodexModels({
			models: [
				entry("faux-1", "list", ["low"]),
				entry("gpt-6", "list", ["low"]),
				entry("gpt-6", "list", ["high"]),
				entry("only-ultra", "list", ["ultra"]),
				entry("bad slug", "list", ["low"]),
			],
		});
		expect(models).toEqual([{ id: "gpt-6", thinking: ["low"] }]);
	});
	it("rejects a body without a model list", () => {
		expect(parseCodexModels({})).toBeNull();
		expect(parseCodexModels(null)).toBeNull();
	});
});

describe("buildCodexModelsRequest", () => {
	it("pins the client version and never carries authorization", () => {
		const request = buildCodexModelsRequest("acct_1");
		expect(request.url).toBe(
			"https://chatgpt.com/backend-api/codex/models?client_version=0.167.0",
		);
		expect(request.init.redirect).toBe("manual");
		expect(request.init.headers).not.toHaveProperty("authorization");
		expect(request.init.headers["chatgpt-account-id"]).toBe("acct_1");
	});
});

describe("buildAccountSnapshot", () => {
	it("stays within the stored bound and still parses", () => {
		const models = Array.from({ length: 16 }, (_, i) => ({
			id: `gpt-${"x".repeat(100)}-${i}`,
			thinking: ["minimal", "low", "medium", "high", "xhigh", "max"] as const,
		})).map((m) => ({ ...m, thinking: [...m.thinking] }));
		const snapshot = buildAccountSnapshot(3, 7, models);
		expect(snapshot.length).toBeLessThanOrEqual(4096);
		const parsed = parseAccountSnapshot(snapshot);
		expect(parsed.models.length).toBeGreaterThan(0);
		expect(parsed.revision).toBe(7);
	});
	it("is unavailable with no models", () => {
		expect(parseAccountSnapshot(buildAccountSnapshot(1, 1, []))).toMatchObject({
			status: "unavailable",
			models: [],
		});
	});
});

describe("defaultSelectionFrom", () => {
	it("takes the first model and level, or nothing when unavailable", () => {
		const available = parseAccountSnapshot(
			buildAccountSnapshot(1, 1, [
				{ id: "gpt-6", thinking: ["medium", "high"] },
			]),
		);
		expect(defaultSelectionFrom(available)).toEqual({
			model: "gpt-6",
			thinking: "medium",
		});
		expect(
			defaultSelectionFrom(
				parseAccountSnapshot(buildAccountSnapshot(1, 1, [])),
			),
		).toBeNull();
	});
});
