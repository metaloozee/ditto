import {
	decryptRuntimeText,
	encryptRuntimeText,
	parseRuntimeCiphertextV1,
	RUNTIME_CRYPTO_FORMAT_VERSION,
	RuntimeCryptoError,
	type RuntimeKeyring,
} from "./runtime-crypto.ts";

export const HOST_PRIVATE_PLAINTEXT_BYTES = 32 * 1024;
const HOST_PRIVATE_ENCRYPTED_BYTES = 64 * 1024;

export type RetainedStorageBinding = {
	ownerId: string;
	workspaceSessionId: string;
	keyring: RuntimeKeyring;
};

/** Authenticated unbound selection. Literal plaintext `pending` is not this token. */
export const UNBOUND_SELECTION = '{"unbound":true}';

export function isUnboundSelection(value: string): boolean {
	return value === UNBOUND_SELECTION;
}

export async function digestText(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function isRuntimeCiphertext(value: string): boolean {
	try {
		parseRuntimeCiphertextV1(value);
		return true;
	} catch (error) {
		if (error instanceof RuntimeCryptoError) return false;
		throw error;
	}
}

export async function sealHostField(
	binding: RetainedStorageBinding,
	recordId: string,
	plaintext: string,
): Promise<{ ciphertext: string; digest: string }> {
	if (
		new TextEncoder().encode(plaintext).byteLength >
		HOST_PRIVATE_PLAINTEXT_BYTES
	)
		throw new RuntimeCryptoError(
			"invalid_ciphertext",
			"host_private_size_limit",
		);
	const ciphertext = await encryptRuntimeText(plaintext, binding.keyring, {
		ownerId: binding.ownerId,
		workspaceSessionId: binding.workspaceSessionId,
		recordId,
		formatVersion: RUNTIME_CRYPTO_FORMAT_VERSION,
	});
	if (
		new TextEncoder().encode(ciphertext).byteLength >
		HOST_PRIVATE_ENCRYPTED_BYTES
	)
		throw new RuntimeCryptoError(
			"invalid_ciphertext",
			"host_private_size_limit",
		);
	return { ciphertext, digest: await digestText(plaintext) };
}

export async function openHostField(
	binding: RetainedStorageBinding,
	recordId: string,
	ciphertext: string,
): Promise<string> {
	if (
		new TextEncoder().encode(ciphertext).byteLength >
		HOST_PRIVATE_ENCRYPTED_BYTES
	)
		throw new RuntimeCryptoError(
			"invalid_ciphertext",
			"host_private_size_limit",
		);
	const plaintext = await decryptRuntimeText(ciphertext, binding.keyring, {
		ownerId: binding.ownerId,
		workspaceSessionId: binding.workspaceSessionId,
		recordId,
		formatVersion: RUNTIME_CRYPTO_FORMAT_VERSION,
	});
	if (
		new TextEncoder().encode(plaintext).byteLength >
		HOST_PRIVATE_PLAINTEXT_BYTES
	)
		throw new RuntimeCryptoError(
			"invalid_ciphertext",
			"host_private_size_limit",
		);
	return plaintext;
}
