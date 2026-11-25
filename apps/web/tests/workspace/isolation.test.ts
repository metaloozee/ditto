// Local Docker withholds NET_ADMIN, so the real fence never passes here. These tests replace the
// instance with a synthetic one through the Workspace object's Instance seam (test stage only),
// and choose what its control port reports for isolation.
import type { BrowserContext } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import type { IsolationReport } from "../../src/workspace-rpc.ts";
import { continueWithGitHub, gitHubUser, newVisitor } from "../auth/visitor.ts";

interface PrivateSessions {
	available: boolean;
	reason?: string;
	detail?: string;
}

interface ComputerStatus {
	computer: "stopped" | "running";
	isolation?: { policy: boolean; fence: boolean } | null;
	privateSessions: PrivateSessions;
}

async function owner() {
	const visitor = await newVisitor();
	await continueWithGitHub(visitor.page, gitHubUser());
	const opened = await visitor.context.request.post("/api/workspaces/open");
	expect(opened.status()).toBe(200);
	const { workspaceId } = (await opened.json()) as { workspaceId: string };
	return { ...visitor, workspaceId };
}

const at = (workspaceId: string, path: string) => `/api/workspaces/${workspaceId}${path}`;

/** The report the image writes once its fence applied, for `workspace` and `hosts`. */
function fenced(workspace: string, hosts: string[] = []): IsolationReport {
	return {
		status: 200,
		body: JSON.stringify({ workspace, isolation: "filter-user-only", hosts }),
	};
}

/** `unreachable`: how many asks for the report fail as a dropped connection would, first. */
async function synthetic(
	context: BrowserContext,
	workspaceId: string,
	isolation: IsolationReport,
	unreachable = 0,
) {
	const response = await context.request.put(at(workspaceId, "/__test/computer/synthetic"), {
		data: { isolation, unreachable },
	});
	expect(response.status(), await response.text()).toBe(204);
}

async function start(context: BrowserContext, workspaceId: string) {
	const response = await context.request.post(at(workspaceId, "/computer/start"));
	expect(response.status(), await response.text()).toBe(200);
	return (await response.json()) as ComputerStatus;
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

describe("private sessions on the shared computer", () => {
	it("are available once the instance reports this workspace's policy behind the fence", async () => {
		const { context, workspaceId } = await owner();
		await synthetic(context, workspaceId, fenced(workspaceId));
		try {
			const started = await start(context, workspaceId);
			expect(started).toMatchObject({
				computer: "running",
				isolation: { policy: true, fence: true },
				privateSessions: { available: true },
			});
			await expect(status(context, workspaceId)).resolves.toMatchObject({
				privateSessions: { available: true },
			});
		} finally {
			await stop(context, workspaceId);
		}
	});

	it("are available when the report arrives after a brief outage of the control port", async () => {
		const { context, workspaceId } = await owner();
		await synthetic(context, workspaceId, fenced(workspaceId), 2);
		try {
			await expect(start(context, workspaceId)).resolves.toMatchObject({
				isolation: { policy: true, fence: true },
				privateSessions: { available: true },
			});
		} finally {
			await stop(context, workspaceId);
		}
	});

	it("stay unavailable as report-missing when the control port never answers", async () => {
		const { context, workspaceId } = await owner();
		await synthetic(context, workspaceId, fenced(workspaceId), 100);
		try {
			await expect(start(context, workspaceId)).resolves.toMatchObject({
				computer: "running",
				privateSessions: { available: false, reason: "report-missing" },
			});
		} finally {
			await stop(context, workspaceId);
		}
	});

	const failing: [string, (workspaceId: string) => IsolationReport, string][] = [
		[
			"the fence is reported absent",
			(id) => ({
				status: 200,
				body: JSON.stringify({ workspace: id, isolation: "none", hosts: [] }),
			}),
			"fence-absent",
		],
		["the report is missing", () => null, "report-missing"],
		["the report is not JSON", () => ({ status: 200, body: "{not json" }), "report-unreadable"],
		[
			"the report lacks its hosts",
			(id) => ({
				status: 200,
				body: JSON.stringify({ workspace: id, isolation: "filter-user-only" }),
			}),
			"report-unreadable",
		],
		["the control port fails", () => ({ status: 500, body: "" }), "report-unreadable"],
		["the instance runs as another workspace", () => fenced("ws-someone-else"), "policy-mismatch"],
		["the instance enforces another list", (id) => fenced(id, ["example.com"]), "policy-mismatch"],
	];

	for (const [when, report, reason] of failing) {
		it(`stay unavailable, and the status says why, when ${when}`, async () => {
			const { context, workspaceId } = await owner();
			await synthetic(context, workspaceId, report(workspaceId));
			try {
				const started = await start(context, workspaceId);
				expect(started.computer).toBe("running");
				expect(started.isolation).toMatchObject(
					reason === "fence-absent" ? { policy: true, fence: false } : { policy: false },
				);
				const { privateSessions } = await status(context, workspaceId);
				expect(privateSessions).toMatchObject({ available: false, reason });
				expect(privateSessions.detail).toEqual(expect.any(String));

				const gate = await context.request.post(
					at(workspaceId, "/__test/computer/private-session"),
				);
				expect(gate.status()).toBe(409);
				await expect(gate.json()).resolves.toMatchObject({ reason });
			} finally {
				await stop(context, workspaceId);
			}
		});
	}

	it("open the gate only while a verified instance runs, and a pass never outlives its instance", async () => {
		const { context, workspaceId } = await owner();
		const gate = () =>
			context.request
				.post(at(workspaceId, "/__test/computer/private-session"))
				.then((r) => r.status());

		await expect(status(context, workspaceId)).resolves.toMatchObject({
			computer: "stopped",
			privateSessions: { available: false, reason: "stopped" },
		});
		await synthetic(context, workspaceId, fenced(workspaceId));
		try {
			await start(context, workspaceId);
			await expect(gate()).resolves.toBe(204);

			await expect(stop(context, workspaceId)).resolves.toMatchObject({
				privateSessions: { available: false, reason: "stopped" },
			});
			await expect(gate()).resolves.toBe(409);

			// The next instance reports no fence; the last one's pass must not carry over.
			await synthetic(context, workspaceId, {
				status: 200,
				body: JSON.stringify({ workspace: workspaceId, isolation: "none", hosts: [] }),
			});
			await expect(start(context, workspaceId)).resolves.toMatchObject({
				isolation: { fence: false },
				privateSessions: { available: false, reason: "fence-absent" },
			});
			await expect(gate()).resolves.toBe(409);
		} finally {
			await stop(context, workspaceId);
		}
	});

	it("become unavailable when the list changes under a running instance", async () => {
		const { context, workspaceId } = await owner();
		await synthetic(context, workspaceId, fenced(workspaceId));
		try {
			await start(context, workspaceId);
			const replaced = await context.request.put(at(workspaceId, "/hosts"), {
				data: { hosts: ["example.com"] },
			});
			expect(replaced.status()).toBe(200);

			await expect(status(context, workspaceId)).resolves.toMatchObject({
				privateSessions: { available: false, reason: "list-changed" },
			});
		} finally {
			await stop(context, workspaceId);
		}
	});
});
