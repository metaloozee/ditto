import type { Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { appUrl, continueWithGitHub, gitHubUser, newVisitor, open } from "../auth/visitor.ts";

/** What the owner sees of their workspace: Ditto's name, its greeting and the computer's state. */
async function seenWorkspace(page: Page) {
	await page.getByText("Hi, I’m Ditto, your Chief of Staff.").waitFor();
	const name = page.getByRole("button", { name: "Ditto", exact: true });
	await name.click();
	const panel = page.getByRole("complementary", { name: "Computer" });
	await panel.waitFor();
	return {
		path: new URL(page.url()).pathname,
		chiefOfStaff: await name.textContent(),
		panelExpanded: await name.getAttribute("aria-expanded"),
		computer: (await panel.getByText(/^(Stopped|Running)$/).textContent())?.trim(),
	};
}

describe("the signed-in home", () => {
	it("shows a first-time owner their workspace with Ditto and a stopped computer", async () => {
		const { page } = await newVisitor();
		await continueWithGitHub(page, gitHubUser());

		await expect(seenWorkspace(page)).resolves.toEqual({
			path: "/",
			chiefOfStaff: "Ditto",
			panelExpanded: "true",
			computer: "Stopped",
		});
		const probed = await page.context().request.post("/api/workspace/open");
		const { workspaceId } = (await probed.json()) as { workspaceId: string };
		const state = await page.context().request.get(`/api/workspaces/${workspaceId}`);
		await expect(state.json()).resolves.toMatchObject({ running: false });
	});

	it("shows a returning owner the same workspace after a reload and on a second device", async () => {
		const user = gitHubUser();
		const first = await newVisitor();
		await continueWithGitHub(first.page, user);
		await seenWorkspace(first.page);
		const firstOpen = await (await first.context.request.post("/api/workspace/open")).json();
		const returned = {
			path: "/",
			chiefOfStaff: "Ditto",
			panelExpanded: "true",
			computer: "Stopped",
		};

		await open(first.page, "/");
		await expect(seenWorkspace(first.page)).resolves.toEqual(returned);

		const second = await newVisitor();
		await continueWithGitHub(second.page, user);

		await expect(seenWorkspace(second.page)).resolves.toEqual(returned);
		await expect(
			(await second.context.request.post("/api/workspace/open")).json(),
		).resolves.toEqual(firstOpen);
	});

	it("keeps the computer panel open across a reload", async () => {
		const { page } = await newVisitor();
		await continueWithGitHub(page, gitHubUser());
		await seenWorkspace(page);

		await open(page, "/?panel=computer");

		await expect(
			page.getByRole("button", { name: "Ditto", exact: true }).getAttribute("aria-expanded"),
		).resolves.toBe("true");
	});

	it("sends a visitor without a session to sign in", async () => {
		const { page } = await newVisitor();

		await open(page, "/");

		expect(new URL(page.url()).pathname).toBe("/sign-in");
	});

	it("shows a failed open with a retry that recovers it", async () => {
		const { context, page } = await newVisitor();
		await continueWithGitHub(page, gitHubUser());
		await context.addCookies([{ name: "test-fail-open", value: "1", url: appUrl }]);

		await open(page, "/");
		const failure = page.getByRole("alert").filter({ hasText: "We couldn’t open your workspace" });
		await failure.waitFor();

		await context.clearCookies({ name: "test-fail-open" });
		await page.getByRole("button", { name: "Try again" }).click();

		await expect(seenWorkspace(page)).resolves.toMatchObject({ computer: "Stopped" });
	});
});
