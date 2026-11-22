// Evidence must hold no credential, cookie or account identifier (docs/feasibility/evidence.md).

// A segment after one of these names a person or account, whatever it looks like.
const ownerPrefixes = new Set(["in", "u", "b", "profile", "people", "user", "users", "company"]);
const plainWord = /^[a-z]{1,20}$/;

/** Keep the origin and leading plain-word path segments; drop the rest, the query and fragment. */
export function redactUrl(raw: string): string {
	const url = new URL(raw);
	const kept: string[] = [];
	for (const segment of url.pathname.split("/").filter(Boolean)) {
		if (!plainWord.test(segment) || ownerPrefixes.has(kept.at(-1) ?? "")) {
			kept.push("<path>");
			break;
		}
		kept.push(segment);
	}
	return `${url.origin}/${kept.join("/")}`;
}

const leaks: [RegExp, string][] = [
	[/[\w.+-]+@[\w-]+\.[\w.-]+/, "an email address"],
	[/\b(set-)?cookie\s*:/i, "a cookie header"],
	[/\beyJ[\w-]+\.[\w-]+/, "a token"],
	[/\b[A-Za-z0-9_-]{32,}\b/, "a token"],
	[/\b\d{10,}\b/, "an account number"],
];

/** Throw before writing evidence that leaks something it must not. */
export function assertClean(text: string): void {
	for (const [pattern, what] of leaks) {
		if (pattern.test(text)) throw new Error(`Evidence contains ${what}; redact it first`);
	}
}
