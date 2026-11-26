import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { open } from "../auth/visitor.ts";
import {
	chatgptCredential,
	chatgptRefreshes,
	chatgptRequests,
	endRefreshFault,
	startRefreshFault,
} from "./chatgpt.ts";
import { openCodeKey, openCodeRequests } from "./opencode.ts";
import { modelAccess, owner, post } from "./owner.ts";
import { workersAiRequests } from "./workers-ai.ts";

interface Deployment {
	mode: "self-deployed" | "hosted";
	license?: string;
	approval?: string;
}

/** Runs this account as if the stage were configured as `deployment`. */
async function deployAs(context: BrowserContext, deployment: Deployment) {
	const response = await context.request.put("/api/models/__test/deployment", {
		data: deployment,
	});
	expect(response.status()).toBe(204);
}

const importCredential = (context: BrowserContext, credential: unknown) =>
	context.request.post("/api/models/chatgpt", { data: { credential } });

async function connections(context: BrowserContext) {
	const response = await context.request.get("/api/models");
	expect(response.status()).toBe(200);
	return ((await response.json()) as { connections: unknown[] }).connections;
}

/** Waits for Settings' ChatGPT plan row to say the plan isn't offered, with nothing to press. */
async function expectNotOffered(page: Page) {
	await open(page, "/settings");
	const section = modelAccess(page);
	await section.getByText("Not offered on this deployment.").waitFor();
	await expect(section.getByRole("button", { name: /ChatGPT plan/ }).count()).resolves.toBe(0);
}

async function expectOffered(page: Page) {
	await open(page, "/settings");
	await modelAccess(page).getByRole("button", { name: "Connect ChatGPT plan" }).waitFor();
}

const LICENSE = "AGPL-3.0-only";

describe("a self-deployed Ditto", () => {
	it("doesn't offer the ChatGPT plan until its license is recorded, and refuses the import", async () => {
		const { page, context } = await owner();
		await deployAs(context, { mode: "self-deployed" });

		await expectNotOffered(page);
		const refused = await importCredential(context, await chatgptCredential());
		expect(refused.status()).toBe(403);
		await expect(connections(context)).resolves.toEqual([]);
	});

	it("offers the plan once the license is recorded", async () => {
		const { page, context, workspaceId, botId } = await owner();
		await deployAs(context, { mode: "self-deployed", license: LICENSE });

		await expectOffered(page);
		const credential = await chatgptCredential();
		expect((await importCredential(context, credential)).status()).toBe(204);
		expect((await post(context, workspaceId, botId, "Hello")).status).toBe(200);
		await expect(chatgptRequests(credential.access)).resolves.toHaveLength(1);
	});
});

describe("a hosted Ditto", () => {
	it("doesn't offer the plan on the license alone, even after a successful Responses call", async () => {
		const { page, context, workspaceId, botId } = await owner();
		// The plan works on this stage: a turn reaches the Responses API and succeeds.
		await deployAs(context, { mode: "self-deployed", license: LICENSE });
		const credential = await chatgptCredential();
		expect((await importCredential(context, credential)).status()).toBe(204);
		expect((await post(context, workspaceId, botId, "Hello")).status).toBe(200);
		await expect(chatgptRequests(credential.access)).resolves.toHaveLength(1);
		expect((await context.request.delete("/api/models/chatgpt")).status()).toBe(204);

		await deployAs(context, { mode: "hosted", license: LICENSE });
		await expectNotOffered(page);
		const refused = await importCredential(context, await chatgptCredential());
		expect(refused.status()).toBe(403);
		await expect(connections(context)).resolves.toEqual([]);
	});

	it("offers the plan once the license and OpenAI's approval are both recorded", async () => {
		const { page, context, workspaceId, botId } = await owner();
		await deployAs(context, { mode: "hosted", license: LICENSE, approval: "2026-11-26" });

		await expectOffered(page);
		const credential = await chatgptCredential();
		expect((await importCredential(context, credential)).status()).toBe(204);
		expect((await post(context, workspaceId, botId, "Hello")).status).toBe(200);
		await expect(chatgptRequests(credential.access)).resolves.toHaveLength(1);
	});
});

describe("a gate that closes", () => {
	it("refuses turns on an imported plan without sending a request", async () => {
		const { context, workspaceId, botId } = await owner();
		await deployAs(context, { mode: "self-deployed", license: LICENSE });
		const credential = await chatgptCredential();
		expect((await importCredential(context, credential)).status()).toBe(204);

		await deployAs(context, { mode: "hosted", license: LICENSE });
		const refused = await post(context, workspaceId, botId, "Hello");
		expect(refused.status).toBe(409);
		expect(JSON.parse(refused.body)).toEqual({ error: "Connect a model in Settings first" });
		await expect(chatgptRequests(credential.access)).resolves.toEqual([]);
	});

	it("shows an imported plan as not offered, and stops probing it", async () => {
		const { page, context, workspaceId, botId } = await owner();
		await deployAs(context, { mode: "self-deployed", license: LICENSE });
		const credential = await chatgptCredential({ expired: true });
		expect((await importCredential(context, credential)).status()).toBe(204);
		await startRefreshFault({ status: 503 });
		try {
			// The rotation meets an outage, so the plan is probed with backoff.
			expect((await post(context, workspaceId, botId, "Hello")).status).toBe(202);

			await deployAs(context, { mode: "hosted", license: LICENSE });
			await expectNotOffered(page);
			await expect(connections(context)).resolves.toEqual([]);
			const rotations = (await chatgptRefreshes(credential.refresh)).length;
			await new Promise((resolve) => setTimeout(resolve, 3000));
			await expect(chatgptRefreshes(credential.refresh)).resolves.toHaveLength(rotations);
		} finally {
			await endRefreshFault();
		}
	});
});

describe("other model access", () => {
	it("keeps an OpenCode key working with every gate closed", async () => {
		const { context, workspaceId, botId } = await owner();
		await deployAs(context, { mode: "hosted" });

		const key = await openCodeKey();
		const connected = await context.request.post("/api/models/opencode", {
			data: { key, model: "gpt-5.4-mini" },
		});
		expect(connected.status()).toBe(204);
		expect((await post(context, workspaceId, botId, "Hello")).status).toBe(200);
		// The connect check, then the turn.
		await expect(openCodeRequests(key)).resolves.toHaveLength(2);
	});

	it("keeps the included model running a turn with the ChatGPT gates closed, in both modes", async () => {
		for (const mode of ["self-deployed", "hosted"] as const) {
			const { context, accountId, workspaceId, botId } = await owner();
			await deployAs(context, { mode });
			const offered = await context.request.put("/api/models/__test/included", {
				data: { offered: true },
			});
			expect(offered.status()).toBe(204);
			const chosen = await context.request.put("/api/models/default", {
				data: { connectionId: "included", model: "DeepSeek V4.1 Flash" },
			});
			expect(chosen.status()).toBe(204);

			const sent = await post(context, workspaceId, botId, "What time is it?");
			expect(sent.status).toBe(200);
			expect(sent.body).toContain('"status":"completed"');
			// The tool call, then the answer with its result.
			await expect(workersAiRequests(accountId)).resolves.toHaveLength(2);
		}
	});
});
