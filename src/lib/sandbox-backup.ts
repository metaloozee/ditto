import type { BackupOptions, DirectoryBackup } from "@cloudflare/sandbox";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

export const SANDBOX_BACKUP_TTL_SECONDS = 365 * 24 * 60 * 60;

export const SANDBOX_BACKUP_EXCLUDES = [
	"node_modules",
	".pnpm-store",
	".yarn/cache",
	".next",
	"dist",
	"build",
	".cache",
	".turbo",
	".env",
	".env.*",
] as const;

export function serializeSandboxBackup(backup: DirectoryBackup): string {
	return JSON.stringify({
		id: backup.id,
		dir: backup.dir,
		...(backup.localBucket === undefined
			? {}
			: { localBucket: backup.localBucket }),
	});
}

export function parseSandboxBackup(value: string | null): DirectoryBackup | null {
	if (!value) {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(value);

		if (!parsed || typeof parsed !== "object") {
			return null;
		}

		const backup = parsed as Record<string, unknown>;
		if (typeof backup.id !== "string" || backup.id.length === 0) {
			return null;
		}
		if (backup.dir !== WORKSPACE_PATH) {
			return null;
		}
		let localBucket: boolean | undefined;
		if (backup.localBucket !== undefined) {
			if (typeof backup.localBucket !== "boolean") {
				return null;
			}
			localBucket = backup.localBucket;
		}

		return {
			id: backup.id,
			dir: backup.dir,
			...(localBucket === undefined
				? {}
				: { localBucket }),
		};
	} catch {
		return null;
	}
}

export function hasPresignedBackupConfig(env: {
	CLOUDFLARE_ACCOUNT_ID?: string;
	CLOUDFLARE_R2_ACCOUNT_ID?: string;
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	BACKUP_BUCKET_NAME?: string;
}): boolean {
	const accountId =
		env.CLOUDFLARE_ACCOUNT_ID?.trim() ||
		env.CLOUDFLARE_R2_ACCOUNT_ID?.trim() ||
		"";

	return Boolean(
		accountId &&
			env.R2_ACCESS_KEY_ID?.trim() &&
			env.R2_SECRET_ACCESS_KEY?.trim() &&
			env.BACKUP_BUCKET_NAME?.trim(),
	);
}

export function shouldUseLocalBucketBackups(env: {
	USE_LOCAL_BUCKET_BACKUPS?: string;
}): boolean {
	return env.USE_LOCAL_BUCKET_BACKUPS?.trim() === "true";
}

export function getSandboxBackupOptions(options: {
	env: Parameters<typeof hasPresignedBackupConfig>[0] &
		Parameters<typeof shouldUseLocalBucketBackups>[0];
	projectId: string;
}): BackupOptions {
	const useLocalBucket = shouldUseLocalBucketBackups(options.env);

	if (!useLocalBucket && !hasPresignedBackupConfig(options.env)) {
		throw new Error(
			"Sandbox backups require R2 credentials or USE_LOCAL_BUCKET_BACKUPS=true.",
		);
	}

	return {
		dir: WORKSPACE_PATH,
		name: `project-${options.projectId}`,
		ttl: SANDBOX_BACKUP_TTL_SECONDS,
		excludes: [...SANDBOX_BACKUP_EXCLUDES],
		...(useLocalBucket ? { localBucket: true } : {}),
	};
}
