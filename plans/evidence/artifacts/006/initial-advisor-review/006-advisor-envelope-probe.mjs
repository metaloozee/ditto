import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "../../apps/credential-tests/node_modules/esbuild/lib/main.js";

const { outputFiles } = await build({
	entryPoints: [new URL("../../apps/web/src/lib/codex-credential-crypto.ts", import.meta.url).pathname],
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
});
const { sealCredentials, openCredentials } = await import(
	"data:text/javascript;base64," + Buffer.from(outputFiles[0].text).toString("base64")
);
const ring = { current: "fixture", keys: { fixture: "01".repeat(32) } };
for (const [label, value] of [
	["plain", "a".repeat(8192)],
	["JSON-expanded", "\u0000".repeat(8192)],
]) {
	test(`accepted ${label} token set remains readable`, async () => {
		const tokens = { access: value, refresh: value, identity: value, expiresAt: 0 };
		const sealed = await sealCredentials(tokens, "owner", 1, ring);
		console.log(JSON.stringify({ case: label, tokenBytes: new TextEncoder().encode(value).byteLength, envelopeChars: sealed.length }));
		const opened = await openCredentials(sealed, "owner", 1, ring);
		assert.ok(opened.access === value && opened.refresh === value && opened.identity === value, "credential roundtrip mismatch");
	});
}
