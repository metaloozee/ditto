import { env, fetchMock, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
	type ModelTransportDescriptorV1,
	parseSyntheticModelRequestV1,
} from "../../../packages/runtime-contracts/src/model.js";
import m0 from "../../web/migrations/0000_wet_giant_girl.sql?raw";
import m1 from "../../web/migrations/0001_jazzy_firelord.sql?raw";
import m2 from "../../web/migrations/0002_sparkling_agent_zero.sql?raw";
import m3 from "../../web/migrations/0003_material_ghost_rider.sql?raw";
import m4 from "../../web/migrations/0004_same_stellaris.sql?raw";
import m5 from "../../web/migrations/0005_illegal_invisible_woman.sql?raw";
import m6 from "../../web/migrations/0006_late_wonder_man.sql?raw";
import m7 from "../../web/migrations/0007_amused_shinobi_shaw.sql?raw";
import m8 from "../../web/migrations/0008_chunky_sunset_bain.sql?raw";
import m9 from "../../web/migrations/0009_worthless_young_avengers.sql?raw";
import m10 from "../../web/migrations/0010_worthless_george_stacy.sql?raw";
import m11 from "../../web/migrations/0011_handy_loa.sql?raw";
import m12 from "../../web/migrations/0012_pale_hiroim.sql?raw";
import m13 from "../../web/migrations/0013_lonely_tigra.sql?raw";
import m14 from "../../web/migrations/0014_smiling_namora.sql?raw";
import m15 from "../../web/migrations/0015_opencode_contract_denials.sql?raw";
import m16 from "../../web/migrations/0016_git_push_contract_state.sql?raw";
import m17 from "../../web/migrations/0017_dazzling_sandman.sql?raw";
import m18 from "../../web/migrations/0018_old_whistler.sql?raw";
import m19 from "../../web/migrations/0019_needy_squadron_sinister.sql?raw";
import m20 from "../../web/migrations/0020_trusted_runtime_additive.sql?raw";
import m21 from "../../web/migrations/0021_first_lilandra.sql?raw";
import m22 from "../../web/migrations/0022_synthetic_model_transport.sql?raw";
import m23 from "../../web/migrations/0023_candidate_product_commands.sql?raw";
import {
	CANDIDATE_MODEL_POLICY,
	ModelProductAuthority,
} from "../../web/src/lib/model-product-authority";
import { CandidateProductCommands } from "../../web/src/lib/session-command-candidate";

import { CANDIDATE_FIXTURE_RESET_SCHEMA } from "./candidate-fixture-schema";
import {
	type CandidateFixtureCredential,
	candidateDispatchScope,
} from "./entry";
import type {
	CandidateFixtureProduct,
	CandidateFixtureSession,
} from "./model-entry";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		CandidateProduct: Service<CandidateFixtureProduct>;
		CandidateSessions: DurableObjectNamespace<CandidateFixtureSession>;
		CandidateCredential: DurableObjectNamespace<CandidateFixtureCredential>;
	}
}

const account = {
	version: 1,
	status: "available",
	generation: 1,
	revision: 1,
	models: [{ id: "faux-1", thinking: ["off"] }],
};
async function candidateCredential() {
	const credential = env.CandidateCredential.getByName("owner");
	await credential.install("owner", 1, {
		access: "synthetic-product-access",
		refresh: "synthetic-product-refresh",
		expiresAt: 4102444800000,
	});
	return credential;
}
let modelCalls = 0;
let trapInstalled = false;
let replyText = "Synthetic product result";
function modelReplies() {
	if (!trapInstalled) {
		trapInstalled = true;
		fetchMock
			.get("https://codex-model-fixture.invalid")
			.intercept({ path: "/v1/stream", method: "POST" })
			.reply(() => {
				modelCalls++;
				return {
					statusCode: 200,
					data:
						[
							{ version: 1, type: "delta", text: replyText },
							{
								version: 1,
								type: "done",
								stopReason: "stop",
								inputTokens: 1,
								outputTokens: 1,
							},
						]
							.map((value) => JSON.stringify(value))
							.join("\n") + "\n",
					responseOptions: {
						headers: { "content-type": "application/x-ndjson" },
					},
				};
			})
			.persist();
	}
	return () => modelCalls;
}
let terminal = false;
const commands = (now: () => number = Date.now) =>
	new CandidateProductCommands(
		env.DB,
		{
			readSelection: async () => null,
			targetStatus: async (_subject, runId) => ({
				ownerVersion: 1,
				runId,
				state: terminal ? "terminal" : "not_delivered",
			}),
		},
		(owner) => env.CodexCredential.getByName(owner),
		now,
	);
const prompt = {
	version: 2,
	kind: "prompt",
	projectId: "project",
	idempotencyKey: "first",
	text: "Synthetic admitted command",
};
async function counts() {
	return Promise.all(
		[
			"workspace_sessions",
			"sandbox_identities",
			"session_commands",
			"messages",
			"workspace_runtime_work",
			"candidate_workspace_claims",
			"runtime_command_memberships",
		].map(
			async (table) =>
				(await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{
					n: number;
				}>())!.n,
		),
	);
}
beforeEach(async ({ task }) => {
	modelCalls = 0;
	replyText = "Synthetic product result";
	await env.CandidateProduct.setProjectionFault(undefined);
	terminal = false;
	fetchMock.activate();
	fetchMock.disableNetConnect();
	for (const migration of [
		m0,
		m1,
		m2,
		m3,
		m4,
		m5,
		m6,
		m7,
		m8,
		m9,
		m10,
		m11,
		m12,
		m13,
		m14,
		m15,
		m16,
		m17,
		m18,
		m19,
		m20,
		m21,
		m22,
		m23,
	])
		for (const statement of migration.split("--> statement-breakpoint"))
			if (statement.trim())
				await env.DB.exec(
					statement.replace(/^\s*--[^\n]*$/gm, "").replaceAll("\n", " "),
				);
	if (task.name !== "owned authority works before the reset table exists")
		await env.DB.exec(CANDIDATE_FIXTURE_RESET_SCHEMA);
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('owner','Synthetic owner','owner@example.invalid',0,0)",
		),
		env.DB.prepare(
			"INSERT INTO projects(id,name,userId,status) VALUES('project','Synthetic project','owner','ready')",
		),
		env.DB.prepare(
			"INSERT INTO codex_connections VALUES('owner',1,0,'connected',0,0)",
		),
		env.DB.prepare(
			"INSERT INTO codex_fixture_capabilities VALUES('owner',1,1,?)",
		).bind(JSON.stringify(account)),
	]);
	expect(
		(
			await env.CodexCredential.getByName("owner").install("owner", 1, {
				access: "synthetic-product-access",
				refresh: "synthetic-product-refresh",
				expiresAt: 4102444800000,
			})
		).status,
	).toBe("connected");
});
afterEach(() => fetchMock.deactivate());

it("owned authority works before the reset table exists", async () => {
	await candidateCredential();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	expect(
		await env.DB.prepare(
			"SELECT name FROM sqlite_master WHERE name='candidate_fixture_resets'",
		).first(),
	).toBeNull();
	expect(
		await env.CandidateProduct.readRuntimeAuthority({
			version: 2,
			userId: "owner",
			projectId: "project",
			workspaceSessionId: first.workspaceSessionId,
			ownerVersion: 1,
		}),
	).toEqual({ current: true, generation: 1, executor: 1, liveExecutors: 1 });
});

it("owned authority is fresh with a present reset table and no reset", async () => {
	await candidateCredential();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const scope = {
		version: 2 as const,
		userId: "owner",
		projectId: "project",
		workspaceSessionId: first.workspaceSessionId,
		ownerVersion: 1 as const,
	};
	expect(await env.CandidateProduct.readRuntimeAuthority(scope)).toEqual({
		current: true,
		generation: 1,
		executor: 1,
		liveExecutors: 1,
	});
	await env.DB.exec(
		"UPDATE workspace_sessions SET runtimeFailureReasonCode='review'",
	);
	expect((await env.CandidateProduct.readRuntimeAuthority(scope)).current).toBe(
		false,
	);
	await env.DB.exec(
		"UPDATE workspace_sessions SET runtimeFailureReasonCode=NULL",
	);
	expect((await env.CandidateProduct.readRuntimeAuthority(scope)).current).toBe(
		true,
	);
	await env.DB.exec(
		"INSERT INTO runtime_deleted_target_fences VALUES('project','project',1,0)",
	);
	expect((await env.CandidateProduct.readRuntimeAuthority(scope)).current).toBe(
		false,
	);
});

it("runs an actually admitted prompt through leased delivery, native DO alarm, Pi and the candidate credential claim path", async () => {
	await env.CandidateCredential.getByName("owner").install("owner", 1, {
		access: "synthetic-product-access",
		refresh: "synthetic-product-refresh",
		expiresAt: 4102444800000,
	});
	const calls = modelReplies();
	const receipt = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(receipt.workspaceSessionId);
	try {
		await env.CandidateProduct.drain();
		expect(
			(
				await env.DB.prepare(
					"SELECT deliveryState FROM workspace_runtime_work WHERE commandId=?",
				)
					.bind(receipt.commandId)
					.first()
			)?.deliveryState,
		).toBe("delivered");
		await expect
			.poll(
				async () =>
					(await runtime.candidateSnapshot()).members.filter(
						(row) => row.state === "pending",
					).length,
				{ timeout: 3000 },
			)
			.toBe(0);
		const snapshot = await runtime.candidateSnapshot();
		expect(calls()).toBe(1);
		expect(snapshot.conversations).toBe(1);
		expect(snapshot.submissions).toHaveLength(1);
		expect(snapshot.commands).toMatchObject([
			{ id: receipt.commandId, sequence: receipt.commandSeq },
		]);
		expect(snapshot.members).toMatchObject([
			{ assistant: receipt.assistantMessageId, state: "complete" },
		]);
		expect(snapshot.projections).toMatchObject([
			{ assistant: receipt.assistantMessageId, state: "complete" },
		]);
		expect(JSON.stringify(snapshot.retained)).not.toContain(prompt.text);
		expect(
			(
				await env.DB.prepare(
					"SELECT decision FROM candidate_command_decisions WHERE commandId=?",
				)
					.bind(receipt.commandId)
					.first()
			)?.decision,
		).toBe("started");
		expect(await counts()).toEqual([1, 1, 1, 2, 1, 1, 1]);
	} finally {
		await runtime.retireFixture();
	}
});

