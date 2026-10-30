const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const HOST_PATTERN =
	/^10000-c-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([a-z0-9_]{1,16})\.(?:ayn\.wtf|localhost)$/;

/** The candidate execution sandbox's name; the prefix keeps its preview hosts apart from legacy ones. */
export function candidateSandboxName(workspaceSessionId: string): string {
	return `c-${workspaceSessionId}`;
}

/** The SDK bearer in a preview URL: the text after the last `-` of the first host label. */
export function previewToken(url: string): string | undefined {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return undefined;
	}
	const label = hostname.split(".")[0] ?? "";
	const token = label.slice(label.lastIndexOf("-") + 1);
	return label.includes("-") && /^[a-z0-9_]{1,16}$/.test(token)
		? token
		: undefined;
}

/** A fresh 16-character [a-z0-9] bearer from crypto.getRandomValues, without modulo bias. */
export function newPreviewToken(): string {
	let token = "";
	while (token.length < 16) {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		for (const byte of bytes) {
			if (byte >= 252) continue;
			token += TOKEN_ALPHABET[byte % 36];
			if (token.length === 16) break;
		}
	}
	return token;
}

/** Lowercase hex SHA-256 of a preview token; the only form the runtime stores. */
export async function previewTokenDigest(token: string): Promise<string> {
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return [...new Uint8Array(hash)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** A candidate preview host: `10000-c-<uuid>-<token>.ayn.wtf` or `.localhost`; anything else is undefined. */
export function parseCandidatePreviewHost(
	hostname: string,
): { workspaceSessionId: string; token: string } | undefined {
	const match = HOST_PATTERN.exec(hostname.toLowerCase());
	if (!match?.[1] || !match[2]) return undefined;
	return { workspaceSessionId: match[1], token: match[2] };
}
