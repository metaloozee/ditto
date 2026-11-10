import { env, fetchMock, runInDurableObject } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import {
	type ModelSubjectV1,
	parseAccountSnapshot,
} from "../../../packages/runtime-contracts/src/model.js";
import m0 from "../../web/migrations/0000_wet_giant_girl.sql?raw";
import m1 from "../../web/migrations/0001_jazzy_firelord.sql?raw";
import m2 from "../../web/migrations/0002_sparkling_agent_zero.sql?raw";
import m13 from "../../web/migrations/0013_lonely_tigra.sql?raw";
import m14 from "../../web/migrations/0014_smiling_namora.sql?raw";
import m15 from "../../web/migrations/0015_opencode_contract_denials.sql?raw";
import m16 from "../../web/migrations/0016_git_push_contract_state.sql?raw";
import m17 from "../../web/migrations/0017_dazzling_sandman.sql?raw";
import m18 from "../../web/migrations/0018_old_whistler.sql?raw";
import m20 from "../../web/migrations/0020_trusted_runtime_additive.sql?raw";
import m21 from "../../web/migrations/0021_first_lilandra.sql?raw";
import m22 from "../../web/migrations/0022_synthetic_model_transport.sql?raw";
import { CodexCredential } from "../../web/src/lib/codex-credential-do";
import { writeAccountSnapshot } from "../../web/src/lib/codex-models";
import { ModelProductAuthority } from "../../web/src/lib/model-product-authority";
import type { FixtureCredential } from "./entry";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		DB: D1Database;
		CodexCredential: DurableObjectNamespace<FixtureCredential>;
		CODEX_CREDENTIAL_CURRENT_KEY_VERSION: string;
		CODEX_CREDENTIAL_KEYS: string;
	}
}

const jwt = (payload: unknown) =>
	`e30.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.sig`;
const withClaim = jwt({
	"https://api.openai.com/auth": { chatgpt_account_id: "acct_synthetic" },
});
const tokens = (access: string) => ({
	access,
	refresh: "synthetic-refresh",
	expiresAt: 4102444800000,
});
const model = (slug: string, efforts: string[]) => ({
	slug,
	visibility: "list",
	supported_reasoning_levels: efforts.map((effort) => ({ effort })),
	default_reasoning_level: "medium",
});

let calls: { headers: Record<string, unknown> }[];
let reply: { status: number; body: unknown };
let installed = false;

function intercept() {
	if (installed) return;
	installed = true;
	fetchMock
		.get("https://chatgpt.com")
		.intercept({
			path: "/backend-api/codex/models",
			query: { client_version: "0.167.0" },
			method: "GET",
		})
		.reply((options) => {
			calls.push({
				headers: (options.headers ?? {}) as Record<string, unknown>,
			});
			return {
				statusCode: reply.status,
				data: JSON.stringify(reply.body),
				responseOptions: { headers: { "content-type": "application/json" } },
			};
		})
		.persist();
}

const production = (override: Record<string, unknown> = {}) =>
	runInDurableObject(env.CodexCredential.getByName("owner"), (_i, state) =>
		new CodexCredential(state, { ...env, ...override }).refreshModels("owner"),
	);
const snapshotRow = () =>
	env.DB.prepare(
		"SELECT generation,revision,snapshot FROM codex_fixture_capabilities WHERE userId='owner'",
	).first<{ generation: number; revision: number; snapshot: string }>();

beforeEach(async () => {
	calls = [];
	reply = {
		status: 200,
		body: { models: [model("gpt-6.1-sol", ["low", "medium", "high"])] },
	};
	fetchMock.activate();
	fetchMock.disableNetConnect();
	intercept();
	for (const migration of [
		m0,
		m1,
		m2,
		m13,
		m14,
		m15,
		m16,
		m17,
		m18,
		m20,
		m21,
		m22,
	])
		for (const statement of migration.split("--> statement-breakpoint"))
			if (statement.trim()) await env.DB.exec(statement.replaceAll("\n", " "));
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('owner','Synthetic owner','owner@example.invalid',0,0)",
		),
		env.DB.prepare(
			"INSERT INTO codex_connections VALUES('owner',1,0,'connected',0,0)",
		),
	]);
	expect(
		(
			await env.CodexCredential.getByName("owner").install(
				"owner",
				1,
				tokens(withClaim),
			)
		).status,
	).toBe("connected");
});

it("refresh writes a version-2 snapshot carrying the account headers", async () => {
	expect(await production()).toBe("refreshed");
	const row = await snapshotRow();
	expect(row).toMatchObject({ generation: 1, revision: 1 });
	expect(parseAccountSnapshot(row?.snapshot)).toMatchObject({
		version: 2,
		status: "available",
		models: [{ id: "gpt-6.1-sol", thinking: ["medium", "low", "high"] }],
	});
	expect(calls).toHaveLength(1);
	expect(calls[0].headers).toMatchObject({
		authorization: `Bearer ${withClaim}`,
		"chatgpt-account-id": "acct_synthetic",
		originator: "codex_cli_rs",
	});
});

