export type ApiKeyCredential = {
	type: "api_key";
	key?: string;
	env?: Record<string, string>;
};

export type CredentialConfig = {
	AI_CREDENTIALS_ENCRYPTION_KEY: string;
	BETTER_AUTH_SECRET: string;
	OPENCODE_API_KEY: string;
};

export function assertCredentialConfig(env: CredentialConfig): void {
	const enc = env.AI_CREDENTIALS_ENCRYPTION_KEY?.trim() ?? "";
	const auth = env.BETTER_AUTH_SECRET?.trim() ?? "";
	const opencode = env.OPENCODE_API_KEY?.trim() ?? "";
	if (!enc) {
		throw new Error("AI_CREDENTIALS_ENCRYPTION_KEY is required.");
	}
	if (!auth) {
		throw new Error("BETTER_AUTH_SECRET is required.");
	}
	if (!opencode) {
		throw new Error("OPENCODE_API_KEY is required.");
	}
	if (enc === auth) {
		throw new Error(
			"AI_CREDENTIALS_ENCRYPTION_KEY must differ from BETTER_AUTH_SECRET.",
		);
	}
}

/** Collect every nonempty string leaf except structural `type`. */
export function credentialSecretValues(credential: unknown): string[] {
	const out: string[] = [];
	const walk = (value: unknown, key?: string) => {
		if (typeof value === "string") {
			if (key === "type") return;
			if (value.length > 0) out.push(value);
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) walk(item);
			return;
		}
		if (value && typeof value === "object") {
			for (const [k, child] of Object.entries(value)) {
				walk(child, k);
			}
		}
	};
	walk(credential);
	return out;
}

export function operatorFallbackCredential(apiKey: string): ApiKeyCredential {
	return { type: "api_key", key: apiKey };
}
