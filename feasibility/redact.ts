// Pure, so the Pi trial (#25) and the bare free-tier Worker (#30) redact entries the same way.
export type Secret = { value: string; placeholder: string };

/** Every string claim in a JWT payload: account ids, user ids and emails. */
export function jwtStrings(token: string): string[] {
	try {
		const payload = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "";
		const out: string[] = [];
		const walk = (value: unknown) => {
			if (typeof value === "string" && value.length >= 6) out.push(value);
			else if (value && typeof value === "object") Object.values(value).forEach(walk);
		};
		walk(JSON.parse(atob(payload)));
		return out;
	} catch {
		return [];
	}
}

const PATTERNS: [RegExp, string][] = [
	[/eyJ[\w-]*\.[\w-]+\.[\w-]*/g, "<token>"],
	[/Bearer\s+[^\s"',]+/gi, "Bearer <token>"],
	[/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>"],
	[/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<account id>"],
	// Unseen tokens and keys: any long opaque run of token characters.
	[/[A-Za-z0-9_-]{32,}/g, "<opaque value>"],
];

export function redact(text: string, secrets: Secret[]): string {
	let out = text;
	for (const { value, placeholder } of [...secrets].sort(
		(a, b) => b.value.length - a.value.length,
	)) {
		if (value) out = out.split(value).join(placeholder);
	}
	for (const [pattern, placeholder] of PATTERNS) out = out.replace(pattern, placeholder);
	return out;
}
