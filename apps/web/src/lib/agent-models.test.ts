import { describe, expect, it } from "vitest";
import {
	clampToSupportedThinkingLevel,
	DEFAULT_PROJECT_CODER_MODEL,
	DEFAULT_THINKING_LEVEL,
	effectiveThinkingLevel,
	isProjectCoderModelSpecifier,
	type PiThinkingLevel,
	parseModelSpecifier,
} from "#/lib/agent-models";

describe("thinking level clamp", () => {
	const sparse: readonly PiThinkingLevel[] = ["off", "high", "max"];

	it("returns preferred when supported", () => {
		expect(clampToSupportedThinkingLevel("high", sparse)).toBe("high");
	});

	it("scans upward first, then downward", () => {
		// medium → high (upward)
		expect(clampToSupportedThinkingLevel("medium", sparse)).toBe("high");
		// xhigh → max (upward)
		expect(clampToSupportedThinkingLevel("xhigh", sparse)).toBe("max");
		// low → high (upward past holes)
		expect(clampToSupportedThinkingLevel("low", sparse)).toBe("high");
	});

	it("defaults preference is high", () => {
		expect(DEFAULT_THINKING_LEVEL).toBe("high");
		expect(clampToSupportedThinkingLevel(DEFAULT_THINKING_LEVEL, sparse)).toBe(
			"high",
		);
	});

	it("missing metadata yields Auto/undefined", () => {
		expect(effectiveThinkingLevel("medium", undefined)).toBeUndefined();
		expect(effectiveThinkingLevel("medium", null)).toBeUndefined();
		expect(effectiveThinkingLevel("medium", [])).toBeUndefined();
	});
});

describe("fixed model specifier", () => {
	it("accepts only the exact fallback model", () => {
		expect(isProjectCoderModelSpecifier(DEFAULT_PROJECT_CODER_MODEL)).toBe(
			true,
		);
		expect(parseModelSpecifier(DEFAULT_PROJECT_CODER_MODEL)).toEqual({
			providerId: "opencode",
			modelId: "deepseek-v4-flash-free",
		});
		expect(isProjectCoderModelSpecifier("anthropic/claude-sonnet")).toBe(false);
		expect(isProjectCoderModelSpecifier("opencode/some-paid-model")).toBe(
			false,
		);
		expect(parseModelSpecifier("opencode/some-paid-model")).toBeNull();
	});
});
