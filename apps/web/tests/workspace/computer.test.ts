// The shared computer runs the feasibility image under local Docker, which withholds NET_ADMIN,
// so the fence never applies here. The filter still decides every request Chrome makes, and
// that is what these tests read. Proving the fence is left to the deployed stage (#47).
import { setTimeout as sleep } from "node:timers/promises";

import type { BrowserContext } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { COMPUTER_IDLE_SECONDS, COMPUTER_LIFETIME_SECONDS } from "../auth/setup.ts";
import { continueWithGitHub, gitHubUser, newVisitor } from "../auth/visitor.ts";

interface ComputerStatus {
	computer: "stopped" | "running";
	policy?: { workspaceId: string; hosts: string[] } | null;
	deadline?: string | null;
}

interface Decision {
	workspace: string;
	host: string;
	decision: "allow" | "deny";
}

/** A visitor signed in with GitHub who has opened their personal workspace. */
async function owner() {
	const visitor = await newVisitor();
	await continueWithGitHub(visitor.page, gitHubUser());
	const opened = await visitor.context.request.post("/api/workspaces/open");
	expect(opened.status()).toBe(200);
	const body = (await opened.json()) as {
		workspaceId: string;
		chiefOfStaff: unknown;
		computer: string;
	};
	return { ...visitor, ...body };
}

const at = (workspaceId: string, path: string) => `/api/workspaces/${workspaceId}${path}`;

async function start(
	context: BrowserContext,
	workspaceId: string,
	headers: Record<string, string> = {},
) {
	const response = await context.request.post(at(workspaceId, "/computer/start"), {
		headers,
		timeout: 180_000,
	});
	expect(response.status(), await response.text()).toBe(200);
	return (await response.json()) as ComputerStatus & { reused: boolean };
}

async function stop(context: BrowserContext, workspaceId: string) {
	const response = await context.request.post(at(workspaceId, "/computer/stop"));
	expect(response.status()).toBe(200);
	return (await response.json()) as ComputerStatus;
}

async function status(context: BrowserContext, workspaceId: string) {
	const response = await context.request.get(at(workspaceId, "/computer"));
	expect(response.status()).toBe(200);
	return (await response.json()) as ComputerStatus;
}

async function replaceHosts(context: BrowserContext, workspaceId: string, hosts: string[]) {
	const response = await context.request.put(at(workspaceId, "/hosts"), { data: { hosts } });
	expect(response.status(), await response.text()).toBe(200);
	return ((await response.json()) as { hosts: string[] }).hosts;
}

/** Asks the owner's running computer to load `https://<host>/` through its filter. */
async function reach(context: BrowserContext, workspaceId: string, host: unknown) {
	const response = await context.request.post(at(workspaceId, "/computer/reach"), {
		data: { host },
		timeout: 60_000,
	});
	return { status: response.status(), body: (await response.json()) as unknown };
}

/** Test stage only: a request to the running instance's control port, which counts as use. */
function control(context: BrowserContext, workspaceId: string, path: string, method = "GET") {
	return context.request.fetch(at(workspaceId, `/__test/computer/control${path}`), { method });
}

/** Opens `url` on another screen of the instance and returns the filter's decision for its host. */
async function visit(context: BrowserContext, workspaceId: string, url: string) {
	const host = new URL(url).hostname;
	const opened = await control(
		context,
		workspaceId,
		`/screens?url=${encodeURIComponent(url)}`,
		"POST",
	);
	expect(opened.status()).toBe(200);
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		const decisions = (await (await control(context, workspaceId, "/decisions")).text())
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Decision);
		const decided = decisions.find((decision) => decision.host === host);
		if (decided) return decided;
		await sleep(500);
	}
	throw new Error(`The filter never decided ${host}`);
}