it("settles final-hold preparation false when a real preclaim hold crosses the original host yield", async () => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.holdModel("claim");
	await credential.armCandidateFinal();
	const receipt = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(receipt.workspaceSessionId);
	try {
		await env.CandidateProduct.drain();
		await credential.waitModel();
		await new Promise((resolve) => setTimeout(resolve, 1100));
		await credential.releaseModel();
		expect(await credential.waitCandidateFinal()).toBe(false);
		expect((await credential.waitCandidateOutcome())?.status).toBe("denied");
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).members[0]?.state, {
				timeout: 3000,
			})
			.toBe("failed");
		const snapshot = await runtime.candidateSnapshot();
		expect(snapshot.projections).toMatchObject([{ state: "failed" }]);
		expect(snapshot.runs).toMatchObject([{ state: "failed" }]);
		expect(snapshot.effects).toMatchObject([{ state: "admitted" }]);
		expect(snapshot.effects).toHaveLength(1);
		expect(
			await runInDurableObject(runtime, (_instance, state) =>
				state.storage.sql
					.exec("SELECT claimed FROM host_model_dispatch")
					.toArray(),
			),
		).toEqual([{ claimed: 0 }]);
		expect(snapshot.invocations).toMatchObject([{ state: "closed" }]);
		expect(calls()).toBe(0);
		expect(
			(
				await env.DB.prepare(
					"SELECT deliveryState FROM workspace_runtime_work WHERE commandId=?",
				)
					.bind(receipt.commandId)
					.first()
			)?.deliveryState,
		).toBe("delivered");
	} finally {
		await credential.releaseModel();
		await credential.releaseCandidateFinal();
		await runtime.retireFixture();
	}
});

