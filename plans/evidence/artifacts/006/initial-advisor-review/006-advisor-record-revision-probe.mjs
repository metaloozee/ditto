import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(new URL("../../apps/credential-tests/package.json", import.meta.url));
const { build } = require("esbuild");
const { Miniflare } = require("miniflare");
const root = new URL("../../", import.meta.url).pathname;
const { outputFiles } = await build({
	stdin: {
		contents: `import { FixtureCredential } from './apps/credential-tests/src/entry.ts';
export class ProbeCredential extends FixtureCredential {
 snapshot() { return this.ctx.storage.sql.exec('SELECT sealed FROM credential').one().sealed; }
 metadata() { return JSON.stringify(this.ctx.storage.sql.exec('SELECT generation,renewal,version,status FROM credential').one()); }
 restoreEnvelope(sealed) { this.ctx.storage.sql.exec('UPDATE credential SET sealed=?', sealed); }
}
export default { fetch: () => new Response('Not found', { status: 404 }) };`,
		resolveDir: root,
		sourcefile: "credential-record-revision-probe.ts",
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "browser",
	external: ["cloudflare:workers"],
});

test("replacing ciphertext alone cannot dispatch a previously spent fixture refresh", async () => {
	let dispatches = 0;
	const tokens = { access: "fixture-one", refresh: "fixture-refresh-one", expiresAt: 0 };
	const replacement = { access: "fixture-two", refresh: "fixture-refresh-two", expiresAt: 4102444800000 };
	const mf = new Miniflare({
		modules: true,
		script: outputFiles[0].text,
		compatibilityDate: "2026-03-10",
		compatibilityFlags: ["nodejs_compat"],
		d1Databases: ["DB"],
		durableObjects: { CodexCredential: { className: "ProbeCredential", useSQLite: true } },
		bindings: {
			CODEX_CREDENTIAL_CURRENT_KEY_VERSION: "fixture",
			CODEX_CREDENTIAL_KEYS: JSON.stringify({ fixture: "01".repeat(32) }),
		},
		outboundService: async (request) => {
			assert.equal(request.url, "https://credential-fixture.invalid/rotate");
			assert.equal(request.method, "POST");
			assert.ok((await request.json()).refresh === tokens.refresh, "unexpected fixture refresh input");
			dispatches++;
			return Response.json(replacement);
		},
	});
	try {
		const db = await mf.getD1Database("DB");
		await db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); CREATE TABLE codex_connections(user_id TEXT PRIMARY KEY,generation INTEGER,revoked INTEGER,status TEXT,projection_version INTEGER,updated_at INTEGER); INSERT INTO user VALUES('owner'); INSERT INTO codex_connections VALUES('owner',1,0,'connected',0,0)");
		const ns = await mf.getDurableObjectNamespace("CodexCredential");
		const stub = ns.get(ns.idFromName("owner"));
		assert.equal((await stub.install("owner", 1, tokens)).status, "connected");
		const previousEnvelope = await stub.snapshot();
		assert.equal((await stub.ensureFresh("owner")).status, "connected");
		assert.equal(dispatches, 1);
		const currentMetadata = await stub.metadata();
		await stub.restoreEnvelope(previousEnvelope);
		assert.deepEqual(await stub.metadata(), currentMetadata);
		const result = await stub.ensureFresh("owner");
		console.log(JSON.stringify({ metadataUnchangedBeforeRead: true, refreshDispatches: dispatches, status: result.status }));
		assert.equal(dispatches, 1, "previously spent fixture refresh was dispatched again");
	} finally {
		await mf.dispose();
	}
});
