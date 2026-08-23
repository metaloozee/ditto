import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../migrations/0019_needy_squadron_sinister.sql",
	),
	"utf8",
);

describe("pre-launch legacy cutover migration", () => {
	it("revokes authority and preserves cleanup before deleting product rows", () => {
		const retire = migration.indexOf("UPDATE `sandbox_identities`");
		const abandon = migration.indexOf("UPDATE `archives`");
		const sessions = migration.indexOf("DELETE FROM `workspace_sessions`");
		const projects = migration.indexOf("DELETE FROM `projects`");
		expect(retire).toBeGreaterThanOrEqual(0);
		expect(abandon).toBeGreaterThan(retire);
		expect(sessions).toBeGreaterThan(abandon);
		expect(projects).toBeGreaterThan(sessions);
		expect(migration).toContain("`openSlot` = `id`");
		expect(migration).toContain("`status` = 'abandoned'");
	});

	it("drops only provider tables and transition columns", () => {
		const droppedTables = [...migration.matchAll(/DROP TABLE `([^`]+)`/g)].map(
			(match) => match[1],
		);
		expect(droppedTables).toEqual([
			"ai_provider_credentials",
			"provider_auth_attempts",
		]);
		for (const table of [
			"user",
			"session",
			"account",
			"verification",
			"sandbox_identities",
			"privileged_operations",
			"archives",
			"project_seeds",
			"workspace_session_recoveries",
			"workspace_runtime_work",
			"workspace_capacity_leases",
		]) {
			expect(migration).not.toContain(`DROP TABLE \`${table}\``);
		}
		expect(migration).toContain(
			"ALTER TABLE `projects` DROP COLUMN `sandboxId`",
		);
		expect(migration).toContain(
			"ALTER TABLE `workspace_sessions` DROP COLUMN `workspacePath`",
		);
	});
});
