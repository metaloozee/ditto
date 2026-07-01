import { describe, expect, it } from "vitest";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";
import {
	SANDBOX_BACKUP_EXCLUDES,
	SANDBOX_BACKUP_TTL_SECONDS,
	getSandboxBackupOptions,
	hasPresignedBackupConfig,
	parseSandboxBackup,
	serializeSandboxBackup,
} from "./sandbox-backup";

const presignedEnv = {
	CLOUDFLARE_ACCOUNT_ID: "account-id",
	R2_ACCESS_KEY_ID: "access-key",
	R2_SECRET_ACCESS_KEY: "secret-key",
	BACKUP_BUCKET_NAME: "backup-bucket",
};

describe("sandbox backup helpers", () => {
	it("serializes and parses a production backup handle", () => {
		const serialized = serializeSandboxBackup({
			id: "backup-1",
			dir: WORKSPACE_PATH,
		});

		expect(JSON.parse(serialized)).toEqual({
			id: "backup-1",
			dir: WORKSPACE_PATH,
		});
		expect(parseSandboxBackup(serialized)).toEqual({
			id: "backup-1",
			dir: WORKSPACE_PATH,
		});
	});

	it("serializes and parses a local-bucket backup handle", () => {
		const serialized = serializeSandboxBackup({
			id: "backup-1",
			dir: WORKSPACE_PATH,
			localBucket: true,
		});

		expect(parseSandboxBackup(serialized)).toEqual({
			id: "backup-1",
			dir: WORKSPACE_PATH,
			localBucket: true,
		});
	});

	it("returns null for invalid JSON", () => {
		expect(parseSandboxBackup("{")).toBeNull();
	});

	it("returns null when id is missing", () => {
		expect(parseSandboxBackup(JSON.stringify({ dir: WORKSPACE_PATH }))).toBeNull();
	});

	it("returns null when dir is missing", () => {
		expect(parseSandboxBackup(JSON.stringify({ id: "backup-1" }))).toBeNull();
	});

	it("returns null when dir is not the workspace path", () => {
		expect(
			parseSandboxBackup(JSON.stringify({ id: "backup-1", dir: "/tmp" })),
		).toBeNull();
	});

	it("requires all presigned backup config fields", () => {
		expect(hasPresignedBackupConfig(presignedEnv)).toBe(true);
		expect(
			hasPresignedBackupConfig({ ...presignedEnv, CLOUDFLARE_ACCOUNT_ID: " " }),
		).toBe(false);
		expect(
			hasPresignedBackupConfig({ ...presignedEnv, R2_ACCESS_KEY_ID: "" }),
		).toBe(false);
		expect(
			hasPresignedBackupConfig({ ...presignedEnv, R2_SECRET_ACCESS_KEY: "" }),
		).toBe(false);
		expect(
			hasPresignedBackupConfig({ ...presignedEnv, BACKUP_BUCKET_NAME: "" }),
		).toBe(false);
	});

	it("uses local bucket mode when explicitly enabled", () => {
		expect(
			getSandboxBackupOptions({
				env: { USE_LOCAL_BUCKET_BACKUPS: "true" },
				projectId: "project-1",
			}),
		).toEqual({
			dir: WORKSPACE_PATH,
			name: "project-project-1",
			ttl: SANDBOX_BACKUP_TTL_SECONDS,
			excludes: [...SANDBOX_BACKUP_EXCLUDES],
			localBucket: true,
		});
	});

	it("omits local bucket mode when presigned config is complete", () => {
		expect(
			getSandboxBackupOptions({
				env: presignedEnv,
				projectId: "project-1",
			}),
		).toEqual({
			dir: WORKSPACE_PATH,
			name: "project-project-1",
			ttl: SANDBOX_BACKUP_TTL_SECONDS,
			excludes: [...SANDBOX_BACKUP_EXCLUDES],
		});
	});

	it("throws when no backup storage mode is configured", () => {
		expect(() =>
			getSandboxBackupOptions({ env: {}, projectId: "project-1" }),
		).toThrow(
			"Sandbox backups require R2 credentials or USE_LOCAL_BUCKET_BACKUPS=true.",
		);
	});

	it("excludes env files and dependency directories", () => {
		expect(SANDBOX_BACKUP_EXCLUDES).toContain(".env");
		expect(SANDBOX_BACKUP_EXCLUDES).toContain("node_modules");
	});
});
