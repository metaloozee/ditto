import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { expect, it } from "vite-plus/test";

const drizzleDir = fileURLToPath(new URL("../drizzle/", import.meta.url));

async function apply(db: DatabaseSync, migration: string) {
	db.exec(await readFile(`${drizzleDir}${migration}/migration.sql`, "utf8"));
}

it("adds the personal workspace mapping over an auth database without touching its accounts", async () => {
	const migrations = (await readdir(drizzleDir)).sort();
	const firstNew = migrations.findIndex((name) => name.endsWith("_personal_workspace"));
	expect(firstNew).toBeGreaterThan(0);
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	for (const migration of migrations.slice(0, firstNew)) await apply(db, migration);
	db.exec(`
		INSERT INTO user (id, name, email, updated_at) VALUES ('acct-1', 'Octo', 'octo@example.com', 0);
		INSERT INTO account (id, account_id, provider_id, user_id, updated_at)
			VALUES ('a-gh', '42', 'github', 'acct-1', 0), ('a-go', '99', 'google', 'acct-1', 0);
		INSERT INTO session (id, expires_at, token, user_id, updated_at)
			VALUES ('s-1', 0, 'token-1', 'acct-1', 0);
	`);

	for (const migration of migrations.slice(firstNew)) await apply(db, migration);

	expect(
		db.prepare("SELECT provider_id FROM account WHERE user_id = 'acct-1' ORDER BY 1").all(),
	).toEqual([{ provider_id: "github" }, { provider_id: "google" }]);
	expect(db.prepare("SELECT token FROM session").all()).toEqual([{ token: "token-1" }]);
	db.exec("INSERT INTO personal_workspace (user_id, workspace_id) VALUES ('acct-1', 'ws-1')");
	expect(() =>
		db.exec("INSERT INTO personal_workspace (user_id, workspace_id) VALUES ('acct-1', 'ws-2')"),
	).toThrow(/UNIQUE/);
});
