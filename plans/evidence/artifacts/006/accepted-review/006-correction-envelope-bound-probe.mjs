import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "../../apps/credential-tests/node_modules/esbuild/lib/main.js";

const { outputFiles } = await build({
 entryPoints: [new URL("../../apps/web/src/lib/codex-credential-crypto.ts", import.meta.url).pathname],
 bundle: true, write: false, format: "esm", platform: "node",
});
const { sealCredentials, openCredentials } = await import(
 "data:text/javascript;base64," + Buffer.from(outputFiles[0].text).toString("base64")
);
const ring = { current: "fixture", keys: { fixture: "01".repeat(32) } };
test("maximum plain token set still roundtrips within the persisted bound", async () => {
 const value = "a".repeat(8192);
 const tokens = { access: value, refresh: value, identity: value, expiresAt: 0 };
 const sealed = await sealCredentials(tokens, "owner", 1, ring);
 assert.ok(sealed.length <= 60000);
 const opened = await openCredentials(sealed, "owner", 1, ring);
 assert.ok(opened.access === value && opened.refresh === value && opened.identity === value);
});
test("JSON-expanded synthetic token sets are denied before a persistable envelope is returned", async () => {
 for (const value of ["\\".repeat(8192), "\u0000".repeat(8192)]) {
  const tokens = { access: value, refresh: value, identity: value, expiresAt: 0 };
  await assert.rejects(sealCredentials(tokens, "owner", 1, ring), { message: "credential_integrity" });
 }
});
