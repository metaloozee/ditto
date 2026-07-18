import { z } from "zod";

const MAX_MSG = 500;
const MAX_ID = 128;
const MAX_URL = 2_048;

export const providerAuthEventSchema = z.discriminatedUnion("kind", [
	z
		.object({
			v: z.literal(1),
			kind: z.literal("prompt"),
			promptId: z.string().min(1).max(MAX_ID),
			type: z.enum(["text", "secret", "select", "manual_code"]),
			message: z.string().min(1).max(MAX_MSG),
			placeholder: z.string().max(200).optional(),
			options: z
				.array(
					z.object({
						id: z.string().min(1).max(MAX_ID),
						label: z.string().min(1).max(200),
						description: z.string().max(200).optional(),
					}),
				)
				.max(32)
				.optional(),
		})
		.strict(),
	z
		.object({
			v: z.literal(1),
			kind: z.literal("auth_url"),
			url: z.string().min(1).max(MAX_URL),
			instructions: z.string().max(MAX_MSG).optional(),
		})
		.strict(),
	z
		.object({
			v: z.literal(1),
			kind: z.literal("device_code"),
			userCode: z.string().min(1).max(64),
			verificationUri: z.string().min(1).max(MAX_URL),
			intervalSeconds: z.number().positive().optional(),
			expiresInSeconds: z.number().positive().optional(),
		})
		.strict(),
	z
		.object({
			v: z.literal(1),
			kind: z.literal("info"),
			message: z.string().min(1).max(MAX_MSG),
		})
		.strict(),
	z
		.object({
			v: z.literal(1),
			kind: z.literal("progress"),
			message: z.string().min(1).max(MAX_MSG),
		})
		.strict(),
	z.object({ v: z.literal(1), kind: z.literal("credential_ready") }).strict(),
	z
		.object({
			v: z.literal(1),
			kind: z.literal("attempt_meta"),
			enterpriseHost: z
				.string()
				.min(1)
				.max(253)
				.regex(/^[A-Za-z0-9.-]+$/),
		})
		.strict(),
	z
		.object({
			v: z.literal(1),
			kind: z.literal("done"),
			ok: z.boolean(),
		})
		.strict(),
	z
		.object({
			v: z.literal(1),
			kind: z.literal("error"),
			code: z.string().min(1).max(64),
			message: z.string().min(1).max(MAX_MSG),
		})
		.strict(),
]);

export type ProviderAuthEvent = z.infer<typeof providerAuthEventSchema>;

const BANNED_KEYS = new Set([
	"credential",
	"refresh",
	"access",
	"apiKey",
	"api_key",
	"token",
	"key",
	"refreshToken",
	"accessToken",
	"encryptedCredential",
]);

export function parseProviderAuthEvent(value: unknown): ProviderAuthEvent {
	if (!value || typeof value !== "object") {
		throw new Error("Invalid auth event");
	}
	for (const key of Object.keys(value as object)) {
		if (BANNED_KEYS.has(key)) {
			throw new Error("Auth event contains banned field");
		}
	}
	return providerAuthEventSchema.parse(value);
}

/** Provider-specific HTTPS host policy for clickable auth URLs. */
const AUTH_URL_HOSTS: Record<string, readonly string[]> = {
	anthropic: ["claude.ai", "console.anthropic.com", "platform.claude.com"],
	"openai-codex": ["auth.openai.com", "chatgpt.com", "platform.openai.com"],
	xai: ["accounts.x.ai", "console.x.ai", "x.ai"],
	"github-copilot": ["github.com", "api.github.com"],
};

export type AuthUrlDecision =
	| { kind: "open"; url: string }
	| { kind: "text"; url: string; reason: string };

export function classifyAuthUrl(
	providerId: string,
	url: string,
	options?: { enterpriseHost?: string },
): AuthUrlDecision {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { kind: "text", url, reason: "invalid_url" };
	}
	if (parsed.protocol !== "https:") {
		// localhost callback guidance is display-only
		if (
			parsed.protocol === "http:" &&
			(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
		) {
			return { kind: "text", url, reason: "localhost_callback" };
		}
		return { kind: "text", url, reason: "non_https" };
	}
	const host = parsed.hostname.toLowerCase();
	if (providerId === "github-copilot" && options?.enterpriseHost) {
		const expected =
			options.enterpriseHost
				.toLowerCase()
				.replace(/^https?:\/\//, "")
				.split("/")[0] ?? "";
		if (host === expected || host.endsWith(`.${expected}`)) {
			return { kind: "open", url: parsed.toString() };
		}
		// Still allow github.com
	}
	const allowed = AUTH_URL_HOSTS[providerId] ?? [];
	if (allowed.some((h) => host === h || host.endsWith(`.${h}`))) {
		return { kind: "open", url: parsed.toString() };
	}
	return { kind: "text", url: parsed.toString(), reason: "unknown_host" };
}

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

export function isAllowedProviderAuth(
	providerId: string,
	authType: string,
): boolean {
	const allowed = (PORTABLE_PROVIDER_AUTH as Record<string, readonly string[]>)[
		providerId
	];
	return !!allowed?.includes(authType);
}
