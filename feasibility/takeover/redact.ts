// Evidence must hold no credential, cookie or account identifier (docs/feasibility/evidence.md).
import { SECRET_SHAPES } from "../redact.ts";

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

/** Throw before writing evidence that leaks something it must not. */
export function assertClean(text: string): void {
	for (const { pattern, what } of SECRET_SHAPES) {
		// `search` ignores the global flag's lastIndex, so a shared pattern stays reusable.
		if (text.search(pattern) >= 0) throw new Error(`Evidence contains ${what}; redact it first`);
	}
}
