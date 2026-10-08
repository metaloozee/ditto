export interface CodexTokens {
	access: string;
	refresh: string;
	identity?: string;
	expiresAt: number;
}

export interface CredentialKeyring {
	current: string;
	keys: Readonly<Record<string, string>>;
}

const encoder = new TextEncoder();
const maxEnvelopeChars = 60000;
function bytes(hex: string): Uint8Array<ArrayBuffer> {
	if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error("credential_integrity");
	return Uint8Array.from(hex.match(/../g) ?? [], (pair) =>
		Number.parseInt(pair, 16),
	);
}
function hex(value: Uint8Array): string {
	return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}
function aad(
	owner: string,
	generation: number,
	revision: number,
): Uint8Array<ArrayBuffer> {
	if (!Number.isSafeInteger(revision) || revision < 1)
		throw new Error("credential_integrity");
	return encoder.encode(
		JSON.stringify([
			"ditto:codex-credential",
			owner,
			"tokens",
			generation,
			revision,
			2,
		]),
	);
}
async function key(
	keyring: CredentialKeyring,
	version: string,
): Promise<CryptoKey> {
	const material = keyring.keys[version];
	if (!material || !/^[0-9a-f]{64}$/i.test(material))
		throw new Error("credential_integrity");
	return crypto.subtle.importKey("raw", bytes(material), "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}
export function parseTokens(value: unknown): CodexTokens {
	if (!value || typeof value !== "object")
		throw new Error("credential_integrity");
	const data = value as Record<string, unknown>;
	for (const field of ["access", "refresh"] as const) {
		if (
			typeof data[field] !== "string" ||
			data[field].length < 1 ||
			encoder.encode(data[field]).byteLength > 8192
		)
			throw new Error("credential_integrity");
	}
	if (
		data.identity !== undefined &&
		(typeof data.identity !== "string" ||
			data.identity.length < 1 ||
			encoder.encode(data.identity).byteLength > 8192)
	)
		throw new Error("credential_integrity");
	if (
		typeof data.expiresAt !== "number" ||
		!Number.isSafeInteger(data.expiresAt) ||
		data.expiresAt < 0
	)
		throw new Error("credential_integrity");
	return {
		access: data.access as string,
		refresh: data.refresh as string,
		expiresAt: data.expiresAt,
		...(typeof data.identity === "string" ? { identity: data.identity } : {}),
	};
}
export async function sealCredentials(
	tokens: CodexTokens,
	owner: string,
	generation: number,
	keyring: CredentialKeyring,
	revision = 1,
): Promise<string> {
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: nonce,
			additionalData: aad(owner, generation, revision),
		},
		await key(keyring, keyring.current),
		encoder.encode(JSON.stringify(parseTokens(tokens))),
	);
	const envelope = JSON.stringify({
		format: 2,
		key: keyring.current,
		nonce: hex(nonce),
		ciphertext: hex(new Uint8Array(ciphertext)),
	});
	if (envelope.length > maxEnvelopeChars)
		throw new Error("credential_integrity");
	return envelope;
}
export async function openCredentials(
	envelope: string,
	owner: string,
	generation: number,
	keyring: CredentialKeyring,
	revision = 1,
): Promise<CodexTokens> {
	try {
		if (envelope.length > maxEnvelopeChars) throw new Error();
		const data: unknown = JSON.parse(envelope);
		if (!data || typeof data !== "object") throw new Error();
		const record = data as Record<string, unknown>;
		if (
			record.format !== 2 ||
			typeof record.key !== "string" ||
			typeof record.nonce !== "string" ||
			record.nonce.length !== 24 ||
			typeof record.ciphertext !== "string"
		)
			throw new Error();
		const plaintext = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: bytes(record.nonce),
				additionalData: aad(owner, generation, revision),
			},
			await key(keyring, record.key),
			bytes(record.ciphertext),
		);
		return parseTokens(JSON.parse(new TextDecoder().decode(plaintext)));
	} catch {
		throw new Error("credential_integrity");
	}
}
