const ENV_VAR_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const ENV_VAR_KEY_DESCRIPTION =
	"Use letters, numbers, and underscores. Start with a letter or underscore.";

export function normalizeEnvVarKey(rawKey: string): string | null {
	const key = rawKey.trim();

	if (!ENV_VAR_KEY_PATTERN.test(key)) {
		return null;
	}

	return key;
}
