import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const { outputFiles, metafile } = await build({ entryPoints: [new URL("./src/entry.ts", import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers"], metafile: true });
const tokens = { access: "fixture-access-one", refresh: "fixture-refresh-one", identity: "fixture-identity-one", expiresAt: 0 };
const rotated = { access: "fixture-access-two", refresh: "fixture-refresh-two", identity: "fixture-identity-two", expiresAt: 4102444800000 };

test("credential imports and bindings remain product-only", async () => {
	for (const source of Object.keys(metafile.inputs)) {
		assert.doesNotMatch(source, /pi-ai|pi-durable|sandbox|runtime\/src|auth\.ts/);
	}
	const runtimeDir = new URL("../runtime/src/", import.meta.url);
	for (const file of await readdir(runtimeDir)) {
		if (!file.endsWith(".ts") || file.includes("test")) continue;
		assert.doesNotMatch(await readFile(new URL(file, runtimeDir), "utf8"), /codex-credential|codex-connection-product|codex-connection\.functions|CODEX_CREDENTIAL_KEYS|CODEX_ACCESS_TOKEN|CODEX_REFRESH_TOKEN/);
	}
	const composition = await readFile(new URL("../../alchemy.run.ts", import.meta.url), "utf8");
	assert.doesNotMatch(composition.replace(/import type[^;]+;/g, "").split('const sandbox = await Container("sandbox"')[0], /CODEX_CREDENTIAL|CodexCredential/);
	assert.match(composition, /new_sqlite_classes: \["Sandbox"\], tag: "v1"/);
	assert.match(composition, /new_sqlite_classes: \["CodexCredential"\], tag: "v2"/);
});

test("production RPC cannot return private keyring or enable fixture token installation", async () => {
	const mf = new Miniflare({ modules: true, script: outputFiles[0].text,
		compatibilityDate: "2026-03-10", compatibilityFlags: ["nodejs_compat"],
		d1Databases: ["DB"], durableObjects: { CodexCredential: { className: "CodexCredential", useSQLite: true } },
		bindings: { CODEX_CREDENTIAL_CURRENT_KEY_VERSION: "fixture-v1", CODEX_CREDENTIAL_KEYS: JSON.stringify({ "fixture-v1": "01".repeat(32) }) },
		outboundService: () => { assert.fail("production attempted external I/O"); },
	});
	try {
		const ns = await mf.getDurableObjectNamespace("CodexCredential");
		const stub = ns.get(ns.idFromName("owner"));
		await assert.rejects(async () => await stub.keyring());
		await assert.rejects(async () => await stub.read());
		assert.equal((await stub.installFixture("owner", 1, tokens)).status, "disconnected");
		assert.equal((await stub.ensureFresh("owner")).status, "disconnected");
	} finally { await mf.dispose(); }
});

test("actual workerd abort after upstream rotation survives two reactivations without redispatch", async () => {
	let rotations = 0;
	const mf = new Miniflare({
		modules: true, script: outputFiles[0].text,
		compatibilityDate: "2026-03-10", compatibilityFlags: ["nodejs_compat"],
		d1Databases: ["DB"],
		durableObjects: { CodexCredential: { className: "FixtureCredential", useSQLite: true } },
		bindings: { CODEX_CREDENTIAL_CURRENT_KEY_VERSION: "fixture-v1", CODEX_CREDENTIAL_KEYS: JSON.stringify({ "fixture-v1": "01".repeat(32) }) },
		outboundService: async (request) => {
			assert.equal(request.url, "https://credential-fixture.invalid/rotate");
			assert.equal(request.method, "POST");
			assert.deepEqual(await request.json(), { refresh: tokens.refresh });
			rotations++;
			return Response.json(rotated);
		},
	});
	try {
		const db = await mf.getD1Database("DB");
		await db.exec("CREATE TABLE user(id TEXT PRIMARY KEY)");
		await db.exec((await readFile(new URL("../web/migrations/0021_first_lilandra.sql", import.meta.url), "utf8")).replaceAll("\n", " "));
		await db.exec("INSERT INTO user VALUES('owner'); INSERT INTO codex_connections VALUES('owner',1,0,'connected',0,0)");
		const ns = await mf.getDurableObjectNamespace("CodexCredential");
		const stub = ns.get(ns.idFromName("owner"));
		const installed = await stub.install("owner", 1, tokens);
		assert.equal(installed.status, "connected"); assert.equal(installed.generation, 1);
		await stub.armAbort();
		await assert.rejects(stub.ensureFresh("owner"));
		for (let i = 0; i < 2; i++) {
			const reopened = ns.get(ns.idFromName("owner"));
			const recovered = await reopened.ensureFresh("owner");
			assert.equal(recovered.status, "reconnect_required"); assert.equal(recovered.generation, 1);
			assert.equal(rotations, 1);
			await assert.rejects(reopened.abortFixture());
		}
		const final = await ns.get(ns.idFromName("owner")).status("owner");
		assert.equal(final.status, "reconnect_required"); assert.equal(final.generation, 1);
		assert.equal(rotations, 1);
		await db.exec("UPDATE codex_connections SET generation=2,revoked=0,status='connected',projection_version=0");
		const reconnected = ns.get(ns.idFromName("owner"));
		assert.equal((await reconnected.install("owner", 2, tokens)).status, "connected");
		assert.equal((await reconnected.ensureFresh("owner")).status, "connected");
		assert.equal(rotations, 2);
		await assert.rejects(reconnected.abortFixture());
		assert.equal((await ns.get(ns.idFromName("owner")).ensureFresh("owner")).status, "connected");
		assert.equal(rotations, 2);
	} finally { await mf.dispose(); }
});
