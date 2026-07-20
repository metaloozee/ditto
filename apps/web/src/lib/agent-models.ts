export const DEFAULT_PROJECT_CODER_MODEL =
	"opencode/deepseek-v4-flash-free" as const;

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

/** Pi default before model-specific clamping. */
export const DEFAULT_THINKING_LEVEL: PiThinkingLevel = "medium";

/** Exact capabilities of the operator fallback model under Pi 0.80.10. */
export const FALLBACK_MODEL_THINKING_LEVELS = [
	"off",
	"high",
	"max",
] as const satisfies readonly PiThinkingLevel[];

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

export type ParsedModelSpecifier = {
	providerId: string;
	modelId: string;
};

/**
 * Syntax-only model specifier parse. Availability is decided by account
 * credential logic, not this helper.
 */
export function parseModelSpecifier(
	value: string,
): ParsedModelSpecifier | null {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_MODEL_SPECIFIER_LENGTH
	) {
		return null;
	}
	const slash = value.indexOf("/");
	if (
		slash <= 0 ||
		slash !== value.lastIndexOf("/") ||
		slash === value.length - 1
	) {
		return null;
	}
	const providerId = value.slice(0, slash);
	const modelId = value.slice(slash + 1);
	if (!providerId || !modelId) return null;
	return { providerId, modelId };
}

/** Syntax-only validator for request schemas. Not an availability check. */
export function isProjectCoderModelSpecifier(value: string): boolean {
	return parseModelSpecifier(value) !== null;
}

/** Fallback-only static list for zero-connection accounts. */
export const PROJECT_CODER_MODELS = [
	{
		id: DEFAULT_PROJECT_CODER_MODEL,
		name: "DeepSeek V4 Flash Free",
		provider: "opencode",
		providerName: "OpenCode Zen",
		thinkingLevels: FALLBACK_MODEL_THINKING_LEVELS,
	},
] as const;

export const PROJECT_CODER_MODEL_IDS = PROJECT_CODER_MODELS.map(
	(model) => model.id,
);

export type ProjectCoderModelSpecifier = string;
