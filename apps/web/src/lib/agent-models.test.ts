import { describe, expect, it } from "vitest";
import {
	clampToSupportedThinkingLevel,
	DEFAULT_THINKING_LEVEL,
	effectiveThinkingLevel,
	type PiThinkingLevel,
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

	it("defaults preference is medium", () => {
		expect(DEFAULT_THINKING_LEVEL).toBe("medium");
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