it("admits concurrent identical first prompts with one receipt, identity, capacity claim and message pair", async () => {
	const [a, b] = await Promise.all([
		commands().admit("owner", prompt),
		commands().admit("owner", prompt),
	]);
	expect(a).toEqual(b);
	expect(await counts()).toEqual([1, 1, 1, 2, 1, 1, 0]);
	const command = await commands().reconstruct(a.commandId, 1);
	expect(command).toMatchObject({
		commandId: a.commandId,
		receiptId: a.receiptId,
		text: prompt.text,
		userMessageId: a.userMessageId,
		assistantMessageId: a.assistantMessageId,
	});
	await expect(
		commands().admit("owner", { ...prompt, text: "Changed" }),
	).rejects.toMatchObject({ code: "conflict" });
	expect(await counts()).toEqual([1, 1, 1, 2, 1, 1, 0]);
});
it("keeps one lifetime workspace claim for concurrent distinct first prompts", async () => {
	const results = await Promise.allSettled([
		commands().admit("owner", prompt),
		commands().admit("owner", { ...prompt, idempotencyKey: "second" }),
	]);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	const rejected = results.find((r) => r.status === "rejected");
	expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
		code: "fixture_capacity_exhausted",
	});
	expect(await counts()).toEqual([1, 1, 1, 2, 1, 1, 0]);
});
it.each([
	"UPDATE projects SET status='deleting'",
	"UPDATE projects SET status='pending'",
	"UPDATE codex_connections SET revoked=1",
	"UPDATE codex_fixture_capabilities SET revision=2",
	"UPDATE codex_fixture_capabilities SET snapshot=json_set(snapshot,'$.models',json('[]'))",
	"INSERT INTO runtime_deleted_target_fences VALUES('project','project',1,0)",
])("rejects current readiness before all admission writes: %s", async (sql) => {
	await env.DB.prepare(sql).run();
	await expect(commands().admit("owner", prompt)).rejects.toMatchObject({
		code: "model_unconfigured",
	});
	expect(await counts()).toEqual([0, 0, 0, 0, 0, 0, 0]);
});
it("denies caller authority, byte overflow and foreign ownership without rows", async () => {
	for (const value of [
		{ ...prompt, userId: "owner" },
		{ ...prompt, text: "😀".repeat(2049) },
		{ ...prompt, kind: "retry_backup" },
	])
		await expect(commands().admit("owner", value)).rejects.toThrow();
	await expect(commands().admit("foreign", prompt)).rejects.toMatchObject({
		code: "model_unconfigured",
	});
	expect(await counts()).toEqual([0, 0, 0, 0, 0, 0, 0]);
});
it("rejects terminal and foreign targets but admits cold Stop after capability removal", async () => {
	const first = await commands().admit("owner", prompt);
	const follow = {
		...prompt,
		kind: "follow_up",
		sessionId: first.workspaceSessionId,
		targetRunId: first.commandId,
		idempotencyKey: "follow",
	};
	await expect(
		commands().admit("owner", { ...follow, targetRunId: "foreign" }),
	).rejects.toMatchObject({ code: "invalid_target" });
	terminal = true;
	await expect(commands().admit("owner", follow)).rejects.toMatchObject({
		code: "target_run_terminal",
	});
	await env.DB.batch([
		env.DB.prepare("DELETE FROM codex_fixture_capabilities"),
		env.DB.prepare("UPDATE codex_connections SET revoked=1"),
	]);
	const stop = await commands().admit("owner", {
		version: 2,
		kind: "stop",
		projectId: "project",
		sessionId: first.workspaceSessionId,
		targetRunId: first.commandId,
		idempotencyKey: "stop",
	});
	expect(stop.commandSeq).toBe(2);
	expect(await counts()).toEqual([1, 1, 2, 2, 2, 1, 0]);
	expect(await commands().admit("owner", prompt)).toEqual(first);
});
it.each(
	Array.from({ length: 11 }, (_, index) => index),
)("rolls back first admission at D1 batch boundary %s without leaking capacity or identity", async (boundary) => {
	const db = new Proxy(env.DB, {
		get(target, key) {
			if (key === "batch")
				return (statements: D1PreparedStatement[]) =>
					target.batch([
						...statements.slice(0, boundary),
						target.prepare("INSERT INTO missing_fixture_table VALUES(1)"),
						...statements.slice(boundary),
					]);
			const value: unknown = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const faulted = new CandidateProductCommands(
		db,
		{
			readSelection: async () => null,
			targetStatus: async (_subject, runId) => ({
				ownerVersion: 1,
				runId,
				state: "not_delivered",
			}),
		},
		(owner) => env.CodexCredential.getByName(owner),
	);
	await expect(faulted.admit("owner", prompt)).rejects.toThrow(
		"missing_fixture_table",
	);
	expect(await counts()).toEqual([0, 0, 0, 0, 0, 0, 0]);
});

it("fails trusted reconstruction when admitted text or outbox membership changes", async () => {
	const first = await commands().admit("owner", prompt);
	await env.DB.prepare("UPDATE messages SET content='Changed' WHERE id=?")
		.bind(first.userMessageId)
		.run();
	expect(await commands().reconstruct(first.commandId, 1)).toBeNull();
});

it.each([
	"UPDATE session_command_keys SET userId='foreign' WHERE commandId=?",
	"DELETE FROM session_command_keys WHERE commandId=?",
	"UPDATE messages SET userId='foreign' WHERE id=(SELECT assistantMessageId FROM session_commands WHERE id=?)",
	"UPDATE workspace_runtime_work SET userId='foreign' WHERE commandId=?",
])("batched reconstruction denies admitted association tamper: %s", async (mutation) => {
	await env.DB.exec(
		"INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('foreign','Synthetic foreign owner','foreign@example.invalid',0,0)",
	);
	const product = commands();
	const first = await product.admit("owner", prompt);
	expect(await product.reconstruct(first.commandId, 1)).not.toBeNull();
	await env.DB.prepare(mutation).bind(first.commandId).run();
	expect(await product.reconstruct(first.commandId, 1)).toBeNull();
});

it("batched command subject rereads capability revision and deletion authority", async () => {
	const product = commands();
	const first = await product.admit("owner", prompt);
	const subject = await product.subjectForCommand(first.commandId, 1);
	expect(subject).toMatchObject({ capabilityRevision: 1 });
	await env.DB.prepare(
		"UPDATE codex_fixture_capabilities SET revision=2,snapshot=? WHERE userId='owner'",
	)
		.bind(JSON.stringify({ ...account, revision: 2 }))
		.run();
	expect(await product.subjectForCommand(first.commandId, 1)).toEqual({
		...subject,
		capabilityRevision: 2,
	});
	await env.DB.prepare(
		"INSERT INTO runtime_deleted_target_fences VALUES('workspace_session',?,1,0)",
	)
		.bind(first.workspaceSessionId)
		.run();
	expect(await product.subjectForCommand(first.commandId, 1)).toBeNull();
});

it.each([
	"started",
	"expired",
] as const)("reconciles the exact %s outcome idempotently and never accepts the opposite fate", async (decision) => {
	let now = Date.now();
	const product = commands(() => now);
	const first = await product.admit("owner", prompt);
	const command = await product.reconstruct(first.commandId, 1);
	if (!command || command.kind !== "prompt")
		throw new Error("Missing admitted prompt");
	now = decision === "started" ? command.acceptedAt + 1 : command.deadlineAt;
	const evidence = {
		version: 2,
		commandId: command.commandId,
		ownerVersion: 1,
		runId: command.commandId,
		runEpoch: 1,
		decision,
		decidedAt: now,
		queueDeadlineAt: command.deadlineAt,
		payloadDigest: command.payloadDigest,
	};
	expect(await product.reconcileDecision(command.commandId, 1, evidence)).toBe(
		true,
	);
	expect(await product.reconcileDecision(command.commandId, 1, evidence)).toBe(
		true,
	);
	expect(
		await product.reconcileDecision(command.commandId, 1, {
			...evidence,
			payloadDigest: "a".repeat(64),
		}),
	).toBe(false);
	now = command.deadlineAt + 1;
	expect(
		await product.reconcileDecision(command.commandId, 1, {
			...evidence,
			decision: decision === "started" ? "expired" : "started",
			decidedAt: decision === "started" ? now : command.acceptedAt,
		}),
	).toBe(false);
	const subject = await product.subjectForCommand(command.commandId, 1);
	if (!subject) throw new Error("Missing owned subject");
	const descriptor: ModelTransportDescriptorV1 = {
		version: 1,
		subject,
		requestDigest: "b".repeat(64),
		attempt: {
			version: 1,
			effectId: "effect",
			operationId: "operation",
			runId: command.commandId,
			commandId: command.commandId,
			assistantId: command.assistantMessageId,
			taskId: 1,
			epoch: 1,
			attempt: 1,
			generation: 1,
			deadlineAt: now + 30000,
			requestDigest: "b".repeat(64),
			kind: "generation",
		},
	};
	const policy = new ModelProductAuthority(
		env.DB,
		() => now,
		CANDIDATE_MODEL_POLICY,
	);
	expect(await policy.current(descriptor)).toBe(decision === "started");
	const body = {
		version: 1 as const,
		protocol: "ditto-synthetic-ndjson-1" as const,
		purpose: "generation" as const,
		model: "faux-1" as const,
		thinking: "off" as const,
		transcript: "Synthetic policy boundary",
		options: { maxTokens: 64 },
	};
	if (decision === "started") {
		expect(await policy.open(descriptor)).not.toBeNull();
		expect(await policy.reserve(descriptor, body)).not.toBeNull();
		expect(await policy.permit(descriptor, body)).toBe(true);
		await env.DB.prepare(
			"UPDATE workspace_sessions SET runtimeProtocolVersion=1",
		).run();
		expect(await policy.current(descriptor)).toBe(false);
		expect(await policy.permit(descriptor, body)).toBe(false);
		await env.DB.prepare(
			"UPDATE workspace_sessions SET runtimeProtocolVersion=2",
		).run();
		expect(await policy.denial(descriptor)).toBe(false);
		expect(await policy.denial(descriptor)).toBe(false);
		expect(await policy.denial(descriptor)).toBe(true);
		expect(
			(
				await env.DB.prepare(
					"SELECT runtimeFailureReasonCode FROM workspace_sessions",
				).first()
			)?.runtimeFailureReasonCode,
		).toBe("model_contract_review");
		expect(await policy.permit(descriptor, body)).toBe(false);
	} else {
		expect(await policy.open(descriptor)).toBeNull();
		expect(await policy.reserve(descriptor, body)).toBeNull();
		expect(await policy.permit(descriptor, body)).toBe(false);
	}
	expect(
		await new ModelProductAuthority(env.DB, () => now).current(descriptor),
	).toBe(false);
	expect(
		await policy.current({
			...descriptor,
			subject: { ...subject, controllerNamespace: "fixture-execution-v1" },
		}),
	).toBe(false);
	expect(await counts()).toEqual([1, 1, 1, 2, 1, 1, 1]);
});

it("native alarms drain delivery order 3,1,2 through individual model turns without client scheduling", async () => {
	await candidateCredential();
	const calls = modelReplies();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const follow = (key: string) =>
		env.CandidateProduct.admitOwned("owner", {
			version: 2,
			kind: "follow_up",
			projectId: "project",
			sessionId: first.workspaceSessionId,
			targetRunId: first.commandId,
			idempotencyKey: key,
			text: `Synthetic ${key}`,
		});
	const second = await follow("second"),
		third = await follow("third");
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		const thirdAck = await runtime.deliverCommand(third.commandId, 1);
		expect(thirdAck).toMatchObject({
			receiptId: third.receiptId,
			acceptedPosition: 3,
		});
		expect((await runtime.candidateSnapshot()).submissions).toHaveLength(0);
		await runtime.deliverCommand(first.commandId, 1);
		await runtime.deliverCommand(second.commandId, 1);
		await expect
			.poll(
				async () =>
					(await runtime.candidateSnapshot()).members.filter(
						(member) => member.state === "complete",
					).length,
				{ timeout: 3000 },
			)
			.toBe(3);
		const snapshot = await runtime.candidateSnapshot();
		expect(calls()).toBe(3);
		expect(snapshot.submissions).toHaveLength(3);
		expect(snapshot.commands.map((row) => row.id)).toEqual([
			first.commandId,
			second.commandId,
			third.commandId,
		]);
		expect(snapshot.projections).toHaveLength(3);
		await runtime.reopenFixture();
		expect(await runtime.deliverCommand(third.commandId, 1)).toEqual(thirdAck);
		expect((await runtime.candidateSnapshot()).submissions).toHaveLength(3);
		expect(calls()).toBe(3);
	} finally {
		await runtime.retireFixture();
	}
});
it("lost delivery acknowledgment and new product invocation retain the receipt and one Pi submission", async () => {
	await candidateCredential();
	const calls = modelReplies();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	let now = Date.now();
	const dispatcher = commands(() => now);
	try {
		await dispatcher.drain(async (_session, commandId, version) => {
			await runtime.deliverCommand(commandId, version);
			throw new Error("Lost durable DO acknowledgment");
		});
		expect(
			await env.DB.prepare(
				"SELECT deliveryState,deliveryAttempts FROM workspace_runtime_work WHERE commandId=?",
			)
				.bind(first.commandId)
				.first(),
		).toMatchObject({ deliveryState: "pending", deliveryAttempts: 1 });
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).members[0]?.state, {
				timeout: 3000,
			})
			.toBe("complete");
		await runtime.reopenFixture();
		now += 1001;
		await commands(() => now).drain((_session, id, version) =>
			runtime.deliverCommand(id, version),
		);
		expect(
			(
				await env.DB.prepare(
					"SELECT deliveryState FROM workspace_runtime_work WHERE commandId=?",
				)
					.bind(first.commandId)
					.first()
			)?.deliveryState,
		).toBe("delivered");
		expect(await env.CandidateProduct.admitOwned("owner", prompt)).toEqual(
			first,
		);
		expect((await runtime.candidateSnapshot()).submissions).toHaveLength(1);
		expect(calls()).toBe(1);
	} finally {
		await runtime.retireFixture();
	}
});
it("cold Stop after disconnect beats delivery gaps and retains multiple late message memberships across reopen", async () => {
	await candidateCredential();
	const calls = modelReplies();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const follow = (key: string) =>
		env.CandidateProduct.admitOwned("owner", {
			version: 2,
			kind: "follow_up",
			projectId: "project",
			sessionId: first.workspaceSessionId,
			targetRunId: first.commandId,
			idempotencyKey: key,
			text: `Synthetic ${key}`,
		});
	const second = await follow("second"),
		third = await follow("third");
	await env.DB.batch([
		env.DB.prepare("UPDATE codex_connections SET revoked=1"),
		env.DB.prepare("DELETE FROM codex_fixture_capabilities"),
	]);
	const stop = await env.CandidateProduct.admitOwned("owner", {
		version: 2,
		kind: "stop",
		projectId: "project",
		sessionId: first.workspaceSessionId,
		targetRunId: first.commandId,
		idempotencyKey: "stop",
	});
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		const stopAck = await runtime.deliverCommand(stop.commandId, 1);
		const stopped = await runtime.candidateSnapshot();
		expect(stopped.conversations).toBe(0);
		const stoppedEpoch = stopped.runs[0]?.epoch;
		await runtime.reopenFixture();
		for (const accepted of [third, first, second]) {
			const ack = await runtime.deliverCommand(accepted.commandId, 1);
			expect(await runtime.deliverCommand(accepted.commandId, 1)).toEqual(ack);
		}
		expect(await runtime.deliverCommand(stop.commandId, 1)).toEqual(stopAck);
		const snapshot = await runtime.candidateSnapshot();
		expect(snapshot.submissions).toHaveLength(0);
		expect(snapshot.members.map((row) => row.state)).toEqual([
			"failed",
			"failed",
			"failed",
		]);
		expect(snapshot.projections).toHaveLength(3);
		expect(snapshot.runs).toMatchObject([
			{ id: first.commandId, state: "canceled", epoch: stoppedEpoch },
		]);
		expect(calls()).toBe(0);
		expect(await env.CandidateProduct.admitOwned("owner", prompt)).toEqual(
			first,
		);
	} finally {
		await runtime.retireFixture();
	}
});
it("a follow-up admitted before completion but delivered afterward fails its own assistant without reopening the completed run", async () => {
	await candidateCredential();
	const calls = modelReplies();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const second = await env.CandidateProduct.admitOwned("owner", {
		version: 2,
		kind: "follow_up",
		projectId: "project",
		sessionId: first.workspaceSessionId,
		targetRunId: first.commandId,
		idempotencyKey: "late",
		text: "Synthetic delayed follow-up",
	});
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		await runtime.deliverCommand(first.commandId, 1);
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).runs[0]?.state, {
				timeout: 3000,
			})
			.toBe("complete");
		await runtime.reopenFixture();
		const ack = await runtime.deliverCommand(second.commandId, 1);
		await runtime.reopenFixture();
		expect(await runtime.deliverCommand(second.commandId, 1)).toEqual(ack);
		const snapshot = await runtime.candidateSnapshot();
		expect(snapshot.members.map((row) => row.state)).toEqual([
			"complete",
			"failed",
		]);
		expect(snapshot.projections.map((row) => row.state)).toEqual([
			"complete",
			"failed",
		]);
		expect(snapshot.runs).toMatchObject([{ state: "complete" }]);
		expect(snapshot.submissions).toHaveLength(1);
		expect(calls()).toBe(1);
		expect(
			await env.CandidateProduct.admitOwned("owner", {
				version: 2,
				kind: "follow_up",
				projectId: "project",
				sessionId: first.workspaceSessionId,
				targetRunId: first.commandId,
				idempotencyKey: "late",
				text: "Synthetic delayed follow-up",
			}),
		).toEqual(second);
	} finally {
		await runtime.retireFixture();
	}
});
it("priority Stop fences a held credential claim without ordinary capacity or a second provider dispatch", async () => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	await credential.holdModel("claim");
	try {
		await runtime.deliverCommand(first.commandId, 1);
		await credential.waitModel();
		const stop = await env.CandidateProduct.admitOwned("owner", {
			version: 2,
			kind: "stop",
			projectId: "project",
			sessionId: first.workspaceSessionId,
			targetRunId: first.commandId,
			idempotencyKey: "stop-held",
		});
		await runtime.deliverCommand(stop.commandId, 1);
		const stopped = await runtime.candidateSnapshot();
		expect(Number(stopped.runs[0]?.epoch)).toBeGreaterThan(1);
		expect(["stopping", "canceled", "failed"]).toContain(
			stopped.runs[0]?.state,
		);
		expect(calls()).toBe(0);
		await credential.releaseModel();
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).members[0]?.state, {
				timeout: 3000,
			})
			.toBe("failed");
		expect(calls()).toBe(0);
	} finally {
		await credential.releaseModel();
		await runtime.retireFixture();
	}
});
it("real delivery expires an admitted but unstarted instruction without creating a Pi root or provider effect", async () => {
	await candidateCredential();
	const calls = modelReplies();
	const first = await commands(() => Date.now() - 900001).admit(
		"owner",
		prompt,
	);
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		const ack = await runtime.deliverCommand(first.commandId, 1);
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).members[0]?.state, {
				timeout: 3000,
			})
			.toBe("failed");
		await runtime.reopenFixture();
		expect(await runtime.deliverCommand(first.commandId, 1)).toEqual(ack);
		const snapshot = await runtime.candidateSnapshot();
		expect(snapshot.conversations).toBe(0);
		expect(snapshot.submissions).toHaveLength(0);
		expect(snapshot.projections).toMatchObject([
			{ assistant: first.assistantMessageId, state: "failed" },
		]);
		expect(
			(
				await env.DB.prepare(
					"SELECT decision FROM candidate_command_decisions WHERE commandId=?",
				)
					.bind(first.commandId)
					.first()
			)?.decision,
		).toBe("expired");
		expect(calls()).toBe(0);
	} finally {
		await runtime.retireFixture();
	}
});
it("product cancellation reconstructs a missing follow-up and closes its sequence without skipping the initial prompt", async () => {
	await candidateCredential();
	const calls = modelReplies();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const second = await env.CandidateProduct.admitOwned("owner", {
		version: 2,
		kind: "follow_up",
		projectId: "project",
		sessionId: first.workspaceSessionId,
		targetRunId: first.commandId,
		idempotencyKey: "canceled",
		text: "Synthetic canceled input",
	});
	const cancel = await env.CandidateProduct.admitOwned("owner", {
		version: 2,
		kind: "cancel",
		projectId: "project",
		sessionId: first.workspaceSessionId,
		targetCommandId: second.commandId,
		idempotencyKey: "cancel",
	});
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		await runtime.deliverCommand(cancel.commandId, 1);
		expect((await runtime.candidateSnapshot()).submissions).toHaveLength(0);
		await runtime.deliverCommand(first.commandId, 1);
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).members[0]?.state, {
				timeout: 3000,
			})
			.toBe("complete");
		const ack = await runtime.deliverCommand(second.commandId, 1);
		await runtime.reopenFixture();
		expect(await runtime.deliverCommand(second.commandId, 1)).toEqual(ack);
		const snapshot = await runtime.candidateSnapshot();
		expect(snapshot.members.map((row) => row.state)).toEqual([
			"complete",
			"failed",
		]);
		expect(snapshot.submissions).toHaveLength(1);
		expect(calls()).toBe(1);
	} finally {
		await runtime.retireFixture();
	}
});

