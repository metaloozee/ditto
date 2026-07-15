import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { decryptText, encryptText } from "#/lib/crypto";
import { ENV_VAR_KEY_DESCRIPTION, normalizeEnvVarKey } from "#/lib/env-vars";
import type { SandboxEnvVar } from "#/lib/sandbox-bootstrap";

const envVarSchema = z.object({
	key: z.string(),
	value: z.string(),
});

export const envVarsSchema = z.array(envVarSchema);

export function toEnvVarKeys(envVars: SandboxEnvVar[]): Array<{ key: string }> {
	return envVars.map(({ key }) => ({ key }));
}

export function sanitizeEnvVars(
	envVars: SandboxEnvVar[] | undefined,
): SandboxEnvVar[] {
	const envVarsByKey = new Map<string, string>();

	for (const envVar of envVars ?? []) {
		const trimmedKey = envVar.key.trim();
		if (trimmedKey.length === 0) {
			continue;
		}
		const key = normalizeEnvVarKey(trimmedKey);

		if (!key) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Invalid environment variable name. ${ENV_VAR_KEY_DESCRIPTION}`,
			});
		}

		envVarsByKey.set(key, envVar.value.trim());
	}

	return Array.from(envVarsByKey, ([key, value]) => ({ key, value }));
}

export async function encryptEnvVars(
	envVars: SandboxEnvVar[],
	secret: string,
): Promise<string | null> {
	if (envVars.length === 0) {
		return null;
	}

	return await encryptText(JSON.stringify(envVars), secret);
}

export async function decryptEnvVars(
	encryptedEnvVars: string | null,
	secret: string,
): Promise<SandboxEnvVar[]> {
	if (!encryptedEnvVars) {
		return [];
	}

	try {
		const plaintext = await decryptText(encryptedEnvVars, secret);
		return envVarsSchema.parse(JSON.parse(plaintext));
	} catch {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to read project environment variables.",
		});
	}
}
