/** Portable provider -> allowed auth types. Account-level D1 only. */
export const PORTABLE_PROVIDER_AUTH = {
	anthropic: ["api_key", "oauth"],
	openai: ["api_key"],
	"openai-codex": ["oauth"],
	xai: ["api_key", "oauth"],
	"github-copilot": ["oauth"],
	opencode: ["api_key"],
	"opencode-go": ["api_key"],
	deepseek: ["api_key"],
	google: ["api_key"],
	mistral: ["api_key"],
	groq: ["api_key"],
	cerebras: ["api_key"],
	openrouter: ["api_key"],
	"vercel-ai-gateway": ["api_key"],
	fireworks: ["api_key"],
	together: ["api_key"],
} as const;

export type PortableProviderId = keyof typeof PORTABLE_PROVIDER_AUTH;
export type PortableAuthType =
	(typeof PORTABLE_PROVIDER_AUTH)[PortableProviderId][number];

export function isPortableProviderId(
	value: string,
): value is PortableProviderId {
	return Object.hasOwn(PORTABLE_PROVIDER_AUTH, value);
}

export function isAllowedAuthType(
	providerId: string,
	authType: string,
): authType is PortableAuthType {
	if (!isPortableProviderId(providerId)) return false;
	return (PORTABLE_PROVIDER_AUTH[providerId] as readonly string[]).includes(
		authType,
	);
}

export const OAUTH_REFRESH_SENTINEL = "ditto:no-refresh";
export const RESULT_DIR = "/tmp/ditto-provider-auth-results";
export const AUTH_CONTROL_DIR = "/tmp/ditto-provider-auth-controls";
export const MAX_SAFE_MODELS = 500;
export const MAX_PROMPT_ANSWER_BYTES = 8_192;
export const RESULT_HANDSHAKE_TIMEOUT_MS = 30_000;
export const RESULT_HANDSHAKE_POLL_MS = 50;
