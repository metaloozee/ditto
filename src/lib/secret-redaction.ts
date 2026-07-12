const REDACTION = "[REDACTED]";

const SECRET_PATTERNS: RegExp[] = [
	// GitHub tokens: ghp_, gho_, ghs_, ghu_, ghr_
	/gh[pousr]_[A-Za-z0-9]{36,}/g,
	// PEM private key blocks (incl. BEGIN/END lines)
	/-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]* )?PRIVATE KEY-----/g,
	// AWS access key IDs
	/AKIA[0-9A-Z]{16}/g,
	// Generic provider API keys: sk-... (OpenAI-style), sk-ant-... (Anthropic-style)
	/sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
];

const PEM_BEGIN_MARKER = "-----BEGIN";
const PEM_BEGIN_FULL = /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----/;
const PEM_END_FULL = /-----END (?:[A-Z ]* )?PRIVATE KEY-----/;

/**
 * Redact concrete secret values and common secret-shaped tokens from text
 * before persisting or broadcasting user-visible output.
 *
 * Exact secrets shorter than 8 characters are intentionally not redacted
 * (one-character values would erase ordinary output). Secret-shaped patterns
 * still apply to all strings regardless of the concrete-secret list.
 */
export function redactSecrets(
	text: string,
	secrets: readonly string[] = [],
): string {
	let out = text;
	for (const secret of secrets) {
		if (secret.length >= 8) {
			out = out.split(secret).join(REDACTION);
		}
	}
	for (const pattern of SECRET_PATTERNS) {
		out = out.replace(pattern, REDACTION);
	}
	return out;
}

/**
 * Recursively redact secrets in JSON-compatible values. Preserves
 * arrays/objects/numbers/booleans/null. Cycles fail closed to the redaction
 * marker (no infinite recursion / no JSON.stringify of cyclic graphs).
 */
export function redactStructured(
	value: unknown,
	secrets: readonly string[] = [],
	seen: WeakSet<object> = new WeakSet(),
): unknown {
	if (typeof value === "string") {
		return redactSecrets(value, secrets);
	}
	if (
		value === null ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value !== "object") {
		// undefined, bigint, symbol, function — do not attempt serialization
		return value === undefined ? value : REDACTION;
	}
	if (seen.has(value)) {
		return REDACTION;
	}
	seen.add(value);
	if (Array.isArray(value)) {
		return value.map((item) => redactStructured(item, secrets, seen));
	}
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		out[key] = redactStructured(child, secrets, seen);
	}
	return out;
}

function maxExactSecretHoldback(secrets: readonly string[]): number {
	let maxLen = 0;
	for (const secret of secrets) {
		if (secret.length >= 8 && secret.length > maxLen) {
			maxLen = secret.length;
		}
	}
	// Hold max(len-1) so a secret split across chunks is never partially leaked.
	// Also retain enough for a partial PEM begin marker at the tail.
	return Math.max(maxLen > 0 ? maxLen - 1 : 0, PEM_BEGIN_MARKER.length - 1);
}

/** Index at which an incomplete PEM-shaped region starts, or -1. */
function incompletePemHoldIndex(text: string): number {
	// Full BEGIN header present but no matching END → hold from BEGIN.
	const beginRe = /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----/g;
	for (
		let match = beginRe.exec(text);
		match !== null;
		match = beginRe.exec(text)
	) {
		const fromBegin = text.slice(match.index);
		if (!PEM_END_FULL.test(fromBegin)) {
			return match.index;
		}
	}

	// Suffix is a proper prefix of "-----BEGIN" (possible marker split).
	for (let len = PEM_BEGIN_MARKER.length - 1; len >= 1; len--) {
		if (text.endsWith(PEM_BEGIN_MARKER.slice(0, len))) {
			return text.length - len;
		}
	}

	// "-----BEGIN..." without a complete PRIVATE KEY header yet.
	const partialBegin = text.lastIndexOf(PEM_BEGIN_MARKER);
	if (partialBegin >= 0) {
		const from = text.slice(partialBegin);
		if (!PEM_BEGIN_FULL.test(from)) {
			return partialBegin;
		}
	}

	return -1;
}

/** Fail-closed: replace incomplete PEM-shaped regions after stream end. */
function redactIncompletePemRegions(text: string): string {
	const beginRe = /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----/g;
	for (
		let match = beginRe.exec(text);
		match !== null;
		match = beginRe.exec(text)
	) {
		const fromBegin = text.slice(match.index);
		if (!PEM_END_FULL.test(fromBegin)) {
			return text.slice(0, match.index) + REDACTION;
		}
	}
	const partialBegin = text.lastIndexOf(PEM_BEGIN_MARKER);
	if (partialBegin >= 0) {
		const from = text.slice(partialBegin);
		if (!PEM_BEGIN_FULL.test(from) || !PEM_END_FULL.test(from)) {
			return text.slice(0, partialBegin) + REDACTION;
		}
	}
	return text;
}

/**
 * Stateful redactor for streamed text deltas.
 *
 * Holds back a suffix long enough that any concrete secret (length >= 8) that
 * could still be completing across a chunk boundary is not emitted yet.
 * Exact secrets shorter than 8 are intentionally not held back / redacted
 * (same as {@link redactSecrets}); secret-shaped patterns still apply to
 * emitted segments and on {@link flush}.
 *
 * Incomplete PEM blocks are held from the BEGIN marker until END arrives, or
 * replaced with the redaction marker on flush (fail closed).
 */
export class StreamingSecretRedactor {
	private buffer = "";
	private readonly secrets: readonly string[];
	private readonly maxHoldback: number;

	constructor(secrets: readonly string[] = []) {
		this.secrets = secrets;
		this.maxHoldback = maxExactSecretHoldback(secrets);
	}

	/** Append a chunk; return only the safe (already redacted) prefix. */
	push(chunk: string): string {
		if (chunk.length === 0) {
			return "";
		}
		this.buffer += chunk;
		return this.drain(false);
	}

	/** Emit remaining buffer after a full redaction pass. */
	flush(): string {
		if (this.buffer.length === 0) {
			return "";
		}
		const remaining = redactIncompletePemRegions(
			redactSecrets(this.buffer, this.secrets),
		);
		this.buffer = "";
		return remaining;
	}

	private drain(_flushing: boolean): string {
		// Redact completed exact secrets and complete secret-shaped patterns first.
		const redacted = redactSecrets(this.buffer, this.secrets);

		let holdFrom = Math.max(0, redacted.length - this.maxHoldback);
		const pemHold = incompletePemHoldIndex(redacted);
		if (pemHold >= 0) {
			holdFrom = Math.min(holdFrom, pemHold);
		}

		const toEmit = redacted.slice(0, holdFrom);
		this.buffer = redacted.slice(holdFrom);
		return toEmit;
	}
}

export { REDACTION as SECRET_REDACTION_MARKER };