/** Polls the status, which never touches the instance, until it reports stopped. */
async function stoppedWithin(context: BrowserContext, workspaceId: string, seconds: number) {
	const deadline = Date.now() + seconds * 1000;
	while (Date.now() < deadline) {
		if ((await status(context, workspaceId)).computer === "stopped") return Date.now();
		await sleep(1000);
	}
	throw new Error(`Still running after ${seconds} s`);
}

describe("the shared computer", () => {
	it("stays stopped on open, runs on an explicit start, and reuses the instance on a second start", async () => {
		const { context, workspaceId, computer } = await owner();
		expect(computer).toBe("stopped");
		await expect(status(context, workspaceId)).resolves.toMatchObject({ computer: "stopped" });

		try {
			await expect(start(context, workspaceId)).resolves.toMatchObject({
				computer: "running",
				reused: false,
			});
			await expect(status(context, workspaceId)).resolves.toMatchObject({ computer: "running" });
			await expect(start(context, workspaceId)).resolves.toMatchObject({
				computer: "running",
				reused: true,
			});
		} finally {
			await stop(context, workspaceId);
		}
	}, 240_000);

	it("starts under the server-resolved workspace ID with an empty list, so every host is denied", async () => {
		const { context, workspaceId } = await owner();
		await expect(
			context.request.get(at(workspaceId, "/hosts")).then((r) => r.json()),
		).resolves.toEqual({ hosts: [] });

		try {
			const started = await start(context, workspaceId, {
				"x-ditto-workspace-id": "ws-forged-by-the-client",
			});
			expect(started.policy).toEqual({ workspaceId, hosts: [] });

			const isolation = (await (await control(context, workspaceId, "/isolation")).json()) as {
				workspace: string;
			};
			expect(isolation.workspace).toBe(workspaceId);
			await expect(visit(context, workspaceId, "https://example.com/")).resolves.toMatchObject({
				workspace: workspaceId,
				decision: "deny",
			});
		} finally {
			await stop(context, workspaceId);
		}
	}, 240_000);

	it("enforces a replaced list from the next start without a rebuild, and keeps its state across a stop", async () => {
		const { context, workspaceId, chiefOfStaff } = await owner();
		await expect(
			replaceHosts(context, workspaceId, ["Example.com", "example.com"]),
		).resolves.toEqual(["example.com"]);
		const refused = await context.request.put(at(workspaceId, "/hosts"), {
			data: { hosts: ["*.example.com"] },
		});
		expect(refused.status()).toBe(400);

		try {
			const started = await start(context, workspaceId);
			expect(started.policy).toEqual({ workspaceId, hosts: ["example.com"] });
			// The image reports this workspace and its list, but local Docker leaves it unfenced.
			expect(started).toMatchObject({
				isolation: { policy: true, fence: false },
				privateSessions: { available: false, reason: "fence-absent" },
			});
			await expect(visit(context, workspaceId, "https://example.com/")).resolves.toMatchObject({
				decision: "allow",
			});
			await expect(visit(context, workspaceId, "https://example.org/")).resolves.toMatchObject({
				decision: "deny",
			});
		} finally {
			await expect(stop(context, workspaceId)).resolves.toMatchObject({ computer: "stopped" });
		}

		await expect(status(context, workspaceId)).resolves.toMatchObject({ computer: "stopped" });
		expect((await control(context, workspaceId, "/isolation")).status()).toBe(409);
		await expect(
			context.request.get(at(workspaceId, "/hosts")).then((r) => r.json()),
		).resolves.toEqual({ hosts: ["example.com"] });
		const reopened = await context.request.post("/api/workspaces/open");
		await expect(reopened.json()).resolves.toMatchObject({ chiefOfStaff, computer: "stopped" });
	}, 240_000);

	it("reaches a host for its owner and reports the filter's decision, leaving the list alone", async () => {
		const { context, workspaceId } = await owner();
		await replaceHosts(context, workspaceId, ["example.com"]);
		try {
			await start(context, workspaceId);

			await expect(reach(context, workspaceId, "example.com")).resolves.toMatchObject({
				status: 200,
				body: { host: "example.com", decision: "allow", status: 200 },
			});
			await expect(reach(context, workspaceId, "example.org")).resolves.toMatchObject({
				status: 200,
				body: { host: "example.org", decision: "deny" },
			});
			await expect(
				context.request.get(at(workspaceId, "/hosts")).then((r) => r.json()),
			).resolves.toEqual({ hosts: ["example.com"] });
		} finally {
			await stop(context, workspaceId);
		}
	}, 240_000);

	it("refuses to reach a host that isn't exact, or while the computer is stopped", async () => {
		const { context, workspaceId } = await owner();
		for (const host of ["*.example.com", "https://example.com/", "example.com/x", 42, undefined]) {
			const refused = await reach(context, workspaceId, host);
			expect(refused.status, JSON.stringify(host)).toBe(400);
		}

		await expect(reach(context, workspaceId, "example.com")).resolves.toMatchObject({
			status: 409,
		});
		await expect(status(context, workspaceId)).resolves.toMatchObject({ computer: "stopped" });
	});

	it("stops after the idle timeout when nothing uses it", async () => {
		const { context, workspaceId } = await owner();
		try {
			await start(context, workspaceId);
			const idleSince = Date.now();

			const stoppedAt = await stoppedWithin(context, workspaceId, COMPUTER_IDLE_SECONDS + 30);

			expect(stoppedAt - idleSince).toBeGreaterThanOrEqual((COMPUTER_IDLE_SECONDS - 2) * 1000);
		} finally {
			await stop(context, workspaceId);
		}
	}, 240_000);

	it("is destroyed at the lifetime deadline scheduled at start, however busy it is", async () => {
		const { context, workspaceId } = await owner();
		try {
			const before = Date.now();
			const started = await start(context, workspaceId);
			const deadline = Date.parse(started.deadline ?? "");
			expect(deadline - before).toBeGreaterThanOrEqual((COMPUTER_LIFETIME_SECONDS - 2) * 1000);
			expect(deadline - Date.now()).toBeLessThanOrEqual(COMPUTER_LIFETIME_SECONDS * 1000);

			// Use it more often than the idle timeout, and the short test session, so only the deadline
			// can stop it.
			while (Date.now() < deadline - 2000) {
				expect((await control(context, workspaceId, "/memory")).status()).toBe(200);
				await sleep(2000);
			}
			const stoppedAt = await stoppedWithin(context, workspaceId, 30);

			expect(stoppedAt).toBeGreaterThanOrEqual(deadline - 1000);
		} finally {
			await stop(context, workspaceId);
		}
	}, 300_000);

	it("refuses another account's start, stop, list change and reach at the gateway", async () => {
		const alice = await owner();
		const bob = await owner();
		const probe = async () =>
			(
				(await (await alice.context.request.get(at(alice.workspaceId, "/"))).json()) as {
					requests: number;
				}
			).requests;
		const before = await probe();

		const attempts = [
			bob.context.request.post(at(alice.workspaceId, "/computer/start")),
			bob.context.request.post(at(alice.workspaceId, "/computer/stop")),
			bob.context.request.put(at(alice.workspaceId, "/hosts"), {
				data: { hosts: ["example.com"] },
			}),
			bob.context.request.post(at(alice.workspaceId, "/computer/reach"), {
				data: { host: "example.com" },
			}),
		];
		for (const attempt of await Promise.all(attempts)) expect(attempt.status()).toBe(404);

		await expect(probe()).resolves.toBe(before + 1);
		await expect(status(alice.context, alice.workspaceId)).resolves.toMatchObject({
			computer: "stopped",
		});
		await expect(
			alice.context.request.get(at(alice.workspaceId, "/hosts")).then((r) => r.json()),
		).resolves.toEqual({ hosts: [] });
	});
});
