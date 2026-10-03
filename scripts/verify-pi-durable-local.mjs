import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCandidateBundle } from "./check-pi-durable-imports.mjs";
import { loadFixtureHostAuth, redactFixtureHostAuth } from "./pi-durable-host-auth.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "plans/evidence/artifacts/001");
await mkdir(artifacts, { recursive: true });
const state = await mkdtemp(path.join(artifacts, "local-"));
const home = path.join(state, "home");
await mkdir(home);
// Alchemy discovers its persistence root by walking to a workspace marker.
await writeFile(path.join(state, "pnpm-workspace.yaml"), "packages: []\n");
const fixture = randomBytes(16).toString("hex");
const childEnv = {
	PATH: process.env.PATH,
	HOME: home,
	TMPDIR: state,
	NO_COLOR: "1",
	DITTO_LOCAL_PI_DURABLE: "1",
	DITTO_FIXTURE_ID: fixture,
	DITTO_FIXTURE_STATE: state,
	ALCHEMY_STATE_FILE: path.join(state, "alchemy.sqlite"),
	ALCHEMY_CI_STATE_STORE_CHECK: "false",
	WRANGLER_SEND_METRICS: "false",
	ALCHEMY_TELEMETRY_DISABLED: "1",
	DO_NOT_TRACK: "1",
};
const emptyEnv = path.join(state, "empty.env");
await writeFile(emptyEnv, "");
let child;
let selected;
let stdout = "";
let stderr = "";
let apiDenial;
let apiAttempted = false;
let outcome = { local: "not run", docker: "not run", state };
try {
	const args = process.argv.slice(2);
	assert(args.length === 2 && args[0] === "--cloudflare-env-file", "Use explicit --cloudflare-env-file PATH");
	const credentialFile = path.resolve(args[1]);
	selected = await loadFixtureHostAuth(credentialFile);
	childEnv.DITTO_FIXTURE_CLOUDFLARE_ENV_FILE = credentialFile;
	apiDenial = createHttpServer((_request, response) => {
		apiAttempted = true;
		response.writeHead(403);
		response.end("Local fixture forbids Cloudflare API requests");
	});
	await new Promise((resolve, reject) => { apiDenial.once("error", reject); apiDenial.listen(0, "127.0.0.1", resolve); });
	childEnv.DITTO_FIXTURE_API_ORIGIN = `http://127.0.0.1:${apiDenial.address().port}`;
	const docker = spawnSync("docker", ["version", "--format", "{{json .}}"], { cwd: root, env: childEnv, encoding: "utf8", timeout: 15000 });
	await writeFile(path.join(state, "docker.json"), docker.stdout || "Docker unavailable\n");
	if (docker.status !== 0) throw new Error("Docker prerequisite unavailable; Docker gate not run");
	const { bundle, assessment } = await buildCandidateBundle();
	await writeFile(path.join(state, "import-assessment.json"), JSON.stringify(assessment, null, 2));
	const candidate = bundle.outputFiles[0].text;
	assert(!candidate.includes(selected.apiToken) && !candidate.includes(selected.accountId), "Host credentials entered candidate bundle");
	await writeFile(path.join(state, "candidate.js"), bundle.outputFiles[0].contents);
	await writeFile(path.join(state, "metafile.json"), JSON.stringify(bundle.metafile, null, 2));
	const server = createServer();
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address();
	assert(address && typeof address === "object");
	const port = address.port;
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	childEnv.DITTO_FIXTURE_PORT = String(port);
	const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.resolve("alchemy"))), "..");
	const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	assert.equal(typeof manifest.bin?.alchemy, "string", "Installed Alchemy CLI missing");
	const cli = path.resolve(packageRoot, manifest.bin.alchemy);
	assert(cli.startsWith(`${packageRoot}${path.sep}`), "Alchemy CLI outside installed package");
	const cliArgs = [cli, "dev", "alchemy.run.ts", "--stage", `l0-${fixture}`, "--env-file", emptyEnv];
	assert(!Object.values(childEnv).some((value) => value === selected.apiToken || value === selected.accountId), "Host credentials entered child environment");
	await writeFile(path.join(state, "invocation.json"), JSON.stringify({ command: [process.execPath, ...cliArgs], environmentKeys: Object.keys(childEnv), credentialFile, state, fixture, port, authentication: "host-resource-properties" }, null, 2));
	child = spawn(process.execPath, cliArgs, { cwd: root, env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.on("error", () => { stderr += "Alchemy process launch failed"; });
	const origin = `http://127.0.0.1:${port}`;
	const headers = { "x-ditto-fixture": fixture };
	const deadline = Date.now() + 120000;
	let ready = false;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error("Alchemy exited before readiness");
		if (apiAttempted) throw new Error("Forbidden Cloudflare API request attempted; local test stopped");
		if ((stdout + stderr).includes("ERR_RUNTIME_FAILURE")) throw new Error("Local workerd startup failed; inspect redacted Alchemy log");
		if ((stdout + stderr).includes("No credentials found")) throw new Error("Alchemy host authentication failed; Docker turn not run");
		try {
			const response = await fetch(`${origin}/ready`, { headers, signal: AbortSignal.timeout(1000) });
			if (response.ok && await response.text() === "ready") { ready = true; break; }
		} catch { /* Bounded readiness polling only. */ }
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	assert(ready, "Alchemy readiness timed out");
	assert.equal((await fetch(`${origin}/ready`)).status, 403);
	outcome.local = "passed";
	outcome.docker = "failed";
	const marker = `/tmp/ditto-l0-${fixture}.txt`;
	await assert.rejects(stat(marker), { code: "ENOENT" });
	const response = await fetch(`${origin}/verify`, { method: "POST", headers, signal: AbortSignal.timeout(120000) });
	assert.equal(response.status, 200, "Candidate integration failed");
	const result = await response.json();
	assert(!JSON.stringify(result).includes(selected.apiToken) && !JSON.stringify(result).includes(selected.accountId), "Host credentials entered runtime result");
	assert(!apiAttempted, "Forbidden Cloudflare API request attempted");
	assert.equal(result.path, marker);
	assert.equal(result.marker, "ditto-disposable-l0");
	assert.equal(result.toolResult, "ditto-disposable-l0");
	assert.equal(result.answer, "Synthetic sandbox marker verified.");
	assert.equal(result.credentialBoundary, "passed");
	await assert.rejects(stat(marker), { code: "ENOENT" });
	outcome.docker = "passed";
	await writeFile(path.join(state, "result.json"), JSON.stringify(result, null, 2));
	outcome.authentication = "host-resource-properties";
} catch (error) {
	outcome = { ...outcome, reason: redactFixtureHostAuth(error instanceof Error ? error.message : "Verification failed", selected).slice(0, 1000) };
	console.error(`${outcome.reason}. Evidence: ${state}`);
	process.exitCode = 1;
} finally {
	if (child) {
		try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
		await Promise.race([new Promise((resolve) => child.once("close", resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
		try { process.kill(-child.pid, "SIGKILL"); } catch { /* Only the owned process group. */ }
	}
	if (apiDenial) await new Promise((resolve) => apiDenial.close(resolve));
	await writeFile(path.join(state, "alchemy.log"), redactFixtureHostAuth(stdout, selected).slice(0, 1000000) + "\n" + redactFixtureHostAuth(stderr, selected).slice(0, 1000000));
	if (selected) {
		try {
			const entries = await readdir(state, { recursive: true, withFileTypes: true });
			let checkedFiles = 0;
			let encryptedSecrets = 0;
			for (const entry of entries) {
				if (!entry.isFile()) continue;
				const file = path.join(entry.parentPath, entry.name);
				const bytes = await readFile(file);
				assert(!bytes.includes(Buffer.from(selected.apiToken)), "Plaintext HOST token persisted in fixture artifacts");
				const management = file.startsWith(path.join(state, ".alchemy", "ditto-pi-durable-l0") + path.sep);
				if (!management) assert(!bytes.includes(Buffer.from(selected.accountId)), "HOST account metadata escaped management state");
				if (management && bytes.includes(Buffer.from('"@secret"'))) encryptedSecrets++;
				checkedFiles++;
			}
			await writeFile(path.join(state, "credential-boundary.json"), JSON.stringify({ checkedFiles, encryptedSecrets, plaintextTokenAbsent: true, accountMetadataManagementOnly: true }, null, 2));
		} catch {
			outcome = { ...outcome, local: "failed", docker: "failed", reason: "Fixture artifact credential boundary failed" };
			process.exitCode = 1;
			console.error(`Fixture artifact credential boundary failed. Evidence: ${state}`);
		}
	}
	await writeFile(path.join(state, "outcome.json"), JSON.stringify({ ...outcome, authentication: "host-resource-properties", cloudflareApiAttempted: apiAttempted }, null, 2));
	if (outcome.docker === "passed") console.log(`Host-authenticated local L0 passed. Evidence: ${state}`);
}
