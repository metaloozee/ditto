// Read-only review probes. Every database below is disposable, in-memory SQLite.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { DatabaseSync } = require("node:sqlite");
const root = process.argv[2] || "/home/ayan/ditto-worktrees/plan-001-reexecute";
const web = path.join(root, "apps/web");
const localRequire = createRequire(path.join(web, "package.json"));
const ts = localRequire("typescript");
const { drizzle } = localRequire("drizzle-orm/sqlite-proxy");
const { drizzle: d1Drizzle } = localRequire("drizzle-orm/d1");
const { sql } = localRequire("drizzle-orm");
const cache = new Map();

function loadSource(file) {
	const absolute = path.resolve(file);
	if (cache.has(absolute)) return cache.get(absolute).exports;
	const module = { exports: {} };
	cache.set(absolute, module);
	const output = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
		},
	}).outputText;
	const resolve = (specifier) => {
		if (specifier.startsWith("#/")) {
			return loadSource(path.join(web, "src", `${specifier.slice(2)}.ts`));
		}
		if (specifier.startsWith(".")) {
			return loadSource(path.resolve(path.dirname(absolute), `${specifier}.ts`));
		}
		return localRequire(specifier);
	};
	new Function("require", "module", "exports", output)(resolve, module, module.exports);
	return module.exports;
}

function fixture() {
	// Reuse the reviewed candidate's legacy fixture without executing its tests.
	const test = fs.readFileSync(path.join(web, "src/db/trusted-runtime-migration.test.ts"), "utf8");
	const body = test.slice(test.indexOf("function legacyDatabase()"), test.indexOf("function counts("));
	if (!body.startsWith("function legacyDatabase()")) throw new Error("Fixture drift; review before rerunning");
	const sqlite = new Function("DatabaseSync", `${body}; return legacyDatabase();`)(DatabaseSync);
	const migration = fs.readFileSync(path.join(web, "migrations/0020_trusted_runtime_additive.sql"), "utf8");
	sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""));
	let afterPolicyRead;
	const db = drizzle(async (query, params, method) => {
		const statement = sqlite.prepare(query);
		if (method === "run") {
			statement.run(...params);
			return { rows: [] };
		}
		const rows = statement.all(...params);
		if (afterPolicyRead && query.startsWith("select") && query.includes("runtime_capacity_policy")) {
			const callback = afterPolicyRead;
			afterPolicyRead = undefined;
			callback();
		}
		const values = rows.map(Object.values);
		return { rows: method === "get" ? values[0] : values };
	});
	return { db, sqlite, onPolicyRead(callback) { afterPolicyRead = callback; } };
}

async function main() {
	const ownership = loadSource(path.join(web, "src/lib/session-runtime-ownership.ts"));
	const authorityModule = loadSource(path.join(web, "src/lib/sandbox-authority.ts"));
	const capacity = loadSource(path.join(web, "src/lib/workspace-runtime-capacity.ts"));

	try {
		await d1Drizzle({}).batch([ownership.abortUnlessLegacyOwnerSql("s", 1)]);
		console.log("batch adapter: accepted");
	} catch (error) {
		console.log("batch adapter:", error.message);
	}

	const guard = fixture();
	try {
		const { SQLiteSyncDialect } = localRequire("drizzle-orm/sqlite-core");
		const query = new SQLiteSyncDialect().sqlToQuery(ownership.abortUnlessLegacyOwnerSql("s", 1));
		guard.sqlite.prepare(query.sql).get(...query.params);
		console.log("SQLite ownership guard: accepted");
	} catch (error) {
		console.log("SQLite ownership guard:", error.message);
	}
	guard.sqlite.close();

	const authorityFixture = fixture();
	authorityFixture.sqlite.exec("UPDATE privileged_operations SET expiresAt = 4102444800; UPDATE workspace_sessions SET runtimeOwner = 'migrating', runtimeOwnerVersion = 2");
	const authority = authorityModule.createSandboxAuthority(authorityFixture.db);
	try {
		await authority.resolveOutboundRequest({ identityId: "i", lifecycleGeneration: 1, containerId: "opaque-container" }, "model");
		console.log("migrating session old model callback: ALLOWED");
	} catch (error) {
		console.log("migrating session old model callback: denied", error.code || error.message);
	}
	try {
		await authority.openOperation({ identityId: "i", family: "git_transport", type: "git_fetch", contractVersion: 1, expiresAt: new Date(4102444800000) });
		console.log("migrating session new legacy operation: ALLOWED");
	} catch (error) {
		console.log("migrating session new legacy operation: denied", error.code || error.message);
	}
	authorityFixture.sqlite.close();

	const accounting = fixture();
	accounting.sqlite.exec("DELETE FROM workspace_capacity_leases");
	accounting.onPolicyRead(() => accounting.sqlite.exec("UPDATE runtime_capacity_policy SET accountingMode = 'unified', version = 2 WHERE id = 1"));
	try {
		await capacity.acquireCapacitySlot({ db: accounting.db, sessionId: "s", userId: "u", nowMs: 1700000000000 });
	} catch (error) {
		console.log("accounting acquire: denied", error.code || error.message);
	}
	console.log("post-cutover legacy lease count:", accounting.sqlite.prepare("SELECT count(*) AS n FROM workspace_capacity_leases").get().n);
	accounting.sqlite.close();

	const work = fixture();
	work.sqlite.exec("INSERT INTO workspace_runtime_work (id,fifoSeq,projectId,userId,sessionId,intent,queueExpiresAt,runtimeOwner,runtimeOwnerVersion,commandId) VALUES ('trusted-delivery',1,'p','u',NULL,'destruction',1,'trusted_v1',1,'command')");
	await capacity.expireQueuedWork({ db: work.db, nowMs: 1700000000000 });
	console.log("trusted project delivery after legacy expiry:", work.sqlite.prepare("SELECT status FROM workspace_runtime_work WHERE id = 'trusted-delivery'").get().status);
	work.sqlite.close();

	// Keep a standalone D1 check independent of the helper's SQL implementation.
	try { await d1Drizzle({}).batch([sql`SELECT 1`]); }
	catch (error) { console.log("raw SQL in Drizzle D1 batch:", error.message); }

	const { parseBrowserCommandV1 } = require(path.join(root, "packages/runtime-contracts/dist/index.js"));
	try {
		parseBrowserCommandV1('{"version":1,"kind":"prompt","idempotencyKey":"key","projectId":"p","text":"hello","__proto__":"ignored"}');
		console.log("unknown __proto__ field: ACCEPTED");
	} catch (error) { console.log("unknown __proto__ field: rejected", error.code || error.message); }
	try { parseBrowserCommandV1("[".repeat(8000) + "0" + "]".repeat(8000)); }
	catch (error) { console.log("deep bounded JSON:", error.name, error.message); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