it.each([
	"acknowledged",
	"lost-ack",
	"replacement",
])("credential-local %s barrier denies a held real positive final permit after host claim", async (mode) => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.armCandidateFinal();
	const receipt = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(receipt.workspaceSessionId);
	try {
		await env.CandidateProduct.drain();
		expect(await credential.waitCandidateFinal()).toBe(true);
		const descriptor = await credential.candidateFinalDescriptor();
		const validRequest = await credential.candidateFinalRequest();
		expect(descriptor).toBeDefined();
		if (!descriptor) throw new Error("missing_final_descriptor");
		const claims = await runInDurableObject(runtime, (_instance, state) =>
			state.storage.sql
				.exec("SELECT effect,claimed FROM host_model_dispatch")
				.toArray(),
		);
		expect(claims).toEqual([
			{ effect: descriptor.attempt.effectId, claimed: 1 },
		]);
		expect(calls()).toBe(0);
		const resetId = crypto.randomUUID();
		const close = () =>
			credential.closeCandidateDispatch(
				descriptor.subject,
				descriptor.attempt.generation,
				resetId,
			);
		if (mode === "lost-ack") await close().then(() => undefined);
		const receiptOfClosure = await close();
		expect(receiptOfClosure).toMatchObject({
			generation: 1,
			resetId,
			phase: "closed",
		});
		expect(await close()).toEqual(receiptOfClosure);
		await credential.releaseCandidateFinal();
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).members[0]?.state, {
				timeout: 3000,
			})
			.not.toBe("pending");
		expect(calls()).toBe(0);
		if (mode === "replacement") {
			await expect(
				runInDurableObject(credential, async (_instance, state) => {
					await state.storage.sync();
					state.abort("008-credential-fence-replacement");
				}),
			).rejects.toMatchObject({
				message: "008-credential-fence-replacement",
				durableObjectReset: true,
			});
			const replacement = env.CandidateCredential.getByName("owner");
			expect(
				await replacement.closeCandidateDispatch(
					descriptor.subject,
					1,
					resetId,
				),
			).toEqual(receiptOfClosure);
			expect(
				await runInDurableObject(replacement, async (instance) =>
					instance.requestModel(validRequest, {
						describe: async () => descriptor,
						claim: async () => {
							throw new Error("closed_preparation_claimed");
						},
						halt: async () => ({ status: "denied" as const }),
					}),
				),
			).toEqual({ version: 1, status: "denied" });
			expect(calls()).toBe(0);
		}
	} finally {
		await env.CandidateCredential.getByName("owner").releaseCandidateFinal();
		await runtime.retireFixture();
	}
});

it.each([
	false,
	true,
])("private fixture reset preserves immutable host origin and discarded observation=%s", async (discard) => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.armClaimAck();
	const receipt = await env.CandidateProduct.admitOwned("owner", prompt);
	let runtime = env.CandidateSessions.getByName(receipt.workspaceSessionId);
	await runtime.holdFixtureJoin();
	await env.CandidateProduct.reserveCandidateReset(receipt.commandId);
	try {
		await env.CandidateProduct.drain();
		expect(await credential.waitClaimAck()).toBe(true);
		const before = await runtime.fixtureProof();
		expect(["active", "draining", "closed"]).toContain(
			before.predecessor.state,
		);
		expect(before.origin).toBe(before.boot);
		expect(before.predecessor.generation).toBe(1);
		expect(calls()).toBe(0);
		const reset = await env.CandidateProduct.resetCandidate(
			receipt.commandId,
			discard,
		);
		expect(reset.phase).toBe(discard ? "intent" : "issued");
		runtime = env.CandidateSessions.getByName(receipt.workspaceSessionId);
		const after = await runtime.fixtureProof();
		expect(after.boot).not.toBe(before.boot);
		expect(after.origin).toBe(before.origin);
		const { state: _settlement, ...boundPredecessor } = before.predecessor;
		expect(after.predecessor).toMatchObject(boundPredecessor);
		expect(["active", "draining", "closed"]).toContain(after.predecessor.state);
		const authority = await env.CandidateProduct.readRuntimeAuthority(
			before.scope,
		);
		expect(authority.generation).toBe(discard ? 1 : 2);
		expect(authority.priorTerminated).toBe(
			discard ? undefined : before.predecessor.id,
		);
		if (discard) {
			if (after.predecessor.state === "closed")
				expect((await runtime.candidateSnapshot()).invocations).toHaveLength(1);
			else
				await expect(
					runInDurableObject(runtime, (instance) =>
						instance.candidateSnapshot(),
					),
				).rejects.toThrow("Prior host termination required");
			expect(
				await runInDurableObject(
					runtime,
					(_instance, state) =>
						state.storage.sql
							.exec("SELECT phase FROM candidate_fixture_gate WHERE id=1")
							.one().phase,
				),
			).toBe("blocked");
			expect(
				await env.CandidateProduct.recoverCandidate(reset.resetId),
			).toEqual({ resetId: reset.resetId, phase: "denied" });
			await runInDurableObject(runtime, async (_instance, state) => {
				await state.storage.deleteAlarm();
				await state.storage.sync();
			});
		} else {
			expect(authority.current).toBe(true);
			const retained = await env.DB.prepare(
				"SELECT observation FROM candidate_fixture_resets WHERE resetId=?",
			)
				.bind(reset.resetId)
				.first<{ observation: string }>();
			if (!retained) throw new Error("missing_reset_observation");
			await env.DB.prepare(
				"UPDATE candidate_fixture_resets SET observation=NULL WHERE resetId=?",
			)
				.bind(reset.resetId)
				.run();
			const missing = await env.CandidateProduct.readRuntimeAuthority(
				before.scope,
			);
			expect(missing.generation).toBe(1);
			expect(missing.priorTerminated).toBeUndefined();
			await env.DB.prepare(
				"UPDATE candidate_fixture_resets SET observation=? WHERE resetId=?",
			)
				.bind(
					JSON.stringify({
						...JSON.parse(retained.observation),
						predecessor: "wrong",
					}),
					reset.resetId,
				)
				.run();
			expect(
				(await env.CandidateProduct.readRuntimeAuthority(before.scope)).current,
			).toBe(false);
			await env.DB.prepare(
				"UPDATE candidate_fixture_resets SET observation=? WHERE resetId=?",
			)
				.bind(retained.observation, reset.resetId)
				.run();
			const identity = await env.DB.prepare(
				"SELECT incarnationId FROM sandbox_identities WHERE workspaceSessionId=?",
			)
				.bind(receipt.workspaceSessionId)
				.first<{ incarnationId: string }>();
			if (!identity) throw new Error("missing_owned_executor");
			await env.DB.prepare(
				"UPDATE sandbox_identities SET incarnationId='changed' WHERE workspaceSessionId=?",
			)
				.bind(receipt.workspaceSessionId)
				.run();
			expect(
				(await env.CandidateProduct.readRuntimeAuthority(before.scope)).current,
			).toBe(false);
			await env.DB.prepare(
				"UPDATE sandbox_identities SET incarnationId=? WHERE workspaceSessionId=?",
			)
				.bind(identity.incarnationId, receipt.workspaceSessionId)
				.run();
			expect(
				(await env.CandidateProduct.readRuntimeAuthority(before.scope)).current,
			).toBe(true);
			expect(
				await env.CandidateProduct.recoverCandidate(reset.resetId),
			).toMatchObject({ generation: 2, phase: "fenced" });
			const recovered = await runtime.fixtureProof();
			expect(recovered.predecessor.id).toBe(before.predecessor.id);
			expect(recovered.predecessor.state).toBe("closed");
			expect((await runtime.candidateSnapshot()).invocations).toHaveLength(1);
			expect((await runtime.candidateSnapshot()).effects).toHaveLength(1);
			expect(
				await runInDurableObject(
					runtime,
					(_instance, state) =>
						state.storage.sql
							.exec("SELECT phase FROM candidate_fixture_gate WHERE id=1")
							.one().phase,
				),
			).toBe("ready");
		}
		expect(calls()).toBe(0);
	} finally {
		await credential.releaseClaimAck();
		expect((await credential.waitCandidateOutcome())?.status).toBe("denied");
		await runtime.releaseFixtureJoin();
		await runtime.retireFixture();
		await runInDurableObject(runtime, async (_instance, state) => {
			await state.storage.deleteAlarm();
			await state.storage.sync();
		});
	}
});

