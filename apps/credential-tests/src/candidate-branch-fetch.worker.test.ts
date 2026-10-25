import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import {
	brokerCandidateGit,
	type CandidateBranchFetchDeps,
	type CandidateFetchScope,
	closeCandidateBranchFetch,
	openCandidateBranchFetch,
} from "../../web/src/lib/candidate-branch-fetch";
import { encodeFlushPkt, encodePktLine } from "../../web/src/lib/git-pkt-line";
import type { CandidateFixtureProduct } from "./model-entry";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		CandidateProduct: Service<CandidateFixtureProduct>;
	}
}

// @ts-expect-error The Vite glob typing is not in this package's types.
const migrations = import.meta.glob("../../web/migrations/*.sql", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

const scope: CandidateFetchScope = {
	userId: "owner",
	projectId: "project",
	workspaceSessionId: "session",
	ownerVersion: 1,
};
const TOKEN = "ghs_fixture_secret_token";
let clock = 1_000_000;
let upstream: Request[] = [];
let upstreamAnswer: () => Response = () => new Response("advert");
let minted = 0;

const deps = (): CandidateBranchFetchDeps => ({
	db: env.DB,
	now: () => clock,
	github: {
		branchExists: async (_repository, branch) => branch === "feature",
		defaultBranch: async () => "main",
	},
	mintToken: async () => {
		minted++;
		return TOKEN;
	},
	fetch: async (request) => {
		upstream.push(request);
		return upstreamAnswer();
	},
});

async function seed(options: { runtimeOwner?: string } = {}) {
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('owner','o','o@example.invalid',0,0)",
		),
		env.DB.prepare(
			"INSERT INTO projects(id,name,userId,status,githubRepo) VALUES('project','p','owner','ready','acme/app')",
		),
		env.DB.prepare(
			"INSERT INTO candidate_workspace_claims(id,sessionId,identityId,userId,projectId,createdAt) VALUES(1,'session','identity','owner','project',0)",
		),
		env.DB.prepare(
			"INSERT INTO workspace_sessions(id,projectId,userId,title,status,sandboxIdentityId,runtimeOwner,runtimeOwnerVersion,runtimeProtocolVersion) VALUES('session','project','owner','t','active','identity',?,1,2)",
		).bind(options.runtimeOwner ?? "pi_durable_v1"),
		env.DB.prepare(
			"INSERT INTO sandbox_identities(id,kind,sandboxId,containerId,userId,projectId,workspaceSessionId,state,controllerClass,controllerNamespace,incarnationId) VALUES('identity','workspace_session','identity','identity','owner','project','session','ready','Sandbox','fixture-pi-durable-execution-v1','incarnation')",
		),
	]);
}

beforeEach(async () => {
	clock = 1_000_000;
	upstream = [];
	upstreamAnswer = () => new Response("advert");
	minted = 0;
	for (const key of Object.keys(migrations).sort())
		for (const statement of (migrations[key] ?? "").split(
			"--> statement-breakpoint",
		))
			if (statement.trim())
				await env.DB.exec(
					statement.replace(/^\s*--[^\n]*$/gm, "").replaceAll("\n", " "),
				);
});

const open = (branch = "feature", who: CandidateFetchScope = scope) =>
	openCandidateBranchFetch(deps(), who, { operation: "op", branch });
const infoRefs = (path = "/acme/app.git/info/refs") =>
	new Request(`https://github.com${path}?service=git-upload-pack`);
const lsRefs = (prefix: string) => {
	const parts = [
		encodePktLine("command=ls-refs\n"),
		new Uint8Array([0x30, 0x30, 0x30, 0x31]),
		encodePktLine(`ref-prefix ${prefix}\n`),
		encodeFlushPkt(),
	];
	const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		body.set(part, offset);
		offset += part.length;
	}
	return new Request("https://github.com/acme/app.git/git-upload-pack", {
		method: "POST",
		headers: {
			"content-type": "application/x-git-upload-pack-request",
			"git-protocol": "version=2",
		},
		body,
	});
};
const broker = (request: Request, container = "c1") =>
	brokerCandidateGit(deps(), scope, request, container);
const row = (id: string) =>
	env.DB.prepare("SELECT * FROM privileged_operations WHERE id=?")
		.bind(id)
		.first<Record<string, unknown>>();
const granted = async (branch = "feature") => {
	const result = await open(branch);
	if ("denied" in result) throw new Error(result.denied);
	return result;
};

it("opens a window bound to the repository and the owned branch, else the default branch", async () => {
	await seed();
	const owned = await granted("feature");
	expect(owned).toMatchObject({
		ref: "refs/heads/feature",
		repository: "acme/app",
	});
	expect(await row(owned.window)).toMatchObject({
		family: "git_transport",
		type: "candidate_branch_fetch",
		identityId: "identity",
		incarnationId: "incarnation",
		repository: "acme/app",
		allowedRefs: JSON.stringify(["refs/heads/feature"]),
		maxRequests: 16,
		consumedRequests: 0,
		openSlot: "open",
	});
	await closeCandidateBranchFetch(deps(), scope, owned.window);
	expect((await granted("missing")).ref).toBe("refs/heads/main");
});

