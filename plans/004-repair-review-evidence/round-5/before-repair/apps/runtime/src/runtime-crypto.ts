const ALGORITHM = "AES-GCM";
const KEY_BITS = 256;
const NONCE_BYTES = 12;
const TAG_BITS = 128;
const KEY_BYTES = KEY_BITS / 8;
const FORMAT_VERSION = 1;
const AAD_PREFIX = "ditto-runtime";
const DEFAULT_CHUNK_BYTES = 16 * 1024;
const DEFAULT_INLINE_MAX_BYTES = 32 * 1024;
const MAX_CHUNK_COUNT = 4096;
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

export const RUNTIME_CRYPTO_FORMAT_VERSION = FORMAT_VERSION;
export const RUNTIME_CRYPTO_CHUNK_BYTES = DEFAULT_CHUNK_BYTES;
export const RUNTIME_CRYPTO_INLINE_MAX_BYTES = DEFAULT_INLINE_MAX_BYTES;

export class RuntimeCryptoError extends Error {
	constructor(
		readonly code:
			| "invalid_keyring"
			| "missing_key"
			| "decrypt_failed"
			| "invalid_ciphertext"
			| "invalid_manifest",
		message = "runtime_crypto_failed",
	) {
		super(message);
		this.name = "RuntimeCryptoError";
	}
}

export type RuntimeCiphertextV1 = {
	version: 1;
	algorithm: "aes-256-gcm";
	keyVersion: string;
	nonce: string;
	ciphertext: string;
	formatVersion: number;
};

export type RuntimeAad = {
	ownerId: string;
	workspaceSessionId: string;
	recordId: string;
	formatVersion: number;
};

export type RuntimeChunkManifestV1 = {
	version: 1;
	recordId: string;
	writeId: string;
	chunkCount: number;
	totalLength: number;
	digest: string;
	formatVersion: number;
	chunks: RuntimeCiphertextV1[];
};

export type RuntimeKeyring = {
	currentVersion: string;
	keys: ReadonlyMap<string, CryptoKey>;
};

