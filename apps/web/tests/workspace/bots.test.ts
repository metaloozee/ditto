import type { BrowserContext } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { continueWithGitHub, gitHubUser, newVisitor } from "../auth/visitor.ts";

interface Bot {
	id: string;
	name: string;
}

interface OpenedWorkspace {
	workspaceId: string;
	chiefOfStaff: Bot;
}

/** Signs a new account in. Landing on the home opens its workspace once already. */
async function signedIn() {
	const visitor = await newVisitor();
	await continueWithGitHub(visitor.page, gitHubUser());
	return visitor.context;
}

async function openWorkspace(
	context: BrowserContext,
	headers?: Record<string, string>,
): Promise<OpenedWorkspace> {
	const response = await context.request.post("/api/workspace/open", { headers });
	expect(response.status()).toBe(200);
	return (await response.json()) as OpenedWorkspace;
}

/** The workspace's bot list as its owner reads it, from the D1 projection. */
async function botList(context: BrowserContext, workspaceId: string): Promise<Bot[]> {
	const response = await context.request.get(`/api/workspace/${workspaceId}/bots`);
	expect(response.status()).toBe(200);
	return ((await response.json()) as { bots: Bot[] }).bots;
}

async function reconcile(context: BrowserContext, workspaceId: string): Promise<void> {
	const response = await context.request.post(`/api/workspace/${workspaceId}/reconcile`);
	expect(response.status()).toBe(204);
}

/** Test stage only: the Workspace object fails its bot-list update during this open. */
const failProjection = { "x-test-fault": "projection" };

/** The Workspace object's membership, the authority, read through the owner's test hook. */
async function members(context: BrowserContext, workspaceId: string): Promise<Bot[]> {
	const response = await context.request.get(`/api/workspaces/${workspaceId}/__test/members`);
	expect(response.status()).toBe(200);
	return (await response.json()) as Bot[];
}

/** Test stage only: writes the D1 bot list behind the Workspace object's back. */
async function damageBotList(
	context: BrowserContext,
	workspaceId: string,
	init: { method: "DELETE" } | { add: Bot },
) {
	const path = `/api/workspaces/${workspaceId}/__test/bot-list`;
	const response =
		"add" in init
			? await context.request.post(path, { data: init.add })
			: await context.request.delete(path);
	expect(response.status()).toBe(204);
}

const stray = { id: "bot-stray", name: "Stray" };

describe("the workspace bot list", () => {
	it("holds exactly the Chief of Staff after a first open", async () => {
		const context = await signedIn();

		const opened = await openWorkspace(context);

		await expect(botList(context, opened.workspaceId)).resolves.toEqual([opened.chiefOfStaff]);
	});

	it("lets an open succeed when the bot-list update fails, and the next open repairs it", async () => {
		const context = await signedIn();
		const { workspaceId } = await openWorkspace(context);
		await damageBotList(context, workspaceId, { method: "DELETE" });

		const opened = await openWorkspace(context, failProjection);

		expect(opened.chiefOfStaff).toEqual({ id: expect.any(String), name: "Ditto" });
		await expect(members(context, workspaceId)).resolves.toEqual([opened.chiefOfStaff]);
		await expect(botList(context, workspaceId)).resolves.toEqual([]);
		await expect(openWorkspace(context)).resolves.toEqual(opened);
		await expect(botList(context, workspaceId)).resolves.toEqual([opened.chiefOfStaff]);
	});

	it("repairs a failed bot-list update on an explicit reconcile, and a replay changes nothing", async () => {
		const context = await signedIn();
		const { workspaceId } = await openWorkspace(context);
		await damageBotList(context, workspaceId, { method: "DELETE" });
		const opened = await openWorkspace(context, failProjection);

		await reconcile(context, workspaceId);
		await reconcile(context, workspaceId);

		await expect(botList(context, workspaceId)).resolves.toEqual([opened.chiefOfStaff]);
	});

	it("removes a bot-list row with no matching member, and never takes it as a member", async () => {
		const context = await signedIn();
		const opened = await openWorkspace(context);
		await damageBotList(context, opened.workspaceId, { add: stray });
		await expect(botList(context, opened.workspaceId)).resolves.toContainEqual(stray);

		await reconcile(context, opened.workspaceId);

		await expect(botList(context, opened.workspaceId)).resolves.toEqual([opened.chiefOfStaff]);
		await expect(members(context, opened.workspaceId)).resolves.toEqual([opened.chiefOfStaff]);
	});

	it("keeps membership and the bot list in agreement across an eviction", async () => {
		const context = await signedIn();
		const opened = await openWorkspace(context);
		await damageBotList(context, opened.workspaceId, { add: stray });

		const evicted = await context.request.post(
			`/api/workspaces/${opened.workspaceId}/__test/evict`,
		);
		expect(evicted.status()).toBe(204);
		await expect(openWorkspace(context)).resolves.toEqual(opened);

		await expect(members(context, opened.workspaceId)).resolves.toEqual([opened.chiefOfStaff]);
		await expect(botList(context, opened.workspaceId)).resolves.toEqual([opened.chiefOfStaff]);
	});

	it("is readable and repairable only by the workspace's owner", async () => {
		const owner = await signedIn();
		const other = await signedIn();
		const { workspaceId } = await openWorkspace(owner);
		const { context: signedOut } = await newVisitor();

		const foreignRead = await other.request.get(`/api/workspace/${workspaceId}/bots`);
		const foreignReconcile = await other.request.post(`/api/workspace/${workspaceId}/reconcile`);
		const guessed = await other.request.get("/api/workspace/ws-guessed/bots");
		const anonymous = await signedOut.request.get(`/api/workspace/${workspaceId}/bots`);
		const foreignMembers = await other.request.get(`/api/workspaces/${workspaceId}/__test/members`);
		const foreignDamage = await other.request.delete(
			`/api/workspaces/${workspaceId}/__test/bot-list`,
		);

		expect(foreignRead.status()).toBe(404);
		expect(foreignReconcile.status()).toBe(404);
		expect(guessed.status()).toBe(404);
		expect(anonymous.status()).toBe(401);
		expect(foreignMembers.status()).toBe(404);
		expect(foreignDamage.status()).toBe(404);
		await expect(botList(owner, workspaceId)).resolves.toHaveLength(1);
	});
});