it("private fixture recovery activates only the exact current successor and a valid old descriptor stays denied", async () => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.armCandidateFinal();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	let runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	await runtime.holdFixtureJoin();
	await env.CandidateProduct.reserveCandidateReset(first.commandId);
	try {
		await env.CandidateProduct.drain();
		await runtime.waitFixtureJoin();
		expect(await credential.waitCandidateFinal()).toBe(true);
		const descriptor = await credential.candidateFinalDescriptor();
		const validRequest = await credential.candidateFinalRequest();
		if (!descriptor) throw new Error("missing_final_descriptor");
		await credential.releaseCandidateFinal();
		expect((await credential.waitCandidateOutcome())?.status).toBe("complete");
		await expect
			.poll(
				async () => {
					await runtime.reconcileFixture();
					return (await runtime.candidateSnapshot()).members[0]?.state;
				},
				{ timeout: 1000 },
			)
			.toBe("complete");
		const predecessor = await runtime.fixtureProof();
		expect(predecessor.predecessor.state).toBe("active");
		const reset = await env.CandidateProduct.resetCandidate(first.commandId);
		expect(reset.phase).toBe("issued");
		runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
		expect(
			await env.CandidateProduct.recoverCandidate(reset.resetId),
		).toMatchObject({ phase: "active", generation: 2 });
		const recovered = await runtime.fixtureProof();
		expect(recovered.boot).not.toBe(predecessor.boot);
		expect(recovered.origin).toBe(predecessor.origin);
		expect(recovered.predecessor.state).toBe("closed");
		expect(
			await runInDurableObject(credential, (instance) =>
				instance.requestModel(validRequest, {
					describe: async () => descriptor,
					claim: async () => {
						throw new Error("stale_generation_claimed");
					},
					halt: async () => ({ status: "denied" as const }),
				}),
			),
		).toEqual({ version: 1, status: "denied" });
		expect(calls()).toBe(1);
		const next = await env.CandidateProduct.admitOwned("owner", {
			...prompt,
			sessionId: first.workspaceSessionId,
			idempotencyKey: "after-recovery",
			text: "Synthetic successor input",
		});
		await env.CandidateProduct.drain();
		await expect
			.poll(
				async () =>
					(await runtime.candidateSnapshot()).members.find(
						(row) => row.assistant === next.assistantMessageId,
					)?.state,
				{ timeout: 3000 },
			)
			.toBe("complete");
		expect(calls()).toBe(2);
		expect((await runtime.fixtureProof()).predecessor.generation).toBe(2);
		await expect
			.poll(async () => (await runtime.fixtureProof()).predecessor.state, {
				timeout: 3000,
			})
			.toBe("closed");
		await expect(
			runInDurableObject(runtime, async (_instance, state) => {
				await state.storage.sync();
				state.abort("008-closed-successor-replacement");
			}),
		).rejects.toMatchObject({
			message: "008-closed-successor-replacement",
			durableObjectReset: true,
		});
		runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
		await expect(
			runInDurableObject(runtime, (instance) =>
				instance.acknowledgeFixtureRecovery(reset.resetId, 2, recovered.boot),
			),
		).rejects.toThrow("fixture_recovery_boot_denied");
		expect(
			await env.CandidateProduct.recoverCandidate(reset.resetId),
		).toMatchObject({ phase: "active", generation: 2 });
		expect(calls()).toBe(2);
	} finally {
		await credential.releaseCandidateFinal();
		await runtime.releaseFixtureJoin();
		await runtime.retireFixture();
	}
});

it("generation-2 admission denies a missing credential fence without fallback or effect refund", async () => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.armCandidateFinal();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	let runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	await runtime.holdFixtureJoin();
	await env.CandidateProduct.reserveCandidateReset(first.commandId);
	try {
		await env.CandidateProduct.drain();
		await runtime.waitFixtureJoin();
		expect(await credential.waitCandidateFinal()).toBe(true);
		const descriptor = await credential.candidateFinalDescriptor();
		if (!descriptor) throw new Error("missing_final_descriptor");
		await credential.releaseCandidateFinal();
		expect((await credential.waitCandidateOutcome())?.status).toBe("complete");
		await expect
			.poll(
				async () => {
					await runtime.reconcileFixture();
					return (await runtime.candidateSnapshot()).members[0]?.state;
				},
				{ timeout: 1000 },
			)
			.toBe("complete");
		const reset = await env.CandidateProduct.resetCandidate(first.commandId);
		expect(reset.phase).toBe("issued");
		runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
		expect(
			await env.CandidateProduct.recoverCandidate(reset.resetId),
		).toMatchObject({ phase: "active", generation: 2 });
		const scope = candidateDispatchScope(descriptor.subject);
		await runInDurableObject(credential, async (_instance, state) => {
			expect(
				state.storage.sql
					.exec(
						"SELECT generation,phase FROM candidate_dispatch_fences WHERE scope=?",
						scope,
					)
					.one(),
			).toMatchObject({ generation: 2, phase: "active" });
			state.storage.sql.exec(
				"DELETE FROM candidate_dispatch_fences WHERE scope=? AND generation=2",
				scope,
			);
			await state.storage.sync();
		});
		const beforeCalls = calls();
		expect(beforeCalls).toBe(1);
		await credential.armCandidateFinal();
		const next = await env.CandidateProduct.admitOwned("owner", {
			...prompt,
			sessionId: first.workspaceSessionId,
			idempotencyKey: "missing-generation-2-fence",
			text: "Synthetic successor denial",
		});
		await env.CandidateProduct.drain();
		expect(await credential.waitCandidateFinal()).toBe(false);
		expect((await credential.waitCandidateOutcome())?.status).toBe("denied");
		await expect
			.poll(
				async () =>
					(await runtime.candidateSnapshot()).members.find(
						(row) => row.assistant === next.assistantMessageId,
					)?.state,
				{ timeout: 3000 },
			)
			.toBe("failed");
		expect(calls()).toBe(beforeCalls);
		expect((await runtime.fixtureProof()).predecessor.generation).toBe(2);
		expect(
			await runInDurableObject(credential, (_instance, state) =>
				state.storage.sql
					.exec(
						"SELECT generation FROM candidate_dispatch_fences WHERE scope=?",
						scope,
					)
					.toArray(),
			),
		).toEqual([]);
		const occupied = await runInDurableObject(runtime, (_instance, state) =>
			state.storage.sql
				.exec(
					"SELECT e.id,e.state,d.claimed FROM host_effects e JOIN host_model_dispatch d ON d.effect=e.id JOIN host_effect_route r ON r.id=e.id WHERE r.run=?",
					next.commandId,
				)
				.toArray(),
		);
		expect(occupied).toHaveLength(1);
		expect(occupied[0]).toMatchObject({ state: "admitted", claimed: 0 });
		await runtime.reconcileFixture();
		expect(
			await runInDurableObject(runtime, (_instance, state) =>
				state.storage.sql
					.exec(
						"SELECT e.id,e.state,d.claimed FROM host_effects e JOIN host_model_dispatch d ON d.effect=e.id JOIN host_effect_route r ON r.id=e.id WHERE r.run=?",
						next.commandId,
					)
					.toArray(),
			),
		).toEqual(occupied);
	} finally {
		await credential.releaseCandidateFinal();
		await runtime.releaseFixtureJoin();
		await runtime.retireFixture();
	}
});

it("credential-local final gate preserves the original positive permit window across a held response", async () => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.holdModel("claim");
	await credential.armCandidateFinal();
	const receipt = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(receipt.workspaceSessionId);
	try {
		await env.CandidateProduct.drain();
		await credential.waitModel();
		const expiry = Date.now() + 500;
		await env.DB.prepare(
			"UPDATE privileged_operations SET expiresAt=min(expiresAt,?) WHERE openSlot='open' AND family='model'",
		)
			.bind(expiry)
			.run();
		await credential.releaseModel();
		expect(await credential.waitCandidateFinal()).toBe(true);
		expect(await credential.candidateFinalDescriptor()).toBeDefined();
		await new Promise((resolve) =>
			setTimeout(resolve, Math.max(0, expiry - Date.now()) + 25),
		);
		await credential.releaseCandidateFinal();
		expect((await credential.waitCandidateOutcome())?.status).toBe("denied");
		expect(calls()).toBe(0);
	} finally {
		await credential.releaseModel();
		await credential.releaseCandidateFinal();
		await runtime.retireFixture();
	}
});

