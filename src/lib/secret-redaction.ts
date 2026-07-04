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

/**
 * Redact concrete secret values and common secret-shaped tokens from text
 * before persisting or broadcasting user-visible output.
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
