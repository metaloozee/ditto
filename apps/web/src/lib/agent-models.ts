export const DEFAULT_PROJECT_CODER_MODEL =
	"opencode/deepseek-v4-flash-free" as const;

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

/** Intermediate static list until connected-provider models land. */
export const PROJECT_CODER_MODELS = [
	{
		id: DEFAULT_PROJECT_CODER_MODEL,
		name: "DeepSeek V4 Flash Free",
		provider: "opencode",
		providerName: "OpenCode Zen",
	},
] as const;

export const PROJECT_CODER_MODEL_IDS = PROJECT_CODER_MODELS.map(
	(model) => model.id,
);

export type ProjectCoderModelSpecifier =
	(typeof PROJECT_CODER_MODELS)[number]["id"];

export function isProjectCoderModelSpecifier(
	value: string,
): value is ProjectCoderModelSpecifier {
	// Step 1 keeps compile-time default; Step 5 opens syntax + availability.
	return parseModelSpecifier(value) !== null;
}