it("priority Stop through transport beats held default configuration without creating a root", async () => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.holdCandidateConfiguration();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		await env.CandidateProduct.drain();
		await credential.waitCandidateConfiguration();
		const stop = await env.CandidateProduct.admitOwned("owner", {
			version: 2,
			kind: "stop",
			projectId: "project",
			sessionId: first.workspaceSessionId,
			targetRunId: first.commandId,
			idempotencyKey: "held-configuration-stop",
		});
		const ack = await runtime.deliverCommand(stop.commandId, 1);
		const fenced = await runtime.candidateSnapshot();
		expect(fenced.runs).toMatchObject([{ id: first.commandId, epoch: 2 }]);
		expect(fenced.conversations).toBe(0);
		await credential.releaseCandidateConfiguration();
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).members[0]?.state, {
				timeout: 3000,
			})
			.toBe("failed");
		expect(await runtime.deliverCommand(stop.commandId, 1)).toEqual(ack);
		expect((await runtime.candidateSnapshot()).runs[0]?.epoch).toBe(2);
		expect(calls()).toBe(0);
	} finally {
		await credential.releaseCandidateConfiguration();
		await runtime.retireFixture();
	}
});

it("queued configuration uses the next selection across a sequence gap and preserves committed preparation", async () => {
	const credential = await candidateCredential();
	await env.DB.prepare(
		"UPDATE codex_fixture_capabilities SET snapshot=? WHERE userId='owner'",
	)
		.bind(
			JSON.stringify({
				...account,
				models: [
					{ id: "faux-1", thinking: ["off"] },
					{ id: "faux-2", thinking: ["off"] },
				],
			}),
		)
		.run();
	const calls = modelReplies();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const second = await env.CandidateProduct.admitOwned("owner", {
		version: 2,
		kind: "follow_up",
		projectId: "project",
		sessionId: first.workspaceSessionId,
		targetRunId: first.commandId,
		idempotencyKey: "queued-config-second",
		text: "Synthetic queued second",
	});
	const third = await env.CandidateProduct.admitOwned("owner", {
		version: 2,
		kind: "follow_up",
		projectId: "project",
		sessionId: first.workspaceSessionId,
		targetRunId: first.commandId,
		idempotencyKey: "queued-config-third",
		text: "Synthetic queued third",
	});
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		await runtime.deliverCommand(third.commandId, 1);
		await runtime.deliverCommand(first.commandId, 1);
		await expect
			.poll(
				async () =>
					(await runtime.candidateSnapshot()).members.map((row) => row.state),
				{ timeout: 3000 },
			)
			.toEqual(["complete", "pending"]);
		const prepared = parseSyntheticModelRequestV1(
			await credential.candidateFinalRequest(),
		);
		expect(JSON.parse(prepared.body)).toMatchObject({ model: "faux-1" });
		const task = await runInDurableObject(runtime, (_instance, state) =>
			state.storage.sql
				.exec("SELECT task,prepared,selection FROM host_tasks ORDER BY task")
				.toArray(),
		);
		await runtime.reopenFixture();
		expect(
			await runtime.configureFixture(
				{
					version: 1,
					intentId: "next-model",
					projectId: "project",
					workspaceSessionId: first.workspaceSessionId,
					ownerVersion: 1,
					selection: { model: "faux-2", thinking: "off" },
				},
				first.commandId,
			),
		).toMatchObject({ status: "applied" });
		expect(
			await runInDurableObject(runtime, (_instance, state) =>
				state.storage.sql
					.exec("SELECT task,prepared,selection FROM host_tasks ORDER BY task")
					.toArray(),
			),
		).toEqual(task);
		await runtime.deliverCommand(second.commandId, 1);
		await expect
			.poll(
				async () =>
					(await runtime.candidateSnapshot()).members.map((row) => row.state),
				{ timeout: 3000 },
			)
			.toEqual(["complete", "complete", "complete"]);
		expect(
			JSON.parse(
				parseSyntheticModelRequestV1(await credential.candidateFinalRequest())
					.body,
			),
		).toMatchObject({ model: "faux-2" });
		expect(calls()).toBe(3);
	} finally {
		await runtime.retireFixture();
	}
});

it("three real candidate contract denials persist review and halt the exact admitted host without fetch", async () => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.armCandidateDenials();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		await env.CandidateProduct.drain();
		await expect
			.poll(
				async () =>
					(
						await env.DB.prepare(
							"SELECT runtimeFailureReasonCode FROM workspace_sessions WHERE id=?",
						)
							.bind(first.workspaceSessionId)
							.first()
					)?.runtimeFailureReasonCode,
				{ timeout: 3000 },
			)
			.toBe("model_contract_review");
		expect((await credential.waitCandidateOutcome())?.status).toBe("denied");
		expect(
			await env.DB.prepare(
				"SELECT contractDenials,closeReason FROM privileged_operations WHERE family='model'",
			).first(),
		).toMatchObject({ contractDenials: 3, closeReason: "contract_denials" });
		const actual = await runInDurableObject(runtime, (_instance, state) => ({
			runs: state.storage.sql
				.exec("SELECT id,epoch,state FROM host_runs")
				.toArray(),
			members: state.storage.sql
				.exec("SELECT assistant,state FROM host_members")
				.toArray(),
		}));
		expect(actual.runs).toMatchObject([
			{ id: first.commandId, epoch: 2, state: "failed" },
		]);
		expect(actual.members).toMatchObject([
			{ assistant: first.assistantMessageId, state: "failed" },
		]);
		expect(calls()).toBe(0);
	} finally {
		await runtime.retireFixture();
	}
});

it.each([
	"started",
	"expired",
] as const)("real D1 lost %s acknowledgment retains one fate and the original queue deadline", async (fate) => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	const first = await commands(
		() => Date.now() - (fate === "started" ? 899000 : 900001),
	).admit("owner", prompt);
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	await credential.loseDecisionAck(first.commandId);
	try {
		const ack = await runtime.deliverCommand(first.commandId, 1);
		await expect
			.poll(
				async () =>
					(
						await env.DB.prepare(
							"SELECT decision FROM candidate_command_decisions WHERE commandId=?",
						)
							.bind(first.commandId)
							.first()
					)?.decision,
				{ timeout: 3000 },
			)
			.toBe(fate);
		const decision = await env.DB.prepare(
			"SELECT * FROM candidate_command_decisions WHERE commandId=?",
		)
			.bind(first.commandId)
			.first();
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).members[0]?.state, {
				timeout: 3000,
			})
			.toBe(fate === "started" ? "complete" : "failed");
		await runtime.reopenFixture();
		expect(await runtime.deliverCommand(first.commandId, 1)).toEqual(ack);
		expect(
			await env.DB.prepare(
				"SELECT * FROM candidate_command_decisions WHERE commandId=?",
			)
				.bind(first.commandId)
				.first(),
		).toEqual(decision);
		expect((await runtime.candidateSnapshot()).submissions).toHaveLength(
			fate === "started" ? 1 : 0,
		);
		expect(calls()).toBe(fate === "started" ? 1 : 0);
	} finally {
		await runtime.retireFixture();
	}
});

it.each([
	"candidate-control-intent",
	"candidate-control-outcome",
] as const)("real admitted Stop repairs %s interruption and retains its epoch and projection", async (point) => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.holdModel("claim");
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		await env.CandidateProduct.drain();
		await credential.waitModel();
		const stop = await env.CandidateProduct.admitOwned("owner", {
			version: 2,
			kind: "stop",
			projectId: "project",
			sessionId: first.workspaceSessionId,
			targetRunId: first.commandId,
			idempotencyKey: point,
		});
		await runtime.armControlFault(point);
		await expect(
			runInDurableObject(runtime, (instance) =>
				instance.deliverCommand(stop.commandId, 1),
			),
		).rejects.toThrow(`fixture_${point}`);
		const before = await runtime.candidateSnapshot();
		expect(before.runs[0]?.epoch).toBe(2);
		const ack = await runtime.deliverCommand(stop.commandId, 1);
		await credential.releaseModel();
		await runtime.reopenFixture();
		expect(await runtime.deliverCommand(stop.commandId, 1)).toEqual(ack);
		const after = await runtime.candidateSnapshot();
		expect(after.runs[0]?.epoch).toBe(2);
		expect(after.members).toMatchObject([
			{ assistant: first.assistantMessageId, state: "failed" },
		]);
		expect(after.projections).toMatchObject([
			{ assistant: first.assistantMessageId, state: "failed" },
		]);
		expect(calls()).toBe(0);
	} finally {
		await credential.releaseModel();
		await runtime.retireFixture();
	}
});

it("transport cancellation after start is too late and delayed old Stop cannot revoke a newer run", async () => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.holdModel("authority");
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		await env.CandidateProduct.drain();
		await credential.waitModel();
		const cancel = await env.CandidateProduct.admitOwned("owner", {
			version: 2,
			kind: "cancel",
			projectId: "project",
			sessionId: first.workspaceSessionId,
			targetCommandId: first.commandId,
			idempotencyKey: "too-late",
		});
		const ack = await runtime.deliverCommand(cancel.commandId, 1);
		expect((await runtime.candidateSnapshot()).runs[0]?.epoch).toBe(1);
		await credential.releaseModel();
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).members[0]?.state, {
				timeout: 3000,
			})
			.toBe("complete");
		await runtime.reopenFixture();
		expect(await runtime.deliverCommand(cancel.commandId, 1)).toEqual(ack);
		await credential.holdModel("authority");
		const next = await env.CandidateProduct.admitOwned("owner", {
			...prompt,
			sessionId: first.workspaceSessionId,
			idempotencyKey: "new-run",
		});
		await env.CandidateProduct.drain();
		await credential.waitModel();
		const stop = await env.CandidateProduct.admitOwned("owner", {
			version: 2,
			kind: "stop",
			projectId: "project",
			sessionId: first.workspaceSessionId,
			targetRunId: first.commandId,
			idempotencyKey: "delayed-old-stop",
		});
		await runtime.deliverCommand(stop.commandId, 1);
		expect(
			(await runtime.candidateSnapshot()).runs.find(
				(row) => row.id === next.commandId,
			),
		).toMatchObject({ epoch: 1, state: "running" });
		await credential.releaseModel();
		await expect
			.poll(
				async () =>
					(await runtime.candidateSnapshot()).members.map((row) => row.state),
				{ timeout: 3000 },
			)
			.toEqual(["complete", "complete"]);
		expect(calls()).toBe(2);
	} finally {
		await credential.releaseModel();
		await runtime.retireFixture();
	}
});

