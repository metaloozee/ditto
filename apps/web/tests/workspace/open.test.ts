import type { BrowserContext } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { continueWithGoogle, googleUser, nextGoogleAuthorization } from "../auth/google.ts";
import { continueWithGitHub, gitHubUser, newVisitor, open } from "../auth/visitor.ts";

interface OpenedWorkspace {
	workspaceId: string;
	chiefOfStaff: { id: string; name: string };
	computer: "stopped" | "running";
}

/** Opens the visitor's personal workspace with nothing but its session cookies. */
async function openWorkspace(context: BrowserContext): Promise<OpenedWorkspace> {
	const response = await context.request.post("/api/workspace/open");
	expect(response.status()).toBe(200);
	return (await response.json()) as OpenedWorkspace;
}

async function signedInWithGitHub(user = gitHubUser()) {
	const visitor = await newVisitor();
	await continueWithGitHub(visitor.page, user);
	return visitor;
}

describe("opening the personal workspace", () => {
	it("is refused without a live session", async () => {
		const { context } = await newVisitor();

		const response = await context.request.post("/api/workspace/open");

		expect(response.status()).toBe(401);
	});

	it("provisions one workspace and its Chief of Staff on first open, with the computer stopped", async () => {
		const { context } = await signedInWithGitHub();
		const account = (await (await context.request.get("/api/auth/get-session")).json()) as {
			user: { id: string };
		};

		const opened = await openWorkspace(context);

		expect(opened.workspaceId).toMatch(/^[a-z0-9-]+$/);
		expect(opened.workspaceId).not.toBe(account.user.id);
		expect(opened.chiefOfStaff).toEqual({ id: expect.any(String), name: "Ditto" });
		expect(opened.computer).toBe("stopped");
		await expect(openWorkspace(context)).resolves.toEqual(opened);
		const probed = await context.request.get(`/api/workspaces/${opened.workspaceId}`);
		await expect(probed.json()).resolves.toMatchObject({ container: true, running: false });
	});

	it("resolves two racing first opens from two devices to one workspace and Chief of Staff", async () => {
		const user = gitHubUser();
		const laptop = await signedInWithGitHub(user);
		const phone = await signedInWithGitHub(user);

		const [fromLaptop, fromPhone] = await Promise.all([
			openWorkspace(laptop.context),
			openWorkspace(phone.context),
		]);

		expect(fromPhone).toEqual(fromLaptop);
	});

	it("reopens the same workspace through another enabled sign-in method", async () => {
		const github = gitHubUser();
		const google = googleUser({ email: github.email ?? undefined });
		const { context, page } = await signedInWithGitHub(github);
		const opened = await openWorkspace(context);
		await open(page, "/settings");
		await nextGoogleAuthorization(google);
		await page.getByRole("button", { name: "Link Google" }).click();
		await page.getByText("Google is linked", { exact: true }).waitFor({ timeout: 10_000 });

		const viaGoogle = await newVisitor();
		await continueWithGoogle(viaGoogle.page, google);

		await expect(openWorkspace(viaGoogle.context)).resolves.toEqual(opened);
	});

	it("reopens the same workspace and Chief of Staff after the Workspace object is evicted", async () => {
		const { context } = await signedInWithGitHub();
		const opened = await openWorkspace(context);

		const evicted = await context.request.post(
			`/api/workspaces/${opened.workspaceId}/__test/evict`,
		);
		expect(evicted.status()).toBe(204);

		await expect(openWorkspace(context)).resolves.toEqual(opened);
	});

	it("completes an open interrupted between the D1 mapping and the Chief of Staff, without a duplicate", async () => {
		const user = gitHubUser();
		const { context } = await signedInWithGitHub(user);
		const interrupted = await context.request.post("/api/workspace/open", {
			headers: { "x-test-interrupt": "after-mapping" },
		});
		expect(interrupted.status()).toBe(503);
		const { interrupted: mapped } = (await interrupted.json()) as { interrupted: string };

		const completed = await openWorkspace(context);
		const fromAnotherDevice = await openWorkspace((await signedInWithGitHub(user)).context);

		expect(completed.workspaceId).toBe(mapped);
		expect(fromAnotherDevice).toEqual(completed);
	});
});
