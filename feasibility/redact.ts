export type Secret = { value: string; placeholder: string };

/** Claims that name OpenAI's endpoints or the grant, not the account. Entries need them. */
const PUBLIC_CLAIMS = new Set(["iss", "aud", "scope"]);

/** Every string claim in a JWT payload that could identify the account: ids and emails. */
export function jwtStrings(token: string): string[] {
	try {
		const payload = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "";
		const out: string[] = [];
		const walk = (value: unknown) => {
			if (typeof value === "string" && value.length >= 6) out.push(value);
			else if (value && typeof value === "object") Object.values(value).forEach(walk);
		};
		const claims: unknown = JSON.parse(atob(payload));
		if (claims && typeof claims === "object") {
			for (const [name, value] of Object.entries(claims)) {
				if (!PUBLIC_CLAIMS.has(name)) walk(value);
			}
		}
		return out;
	} catch {
		return [];
	}
}

/**
 * Shapes no evidence may hold (docs/feasibility/evidence.md). `redact` replaces them with the
 * placeholder; the take-over harness refuses evidence that still matches, naming `what`.
 */
export const SECRET_SHAPES: { pattern: RegExp; placeholder: string; what: string }[] = [
	{ pattern: /eyJ[\w-]*\.[\w-]+\.[\w-]*/g, placeholder: "<token>", what: "a token" },
	{ pattern: /Bearer\s+[^\s"',<]+/gi, placeholder: "Bearer <token>", what: "a token" },
	{
		pattern: /\b(set-)?cookie\s*:[^\n]*/gi,
		placeholder: "<cookie header>",
		what: "a cookie header",
	},
	{ pattern: /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, placeholder: "<email>", what: "an email address" },
	{
		pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
		placeholder: "<account id>",
		what: "an account id",
	},
	// Unseen tokens and keys: any long opaque run of token characters. OpenAI's plan-usage error
	// codes (`subscription_sharing_*`, `chatpass_v2_*`) are long too, and are evidence.
	{
		pattern:
			/(?<![A-Za-z0-9_-])(?!(?:subscription_sharing|chatpass_v2)_[a-z_]+\b)[A-Za-z0-9_-]{32,}/g,
		placeholder: "<opaque value>",
		what: "a token",
	},
	{ pattern: /\b\d{10,}\b/g, placeholder: "<account number>", what: "an account number" },
];

export function redact(text: string, secrets: Secret[]): string {
	let out = text;
	for (const { value, placeholder } of [...secrets].sort(
		(a, b) => b.value.length - a.value.length,
	)) {
		if (value) out = out.split(value).join(placeholder);
	}
	for (const { pattern, placeholder } of SECRET_SHAPES) out = out.replace(pattern, placeholder);
	return out;
}
