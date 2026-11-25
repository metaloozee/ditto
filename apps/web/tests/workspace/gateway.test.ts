import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { COOKIE_ENCRYPTION_KEY, SESSION_EXPIRES_IN } from "../auth/setup.ts";
import { appUrl, continueWithGitHub, gitHubUser, newVisitor } from "../auth/visitor.ts";

interface WorkspaceAnswer {
	object: string;
	container: boolean;
	running: boolean;
	/** Requests the object has answered since it woke. */
	requests: number;
}

/** A visitor signed in with GitHub who has opened their personal workspace. */
async function owner(user = gitHubUser()) {
	const visitor = await newVisitor();
	await continueWithGitHub(visitor.page, user);
	const opened = await visitor.context.request.post("/api/workspaces/open");
	expect(opened.status()).toBe(200);
	const { workspaceId } = (await opened.json()) as { workspaceId: string };
	return { ...visitor, user, workspaceId };
}

const workspacePath = (workspaceId: string) => `/api/workspaces/${workspaceId}`;

/** An ordinary HTTP request to the workspace, with only the visitor's cookies. */
async function ask(context: BrowserContext, workspaceId: string) {
	const response = await context.request.get(workspacePath(workspaceId));
	return { status: response.status(), body: await response.text() };
}

/** What the owner's own object reports, asked through the gateway. */
async function reached(context: BrowserContext, workspaceId: string) {
	const { status, body } = await ask(context, workspaceId);
	expect(status).toBe(200);
	return JSON.parse(body) as WorkspaceAnswer;
}

/**
 * Sends a raw WebSocket upgrade with exactly these cookies and origin, and reports the
 * status the Worker answered: 101 when it was forwarded and accepted.
 */
async function upgrade(
	workspaceId: string,
	{ context, origin = appUrl }: { context?: BrowserContext; origin?: string },
) {
	const cookies = context ? await context.cookies(appUrl) : [];
	const headers: Record<string, string> = {
		connection: "Upgrade",
		upgrade: "websocket",
		"sec-websocket-version": "13",
		"sec-websocket-key": randomBytes(16).toString("base64"),
		origin,
	};
	if (cookies.length) headers.cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
	return new Promise<{ status: number; body: string }>((resolve, reject) => {
		const req = httpRequest(new URL(workspacePath(workspaceId), appUrl), { headers });
		req.on("upgrade", (_response, socket) => {
			socket.destroy();
			resolve({ status: 101, body: "" });
		});
		req.on("response", (response) => {
			let body = "";
			response.on("data", (chunk: Buffer) => (body += chunk.toString()));
			response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
		});
		req.on("error", reject);
		req.end();
	});
}

/** Opens a socket to the workspace from the signed-in page and round-trips one message. */
async function echoFromPage(page: Page, workspaceId: string, message: string) {
	const url = new URL(workspacePath(workspaceId), appUrl.replace(/^http/, "ws")).href;
	return page.evaluate(
		async ({ url, message }) => {
			const socket = new WebSocket(url);
			await new Promise((resolve, reject) => {
				socket.addEventListener("open", resolve, { once: true });
				socket.addEventListener("error", () => reject(new Error("upgrade refused")), {
					once: true,
				});
			});
			const echoed = new Promise<unknown>((resolve) =>
				socket.addEventListener("message", (event) => resolve(event.data), { once: true }),
			);
			socket.send(message);
			const answer = await echoed;
			socket.close();
			return answer;
		},
		{ url, message },
	);
}

const unknownWorkspaceId = () => `ws-${crypto.randomUUID()}`;