it("denies open for a foreign, legacy or retired session, a malformed branch and a second open", async () => {
	await seed();
	expect(await open("feature", { ...scope, userId: "intruder" })).toEqual({
		denied: "authority_denied",
	});
	for (const branch of ["", "-x", "refs/heads/x", " x", "a\nb"])
		expect(await open(branch)).toEqual({ denied: "invalid_branch" });
	await granted();
	expect(await open()).toEqual({ denied: "busy" });
	await env.DB.exec(
		"UPDATE sandbox_identities SET retiredAt=1 WHERE id='identity'",
	);
	expect(await open()).toEqual({ denied: "authority_denied" });
});

it("denies open for a legacy session", async () => {
	await seed({ runtimeOwner: "legacy" });
	expect(await open()).toEqual({ denied: "authority_denied" });
});

it("passes a valid request upstream with authorization and returns no token", async () => {
	await seed();
	await granted();
	for (const request of [infoRefs(), lsRefs("refs/heads/feature")]) {
		const response = await broker(request);
		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain(TOKEN);
		expect([...response.headers.values()].join(" ")).not.toContain(TOKEN);
	}
	expect(upstream).toHaveLength(2);
	for (const sent of upstream) {
		expect(new URL(sent.url).origin).toBe("https://github.com");
		expect(new URL(sent.url).pathname.startsWith("/acme/app.git/")).toBe(true);
		expect(sent.headers.get("authorization")).toBe(`token ${TOKEN}`);
		expect(sent.redirect).toBe("manual");
	}
});

it("refuses without any upstream call", async () => {
	await seed();
	const window = await granted();
	const refused: [string, () => Promise<Response>][] = [
		[
			"receive-pack",
			() =>
				broker(
					new Request("https://github.com/acme/app.git/git-receive-pack", {
						method: "POST",
						body: "x",
					}),
				),
		],
		["another repository", () => broker(infoRefs("/acme/other.git/info/refs"))],
		["ref outside the window", () => broker(lsRefs("refs/heads/secret"))],
	];
	for (const [label, send] of refused) {
		const response = await send();
		expect(response.status, label).toBe(403);
		expect(await response.text()).toBe("denied");
	}
	expect(upstream).toHaveLength(0);
	expect(minted).toBe(0);

	// Bind the container, then a second container is refused.
	expect((await broker(infoRefs())).status).toBe(200);
	expect(upstream).toHaveLength(1);
	const other = await broker(infoRefs(), "c2");
	expect(other.status).toBe(403);
	expect(other.headers.get("x-ditto-denial")).toBe("container_mismatch");
	expect(upstream).toHaveLength(1);

	// Budget: 15 more requests spend the window, the next is refused.
	for (let i = 0; i < 15; i++)
		expect((await broker(infoRefs())).status).toBe(200);
	const exhausted = await broker(infoRefs());
	expect(exhausted.headers.get("x-ditto-denial")).toBe("budget_exhausted");
	expect(upstream).toHaveLength(16);
	expect((await row(window.window))?.consumedRequests).toBe(16);
});

it("refuses an expired window and lets a new one open", async () => {
	await seed();
	const window = await granted();
	clock += 5 * 60 * 1000 + 1000;
	const expired = await broker(infoRefs());
	expect(expired.headers.get("x-ditto-denial")).toBe("window_expired");
	expect(upstream).toHaveLength(0);
	// An expired window no longer blocks a new one.
	const fresh = await granted();
	expect(fresh.window).not.toBe(window.window);
	expect((await row(window.window))?.closeReason).toBe("expired");
});

it("does not follow an upstream redirect", async () => {
	await seed();
	await granted();
	upstreamAnswer = () =>
		new Response(null, {
			status: 302,
			headers: { location: "https://evil.example/x" },
		});
	const response = await broker(infoRefs());
	expect(response.status).toBe(403);
	expect(response.headers.get("location")).toBeNull();
	expect(upstream).toHaveLength(1);
});

it("closes idempotently and refuses afterwards", async () => {
	await seed();
	const window = await granted();
	await closeCandidateBranchFetch(deps(), scope, window.window);
	const first = await row(window.window);
	expect(first).toMatchObject({
		closeReason: "closed",
		openSlot: window.window,
	});
	clock += 10_000;
	await closeCandidateBranchFetch(deps(), scope, window.window);
	expect((await row(window.window))?.closedAt).toBe(first?.closedAt);
	const response = await broker(infoRefs());
	expect(response.headers.get("x-ditto-denial")).toBe("no_window");
	expect(upstream).toHaveLength(0);
	// A foreign scope cannot close another session's window.
	const next = await granted();
	await closeCandidateBranchFetch(
		deps(),
		{ ...scope, userId: "intruder" },
		next.window,
	);
	expect((await row(next.window))?.closedAt).toBeNull();
});

it("serves the port through the fixture product", async () => {
	await seed();
	const result = await env.CandidateProduct.openCandidateBranchFetch(
		{ version: 2, ...scope, ownerVersion: 1 },
		{ operation: "op", branch: "feature" },
	);
	expect(result).toMatchObject({ ref: "refs/heads/feature" });
	const response = await env.CandidateProduct.brokerCandidateGit(
		{ version: 2, ...scope, ownerVersion: 1 },
		infoRefs(),
		"c1",
	);
	expect(response.status).toBe(200);
	if ("window" in result)
		await env.CandidateProduct.closeCandidateBranchFetch(
			{ version: 2, ...scope, ownerVersion: 1 },
			result.window,
		);
});