it.each([
	"UPDATE sandbox_identities SET incarnationId='changed'",
	"UPDATE workspace_sessions SET runtimeProtocolVersion=1",
	"INSERT INTO runtime_deleted_target_fences VALUES('project','project',1,0)",
])("fresh mutable authority denies a prepared real request: %s", async (mutation) => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.holdModel("authority");
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		await env.CandidateProduct.drain();
		await credential.waitModel();
		await env.DB.exec(mutation);
		await credential.releaseModel();
		expect((await credential.waitCandidateOutcome())?.status).toBe("denied");
		await expect
			.poll(
				() =>
					runInDurableObject(
						runtime,
						(_instance, state) =>
							state.storage.sql.exec("SELECT state FROM host_members").one()
								.state,
					),
				{ timeout: 3000 },
			)
			.toBe("failed");
		expect(calls()).toBe(0);
		expect(
			(
				await env.DB.prepare(
					"SELECT count(*) AS n FROM candidate_workspace_claims",
				).first()
			)?.n,
		).toBe(1);
	} finally {
		await credential.releaseModel();
		await runtime.retireFixture();
	}
});

it("a natural replacement cannot certify the original host invocation or close an unrelated scope", async () => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.armClaimAck();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	let runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	await runtime.holdFixtureJoin();
	await env.CandidateProduct.reserveCandidateReset(first.commandId);
	try {
		await env.CandidateProduct.drain();
		expect(await credential.waitClaimAck()).toBe(true);
		const subject = await env.CandidateProduct.readCandidateSubject(
			first.commandId,
			1,
		);
		if (!subject) throw new Error("missing_owned_subject");
		const original = await runtime.fixtureProof();
		await expect(
			runInDurableObject(credential, (instance) =>
				instance.closeCandidateDispatch(
					{ ...subject, workspaceSessionId: "foreign" },
					1,
					crypto.randomUUID(),
				),
			),
		).rejects.toThrow("candidate_dispatch_denied");
		await expect(
			runInDurableObject(runtime, async (_instance, state) => {
				await state.storage.sync();
				state.abort("008-unobserved-origin");
			}),
		).rejects.toMatchObject({
			message: "008-unobserved-origin",
			durableObjectReset: true,
		});
		runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
		const replacement = await runtime.fixtureProof();
		expect(replacement.boot).not.toBe(original.origin);
		expect(replacement.origin).toBe(original.origin);
		expect(
			await env.CandidateProduct.resetCandidate(first.commandId),
		).toMatchObject({ phase: "denied" });
		const authority = await env.CandidateProduct.readRuntimeAuthority(
			original.scope,
		);
		expect(authority.generation).toBe(1);
		expect(authority.priorTerminated).toBeUndefined();
		await expect(
			runInDurableObject(runtime, (instance) => instance.candidateSnapshot()),
		).rejects.toThrow("Prior host termination required");
		expect(calls()).toBe(0);
	} finally {
		await credential.releaseClaimAck();
		await credential.waitCandidateOutcome();
		await runtime.releaseFixtureJoin();
		await runtime.retireFixture();
		await runInDurableObject(runtime, async (_instance, state) => {
			await state.storage.deleteAlarm();
			await state.storage.sync();
		});
	}
});

it("private recovery scans every control through the cutoff and repairs an already delivered partial Stop", async () => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.armClaimAck();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const follow = await env.CandidateProduct.admitOwned("owner", {
		version: 2,
		kind: "follow_up",
		projectId: "project",
		sessionId: first.workspaceSessionId,
		targetRunId: first.commandId,
		idempotencyKey: "recovery-follow",
		text: "Synthetic undelivered recovery member",
	});
	const stop = await env.CandidateProduct.admitOwned("owner", {
		version: 2,
		kind: "stop",
		projectId: "project",
		sessionId: first.workspaceSessionId,
		targetRunId: first.commandId,
		idempotencyKey: "recovery-partial-stop",
	});
	const cancel = await env.CandidateProduct.admitOwned("owner", {
		version: 2,
		kind: "cancel",
		projectId: "project",
		sessionId: first.workspaceSessionId,
		targetCommandId: follow.commandId,
		idempotencyKey: "recovery-cancel",
	});
	const laterStop = await env.CandidateProduct.admitOwned("owner", {
		version: 2,
		kind: "stop",
		projectId: "project",
		sessionId: first.workspaceSessionId,
		targetRunId: first.commandId,
		idempotencyKey: "recovery-later-stop",
	});
	let runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		await runtime.holdFixtureJoin();
		await env.CandidateProduct.reserveCandidateReset(first.commandId);
		await runtime.deliverCommand(first.commandId, 1);
		expect(await credential.waitClaimAck()).toBe(true);
		await runtime.armControlFault("candidate-control-intent");
		await expect(
			runInDurableObject(runtime, (instance) =>
				instance.deliverCommand(stop.commandId, 1),
			),
		).rejects.toThrow("fixture_candidate-control-intent");
		const old = await runtime.fixtureProof();
		const reset = await env.CandidateProduct.resetCandidate(first.commandId);
		expect(reset.phase).toBe("issued");
		runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
		expect(
			await env.CandidateProduct.recoverCandidate(reset.resetId),
		).toMatchObject({ generation: 2, phase: "fenced" });
		const [firstPage, finalPage, snapshot] = await Promise.all([
			env.CandidateProduct.fixtureControls(old.scope, laterStop.commandSeq, 0),
			env.CandidateProduct.fixtureControls(
				old.scope,
				laterStop.commandSeq,
				cancel.commandSeq,
			),
			runtime.candidateSnapshot(),
		]);
		expect(firstPage.commandIds).toEqual([stop.commandId, cancel.commandId]);
		expect(firstPage.after).toBe(cancel.commandSeq);
		expect(firstPage.end).toBe(false);
		expect(finalPage).toMatchObject({
			commandIds: [laterStop.commandId],
			end: true,
		});
		expect(snapshot.runs[0]?.epoch).toBe(2);
		expect(snapshot.members.map((row) => row.state)).toEqual([
			"failed",
			"failed",
		]);
		expect(snapshot.submissions).toHaveLength(1);
		expect(snapshot.invocations).toHaveLength(1);
		expect(snapshot.effects).toHaveLength(1);
		expect(await runtime.deliverCommand(stop.commandId, 1)).toMatchObject({
			receiptId: stop.receiptId,
		});
		expect((await runtime.candidateSnapshot()).runs[0]?.epoch).toBe(2);
		expect(calls()).toBe(0);
	} finally {
		await credential.releaseClaimAck();
		await credential.waitCandidateOutcome();
		await runtime.releaseFixtureJoin();
		await runtime.retireFixture();
	}
});

it("an unclosed successor needs its own reset proof and cannot reuse the older witness", async () => {
	const credential = await candidateCredential();
	const calls = modelReplies();
	await credential.armCandidateFinal();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	let runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	await runtime.holdFixtureJoin();
	await env.CandidateProduct.reserveCandidateReset(first.commandId);
	try {
		await runtime.deliverCommand(first.commandId, 1);
		await runtime.waitFixtureJoin();
		expect(await credential.waitCandidateFinal()).toBe(true);
		await credential.releaseCandidateFinal();
		await credential.waitCandidateOutcome();
		await expect
			.poll(
				async () => {
					await runtime.reconcileFixture();
					return (await runtime.candidateSnapshot()).members[0]?.state;
				},
				{ timeout: 1000 },
			)
			.toBe("complete");
		const firstReset = await env.CandidateProduct.resetCandidate(
			first.commandId,
		);
		runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
		expect(
			await env.CandidateProduct.recoverCandidate(firstReset.resetId),
		).toMatchObject({ generation: 2, phase: "active" });
		await runtime.holdFixtureJoin();
		await credential.armClaimAck();
		const next = await env.CandidateProduct.admitOwned("owner", {
			...prompt,
			sessionId: first.workspaceSessionId,
			idempotencyKey: "unclosed-successor",
		});
		await runtime.deliverCommand(next.commandId, 1);
		await runtime.waitFixtureJoin();
		const successor = await runtime.fixtureProof();
		expect(successor.predecessor.state).toBe("active");
		const subject = await env.CandidateProduct.readCandidateSubject(
			next.commandId,
			1,
		);
		if (!subject) throw new Error("missing_successor_subject");
		await credential.closeCandidateDispatch(subject, 2, crypto.randomUUID());
		expect(successor.predecessor.generation).toBe(2);
		expect(successor.origin).toBe(successor.boot);
		await expect(
			runInDurableObject(runtime, async (_instance, state) => {
				await state.storage.sync();
				state.abort("008-unobserved-successor");
			}),
		).rejects.toMatchObject({
			message: "008-unobserved-successor",
			durableObjectReset: true,
		});
		runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
		await expect(
			runInDurableObject(runtime, (instance) => instance.candidateSnapshot()),
		).rejects.toThrow("Prior host termination required");
		expect(
			await env.CandidateProduct.recoverCandidate(firstReset.resetId),
		).toMatchObject({ phase: "denied" });
		const authority = await env.CandidateProduct.readRuntimeAuthority(
			successor.scope,
		);
		expect(authority.generation).toBe(2);
		expect(authority.priorTerminated).not.toBe(successor.predecessor.id);
		expect((await runtime.fixtureProof()).predecessor).toEqual(
			successor.predecessor,
		);
		expect(calls()).toBe(1);
		expect(
			(
				await env.DB.prepare(
					"SELECT count(*) AS n FROM candidate_fixture_resets",
				).first()
			)?.n,
		).toBe(1);
		expect(next.commandId).not.toBe(first.commandId);
	} finally {
		await credential.releaseCandidateFinal();
		await credential.releaseClaimAck();
		await credential.waitCandidateOutcome();
		await runInDurableObject(runtime, async (_instance, state) => {
			await state.storage.deleteAlarm();
			await state.storage.sync();
		});
	}
});

const SENTINEL = "sk-synthetic0projection0sentinel0value";
async function message(id: string | undefined) {
	return env.DB.prepare("SELECT status,content FROM messages WHERE id=?")
		.bind(id ?? "")
		.first<{ status: string; content: string }>();
}