export type RuntimeKeyringBinding = {
	currentVersion: unknown;
	keys: unknown;
};

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(value: string, label: string): Uint8Array {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length % 4 !== 0
	) {
		throw new RuntimeCryptoError("invalid_ciphertext", `invalid_${label}`);
	}
	try {
		const binary = atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return bytes;
	} catch {
		throw new RuntimeCryptoError("invalid_ciphertext", `invalid_${label}`);
	}
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function hexToBytes(hex: string): Uint8Array {
	if (hex.length !== KEY_BYTES * 2 || /[^0-9a-f]/i.test(hex)) {
		throw new RuntimeCryptoError("invalid_keyring");
	}
	const bytes = new Uint8Array(KEY_BYTES);
	for (let index = 0; index < KEY_BYTES; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

export function canonicalRuntimeAad(aad: RuntimeAad): string {
	return JSON.stringify([
		AAD_PREFIX,
		aad.ownerId,
		aad.workspaceSessionId,
		aad.recordId,
		aad.formatVersion,
	]);
}

function chunkAad(
	aad: RuntimeAad,
	ordinal: number,
	chunkCount: number,
	binding: { writeId: string; digest: string; totalLength: number },
): RuntimeAad {
	return {
		...aad,
		recordId: `${aad.recordId}:${ordinal}:${chunkCount}:${binding.writeId}:${binding.digest}:${binding.totalLength}`,
	};
}

function randomWriteId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function importRawKey(bytes: Uint8Array): Promise<CryptoKey> {
	if (bytes.byteLength !== KEY_BYTES) {
		throw new RuntimeCryptoError("invalid_keyring");
	}
	return crypto.subtle.importKey(
		"raw",
		toArrayBuffer(bytes),
		{ name: ALGORITHM, length: KEY_BITS },
		false,
		["encrypt", "decrypt"],
	);
}

export async function parseRuntimeKeyring(
	binding: RuntimeKeyringBinding,
): Promise<RuntimeKeyring> {
	if (
		typeof binding.currentVersion !== "string" ||
		binding.currentVersion.length === 0 ||
		typeof binding.keys !== "object" ||
		binding.keys === null ||
		Array.isArray(binding.keys)
	) {
		throw new RuntimeCryptoError("invalid_keyring");
	}
	const rawKeys = binding.keys as Record<string, unknown>;
	const keys = new Map<string, CryptoKey>();
	for (const [version, value] of Object.entries(rawKeys)) {
		if (typeof version !== "string" || version.length === 0) {
			throw new RuntimeCryptoError("invalid_keyring");
		}
		if (typeof value !== "string") {
			throw new RuntimeCryptoError("invalid_keyring");
		}
		keys.set(version, await importRawKey(hexToBytes(value)));
	}
	if (!keys.has(binding.currentVersion)) {
		throw new RuntimeCryptoError("invalid_keyring");
	}
	return { currentVersion: binding.currentVersion, keys };
}

export async function importRuntimeKeyringFromBytes(
	currentVersion: string,
	keys: Record<string, Uint8Array>,
): Promise<RuntimeKeyring> {
	if (!currentVersion || !(currentVersion in keys)) {
		throw new RuntimeCryptoError("invalid_keyring");
	}
	const imported = new Map<string, CryptoKey>();
	for (const [version, bytes] of Object.entries(keys)) {
		imported.set(version, await importRawKey(bytes));
	}
	return { currentVersion, keys: imported };
}

function encodeCiphertext(record: RuntimeCiphertextV1): string {
	return JSON.stringify(record);
}

export function parseRuntimeCiphertextV1(value: unknown): RuntimeCiphertextV1 {
	if (typeof value === "string") {
		try {
			value = JSON.parse(value) as unknown;
		} catch {
			throw new RuntimeCryptoError("invalid_ciphertext");
		}
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new RuntimeCryptoError("invalid_ciphertext");
	}
	const record = value as Record<string, unknown>;
	if (
		record.version !== 1 ||
		record.algorithm !== "aes-256-gcm" ||
		typeof record.keyVersion !== "string" ||
		record.keyVersion.length === 0 ||
		typeof record.nonce !== "string" ||
		typeof record.ciphertext !== "string" ||
		record.formatVersion !== FORMAT_VERSION
	) {
		throw new RuntimeCryptoError("invalid_ciphertext");
	}
	const nonce = base64ToBytes(record.nonce, "nonce");
	if (nonce.byteLength !== NONCE_BYTES) {
		throw new RuntimeCryptoError("invalid_ciphertext");
	}
	const ciphertext = base64ToBytes(record.ciphertext, "ciphertext");
	if (ciphertext.byteLength < TAG_BITS / 8) {
		throw new RuntimeCryptoError("invalid_ciphertext");
	}
	return {
		version: 1,
		algorithm: "aes-256-gcm",
		keyVersion: record.keyVersion,
		nonce: record.nonce,
		ciphertext: record.ciphertext,
		formatVersion: FORMAT_VERSION,
	};
}

export async function encryptRuntimeRecord(
	plaintext: Uint8Array,
	keyring: RuntimeKeyring,
	aad: RuntimeAad,
): Promise<RuntimeCiphertextV1> {
	const key = keyring.keys.get(keyring.currentVersion);
	if (!key) throw new RuntimeCryptoError("missing_key");
	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
	const additionalData = toArrayBuffer(
		new TextEncoder().encode(canonicalRuntimeAad(aad)),
	);
	const encrypted = await crypto.subtle.encrypt(
		{
			name: ALGORITHM,
			iv: toArrayBuffer(nonce),
			additionalData,
			tagLength: TAG_BITS,
		},
		key,
		toArrayBuffer(plaintext),
	);
	return {
		version: 1,
		algorithm: "aes-256-gcm",
		keyVersion: keyring.currentVersion,
		nonce: bytesToBase64(nonce),
		ciphertext: bytesToBase64(new Uint8Array(encrypted)),
		formatVersion: aad.formatVersion,
	};
}

export async function decryptRuntimeRecord(
	envelope: RuntimeCiphertextV1 | string,
	keyring: RuntimeKeyring,
	aad: RuntimeAad,
): Promise<Uint8Array> {
	const parsed = parseRuntimeCiphertextV1(envelope);
	const key = keyring.keys.get(parsed.keyVersion);
	if (!key) throw new RuntimeCryptoError("missing_key");
	if (parsed.formatVersion !== aad.formatVersion) {
		throw new RuntimeCryptoError("decrypt_failed");
	}
	try {
		const plaintext = await crypto.subtle.decrypt(
			{
				name: ALGORITHM,
				iv: toArrayBuffer(base64ToBytes(parsed.nonce, "nonce")),
				additionalData: toArrayBuffer(
					new TextEncoder().encode(canonicalRuntimeAad(aad)),
				),
				tagLength: TAG_BITS,
			},
			key,
			toArrayBuffer(base64ToBytes(parsed.ciphertext, "ciphertext")),
		);
		return new Uint8Array(plaintext);
	} catch (error) {
		if (error instanceof RuntimeCryptoError) throw error;
		throw new RuntimeCryptoError("decrypt_failed");
	}
}

export async function encryptRuntimeText(
	plaintext: string,
	keyring: RuntimeKeyring,
	aad: RuntimeAad,
): Promise<string> {
	return encodeCiphertext(
		await encryptRuntimeRecord(
			new TextEncoder().encode(plaintext),
			keyring,
			aad,
		),
	);
}

export async function decryptRuntimeText(
	envelope: RuntimeCiphertextV1 | string,
	keyring: RuntimeKeyring,
	aad: RuntimeAad,
): Promise<string> {
	return new TextDecoder().decode(
		await decryptRuntimeRecord(envelope, keyring, aad),
	);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function encryptRuntimePayload(
	plaintext: Uint8Array,
	keyring: RuntimeKeyring,
	aad: RuntimeAad,
	options?: { inlineMaxBytes?: number; chunkBytes?: number },
): Promise<
	| { kind: "inline"; envelope: RuntimeCiphertextV1; byteCount: number }
	| {
			kind: "chunked";
			manifest: RuntimeChunkManifestV1;
			byteCount: number;
	  }
> {
	const inlineMax = options?.inlineMaxBytes ?? DEFAULT_INLINE_MAX_BYTES;
	const chunkBytes = options?.chunkBytes ?? DEFAULT_CHUNK_BYTES;
	if (chunkBytes < 1 || inlineMax < 1) {
		throw new RuntimeCryptoError("invalid_manifest");
	}
	if (plaintext.byteLength > MAX_PAYLOAD_BYTES) {
		throw new RuntimeCryptoError("invalid_manifest");
	}
	if (plaintext.byteLength <= inlineMax) {
		return {
			kind: "inline",
			envelope: await encryptRuntimeRecord(plaintext, keyring, aad),
			byteCount: plaintext.byteLength,
		};
	}
	const chunkCount = Math.ceil(plaintext.byteLength / chunkBytes);
	if (chunkCount > MAX_CHUNK_COUNT) {
		throw new RuntimeCryptoError("invalid_manifest");
	}
	const digest = await sha256Hex(plaintext);
	const writeId = randomWriteId();
	const binding = { writeId, digest, totalLength: plaintext.byteLength };
	const chunks: RuntimeCiphertextV1[] = [];
	for (let ordinal = 0; ordinal < chunkCount; ordinal += 1) {
		const start = ordinal * chunkBytes;
		const slice = plaintext.subarray(start, start + chunkBytes);
		chunks.push(
			await encryptRuntimeRecord(
				slice,
				keyring,
				chunkAad(aad, ordinal, chunkCount, binding),
			),
		);
	}
	return {
		kind: "chunked",
		manifest: {
			version: 1,
			recordId: aad.recordId,
			writeId,
			chunkCount,
			totalLength: plaintext.byteLength,
			digest,
			formatVersion: aad.formatVersion,
			chunks,
		},
		byteCount: plaintext.byteLength,
	};
}

export async function decryptRuntimePayload(
	stored:
		| { kind: "inline"; envelope: RuntimeCiphertextV1 | string }
		| { kind: "chunked"; manifest: RuntimeChunkManifestV1 },
	keyring: RuntimeKeyring,
	aad: RuntimeAad,
): Promise<Uint8Array> {
	if (stored.kind === "inline") {
		return decryptRuntimeRecord(stored.envelope, keyring, aad);
	}
	const manifest = stored.manifest;
	if (
		manifest.version !== 1 ||
		manifest.recordId !== aad.recordId ||
		manifest.formatVersion !== aad.formatVersion ||
		typeof manifest.writeId !== "string" ||
		manifest.writeId.length === 0 ||
		manifest.chunkCount < 1 ||
		manifest.chunks.length !== manifest.chunkCount ||
		manifest.totalLength < 1 ||
		manifest.chunkCount > MAX_CHUNK_COUNT ||
		manifest.totalLength > MAX_PAYLOAD_BYTES
	) {
		throw new RuntimeCryptoError("invalid_manifest");
	}
	const binding = {
		writeId: manifest.writeId,
		digest: manifest.digest,
		totalLength: manifest.totalLength,
	};
	const parts: Uint8Array[] = [];
	let total = 0;
	for (let ordinal = 0; ordinal < manifest.chunkCount; ordinal += 1) {
		const part = await decryptRuntimeRecord(
			manifest.chunks[ordinal],
			keyring,
			chunkAad(aad, ordinal, manifest.chunkCount, binding),
		);
		parts.push(part);
		total += part.byteLength;
		if (total > MAX_PAYLOAD_BYTES) {
			throw new RuntimeCryptoError("invalid_manifest");
		}
	}
	if (total !== manifest.totalLength) {
		throw new RuntimeCryptoError("invalid_manifest");
	}
	const plaintext = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		plaintext.set(part, offset);
		offset += part.byteLength;
	}
	const digest = await sha256Hex(plaintext);
	if (digest !== manifest.digest) {
		throw new RuntimeCryptoError("decrypt_failed");
	}
	return plaintext;
}

export function serializeRuntimeCiphertext(
	envelope: RuntimeCiphertextV1,
): string {
	return encodeCiphertext(envelope);
}

export function serializeRuntimeManifest(
	manifest: RuntimeChunkManifestV1,
): string {
	return JSON.stringify(manifest);
}

export function parseRuntimeManifest(value: unknown): RuntimeChunkManifestV1 {
	const parsed =
		typeof value === "string" ? (JSON.parse(value) as unknown) : value;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new RuntimeCryptoError("invalid_manifest");
	}
	const record = parsed as Record<string, unknown>;
	if (
		record.version !== 1 ||
		typeof record.recordId !== "string" ||
		typeof record.writeId !== "string" ||
		record.writeId.length === 0 ||
		typeof record.digest !== "string" ||
		record.formatVersion !== FORMAT_VERSION ||
		!Array.isArray(record.chunks) ||
		typeof record.chunkCount !== "number" ||
		typeof record.totalLength !== "number" ||
		record.chunkCount > MAX_CHUNK_COUNT ||
		record.totalLength > MAX_PAYLOAD_BYTES
	) {
		throw new RuntimeCryptoError("invalid_manifest");
	}
	return {
		version: 1,
		recordId: record.recordId,
		writeId: record.writeId,
		chunkCount: record.chunkCount,
		totalLength: record.totalLength,
		digest: record.digest,
		formatVersion: FORMAT_VERSION,
		chunks: record.chunks.map((chunk) => parseRuntimeCiphertextV1(chunk)),
	};
}