it("a second refresh inside the TTL makes no request", async () => {
	expect(await production()).toBe("refreshed");
	expect(await production()).toBe("current");
	expect(calls).toHaveLength(1);
});

it("after the TTL an identical list keeps the revision and a changed list bumps it", async () => {
	const expire = () =>
		runInDurableObject(env.CodexCredential.getByName("owner"), (_i, state) => {
			state.storage.sql.exec("UPDATE discovery SET fetched_at=0");
		});
	expect(await production()).toBe("refreshed");
	await expire();
	expect(await production()).toBe("refreshed");
	expect((await snapshotRow())?.revision).toBe(1);
	expect(calls).toHaveLength(2);
	reply = {
		status: 200,
		body: {
			models: [
				model("gpt-6.1-sol", ["low", "medium", "high"]),
				model("gpt-6", ["high"]),
			],
		},
	};
	await expire();
	expect(await production()).toBe("refreshed");
	expect((await snapshotRow())?.revision).toBe(2);
});

it("failed discovery returns unavailable and writes nothing", async () => {
	reply = { status: 401, body: {} };
	expect(await production()).toBe("unavailable");
	reply = { status: 200, body: { nope: [] } };
	expect(await production()).toBe("unavailable");
	expect(await snapshotRow()).toBeNull();
	expect(calls).toHaveLength(2);

	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('bare','Bare','bare@example.invalid',0,0)",
		),
		env.DB.prepare(
			"INSERT INTO codex_connections VALUES('bare',1,0,'connected',0,0)",
		),
	]);
	await env.CodexCredential.getByName("bare").install(
		"bare",
		1,
		tokens(jwt({})),
	);
	reply = { status: 200, body: { models: [model("gpt-6", ["low"])] } };
	const bare = await runInDurableObject(
		env.CodexCredential.getByName("bare"),
		(_i, state) => new CodexCredential(state, env).refreshModels("bare"),
	);
	expect(bare).toBe("unavailable");
	expect(calls).toHaveLength(2);
	expect(
		await env.DB.prepare(
			"SELECT userId FROM codex_fixture_capabilities WHERE userId='bare'",
		).first(),
	).toBeNull();
});

it("discovery is unavailable and silent when the device flag is unset", async () => {
	expect(await production({ CODEX_DEVICE_AUTH: "" })).toBe("unavailable");
	expect(calls).toHaveLength(0);
	expect(await snapshotRow()).toBeNull();
});

it("writeAccountSnapshot refuses a connection that moved to a newer generation", async () => {
	await env.DB.prepare(
		"UPDATE codex_connections SET generation=2 WHERE user_id='owner'",
	).run();
	expect(
		await writeAccountSnapshot(env.DB, "owner", 1, [
			{ id: "gpt-6", thinking: ["low"] },
		]),
	).toBe("stale");
	expect(await snapshotRow()).toBeNull();
});

const subject: ModelSubjectV1 = {
	version: 1,
	userId: "owner",
	projectId: "project",
	workspaceSessionId: "session",
	identityId: "executor",
	incarnationId: "incarnation",
	controllerNamespace: "fixture-execution-v1",
	lifecycleGeneration: 1,
	runtimeOwnerVersion: 1,
	connectionGeneration: 1,
	capabilityRevision: 1,
};
const seedSnapshot = (snapshot: unknown) =>
	env.DB.prepare(
		"INSERT OR REPLACE INTO codex_fixture_capabilities VALUES('owner',1,1,?)",
	)
		.bind(JSON.stringify(snapshot))
		.run();
const account = (status: string, models: unknown[]) => ({
	version: 2,
	status,
	generation: 1,
	revision: 1,
	models,
});

it("defaultSelection is the first model and its first level", async () => {
	await seedSnapshot(
		account("available", [
			{ id: "gpt-6.1-sol", thinking: ["medium", "high"] },
			{ id: "gpt-6", thinking: ["low"] },
		]),
	);
	expect(
		await new ModelProductAuthority(env.DB).defaultSelection(subject),
	).toEqual({ model: "gpt-6.1-sol", thinking: "medium" });
});

it("defaultSelection is null for another revision or an unavailable snapshot", async () => {
	await seedSnapshot(
		account("available", [{ id: "gpt-6", thinking: ["low"] }]),
	);
	const policy = new ModelProductAuthority(env.DB);
	expect(
		await policy.defaultSelection({ ...subject, capabilityRevision: 2 }),
	).toBeNull();
	await seedSnapshot(account("unavailable", []));
	expect(await policy.defaultSelection(subject)).toBeNull();
});