it("settles a completed assistant in D1 from a durable projection with redacted content and owned observation", async () => {
	await candidateCredential();
	const calls = modelReplies();
	replyText = `Synthetic answer ${SENTINEL} done`;
	const receipt = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(receipt.workspaceSessionId);
	try {
		await env.CandidateProduct.drain();
		await expect
			.poll(async () => (await message(receipt.assistantMessageId))?.status, {
				timeout: 5000,
			})
			.toBe("complete");
		const settled = await message(receipt.assistantMessageId);
		expect(settled?.content).toBe("Synthetic answer [REDACTED] done");
		expect(JSON.stringify(settled)).not.toContain(SENTINEL);
		expect(calls()).toBe(1);
		expect((await runtime.candidateSnapshot()).projections).toMatchObject([
			{ assistant: receipt.assistantMessageId, state: "complete", applied: 1 },
		]);
		await runtime.retireFixture();
		const before = await runtime.fixtureWakeState();
		const observed = await env.CandidateProduct.observeOwned(
			"owner",
			"project",
			receipt.workspaceSessionId,
		);
		expect(observed.snapshot).toMatchObject({
			runs: [{ id: receipt.commandId, state: "complete" }],
			assistants: [
				{
					id: receipt.assistantMessageId,
					state: "complete",
					reason: null,
					applied: true,
				},
			],
			health: { projectionLag: 0, safetyStopped: false },
		});
		expect(JSON.stringify(observed)).not.toContain(SENTINEL);
		expect(JSON.stringify(observed)).not.toContain(prompt.text);
		const events = await env.CandidateProduct.observeOwned(
			"owner",
			"project",
			receipt.workspaceSessionId,
			0,
		);
		expect(events.snapshot).toBeUndefined();
		expect(events.cursor).toBe(observed.cursor);
		expect(
			events.events.map((event) => [event.kind, event.state]),
		).toContainEqual(["assistant", "complete"]);
		const positions = events.events.map((event) => event.position);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		// A cursor ahead of committed history gets a replacement snapshot.
		expect(
			(
				await env.CandidateProduct.observeOwned(
					"owner",
					"project",
					receipt.workspaceSessionId,
					observed.cursor + 10,
				)
			).snapshot,
		).toBeDefined();
		expect(await runtime.fixtureWakeState()).toEqual(before);
		expect(before.open).toBe(false);
		expect(calls()).toBe(1);
		await expect(
			commands().observe("intruder", "project", receipt.workspaceSessionId),
		).rejects.toMatchObject({ code: "runtime_owner_mismatch" });
	} finally {
		await runtime.retireFixture();
	}
});

it("retries failed, short and lost projection acknowledgments without rerunning the command", async () => {
	await candidateCredential();
	const calls = modelReplies();
	await env.CandidateProduct.setProjectionFault("throw");
	const receipt = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(receipt.workspaceSessionId);
	const applied = async () =>
		(await runtime.candidateSnapshot()).projections.map((row) => row.applied);
	try {
		await env.CandidateProduct.drain();
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).projections, {
				timeout: 5000,
			})
			.toHaveLength(1);
		await expect
			.poll(() => env.CandidateProduct.setProjectionFault("throw"), {
				timeout: 5000,
			})
			.toBeGreaterThan(0);
		expect((await message(receipt.assistantMessageId))?.status).toBe("pending");
		expect(await applied()).toEqual([0]);
		await expect
			.poll(async () => (await runtime.fixtureWakeState()).alarm, {
				timeout: 5000,
			})
			.not.toBeNull();
		await env.CandidateProduct.setProjectionFault("short");
		await runtime.forceProjectionDelivery();
		expect((await message(receipt.assistantMessageId))?.status).toBe(
			"complete",
		);
		expect(await applied()).toEqual([0]);
		await env.CandidateProduct.setProjectionFault("lose-ack");
		await runtime.forceProjectionDelivery();
		expect(await applied()).toEqual([0]);
		await env.CandidateProduct.setProjectionFault(undefined);
		await runtime.forceProjectionDelivery();
		expect(await applied()).toEqual([1]);
		expect(await env.CandidateProduct.setProjectionFault(undefined)).toBe(1);
		const observed = await env.CandidateProduct.observeOwned(
			"owner",
			"project",
			receipt.workspaceSessionId,
		);
		expect(observed.snapshot?.health.projectionLag).toBe(0);
		expect((await message(receipt.assistantMessageId))?.content).toBe(
			"Synthetic product result",
		);
		expect(calls()).toBe(1);
		expect((await runtime.candidateSnapshot()).submissions).toHaveLength(1);
	} finally {
		await runtime.retireFixture();
	}
});

it("settles late follow-ups as failed while the completed assistant stays complete, and never recreates a deleted target", async () => {
	await candidateCredential();
	const calls = modelReplies();
	const first = await env.CandidateProduct.admitOwned("owner", prompt);
	const late = async (key: string) =>
		env.CandidateProduct.admitOwned("owner", {
			version: 2,
			kind: "follow_up",
			projectId: "project",
			sessionId: first.workspaceSessionId,
			targetRunId: first.commandId,
			idempotencyKey: key,
			text: `Synthetic delayed ${key}`,
		});
	const second = await late("late");
	const third = await late("deleted");
	const runtime = env.CandidateSessions.getByName(first.workspaceSessionId);
	try {
		await runtime.deliverCommand(first.commandId, 1);
		await expect
			.poll(async () => (await message(first.assistantMessageId))?.status, {
				timeout: 5000,
			})
			.toBe("complete");
		await env.CandidateProduct.setProjectionFault("throw");
		await runtime.deliverCommand(second.commandId, 1);
		await runtime.deliverCommand(third.commandId, 1);
		expect((await runtime.candidateSnapshot()).projections).toMatchObject([
			{ assistant: first.assistantMessageId, state: "complete", applied: 1 },
			{
				assistant: second.assistantMessageId,
				state: "failed",
				reason: "target_run_terminal",
				applied: 0,
			},
			{
				assistant: third.assistantMessageId,
				state: "failed",
				reason: "target_run_terminal",
				applied: 0,
			},
		]);
		await env.DB.prepare("DELETE FROM messages WHERE id=?")
			.bind(third.assistantMessageId)
			.run();
		await env.CandidateProduct.setProjectionFault(undefined);
		await runtime.forceProjectionDelivery();
		await expect
			.poll(
				async () =>
					(await runtime.candidateSnapshot()).projections.map(
						(row) => row.applied,
					),
				{ timeout: 10000 },
			)
			.toEqual([1, 1, 1]);
		expect((await message(second.assistantMessageId))?.status).toBe("failed");
		expect((await message(first.assistantMessageId))?.status).toBe("complete");
		expect(await message(third.assistantMessageId)).toBeNull();
		expect(calls()).toBe(1);
	} finally {
		await runtime.retireFixture();
	}
});

it("never stores an unterminated private key block from a settled answer", async () => {
	await candidateCredential();
	modelReplies();
	replyText =
		"Synthetic partial -----BEGIN PRIVATE KEY-----\nsynthetic0material0only";
	const receipt = await env.CandidateProduct.admitOwned("owner", prompt);
	const runtime = env.CandidateSessions.getByName(receipt.workspaceSessionId);
	try {
		await env.CandidateProduct.drain();
		await expect
			.poll(async () => (await message(receipt.assistantMessageId))?.status, {
				timeout: 5000,
			})
			.toBe("complete");
		expect((await message(receipt.assistantMessageId))?.content).toBe(
			"Synthetic partial [REDACTED]",
		);
		await expect
			.poll(async () => (await runtime.candidateSnapshot()).projections, {
				timeout: 5000,
			})
			.toMatchObject([{ state: "complete", applied: 1 }]);
	} finally {
		await runtime.retireFixture();
	}
});

it("applies checkpoint pointer moves update-only, in generation order, and acknowledges a repeated move", async () => {
	await candidateCredential();
	const receipt = await env.CandidateProduct.admitOwned("owner", prompt);
	const sessionId = receipt.workspaceSessionId;
	const scope = {
		userId: "owner",
		projectId: "project",
		workspaceSessionId: sessionId,
	};
	const pointer = () =>
		env.DB.prepare(
			"SELECT currentPairId, previousPairId, mutationGeneration FROM runtime_checkpoint_pointers WHERE sessionId=?",
		)
			.bind(sessionId)
			.first();
	expect(await pointer()).toEqual({
		currentPairId: null,
		previousPairId: null,
		mutationGeneration: 0,
	});
	const move = (generation: number) => ({
		version: 1,
		currentPairId: `pair-${generation}`,
		previousPairId: generation > 1 ? `pair-${generation - 1}` : null,
		mutationGeneration: generation,
		expectedMutationGeneration: generation - 1,
		projectionVersion: generation,
	});
	const apply = (moves: unknown[]) =>
		commands().applyCheckpointProjections(scope, moves);
	expect(await apply([move(1)])).toEqual([
		{ projectionVersion: 1, outcome: "applied" },
	]);
	expect(await apply([move(1)])).toEqual([
		{ projectionVersion: 1, outcome: "already_applied" },
	]);
	expect(await apply([move(3)])).toEqual([
		{ projectionVersion: 3, outcome: "blocked_membership" },
	]);
	expect(await pointer()).toEqual({
		currentPairId: "pair-1",
		previousPairId: null,
		mutationGeneration: 1,
	});
	expect(await apply([move(2), move(3)])).toEqual([
		{ projectionVersion: 2, outcome: "applied" },
		{ projectionVersion: 3, outcome: "applied" },
	]);
	expect(await pointer()).toEqual({
		currentPairId: "pair-3",
		previousPairId: "pair-2",
		mutationGeneration: 3,
	});
	await expect(
		apply([{ ...move(4), expectedMutationGeneration: 1 }]),
	).rejects.toThrow();
	await expect(
		commands().applyCheckpointProjections({ ...scope, userId: "other" }, [
			move(4),
		]),
	).resolves.toEqual([{ projectionVersion: 4, outcome: "blocked_membership" }]);
	expect((await pointer())?.mutationGeneration).toBe(3);
});