describe("the workspace gateway", () => {
	it("forwards an owner's request to their Container-backed Workspace without starting it", async () => {
		const { context, workspaceId } = await owner();

		await expect(reached(context, workspaceId)).resolves.toMatchObject({
			object: "Workspace",
			container: true,
			running: false,
		});
	});

	it("forwards an owner's WebSocket upgrade to their Workspace, which echoes a message", async () => {
		const { context, page, workspaceId } = await owner();

		await expect(echoFromPage(page, workspaceId, "hello, workspace")).resolves.toBe(
			"hello, workspace",
		);
		await expect(reached(context, workspaceId)).resolves.toMatchObject({ running: false });
	});

	it("reports to the owner that every named binding resolves, without revealing the cookie key", async () => {
		const alice = await owner();
		const bob = await owner();

		const answer = await alice.context.request.get(`${workspacePath(alice.workspaceId)}/bindings`);
		const body = await answer.text();
		expect(answer.status(), body).toBe(200);
		expect(JSON.parse(body)).toEqual({
			DB: "resolved",
			WORKSPACE: "resolved",
			BOT: "resolved",
			CREDENTIALS: "resolved",
			FILES: "resolved",
			COOKIE_ENCRYPTION_KEY: "resolved",
		});
		expect(body).not.toContain(COOKIE_ENCRYPTION_KEY);
		// Touching the Workspace object never starts its computer.
		await expect(reached(alice.context, alice.workspaceId)).resolves.toMatchObject({
			running: false,
		});

		const foreign = await bob.context.request.get(`${workspacePath(alice.workspaceId)}/bindings`);
		expect(foreign.status()).toBe(404);
	});

	it("refuses another account's workspace exactly as it refuses an unknown one, before forwarding", async () => {
		const alice = await owner();
		const bob = await owner();
		const before = await reached(alice.context, alice.workspaceId);

		const foreign = await ask(bob.context, alice.workspaceId);
		const unknown = await ask(bob.context, unknownWorkspaceId());
		const foreignUpgrade = await upgrade(alice.workspaceId, { context: bob.context });
		const unknownUpgrade = await upgrade(unknownWorkspaceId(), { context: bob.context });

		expect(foreign.status).toBe(404);
		expect(foreign).toEqual(unknown);
		expect(foreignUpgrade.status).toBe(404);
		expect(foreignUpgrade).toEqual(unknownUpgrade);
		await expect(reached(alice.context, alice.workspaceId)).resolves.toMatchObject({
			requests: before.requests + 1,
		});
	});

	it("refuses a request or upgrade without a session, before forwarding", async () => {
		const alice = await owner();
		const before = await reached(alice.context, alice.workspaceId);
		const { context: signedOut } = await newVisitor();

		await expect(ask(signedOut, alice.workspaceId)).resolves.toMatchObject({ status: 401 });
		await expect(upgrade(alice.workspaceId, {})).resolves.toMatchObject({ status: 401 });
		await expect(reached(alice.context, alice.workspaceId)).resolves.toMatchObject({
			requests: before.requests + 1,
		});
	});

	it("refuses a request or upgrade with an expired session, before forwarding", async () => {
		const alice = await owner();
		const before = await reached(alice.context, alice.workspaceId);

		await sleep((SESSION_EXPIRES_IN + 1) * 1000);

		await expect(ask(alice.context, alice.workspaceId)).resolves.toMatchObject({ status: 401 });
		await expect(upgrade(alice.workspaceId, { context: alice.context })).resolves.toMatchObject({
			status: 401,
		});
		const again = await owner(alice.user);
		expect(again.workspaceId).toBe(alice.workspaceId);
		await expect(reached(again.context, alice.workspaceId)).resolves.toMatchObject({
			requests: before.requests + 1,
		});
	}, 60_000);

	it("refuses the owner's upgrade from another origin, before forwarding", async () => {
		const alice = await owner();
		const before = await reached(alice.context, alice.workspaceId);

		const crossOrigin = await upgrade(alice.workspaceId, {
			context: alice.context,
			origin: "https://evil.example",
		});
		const sameOrigin = await upgrade(alice.workspaceId, { context: alice.context });

		expect(crossOrigin.status).toBe(403);
		expect(sameOrigin.status).toBe(101);
		await expect(reached(alice.context, alice.workspaceId)).resolves.toMatchObject({
			requests: before.requests + 2,
		});
	});
});
