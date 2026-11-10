import type { DEFAULT_MODEL_SPECIFIER } from "#/lib/default-model";

// Type-only import: default-model.ts imports PI_THINKING_LEVELS from here.
export const DEFAULT_PROJECT_CODER_MODEL =
	"ditto/default" as const satisfies typeof DEFAULT_MODEL_SPECIFIER;

/** Canonical Pi abstract thinking levels (0.80.10), in clamp order. */
export const PI_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

/** Exact capabilities of the operator fallback model under Pi 0.80.10. */
export const FALLBACK_MODEL_THINKING_LEVELS = [
	"off",
	"high",
	"max",
] as const satisfies readonly PiThinkingLevel[];

export type SupportedThinkingLevel =
	(typeof FALLBACK_MODEL_THINKING_LEVELS)[number];

/** Default preference for the fixed model (`medium` is not supported). */
export const DEFAULT_THINKING_LEVEL: SupportedThinkingLevel = "high";

export const PI_THINKING_LEVEL_LABELS: Record<PiThinkingLevel, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
};

export function isPiThinkingLevel(value: unknown): value is PiThinkingLevel {
	return (
		typeof value === "string" &&
		(PI_THINKING_LEVELS as readonly string[]).includes(value)
	);
}

export function isSupportedThinkingLevel(
	value: unknown,
): value is SupportedThinkingLevel {
	return (
		typeof value === "string" &&
		(FALLBACK_MODEL_THINKING_LEVELS as readonly string[]).includes(value)
	);
}

/**
 * Clamp preferred abstract level to a supported list.
 * Pi semantics: scan upward in canonical order first, then downward.
 */
export function clampToSupportedThinkingLevel(
	preferred: PiThinkingLevel,
	supported: readonly PiThinkingLevel[],
): PiThinkingLevel {
	const fallback = supported[0] ?? "off";
	if (supported.length === 0) return fallback;
	const allowed = new Set<string>(supported);
	if (allowed.has(preferred)) return preferred;
	const requestedIndex = PI_THINKING_LEVELS.indexOf(preferred);
	if (requestedIndex === -1) return fallback;
	for (let i = requestedIndex; i < PI_THINKING_LEVELS.length; i++) {
		const candidate = PI_THINKING_LEVELS[i];
		if (candidate !== undefined && allowed.has(candidate)) return candidate;
	}
	for (let i = requestedIndex - 1; i >= 0; i--) {
		const candidate = PI_THINKING_LEVELS[i];
		if (candidate !== undefined && allowed.has(candidate)) return candidate;
	}
	return fallback;
}

/**
 * Effective level for UI/request. Missing/empty capability metadata =>
 * undefined (legacy Auto: omit thinkingLevel from the request).
 */
export function effectiveThinkingLevel(
	preferred: PiThinkingLevel,
	thinkingLevels: readonly PiThinkingLevel[] | null | undefined,
): PiThinkingLevel | undefined {
	if (!thinkingLevels || thinkingLevels.length === 0) return undefined;
	return clampToSupportedThinkingLevel(preferred, thinkingLevels);
}

/** Bound total length of a `provider/model` specifier. */
export const MAX_MODEL_SPECIFIER_LENGTH = 200;

/** Fixed-model list for composer context. */
export const PROJECT_CODER_MODELS = [
	{
		id: DEFAULT_PROJECT_CODER_MODEL,
		name: "Default model",
		provider: "ditto",
		providerName: "Ditto",
		thinkingLevels: FALLBACK_MODEL_THINKING_LEVELS,
	},
] as const;

export type ProjectCoderModelSpecifier = typeof DEFAULT_PROJECT_CODER_MODEL;
