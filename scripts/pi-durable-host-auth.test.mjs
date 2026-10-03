import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { Scope, serialize } from "alchemy";
import { createCloudflareApi } from "alchemy/cloudflare";
import { fixtureWorkerAuth, loadFixtureHostAuth, redactFixtureHostAuth } from "./pi-durable-host-auth.ts";

const token = "synthetic-credential-not-a-real-token";
const account = "0123456789abcdef0123456789abcdef";

async function fixtureFile(content) {
	const directory = await mkdtemp("/tmp/ditto-l0-auth-test-");
	const file = path.join(directory, "synthetic.env");
	await writeFile(file, content);
	return file;
}

test("selects only host auth keys without exporting dotenv values", async () => {
	const file = await fixtureFile(`CLOUDFLARE_API_TOKEN=${token}\nCLOUDFLARE_ACCOUNT_ID=${account}\nOPENAI_API_KEY=synthetic-other-secret\nBETTER_AUTH_SECRET=synthetic-product-secret\n`);
	const before = { ...process.env };
	const selected = await loadFixtureHostAuth(file);
	assert.deepEqual(selected, { apiToken: token, accountId: account });
	assert.deepEqual({ ...process.env }, before);
	const props = fixtureWorkerAuth(selected);
	assert.equal(props.apiToken.unencrypted, token);
	assert.equal(props.accountId, account);
	assert.equal(props.bindings, undefined);
	const api = await createCloudflareApi({ ...props, baseUrl: "http://127.0.0.1:1" });
	assert.equal(api.accountId, account);
	const scope = new Scope({ scopeName: "synthetic-auth", parent: null, phase: "up", password: randomBytes(32).toString("hex"), noTrack: true });
	const state = await serialize(scope, props);
	assert.equal(state.apiToken["@secret"].version, "v1");
	assert.equal(typeof state.apiToken["@secret"].ciphertext, "string");
	assert(!JSON.stringify(state).includes(token));
});

test("invalid credentials and split logs cannot expose selected values", async () => {
	for (const content of ["", `CLOUDFLARE_API_TOKEN=${token}\nCLOUDFLARE_ACCOUNT_ID=bad-secret-value\n`, `CLOUDFLARE_API_TOKEN=bad secret value\nCLOUDFLARE_ACCOUNT_ID=${account}\n`]) {
		const file = await fixtureFile(content);
		await assert.rejects(loadFixtureHostAuth(file), (error) => {
			assert(!error.message.includes(token));
			assert(!error.message.includes(account));
			assert(!error.message.includes("bad-secret-value"));
			assert(!error.message.includes("bad secret value"));
			return /CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)/.test(error.message);
		});
	}
	const chunks = [token.slice(0, 10), token.slice(10), account.slice(0, 8), account.slice(8)];
	assert.equal(redactFixtureHostAuth(chunks.join(""), { apiToken: token, accountId: account }), "<REDACTED><REDACTED>");
});

test("public resource auth keeps inherited Docker child environment credential-free", async () => {
	const file = await fixtureFile(`CLOUDFLARE_API_TOKEN=${token}\nCLOUDFLARE_ACCOUNT_ID=${account}\nOPENAI_API_KEY=synthetic-other-secret\n`);
	const helper = new URL("./pi-durable-host-auth.ts", import.meta.url).href;
	const program = `
		import assert from 'node:assert/strict';
		import { DockerApi } from 'alchemy/docker';
		import { fixtureWorkerAuth, loadFixtureHostAuth } from ${JSON.stringify(helper)};
		const auth = fixtureWorkerAuth(await loadFixtureHostAuth(process.argv[1]));
		assert(auth.apiToken && auth.accountId && !auth.bindings);
		const probe = "console.log(JSON.stringify(Object.keys(process.env).filter(key => /CLOUDFLARE|OPENAI|BETTER_AUTH/.test(key))))";
		const { stdout } = await new DockerApi({ dockerPath: process.execPath }).exec(['-e', probe], 0, true);
		assert.deepEqual(JSON.parse(stdout), []);
		console.log('closed Docker child environment');
	`;
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", program, file], {
		cwd: path.resolve(new URL("..", import.meta.url).pathname),
		env: { PATH: process.env.PATH, HOME: path.dirname(file), NO_COLOR: "1" },
		encoding: "utf8", timeout: 15000,
	});
	assert.equal(result.status, 0, "Synthetic host/Docker boundary probe failed");
	assert.equal(result.stdout.trim(), "closed Docker child environment");
});
