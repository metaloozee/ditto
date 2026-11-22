import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, expect, it } from "vite-plus/test";

const run = promisify(execFile);
const composeFile = path.join(import.meta.dirname, "egress/compose.yaml");
const workspace = "ws-trial";
const destinations = mkdtempSync(path.join(tmpdir(), "ditto-egress-"));

const env = { ...process.env, WORKSPACE_ID: workspace, DESTINATIONS_DIR: destinations };
const compose = (...args: string[]) =>
	run("docker", ["compose", "-f", composeFile, ...args], { env, maxBuffer: 16 * 1024 * 1024 });

function approve(...hosts: string[]) {
	writeFileSync(path.join(destinations, `${workspace}.txt`), `${hosts.join("\n")}\n`);
}

async function load(url: string, ...flags: string[]) {
	const { stdout } = await compose("run", "--rm", "chrome", url, ...flags);
	return stdout;
}

type Decision = { workspace: string; host: string; decision: "allow" | "deny" };

async function filterLog(): Promise<Decision[]> {
	const { stdout } = await compose("logs", "--no-log-prefix", "filter");
	return stdout
		.split("\n")
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as Decision);
}

beforeAll(async () => {
	approve("example.com");
	await compose("up", "-d", "--build", "--wait", "filter");
	await compose("build", "chrome");
}, 600_000);

afterAll(async () => {
	await compose("down", "-v");
	rmSync(destinations, { recursive: true, force: true });
}, 120_000);

it("loads an approved HTTPS destination through the filter, trusting its CA", async () => {
	expect(await load("https://example.com/")).toContain("Example Domain");

	expect(await filterLog()).toContainEqual(
		expect.objectContaining({ workspace, host: "example.com", decision: "allow" }),
	);
}, 120_000);

it("refuses an unapproved destination and logs the refusal with the workspace", async () => {
	expect(await load("https://example.org/")).not.toContain("Example Domain");

	expect(await filterLog()).toContainEqual(
		expect.objectContaining({ workspace, host: "example.org", decision: "deny" }),
	);
}, 120_000);

it("gives Chrome no route around the filter", async () => {
	expect(await load("https://example.com/", "--no-proxy-server")).not.toContain("Example Domain");
}, 120_000);

it("follows a changed destination list without rebuilding the image", async () => {
	approve("example.com", "example.org");

	expect(await load("https://example.org/")).toContain("Example Domain");
	expect(await filterLog()).toContainEqual(
		expect.objectContaining({ workspace, host: "example.org", decision: "allow" }),
	);
}, 120_000);

it("logs a request's path without its query, which can carry login codes", async () => {
	await load("https://example.com/callback?code=SIMULATED-oauth-code&state=x");

	const { stdout } = await compose("logs", "--no-log-prefix", "filter");
	expect(stdout).not.toContain("SIMULATED-oauth-code");
	expect(await filterLog()).toContainEqual(
		expect.objectContaining({ host: "example.com", port: 443, path: "/callback", method: "GET" }),
	);
}, 120_000);

it("logs the workspace identity on every request", async () => {
	const log = await filterLog();

	expect(log.length).toBeGreaterThan(0);
	expect(log.every((entry) => entry.workspace === workspace)).toBe(true);
});
