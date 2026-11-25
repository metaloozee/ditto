import { setTimeout as sleep } from "node:timers/promises";

import type { BrowserContext } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { SESSION_EXPIRES_IN } from "../auth/setup.ts";
import { continueWithGitHub, gitHubUser, newVisitor } from "../auth/visitor.ts";

/** A visitor signed in with GitHub who has opened their personal workspace. */
async function owner() {
	const visitor = await newVisitor();
	await continueWithGitHub(visitor.page, gitHubUser());
	const opened = await visitor.context.request.post("/api/workspace/open");
	expect(opened.status()).toBe(200);
	const { workspaceId } = (await opened.json()) as { workspaceId: string };
	return { ...visitor, workspaceId };
}

/** Test stage only: writes an object into the owner's own workspace, as #20 and #21 will. */
async function seed(
	context: BrowserContext,
	workspaceId: string,
	path: string,
	body: string,
	contentType = "text/plain",
) {
	const response = await context.request.put(
		`/api/workspaces/${workspaceId}/__test/files/${path}`,
		{
			data: body,
			headers: { "content-type": contentType },
		},
	);
	expect(response.status()).toBe(204);
}

/** Requests a file with only the visitor's cookies. `path` is sent exactly as written. */
async function read(context: BrowserContext, workspaceId: string, path: string) {
	const response = await context.request.get(`/api/workspace/${workspaceId}/files/${path}`);
	return {
		status: response.status(),
		contentType: response.headers()["content-type"],
		body: await response.text(),
	};
}

describe("a workspace's private files", () => {
	it("serves a seeded published file to its owner", async () => {
		const { context, workspaceId } = await owner();
		await seed(
			context,
			workspaceId,
			"published/report/summary.md",
			"# Q3 summary",
			"text/markdown",
		);

		await expect(read(context, workspaceId, "published/report/summary.md")).resolves.toEqual({
			status: 200,
			contentType: "text/markdown",
			body: "# Q3 summary",
		});
	});

	it("refuses another account's file exactly as it refuses a missing one", async () => {
		const alice = await owner();
		const bob = await owner();
		await seed(alice.context, alice.workspaceId, "screenshots/step-1.png", "pixels", "image/png");

		const foreign = await read(bob.context, alice.workspaceId, "screenshots/step-1.png");
		const missingThere = await read(bob.context, alice.workspaceId, "screenshots/step-2.png");
		const missingOwn = await read(bob.context, bob.workspaceId, "screenshots/step-1.png");

		expect(foreign.status).toBe(404);
		expect(foreign).toEqual(missingThere);
		expect(foreign).toEqual(missingOwn);
		await expect(
			read(alice.context, alice.workspaceId, "screenshots/step-1.png"),
		).resolves.toMatchObject({
			status: 200,
			body: "pixels",
		});
	});

	it("refuses a file without a session or with an expired one", async () => {
		const alice = await owner();
		await seed(alice.context, alice.workspaceId, "home/backup-1.tar", "home");
		const { context: signedOut } = await newVisitor();

		await expect(read(signedOut, alice.workspaceId, "home/backup-1.tar")).resolves.toMatchObject({
			status: 401,
		});
		await sleep((SESSION_EXPIRES_IN + 1) * 1000);
		await expect(
			read(alice.context, alice.workspaceId, "home/backup-1.tar"),
		).resolves.toMatchObject({
			status: 401,
		});
	}, 60_000);

	it("refuses a path that escapes the owner's workspace prefix, by traversal or by naming another workspace", async () => {
		const alice = await owner();
		const bob = await owner();
		await seed(alice.context, alice.workspaceId, "published/secret.txt", "alice only");
		await seed(bob.context, bob.workspaceId, "published/secret.txt", "bob's own");
		const missing = await read(bob.context, bob.workspaceId, "published/nothing.txt");
		const escapes = [
			`published/..%2F..%2F${alice.workspaceId}%2Fpublished%2Fsecret.txt`,
			`published/%2e%2e/%2e%2e/${alice.workspaceId}/published/secret.txt`,
			`published/../../../${alice.workspaceId}/files/published/secret.txt`,
			`${alice.workspaceId}/published/secret.txt`,
			`published%2Fsecret.txt`,
			`published/.%2Fsecret.txt`,
			`published/sub%5C..%5C..%5Csecret.txt`,
		];

		for (const path of escapes) {
			const answer = await read(bob.context, bob.workspaceId, path);
			expect(answer.status, path).toBe(404);
			expect(answer.body, path).not.toMatch(/alice only|bob's own/);
		}
		await expect(read(bob.context, bob.workspaceId, escapes[0]!)).resolves.toEqual(missing);
		await expect(read(bob.context, bob.workspaceId, escapes[3]!)).resolves.toEqual(missing);
	});
});
