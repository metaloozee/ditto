import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { TestProject } from "vite-plus/test/node";

import { startFakeUpstream } from "./fake-upstream.ts";

declare module "vite-plus/test" {
	export interface ProvidedContext {
		appUrl: string;
		upstreamUrl: string;
	}
}

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const APP_URL = "http://localhost:1338";
/** How long an idle test session lasts, so expiry can be observed. */
export const SESSION_EXPIRES_IN = 6;
/** How long a test email code lasts, so expiry can be observed. */
export const CODE_EXPIRES_IN = 10;
/** How long a test visitor waits before another code can be sent. */
export const CODE_RESEND_IN = 3;

async function waitForApp(exited: Promise<number | null>) {
	const deadline = Date.now() + 180_000;
	while (Date.now() < deadline) {
		const ready = await fetch(`${APP_URL}/sign-in`).then(
			(r) => r.ok,
			() => false,
		);
		if (ready) return;
		const code = await Promise.race([exited, new Promise((r) => setTimeout(r, 500, "running"))]);
		if (code !== "running") throw new Error(`alchemy dev exited with ${String(code)}`);
	}
	throw new Error(`The test stage didn't answer at ${APP_URL}`);
}

/**
 * Starts the test stage — the real Worker on a freshly migrated local D1 —
 * pointed at a fake GitHub and Resend, with fake secrets only.
 */
export default async function setup(project: TestProject) {
	const upstream = await startFakeUpstream();
	await rm(`${repoRoot}.alchemy/state/ditto/test`, { recursive: true, force: true });

	const child = spawn("pnpm", ["exec", "alchemy", "dev", "--stage", "test", "--no-input"], {
		cwd: repoRoot,
		detached: true,
		stdio: ["ignore", "inherit", "inherit"],
		env: {
			...process.env,
			CI: "true",
			BETTER_AUTH_URL: APP_URL,
			BETTER_AUTH_SECRET: "test-only-secret-not-for-any-real-stage",
			GITHUB_CLIENT_ID: "test-github-client",
			GITHUB_CLIENT_SECRET: "test-github-secret",
			OAUTH_UPSTREAM: upstream.url,
			SESSION_EXPIRES_IN: String(SESSION_EXPIRES_IN),
			RESEND_API_KEY: "re_test",
			RESEND_FROM: "Ditto <sign-in@test.example>",
			RESEND_BASE_URL: `${upstream.url}/resend`,
			CODE_EXPIRES_IN: String(CODE_EXPIRES_IN),
			CODE_RESEND_IN: String(CODE_RESEND_IN),
		},
	});
	const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));

	const stop = async () => {
		if (child.exitCode === null && child.pid) process.kill(-child.pid, "SIGTERM");
		await upstream.close();
	};

	try {
		await waitForApp(exited);
	} catch (error) {
		await stop();
		throw error;
	}

	project.provide("appUrl", APP_URL);
	project.provide("upstreamUrl", upstream.url);
	return stop;
}
