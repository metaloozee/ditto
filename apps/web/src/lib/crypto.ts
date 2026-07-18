const ENCRYPTION_VERSION = "v1";
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 310000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function bytesToHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

function hexToBytes(hex: string, label: string): Uint8Array {
	if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
		throw new Error(`Malformed encrypted payload: invalid ${label}.`);
	}

	const bytes = new Uint8Array(hex.length / 2);
	for (let index = 0; index < hex.length; index += 2) {
		bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
	}
	return bytes;
}

async function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
	const baseKey = await crypto.subtle.importKey(
		"raw",
		textEncoder.encode(secret),
		"PBKDF2",
		false,
		["deriveKey"],
	);

	return await crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt: toArrayBuffer(salt),
			iterations: PBKDF2_ITERATIONS,
		},
		baseKey,
		{
			name: "AES-GCM",
			length: 256,
		},
		false,
		["encrypt", "decrypt"],
	);
}

export type EncryptTextOptions = {
	/** AES-GCM additional authenticated data. Bound into the ciphertext. */
	additionalData?: string;
};

export async function encryptText(
	plaintext: string,
	secret: string,
	options?: EncryptTextOptions,
): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const key = await deriveKey(secret, salt);
	const additionalData = options?.additionalData
		? toArrayBuffer(textEncoder.encode(options.additionalData))
		: undefined;
	const ciphertext = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: toArrayBuffer(iv),
			...(additionalData ? { additionalData } : {}),
		},
		key,
		toArrayBuffer(textEncoder.encode(plaintext)),
	);

	return [
		ENCRYPTION_VERSION,
		bytesToHex(salt),
		bytesToHex(iv),
		bytesToHex(new Uint8Array(ciphertext)),
	].join(".");
}

export async function decryptText(
	payload: string,
	secret: string,
	options?: EncryptTextOptions,
): Promise<string> {
	const [version, saltHex, ivHex, ciphertextHex, ...extra] = payload.split(".");

	if (extra.length > 0 || !version || !saltHex || !ivHex || !ciphertextHex) {
		throw new Error("Malformed encrypted payload.");
	}

	if (version !== ENCRYPTION_VERSION) {
		throw new Error(`Unsupported encrypted payload version: ${version}.`);
	}

	const salt = hexToBytes(saltHex, "salt");
	const iv = hexToBytes(ivHex, "iv");
	const ciphertext = hexToBytes(ciphertextHex, "ciphertext");

	if (iv.byteLength !== IV_LENGTH) {
		throw new Error("Malformed encrypted payload: invalid iv.");
	}

	const key = await deriveKey(secret, salt);
	const additionalData = options?.additionalData
		? toArrayBuffer(textEncoder.encode(options.additionalData))
		: undefined;
	try {
		const plaintext = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: toArrayBuffer(iv),
				...(additionalData ? { additionalData } : {}),
			},
			key,
			toArrayBuffer(ciphertext),
		);
		return textDecoder.decode(plaintext);
	} catch {
		throw new Error("Failed to decrypt payload.");
	}
}

/** Canonical AAD for account provider credentials. */
export function providerCredentialAad(
	userId: string,
	providerId: string,
): string {
	return JSON.stringify(["ditto:provider-credential", userId, providerId]);
}
