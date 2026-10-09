import { env, fetchMock, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import type {
	ConfigurationAuthorityV1,
	ConfigurationIntentV1,
	ConfigurationReadV1,
	ConfigurationSelectionV1,
} from "/home/ayan/ditto-execution/plan-007-recovery/packages/runtime-contracts/src/configuration.js";
import {
	type ModelSubjectV1,
	type ModelTransportDescriptorV1,
	parseSyntheticModelBodyV1,
	parseSyntheticModelRequestV1,
	type SyntheticModelRequestV1,
} from "/home/ayan/ditto-execution/plan-007-recovery/packages/runtime-contracts/src/model.js";
import {
	type HostFixtureDependencies,
	PiDurableHost,
	type PiDurableHostFixture,
	requestDigest,
} from "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime/src/pi-durable-host.ts";
import {
	createPrivateModelAdapter,
	type PrivateModelTransport,
} from "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime/src/pi-durable-models.ts";
import { importRuntimeKeyringFromBytes } from "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime/src/runtime-crypto.ts";
import m0 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0000_wet_giant_girl.sql?raw";
import m1 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0001_jazzy_firelord.sql?raw";
import m2 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0002_sparkling_agent_zero.sql?raw";
import m13 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0013_lonely_tigra.sql?raw";
import m14 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0014_smiling_namora.sql?raw";
import m15 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0015_opencode_contract_denials.sql?raw";
import m16 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0016_git_push_contract_state.sql?raw";
import m17 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0017_dazzling_sandman.sql?raw";
import m18 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0018_old_whistler.sql?raw";
import m20 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0020_trusted_runtime_additive.sql?raw";
import m21 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0021_first_lilandra.sql?raw";
import m22 from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/migrations/0022_synthetic_model_transport.sql?raw";
import { CodexCredential } from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/src/lib/codex-credential-do";
import { ModelProductAuthority } from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/src/lib/model-product-authority";
import type { FixtureCredential } from "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/src/entry";
import type { FixtureProduct } from "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/src/model-entry";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_MODEL_HOST: DurableObjectNamespace<PiDurableHostFixture>;
		DB: D1Database;
		CodexCredential: DurableObjectNamespace<FixtureCredential>;
		CODEX_CREDENTIAL_CURRENT_KEY_VERSION: string;
		CODEX_CREDENTIAL_KEYS: string;
	}
}

let measured: Record<string, { count: number; ms: number; max: number }> = {};
let measuredStart = 0;
function timed(name: string, operation: (...args: unknown[]) => unknown) {
 return async function(this: unknown, ...args: unknown[]) {
  const start = performance.now();
  try { return await operation.apply(this, args); }
  finally {
   const ms = performance.now() - start;
   const row = measured[name] ??= {count: 0, ms: 0, max: 0};
   row.count++; row.ms += ms; row.max = Math.max(row.max, ms);
  }
 };
}
function wrap(target: object, key: string, name: string) {
 const operation = Reflect.get(target, key) as (...args: unknown[]) => unknown;
 Reflect.set(target, key, timed(name, operation));
}
for (const key of ['configurationAllowed', 'configurationLedger', 'configurationIdentity', 'configurationEvidence', 'initializeOwnedConfiguration', 'piConfiguration', 'durable', 'seal', 'configureOwned', 'yield'])
 wrap(PiDurableHost.prototype, key, 'host.' + key);
wrap(ModelProductAuthority.prototype, 'ownedConfiguration', 'local.productD1');
const originalOpen = PiDurableHost.open;
const seen = new WeakSet<object>();
PiDurableHost.open = async function(storage, dependencies) {
 const start = performance.now();
 const host = await originalOpen.call(this, storage, dependencies);
 const row = measured['host.open'] ??= {count:0, ms:0, max:0};
 const ms = performance.now()-start; row.count++; row.ms+=ms; row.max=Math.max(row.max,ms);
 const harness = Reflect.get(host, 'harness');
 for (const key of ['root', 'conversation']) {
  const original = Reflect.get(harness,key);
  Reflect.set(harness,key,async function(...args: unknown[]) {
   const conversation = await original.apply(this,args);
   if(conversation && !seen.has(conversation)) {
    seen.add(conversation); wrap(conversation,'configure','pi.configure');
   }
   return conversation;
  });
 }
 return host;
};
beforeEach(() => { measured = {}; measuredStart = performance.now(); });
afterEach(() => { console.log('[007-timing]', JSON.stringify({test: expect.getState().currentTestName, totalMs: performance.now()-measuredStart, measured})); });

const product = SELF as Service<FixtureProduct>;
const configurationQuery: ConfigurationReadV1 = {
	version: 1,
	projectId: "project",
	workspaceSessionId: "session",
	ownerVersion: 1,
};
function selectionIntent(
	intentId = "choice-1",
	model: "faux-1" | "faux-2" = "faux-2",
	thinking: "off" | "low" | "high" | "max" = "low",
): ConfigurationIntentV1 {
	return { ...configurationQuery, intentId, selection: { model, thinking } };
}
const credential = {
	holdModel: (phase: "authority" | "credentials" | "claim") =>
		env.CodexCredential.getByName("owner").holdModel(phase),
	waitModel: () => env.CodexCredential.getByName("owner").waitModel(),
	releaseModel: () => env.CodexCredential.getByName("owner").releaseModel(),
};
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
const account = {
	version: 1,
	status: "available",
	generation: 1,
	revision: 1,
	models: [
		{ id: "faux-1", thinking: ["off", "low", "high", "max"] },
		{ id: "faux-2", thinking: ["off", "low", "high", "max"] },
	],
};
const syntheticTokens = {
	access: "synthetic-request-access",
	refresh: "synthetic-request-refresh",
	expiresAt: 4102444800000,
};
const frames = [
	{ version: 1, type: "delta", text: "Synthetic answer ".repeat(50) },
	{
		version: 1,
		type: "done",
		stopReason: "stop",
		inputTokens: 4,
		outputTokens: 6,
	},
];
const encodedFrames =
	frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n";
let calls: {
	body: ReturnType<typeof parseSyntheticModelBodyV1>;
	headerNames: string[];
}[];
let installed = false;
let responses: { status: number; response: string }[] = [];
let defaultResponse = { status: 200, response: encodedFrames };
function upstream(status = 200, response = encodedFrames, times?: number) {
	if (times)
		responses.push(
			...Array.from({ length: times }, () => ({ status, response })),
		);
	else defaultResponse = { status, response };
}
function installTrap() {
	if (installed) return;
	installed = true;
	fetchMock
		.get("https://codex-model-fixture.invalid")
		.intercept({ path: "/v1/stream", method: "POST" })
		.reply((options) => {
			expect(typeof options.body).toBe("string");
			const body = parseSyntheticModelBodyV1(options.body);
			const headers = options.headers;
			expect(headers).toMatchObject({
				"content-type": "application/json",
				accept: "application/x-ndjson",
				authorization: `Bearer ${syntheticTokens.access}`,
			});
			calls.push({ body, headerNames: Object.keys(headers ?? {}).sort() });
			const selected = responses.shift() ?? defaultResponse;
			return {
				statusCode: selected.status,
				data: selected.response,
				responseOptions: {
					headers: { "content-type": "application/x-ndjson" },
				},
			};
		})
		.persist()
		.delay(100);
}
async function piState(storage: DurableObjectStorage): Promise<string> {
	const names = storage.sql
		.exec<{ name: string }>(
			"SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'host_%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
		.toArray();
	return requestDigest(
		names.map(({ name }) => ({
			name,
			rows: storage.sql
				.exec(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`)
				.toArray(),
		})),
	);
}
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Fixture bounded wait expired")),
					3000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
async function until(check: () => boolean | Promise<boolean>) {
	const deadline = Date.now() + 3000;
	while (!(await check())) {
		if (Date.now() >= deadline)
			throw new Error("Fixture bounded observation expired");
		await new Promise<void>((r) => setTimeout(r, 1));
	}
}
beforeEach(async () => {
 const setupStart = performance.now();
	calls = [];
	responses = [];
	defaultResponse = { status: 200, response: encodedFrames };
	fetchMock.activate();
	fetchMock.disableNetConnect();
	installTrap();
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
			"INSERT INTO projects(id,name,userId,status) VALUES('project','Synthetic project','owner','ready')",
		),
		env.DB.prepare(
			"INSERT INTO workspace_sessions(id,projectId,userId,status,sandboxIdentityId,runtimeOwner,runtimeOwnerVersion) VALUES('session','project','owner','active','executor','trusted_v1',1)",
		),
		env.DB.prepare(
			"INSERT INTO sandbox_identities(id,kind,sandboxId,containerId,userId,projectId,workspaceSessionId,state,controllerClass,controllerNamespace,incarnationId) VALUES('executor','workspace_session','sandbox','container','owner','project','session','ready','Sandbox','fixture-execution-v1','incarnation')",
		),
		env.DB.prepare(
			"INSERT INTO codex_connections VALUES('owner',1,0,'connected',0,0)",
		),
		env.DB.prepare(
			"INSERT INTO codex_fixture_capabilities VALUES('owner',1,1,?)",
		).bind(JSON.stringify(account)),
		env.DB.prepare(
			"INSERT INTO session_commands(id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,payloadVersion,userMessageId,assistantMessageId,payloadDigest,acceptedAt,deadlineAt) VALUES('command','owner','workspace_session','session','project','session','prompt',1,1,'user-message','assistant','fixture-digest',0,?)",
		).bind(Date.now() + 600000),
		env.DB.prepare(
			"INSERT INTO runtime_command_memberships(commandId,sessionId,runId,userMessageId,assistantMessageId,runEpoch) VALUES('command','session','run','user-message','assistant',1)",
		),
	]);
	expect(
		(
			await env.CodexCredential.getByName("owner").install(
				"owner",
				1,
				syntheticTokens,
			)
		).status,
	).toBe("connected");
 measured['fixture.setup'] = {count:1,ms:performance.now()-setupStart,max:performance.now()-setupStart};
});
afterEach(() => {
	// Denial tests deliberately leave the fixed-destination credential-bearing trap unused.
	for (const pending of fetchMock.pendingInterceptors())
		expect(pending).toMatchObject({
			origin: "https://codex-model-fixture.invalid",
			path: "/v1/stream",
			method: "POST",
			persist: true,
		});
	fetchMock.deactivate();
});

async function gate(
	name: string,
	test: (f: {
		host: PiDurableHost;
		storage: DurableObjectStorage;
		start(): Promise<void>;
		settled: Promise<void>;
		snapshot(): Promise<unknown>;
		claimFlush(): { entered: Promise<void>; release(): void };
		reopen(): Promise<PiDurableHost>;
	}) => Promise<void>,
	options: {
		acceptCommand?: boolean;
		owned?: boolean;
		prepareModel?: HostFixtureDependencies["prepareModel"];
		encrypted?: boolean;
		configurationFault?: (point: string) => void;
		localAuthority?: (
			current: boolean,
			generation: number,
		) => Promise<{ current: boolean; generation: number; executor: number }>;
		configurationAuthority?: (
			query: ConfigurationReadV1,
			selection?: ConfigurationSelectionV1,
		) => Promise<ConfigurationAuthorityV1>;
		transform?: (request: SyntheticModelRequestV1) => unknown;
		threeDenials?: boolean;
		duplicate?: boolean;
		retry?: boolean;
		purpose?: "generation" | "git_metadata";
		model?: "faux-1" | "faux-2";
		reopen?: boolean;
		finalAuthorityHold?: {
			entered: ReturnType<typeof deferred>;
			released: ReturnType<typeof deferred>;
		};
		permit?: (
			request: unknown,
			descriptor: ModelTransportDescriptorV1,
		) => Promise<{ status: "current" | "denied" }>;
	} = {},
) {
	await runInDurableObject(
		env.PI_MODEL_HOST.getByName(name),
		async (_instance, state) => {
			const finished = deferred();
			const probe: ModelTransportDescriptorV1 = {
				version: 1,
				subject,
				requestDigest: "0".repeat(64),
				attempt: {
					version: 1,
					effectId: "check",
					operationId: "check",
					runId: "run",
					commandId: "command",
					assistantId: "assistant",
					taskId: 1,
					epoch: 1,
					attempt: 1,
					generation: 1,
					deadlineAt: Date.now() + 600000,
					requestDigest: "0".repeat(64),
					kind: "generation",
				},
			};
			let hold:
				| {
						entered: ReturnType<typeof deferred>;
						released: ReturnType<typeof deferred>;
				  }
				| undefined;
			const storage = new Proxy(state.storage, {
				get(target, key) {
					if (key === "sync")
						return async () => {
							if (
								hold &&
								state.storage.sql
									.exec("SELECT 1 FROM host_model_dispatch WHERE claimed=1")
									.toArray().length
							) {
								const waiting = hold;
								hold = undefined;
								waiting.entered.resolve();
								await waiting.released.promise;
							}
							await target.sync();
						};
					const value: unknown = Reflect.get(target, key, target);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			const transport: PrivateModelTransport = {
				readModelPermit:
					options.permit ??
					((request, descriptor) =>
						product.readModelPermit(request, descriptor)),
				requestModel: async (input, capability) => {
					try {
						const request = parseSyntheticModelRequestV1(input);
						if (options.threeDenials) {
							for (let count = 0; count < 3; count++)
								expect(
									(
										await product.requestModel(
											{ ...request, method: "GET" },
											capability,
										)
									).status,
								).toBe("denied");
							return { version: 1, status: "denied" };
						}
						if (options.duplicate) {
							const outcomes = await Promise.all([
								product.requestModel(request, capability),
								product.requestModel(request, capability),
							]);
							expect(outcomes.map((result) => result.status).sort()).toEqual([
								"complete",
								"denied",
							]);
							return outcomes.find((result) => result.status === "complete")!;
						}
						return await product.requestModel(
							options.transform ? options.transform(request) : request,
							capability,
						);
					} finally {
						finished.resolve();
					}
				},
			};
			let generation = 1;
			let interrupt = options.reopen ?? false;
			const dependencies: HostFixtureDependencies = {
				prepareModel: options.prepareModel,
				retained: options.encrypted
					? {
							ownerId: subject.userId,
							workspaceSessionId: subject.workspaceSessionId,
							keyring: await importRuntimeKeyringFromBytes("v1", {
								v1: new Uint8Array(32).fill(19),
							}),
						}
					: undefined,
				configuration: options.owned
					? {
							subject,
							defaultSelection: { model: "faux-1", thinking: "off" },
							authorize:
								options.configurationAuthority ??
								((query, selection) =>
									product.readConfigurationAuthority(query, selection)),
						}
					: undefined,
				fault: (point) => {
					options.configurationFault?.(point);
					if (interrupt && point === "before-submit") {
						interrupt = false;
						throw new Error("Synthetic interruption before submission");
					}
				},
				now: Date.now,
				authority: async () => {
					const current = options.owned
						? await new ModelProductAuthority(env.DB).ownedConfiguration(
								subject,
								configurationQuery,
							)
						: await new ModelProductAuthority(env.DB).current(probe);
					if (
						options.finalAuthorityHold &&
						state.storage.sql
							.exec("SELECT 1 FROM host_model_dispatch WHERE claimed=1")
							.toArray().length
					) {
						options.finalAuthorityHold.entered.resolve();
						await options.finalAuthorityHold.released.promise;
					}
					return options.localAuthority
						? options.localAuthority(current, generation)
						: { current, generation, executor: 1 };
				},
				budgets: { workMs: 10000, drainMs: 1000 },
				operationMs: { model: 10000, tool: 10000 },
				wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
				options: (guard) => {
					const adapter = createPrivateModelAdapter(
						guard,
						transport,
						subject,
						options.purpose ?? "generation",
					);
					return {
						models: adapter.models,
						registry: adapter.registry,
						settings: {
							extensions: [adapter.extension],
							retry: {
								enabled: options.retry ?? false,
								maxRetries: 1,
								baseDelayMs: 1,
							},
							compaction: {
								enabled: false,
								reserveTokens: 64,
								keepRecentTokens: 1,
								backgroundTokens: 0,
							},
						},
					};
				},
			};
			if (dependencies.configuration) dependencies.configuration.authorize = timed('product.configurationRPC', dependencies.configuration.authorize as (...args: unknown[]) => unknown) as typeof dependencies.configuration.authorize;
            dependencies.authority = timed('local.authority', dependencies.authority as (...args: unknown[]) => unknown) as typeof dependencies.authority;
            let host = await PiDurableHost.open(storage, dependencies);
			try {
				if (options.acceptCommand !== false)
					await host.accept("command", "Synthetic request", {
						run: "run",
						user: "user-message",
						assistant: "assistant",
						sequence: 1,
					});
				if (options.reopen) {
					await expect(host.schedule("command")).rejects.toThrow(
						"Synthetic interruption",
					);
					await host.yield();
					generation = 2;
					host = await PiDurableHost.open(storage, dependencies);
				}
				if (options.model)
					await host.configure({
						model: { provider: "faux", modelId: options.model },
					});
				await test({
					host,
					storage: state.storage,
					start: async () => {
						await host.schedule("command");
					},
					settled: finished.promise,
					reopen: async () => {
						await host.yield();
						generation++;
						host = await PiDurableHost.open(storage, dependencies);
						return host;
					},
					claimFlush: () => {
						const entered = deferred(),
							released = deferred();
						hold = { entered, released };
						return { entered: entered.promise, release: released.resolve };
					},
					snapshot: async () => ({
						calls: calls.length,
						windows: (
							await env.DB.prepare(
								"SELECT consumedRequests,contractDenials,closeReason,openSlot FROM privileged_operations",
							).all()
						).results,
						admissions: (
							await env.DB.prepare(
								"SELECT effectId,purpose,state,requestDigest FROM model_request_admissions",
							).all()
						).results,
						claims: state.storage.sql
							.exec("SELECT claimed FROM host_model_dispatch")
							.toArray(),
						runs: state.storage.sql
							.exec("SELECT state,epoch FROM host_runs")
							.toArray(),
					}),
				});
			} finally {
				hold?.released.resolve();
				await credential.releaseModel();
				await host.yield();
				await state.storage.deleteAlarm();
				await state.storage.sync();
			}
		},
	);
}

for (const encrypted of [false, true]) {
	for (const change of ["current", "executor", "generation"] as const)
		it(`configuration correction: final product hold rechecks local ${change}, encrypted=${encrypted}`, async () => {
			let configured = false,
				selectionCalls = 0,
				revoked = false;
			const entered = deferred(),
				released = deferred();
			await gate(
				"configuration-correction",
				async (f) => {
					if (change === "generation") {
						await credential.holdModel("credentials");
						await f.start();
						await bounded(credential.waitModel());
					}
					const before = await piState(f.storage);
					configured = true;
					const pending = f.host.configureOwned(selectionIntent());
					try {
						await bounded(entered.promise);
						revoked = true;
					} finally {
						released.resolve();
					}
					const ack = await bounded(pending);
					expect(ack.status).toBe("denied");
					expect(await piState(f.storage)).toBe(before);
					expect(calls).toEqual([]);
					console.log(
						"[007-correction-authority]",
						JSON.stringify({
							change,
							encrypted,
							revoked,
							status: ack.status,
							piUnchanged: true,
							snapshot: await f.snapshot(),
						}),
					);
				},
				{
					owned: true,
					encrypted,
					acceptCommand: change === "generation",
					localAuthority: async (current, generation) => ({
						current: current && !(revoked && change === "current"),
						generation:
							generation + (revoked && change === "generation" ? 1 : 0),
						executor: revoked && change === "executor" ? 2 : 1,
					}),
					configurationAuthority: async (query, selection) => {
						const result = await product.readConfigurationAuthority(
							query,
							selection,
						);
						if (configured && selection && ++selectionCalls === 6) {
							entered.resolve();
							await released.promise;
						}
						return result;
					},
				},
			);
		});
	it(`configuration correction: close cancels final product callback, encrypted=${encrypted}`, async () => {
		let configured = false,
			selectionCalls = 0;
		const entered = deferred(),
			released = deferred();
		await gate(
			"configuration-correction",
			async (f) => {
				const before = await piState(f.storage);
				configured = true;
				const pending = f.host.configureOwned(selectionIntent());
				const rejected = expect(pending).rejects.toThrow();
				try {
					await bounded(entered.promise);
					await bounded(f.host.yield());
					await rejected;
					expect(await piState(f.storage)).toBe(before);
				} finally {
					released.resolve();
				}
				const reopened = await f.reopen();
				expect((await reopened.configureOwned(selectionIntent())).status).toBe(
					"outcome_unknown",
				);
				expect(
					(await reopened.readOwnedConfiguration(configurationQuery))
						?.selection,
				).toEqual({ model: "faux-1", thinking: "off" });
				expect(calls).toEqual([]);
			},
			{
				owned: true,
				encrypted,
				acceptCommand: false,
				configurationAuthority: async (query, selection) => {
					const result = await product.readConfigurationAuthority(
						query,
						selection,
					);
					if (configured && selection && ++selectionCalls === 6) {
						entered.resolve();
						await released.promise;
					}
					return result;
				},
			},
		);
	});
	it(`owned configuration commits scoped duplicate/conflict outcomes and lost acknowledgments, encrypted=${encrypted}`, async () => {
		await gate(
			`owned-idempotency-${encrypted}`,
			async (f) => {
				const intent = selectionIntent();
				const outcomes = await Promise.all([
					f.host.configureOwned(intent),
					f.host.configureOwned(intent),
				]);
				expect(outcomes[0]).toEqual(outcomes[1]);
				expect(outcomes[0].status).toBe("applied");
				expect(
					(
						await f.host.configureOwned({
							...intent,
							selection: { model: "faux-1", thinking: "off" },
						})
					).status,
				).toBe("conflict");
				const next = selectionIntent("choice-2", "faux-1", "high");
				expect((await f.host.configureOwned(next)).status).toBe("applied");
				expect(await f.host.configureOwned(intent)).toEqual(outcomes[0]);
				expect(
					(await f.host.readOwnedConfiguration(configurationQuery))?.selection,
				).toEqual(next.selection);
				const host = await f.reopen();
				expect(await host.configureOwned(intent)).toEqual(outcomes[0]);
				expect(
					(await host.readOwnedConfiguration(configurationQuery))?.selection,
				).toEqual(next.selection);
				expect(
					f.storage.sql
						.exec("SELECT state FROM host_configuration_intents")
						.toArray(),
				).toEqual([{ state: "complete" }, { state: "complete" }]);
				if (encrypted)
					for (const row of f.storage.sql
						.exec<{ outcome: string }>(
							"SELECT outcome FROM host_configuration_intents",
						)
						.toArray()) {
						expect(row.outcome).not.toContain("faux-");
						expect(row.outcome).not.toContain("thinking");
					}
				expect(calls).toEqual([]);
			},
			{ owned: true, encrypted },
		);
	});
	for (const phase of [
		"configuration-intent",
		"configuration-applied",
		"configuration-outcome",
	])
		it(`configuration crash at ${phase} never reapplies an older choice, encrypted=${encrypted}`, async () => {
			let crash = true;
			await gate(
				`owned-crash-${phase}-${encrypted}`,
				async (f) => {
					await expect(
						f.host.configureOwned(selectionIntent()),
					).rejects.toThrow("Synthetic configuration crash");
					const host = await f.reopen();
					const first = await host.configureOwned(selectionIntent());
					expect(first.status).toBe(
						phase === "configuration-intent" ? "outcome_unknown" : "applied",
					);
					const next = selectionIntent("newer", "faux-1", "high");
					expect((await host.configureOwned(next)).status).toBe("applied");
					expect(await host.configureOwned(selectionIntent())).toEqual(first);
					expect(
						(await host.readOwnedConfiguration(configurationQuery))?.selection,
					).toEqual(next.selection);
					expect(calls).toEqual([]);
				},
				{
					owned: true,
					encrypted,
					configurationFault: (point) => {
						if (crash && point === phase) {
							crash = false;
							throw new Error("Synthetic configuration crash");
						}
					},
				},
			);
		});
}
for (const [name, sql] of [
	["wrong-user", "UPDATE workspace_sessions SET userId='foreign'"],
	["wrong-project-owner", "UPDATE projects SET userId='foreign'"],
	["wrong-project", "UPDATE workspace_sessions SET projectId='foreign'"],
	["archived", "UPDATE workspace_sessions SET status='archived'"],
	["deleting", "UPDATE projects SET status='deleting'"],
	["owner-version", "UPDATE workspace_sessions SET runtimeOwnerVersion=2"],
	["stale-identity", "UPDATE sandbox_identities SET incarnationId='stale'"],
	["wrong-role", "UPDATE sandbox_identities SET kind='project_seed'"],
	["retired", "UPDATE sandbox_identities SET retiredAt=1"],
	["lifecycle", "UPDATE sandbox_identities SET lifecycleGeneration=2"],
	["revoked", "UPDATE codex_connections SET revoked=1"],
	["disconnected", "UPDATE codex_connections SET status='disconnected'"],
	["connection-generation", "UPDATE codex_connections SET generation=2"],
	["capability-revision", "UPDATE codex_fixture_capabilities SET revision=2"],
] as const)
	it(`owned configuration rejects ${name} after actual D1 revocation with unchanged Pi state`, async () => {
		await gate(
			`owned-denial-${name}`,
			async (f) => {
				const initial = await f.host.readOwnedConfiguration(configurationQuery);
				const persisted = await piState(f.storage);
				await env.DB.batch([
					env.DB.prepare(
						"INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('foreign','Synthetic foreign','foreign@example.invalid',0,0)",
					),
					env.DB.prepare(
						"INSERT INTO projects(id,name,userId,status) VALUES('foreign','Foreign project','foreign','ready')",
					),
				]);
				await env.DB.prepare(sql).run();
				expect((await f.host.configureOwned(selectionIntent())).status).toBe(
					"denied",
				);
				expect(
					f.storage.sql
						.exec("SELECT id FROM host_configuration_intents")
						.toArray(),
				).toEqual([]);
				expect(calls).toEqual([]);
				expect(await piState(f.storage)).toBe(persisted);
				expect(initial?.selection).toEqual({
					model: "faux-1",
					thinking: "off",
				});
			},
			{ owned: true },
		);
	});
for (const reason of [
	"unavailable",
	"revoked",
	"unsupported-model",
	"unsupported-thinking",
] as const)
	it(`owned selection denies ${reason} without a request`, async () => {
		await gate(
			`owned-capability-${reason}`,
			async (f) => {
				const persisted = await piState(f.storage);
				const changed =
					reason === "unavailable" || reason === "revoked"
						? { ...account, status: reason, models: [] }
						: { ...account, models: [{ id: "faux-1", thinking: ["off"] }] };
				await env.DB.prepare("UPDATE codex_fixture_capabilities SET snapshot=?")
					.bind(JSON.stringify(changed))
					.run();
				expect(
					(
						await f.host.configureOwned(
							reason === "unsupported-thinking"
								? selectionIntent("choice", "faux-1", "high")
								: selectionIntent(),
						)
					).status,
				).toBe("denied");
				expect(await piState(f.storage)).toBe(persisted);
				expect(
					f.storage.sql
						.exec("SELECT id FROM host_configuration_intents")
						.toArray(),
				).toEqual([]);
				expect(calls).toEqual([]);
			},
			{ owned: true },
		);
	});
it("caller fields cannot authenticate or select another owned scope", async () => {
	await gate(
		"owned-input",
		async (f) => {
			for (const patch of [
				{ workspaceSessionId: "foreign" },
				{ projectId: "foreign" },
				{ ownerVersion: 2 },
			])
				expect(
					(await f.host.configureOwned({ ...selectionIntent(), ...patch }))
						.status,
				).toBe("denied");
			await expect(
				f.host.configureOwned({ ...selectionIntent(), userId: "owner" }),
			).rejects.toThrow();
			expect(
				await product.readConfigurationAuthority(
					{ ...configurationQuery, userId: "owner" },
					{ model: "faux-1", thinking: "off" },
				),
			).toEqual({ version: 1, status: "denied" });
			expect(calls).toEqual([]);
		},
		{ owned: true },
	);
});
it("a held actual D1 configuration authority result cannot survive capability revocation", async () => {
	let hold = false;
	const entered = deferred(),
		released = deferred();
	await gate(
		"owned-held-authority",
		async (f) => {
			hold = true;
			const changing = f.host.configureOwned(selectionIntent());
			await bounded(entered.promise);
			await env.DB.prepare(
				"UPDATE codex_fixture_capabilities SET revision=2",
			).run();
			released.resolve();
			expect((await changing).status).toBe("denied");
			expect(
				f.storage.sql
					.exec("SELECT id FROM host_configuration_intents")
					.toArray(),
			).toEqual([]);
			expect(calls).toEqual([]);
		},
		{
			owned: true,
			configurationAuthority: async (query, selected) => {
				const result = await product.readConfigurationAuthority(
					query,
					selected,
				);
				if (hold) {
					hold = false;
					entered.resolve();
					await released.promise;
				}
				return result;
			},
		},
	);
});
it("owned configuration is reflected in an actual mandatory credential request", async () => {
	await gate(
		"owned-request",
		async (f) => {
			expect((await f.host.configureOwned(selectionIntent())).status).toBe(
				"applied",
			);
			await f.start();
			await bounded(f.settled);
			await f.host.waitIdle();
			expect(calls.map((c) => [c.body.model, c.body.thinking])).toEqual([
				["faux-2", "low"],
			]);
		},
		{ owned: true },
	);
});
it("a valid first default grants no later request admission after capability revocation", async () => {
	await gate(
		"owned-default-revocation",
		async (f) => {
			expect(
				(await f.host.readOwnedConfiguration(configurationQuery))?.selection,
			).toEqual({ model: "faux-1", thinking: "off" });
			await credential.holdModel("credentials");
			await f.start();
			await bounded(credential.waitModel());
			await env.DB.prepare("UPDATE codex_fixture_capabilities SET snapshot=?")
				.bind(JSON.stringify({ ...account, status: "revoked", models: [] }))
				.run();
			await credential.releaseModel();
			await bounded(f.settled);
			expect(calls).toEqual([]);
		},
		{ owned: true },
	);
});

for (const reason of [
	"valid",
	"unsupported-model",
	"unsupported-thinking",
	"unavailable",
	"revoked",
	"disconnected",
	"local-current",
	"local-executor",
] as const)
	it(`first owned conversation validates defaults without prompt membership, ${reason}`, async () => {
		const invalid = reason !== "valid";
		await env.DB.prepare("DELETE FROM runtime_command_memberships").run();
		await env.DB.prepare("DELETE FROM session_commands").run();
		if (reason === "disconnected")
			await env.CodexCredential.getByName("owner").revoke("owner", 2);
		else if (invalid && !reason.startsWith("local-")) {
			const changed =
				reason === "unavailable" || reason === "revoked"
					? { ...account, status: reason, models: [] }
					: {
							...account,
							models: [
								{
									id: reason === "unsupported-model" ? "faux-1" : "faux-2",
									thinking: ["off"],
								},
							],
						};
			await env.DB.prepare("UPDATE codex_fixture_capabilities SET snapshot=?")
				.bind(JSON.stringify(changed))
				.run();
		}
		await runInDurableObject(
			env.PI_MODEL_HOST.getByName(`owned-default-${reason}`),
			async (_instance, state) => {
				const selected: ConfigurationSelectionV1 = {
					model: "faux-2",
					thinking: "low",
				};
				let selectionCalls = 0,
					revoked = false;
				const dependencies: HostFixtureDependencies = {
					now: Date.now,
					authority: async () => ({
						current:
							(await new ModelProductAuthority(env.DB).ownedConfiguration(
								subject,
								configurationQuery,
							)) && !(revoked && reason === "local-current"),
						generation: 1,
						executor: revoked && reason === "local-executor" ? 2 : 1,
					}),
					configuration: {
						subject,
						defaultSelection: selected,
						authorize: async (query, selection) => {
							const result = await product.readConfigurationAuthority(
								query,
								selection,
							);
							if (selection && ++selectionCalls === 3) revoked = true;
							return result;
						},
					},
					wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
					options: (guard) => {
						const adapter = createPrivateModelAdapter(
							guard,
							{
								requestModel: (input, capability) =>
									product.requestModel(input, capability),
								readModelPermit: (input, descriptor) =>
									product.readModelPermit(input, descriptor),
							},
							subject,
						);
						return {
							models: adapter.models,
							registry: adapter.registry,
							settings: { extensions: [adapter.extension] },
						};
					},
				};
				if (invalid) {
					await expect(
						PiDurableHost.open(state.storage, dependencies),
					).rejects.toThrow("Default configuration denied");
					expect(
						state.storage.sql
							.exec<{ n: number }>("SELECT COUNT(*) AS n FROM conversations")
							.one().n,
					).toBe(0);
				} else {
					const host = await PiDurableHost.open(state.storage, dependencies);
					try {
						expect(
							(await host.readOwnedConfiguration(configurationQuery))
								?.selection,
						).toEqual(selected);
					} finally {
						await host.yield();
					}
					expect(
						state.storage.sql
							.exec<{ n: number }>("SELECT COUNT(*) AS n FROM conversations")
							.one().n,
					).toBe(1);
				}
				expect(calls).toEqual([]);
				await state.storage.deleteAlarm();
			},
		);
	});
it("local credential disconnect denies configuration before its D1 projection catches up", async () => {
	await gate(
		"owned-local-disconnect",
		async (f) => {
			await env.CodexCredential.getByName("owner").revoke("owner", 2);
			expect((await f.host.configureOwned(selectionIntent())).status).toBe(
				"denied",
			);
			expect(
				f.storage.sql
					.exec("SELECT id FROM host_configuration_intents")
					.toArray(),
			).toEqual([]);
			expect(calls).toEqual([]);
		},
		{ owned: true },
	);
});
it("configuration in flight keeps the prepared request and changes the separately prepared summary", async () => {
	await gate(
		"owned-in-flight-summary",
		async (f) => {
			await credential.holdModel("credentials");
			await f.start();
			await bounded(credential.waitModel());
			expect((await f.host.configureOwned(selectionIntent())).status).toBe(
				"applied",
			);
			await credential.releaseModel();
			await bounded(f.settled);
			await until(async () => {
				const row = f.storage.sql
					.exec<{ task: number }>(
						"SELECT task FROM host_tasks WHERE kind='pi.generation'",
					)
					.toArray()[0];
				return (
					!!row &&
					(await f.host.task(row.task as Parameters<typeof f.host.task>[0]))
						?.state.status === "terminal"
				);
			});
			expect(calls.map((c) => [c.body.model, c.body.thinking])).toEqual([
				["faux-1", "off"],
			]);
			await f.host.compact("command");
			await until(() => calls.length === 2);
			await f.host.waitIdle();
			expect(calls[1].body).toMatchObject({
				purpose: "custom_summary",
				model: "faux-2",
				thinking: "low",
			});
			expect(await f.snapshot()).toMatchObject({
				windows: [{ consumedRequests: 1 }, { consumedRequests: 1 }],
			});
			console.log(
				"[007-configuration-preparation]",
				JSON.stringify({
					requests: calls.map((c) => ({
						model: c.body.model,
						thinking: c.body.thinking,
						purpose: c.body.purpose,
					})),
					configuration:
						await f.host.readOwnedConfiguration(configurationQuery),
					snapshot: await f.snapshot(),
				}),
			);
		},
		{ owned: true },
	);
});

it("held host authority revocation rejects configuration without changing durable Pi state", async () => {
	let held = false,
		current = true;
	const entered = deferred(),
		released = deferred();
	await gate(
		"owned-host-revocation",
		async (f) => {
			const before = await f.host.readOwnedConfiguration(configurationQuery);
			held = true;
			const configuring = f.host.configureOwned(selectionIntent());
			await bounded(entered.promise);
			current = false;
			released.resolve();
			expect((await configuring).status).toBe("denied");
			current = true;
			expect(await f.host.readOwnedConfiguration(configurationQuery)).toEqual(
				before,
			);
			expect(calls).toEqual([]);
		},
		{
			owned: true,
			localAuthority: async (productCurrent, generation) => {
				const captured = current;
				if (held) {
					held = false;
					entered.resolve();
					await released.promise;
				}
				return { current: captured && productCurrent, generation, executor: 1 };
			},
		},
	);
});
it("same key with concurrent changed payload has one durable winner", async () => {
	await gate(
		"owned-concurrent-conflict",
		async (f) => {
			const [first, changed] = await Promise.all([
				f.host.configureOwned(selectionIntent()),
				f.host.configureOwned(selectionIntent("choice-1", "faux-1", "high")),
			]);
			expect(first.status).toBe("applied");
			expect(changed.status).toBe("conflict");
			expect(
				(await f.host.readOwnedConfiguration(configurationQuery))?.selection,
			).toEqual(selectionIntent().selection);
			expect(calls).toEqual([]);
		},
		{ owned: true },
	);
});
it("two actual owned sessions retain independent durable Pi selections", async () => {
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO workspace_sessions(id,projectId,userId,status,sandboxIdentityId,runtimeOwner,runtimeOwnerVersion) VALUES('session-2','project','owner','active','executor-2','trusted_v1',1)",
		),
		env.DB.prepare(
			"INSERT INTO sandbox_identities(id,kind,sandboxId,containerId,userId,projectId,workspaceSessionId,state,controllerClass,controllerNamespace,incarnationId) VALUES('executor-2','workspace_session','sandbox-2','container-2','owner','project','session-2','ready','Sandbox','fixture-execution-v1','incarnation-2')",
		),
	]);
	await gate(
		"owned-isolation-1",
		async (f) => {
			expect((await f.host.configureOwned(selectionIntent())).status).toBe(
				"applied",
			);
			const second = {
				...subject,
				workspaceSessionId: "session-2",
				identityId: "executor-2",
				incarnationId: "incarnation-2",
			};
			const query = { ...configurationQuery, workspaceSessionId: "session-2" };
			await runInDurableObject(
				env.PI_MODEL_HOST.getByName("owned-isolation-2"),
				async (_instance, state) => {
					const host = await PiDurableHost.open(state.storage, {
						now: Date.now,
						authority: async () => ({
							current: await new ModelProductAuthority(
								env.DB,
							).ownedConfiguration(second, query),
							generation: 1,
							executor: 1,
						}),
						configuration: {
							subject: second,
							defaultSelection: { model: "faux-1", thinking: "off" },
							authorize: (query, selection) =>
								product.readSecondConfigurationAuthority(query, selection),
						},
						wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
						options: (guard) => {
							const adapter = createPrivateModelAdapter(
								guard,
								{
									requestModel: (input, capability) =>
										product.requestModel(input, capability),
									readModelPermit: (input, descriptor) =>
										product.readModelPermit(input, descriptor),
								},
								second,
							);
							return {
								models: adapter.models,
								registry: adapter.registry,
								settings: { extensions: [adapter.extension] },
							};
						},
					});
					try {
						expect(
							(
								await host.configureOwned({
									...selectionIntent(),
									workspaceSessionId: "session-2",
									selection: { model: "faux-1", thinking: "high" },
								})
							).status,
						).toBe("applied");
						expect(
							(await host.readOwnedConfiguration(query))?.selection,
						).toEqual({ model: "faux-1", thinking: "high" });
						await expect(
							host.configureOwned(selectionIntent()),
						).resolves.toMatchObject({ status: "denied" });
					} finally {
						await host.yield();
						await state.storage.deleteAlarm();
					}
				},
			);
			expect(
				(await f.host.readOwnedConfiguration(configurationQuery))?.selection,
			).toEqual({ model: "faux-2", thinking: "low" });
			expect(calls).toEqual([]);
		},
		{ owned: true },
	);
});

it("owned configuration close cancels held authority and joins the owner lane", async () => {
	let held = false;
	const entered = deferred(),
		released = deferred();
	await gate(
		"owned-close",
		async (f) => {
			held = true;
			const pending = f.host.configureOwned(selectionIntent());
			const rejected = expect(pending).rejects.toThrow();
			await bounded(entered.promise);
			await bounded(f.host.yield());
			await rejected;
			released.resolve();
			const host = await f.reopen();
			expect(
				(await host.readOwnedConfiguration(configurationQuery))?.selection,
			).toEqual({ model: "faux-1", thinking: "off" });
			expect(calls).toEqual([]);
		},
		{
			owned: true,
			configurationAuthority: async (query, selected) => {
				const result = await product.readConfigurationAuthority(
					query,
					selected,
				);
				if (held) {
					held = false;
					entered.resolve();
					await released.promise;
				}
				return result;
			},
		},
	);
});
it("queued follow-up preparation uses the owned change, not acceptance-time selection", async () => {
	await gate(
		"owned-follow-up",
		async (f) => {
			await credential.holdModel("credentials");
			await f.start();
			await bounded(credential.waitModel());
			await env.DB.batch([
				env.DB.prepare(
					"INSERT INTO session_commands(id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,targetRunId,payloadVersion,userMessageId,assistantMessageId,payloadDigest,acceptedAt,deadlineAt) VALUES('follow','owner','workspace_session','session','project','session','follow_up',2,'run',1,'follow-user','follow-assistant','fixture-follow',0,?)",
				).bind(Date.now() + 600000),
				env.DB.prepare(
					"INSERT INTO runtime_command_memberships(commandId,sessionId,runId,userMessageId,assistantMessageId,runEpoch) VALUES('follow','session','run','follow-user','follow-assistant',1)",
				),
			]);
			await f.host.accept("follow", "Synthetic follow-up", {
				run: "run",
				user: "follow-user",
				assistant: "follow-assistant",
				sequence: 2,
			});
			await expect(f.host.schedule("follow")).rejects.toThrow("boundary");
			expect((await f.host.configureOwned(selectionIntent())).status).toBe(
				"applied",
			);
			await credential.releaseModel();
			await bounded(f.settled);
			await f.host.waitIdle();
			await f.host.schedule("follow");
			await f.host.waitIdle();
			expect(calls.map((c) => [c.body.model, c.body.thinking])).toEqual([
				["faux-1", "off"],
				["faux-2", "low"],
			]);
		},
		{ owned: true },
	);
});
it("owned configuration leaves retries separately admitted with new preparation-time selection", async () => {
	upstream(503, "Synthetic known failure", 1);
	await gate(
		"owned-retry",
		async (f) => {
			await credential.holdModel("credentials");
			await f.start();
			await bounded(credential.waitModel());
			expect((await f.host.configureOwned(selectionIntent())).status).toBe(
				"applied",
			);
			await credential.releaseModel();
			await bounded(f.settled);
			await f.host.waitIdle();
			expect(calls.map((c) => [c.body.model, c.body.thinking])).toEqual([
				["faux-1", "off"],
				["faux-2", "low"],
			]);
			expect(await f.snapshot()).toMatchObject({
				windows: [{ consumedRequests: 1 }, { consumedRequests: 1 }],
				admissions: [{ state: "failed_known" }, { state: "complete" }],
			});
		},
		{ owned: true, retry: true },
	);
});

for (const purpose of ["generation", "custom_summary"] as const)
	it(`actual ${purpose} preparation survives close/reopen with an owned selection change`, async () => {
		let pause = purpose === "generation";
		const entered = deferred(),
			remote = deferred();
		await gate(
			`owned-prepared-${purpose}`,
			async (f) => {
				await f.start();
				if (purpose === "custom_summary") {
					await bounded(f.settled);
					await until(async () => {
						const row = f.storage.sql
							.exec<{ task: number }>(
								"SELECT task FROM host_tasks WHERE kind='pi.generation'",
							)
							.toArray()[0];
						return (
							!!row &&
							(await f.host.task(row.task as Parameters<typeof f.host.task>[0]))
								?.state.status === "terminal"
						);
					});
					pause = true;
					await f.host.compact("command");
				}
				await bounded(entered.promise);
				const before = calls.length;
				expect((await f.host.configureOwned(selectionIntent())).status).toBe(
					"applied",
				);
				const host = await f.reopen();
				expect(calls.length).toBe(before);
				pause = false;
				remote.resolve();
				await host.schedule("command");
				await host.waitIdle();
				expect(calls.at(-1)?.body).toMatchObject({
					purpose,
					model: "faux-1",
					thinking: "off",
				});
				expect(
					(await host.readOwnedConfiguration(configurationQuery))?.selection,
				).toEqual({ model: "faux-2", thinking: "low" });
				console.log(
					"[007-configuration-retained]",
					JSON.stringify({
						purpose,
						requests: calls.map((c) => ({
							model: c.body.model,
							thinking: c.body.thinking,
							purpose: c.body.purpose,
						})),
						snapshot: await f.snapshot(),
					}),
				);
			},
			{
				owned: true,
				encrypted: true,
				prepareModel: async (context) => {
					if (pause) {
						entered.resolve();
						const signal = context.abortSignal;
						signal?.throwIfAborted();
						let abort: (() => void) | undefined;
						try {
							await Promise.race([
								remote.promise,
								new Promise<never>((_, reject) => {
									abort = () =>
										reject(new Error("Synthetic preparation cancelled"));
									signal?.addEventListener("abort", abort, { once: true });
								}),
							]);
						} finally {
							if (abort) signal?.removeEventListener("abort", abort);
						}
					}
				},
			},
		);
	});

it("lost acknowledgment retry remains an owned receipt, not new entitlement or selection", async () => {
	await gate(
		"owned-receipt-revocation",
		async (f) => {
			const ack = await f.host.configureOwned(selectionIntent());
			await env.CodexCredential.getByName("owner").revoke("owner", 2);
			expect(await f.host.configureOwned(selectionIntent())).toEqual(ack);
			expect((await f.host.configureOwned(selectionIntent("new"))).status).toBe(
				"denied",
			);
			expect(
				(await f.host.readOwnedConfiguration(configurationQuery))?.selection,
			).toEqual(selectionIntent().selection);
			expect(calls).toEqual([]);
		},
		{ owned: true, encrypted: true },
	);
});
for (const field of ["payload_digest", "state", "outcome"] as const)
	it(`encrypted configuration evidence rejects ${field} tampering without changing Pi`, async () => {
		await gate(
			`owned-tamper-${field}`,
			async (f) => {
				await f.host.configureOwned(selectionIntent());
				const original = f.storage.sql
					.exec<{
						id: string;
						payload_digest: string;
						state: string;
						outcome: string;
					}>("SELECT * FROM host_configuration_intents")
					.one();
				const persisted = await piState(f.storage);
				f.storage.sql.exec(
					`UPDATE host_configuration_intents SET ${field}=?`,
					field === "state"
						? "pending"
						: field === "outcome"
							? original.outcome + "changed"
							: "0".repeat(64),
				);
				try {
					await expect(
						f.host.configureOwned(selectionIntent()),
					).rejects.toThrow();
					expect(await piState(f.storage)).toBe(persisted);
					expect(calls).toEqual([]);
				} finally {
					f.storage.sql.exec(
						"UPDATE host_configuration_intents SET payload_digest=?,state=?,outcome=? WHERE id=?",
						original.payload_digest,
						original.state,
						original.outcome,
						original.id,
					);
				}
			},
			{ owned: true, encrypted: true },
		);
	});

for (const phase of ["pending", "complete"] as const)
	for (const path of ["new-intent", "reopen"] as const)
		for (const field of ["state", "payload_digest", "id", "outcome"] as const)
			it(`configuration correction: authenticates ${phase} ${field} before ${path}`, async () => {
				let crashed = false;
				await gate(
					"configuration-correction",
					async (f) => {
						if (phase === "pending")
							await expect(
								f.host.configureOwned(selectionIntent("interrupted")),
							).rejects.toThrow("Correction pending crash");
						else
							expect(
								(await f.host.configureOwned(selectionIntent("completed")))
									.status,
							).toBe("applied");
						const before = await piState(f.storage);
						const original = f.storage.sql
							.exec<{
								id: string;
								payload_digest: string;
								state: string;
								outcome: string;
							}>("SELECT * FROM host_configuration_intents")
							.one();
						f.storage.sql.exec(
							`UPDATE host_configuration_intents SET ${field}=?`,
							field === "state"
								? phase === "pending"
									? "complete"
									: "pending"
								: field === "outcome"
									? original.outcome + "changed"
									: "0".repeat(64),
						);
						const corrupt = f.storage.sql
							.exec("SELECT * FROM host_configuration_intents")
							.toArray();
						await expect(
							path === "reopen"
								? f.reopen()
								: f.host.configureOwned(
										selectionIntent("newer", "faux-1", "high"),
									),
						).rejects.toThrow();
						expect(await piState(f.storage)).toBe(before);
						expect(
							f.storage.sql
								.exec("SELECT * FROM host_configuration_intents")
								.toArray(),
						).toEqual(corrupt);
						expect(calls).toEqual([]);
						console.log(
							"[007-correction-integrity]",
							JSON.stringify({
								phase,
								path,
								field,
								piUnchanged: true,
								evidenceUnchanged: true,
								calls: calls.length,
							}),
						);
					},
					{
						owned: true,
						encrypted: true,
						acceptCommand: false,
						configurationFault: (point) => {
							if (
								phase === "pending" &&
								!crashed &&
								point === "configuration-intent"
							) {
								crashed = true;
								throw new Error("Correction pending crash");
							}
						},
					},
				);
			});

it("the mandatory adapter constructs an exact credential-owned request and bounded stream through private RPC", async () => {
	upstream();
	await gate("valid", async (f) => {
		await f.start();
		await bounded(f.settled);
		await f.host.waitIdle();
		expect(calls).toHaveLength(1);
		expect(calls[0].body).toMatchObject({
			version: 1,
			protocol: "ditto-synthetic-ndjson-1",
			purpose: "generation",
			model: "faux-1",
			thinking: "off",
			options: { maxTokens: 4096 },
		});
		expect(calls[0].body.transcript).toContain("Synthetic request");
		expect(calls[0].headerNames).toEqual([
			"accept",
			"authorization",
			"content-type",
		]);
		expect(await f.snapshot()).toMatchObject({
			calls: 1,
			windows: [{ consumedRequests: 1, contractDenials: 0 }],
			admissions: [{ state: "complete" }],
			claims: [{ claimed: 1 }],
			runs: [{ state: "complete" }],
		});
		console.log(
			"[007-product-constructed]",
			JSON.stringify({ ...calls[0], frames, snapshot: await f.snapshot() }),
		);
	});
});

for (const transform of [
	(request: SyntheticModelRequestV1) => ({ ...request, method: "GET" }),
	(request: SyntheticModelRequestV1) => ({
		...request,
		url: `${request.url}?proxy=1`,
	}),
	(request: SyntheticModelRequestV1) => ({
		...request,
		headers: [...request.headers, ["authorization", "caller"]],
	}),
	(request: SyntheticModelRequestV1) => ({
		...request,
		body: request.body.replace('"version":1', '"version":1,"version":1'),
	}),
	(request: SyntheticModelRequestV1) => ({
		...request,
		body: JSON.stringify({ ...JSON.parse(request.body), thinking: "high" }),
	}),
])
	it(`invalid or differently bound request dispatches zero calls: ${transform.toString()}`, async () => {
		upstream();
		await gate(
			"request-denial",
			async (f) => {
				await f.start();
				await bounded(f.settled);
				expect(calls).toHaveLength(0);
				expect(await f.snapshot()).toMatchObject({
					windows: [{ consumedRequests: 0, contractDenials: 1 }],
					admissions: [],
					claims: [{ claimed: 0 }],
				});
			},
			{ transform },
		);
	});

const revocations = [
	"UPDATE projects SET userId='foreign'",
	"UPDATE workspace_sessions SET status='archived'",
	"UPDATE workspace_sessions SET runtimeOwnerVersion=2",
	"UPDATE workspace_sessions SET runtimeOwner='legacy'",
	"UPDATE sandbox_identities SET kind='project_seed'",
	"UPDATE sandbox_identities SET retiredAt=1",
	"UPDATE sandbox_identities SET lifecycleGeneration=2",
	"UPDATE sandbox_identities SET incarnationId='replacement'",
	"UPDATE sandbox_identities SET controllerNamespace='foreign'",
	"UPDATE codex_connections SET revoked=1,generation=2",
	"UPDATE codex_fixture_capabilities SET snapshot=json_set(snapshot,'$.models',json('[]'))",
];
for (const phase of ["authority", "credentials", "claim"] as const)
	for (const sql of revocations)
		it(`fresh D1 revocation after held ${phase} prevents attachment: ${sql}`, async () => {
			upstream();
			await credential.holdModel(phase);
			await gate(`race-${phase}`, async (f) => {
				await f.start();
				await bounded(credential.waitModel());
				// Foreign membership fixtures change the owner without creating an authorized replacement.
				if (sql.includes("userId='foreign'"))
					await env.DB.prepare(
						"INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('foreign','Foreign','foreign@example.invalid',0,0)",
					).run();
				await env.DB.prepare(sql).run();
				await credential.releaseModel();
				await bounded(f.settled);
				expect(calls).toHaveLength(0);
				expect(
					f.storage.sql.exec("SELECT claimed FROM host_model_dispatch").one()
						.claimed,
				).toBe(0);
			});
		});

it("Stop wins during credential preparation before the host acknowledgment, with zero fetches", async () => {
	upstream();
	await credential.holdModel("credentials");
	await gate("stop-preparation", async (f) => {
		await f.start();
		await bounded(credential.waitModel());
		await f.host.stop("stop", "run");
		await credential.releaseModel();
		await bounded(f.settled);
		expect(calls).toHaveLength(0);
		expect(await f.snapshot()).toMatchObject({
			windows: [{ consumedRequests: 1 }],
			admissions: [{ state: "failed_known" }],
			claims: [{ claimed: 0 }],
		});
	});
});

it("a model capability revoked while the actual claim flush is held is freshly denied after that flush", async () => {
	upstream();
	await gate("claim-flush-revoke", async (f) => {
		const hold = f.claimFlush();
		await f.start();
		await bounded(hold.entered);
		await env.DB.prepare(
			"UPDATE codex_fixture_capabilities SET revision=2",
		).run();
		hold.release();
		await bounded(f.settled);
		expect(calls).toHaveLength(0);
		expect(await f.snapshot()).toMatchObject({
			windows: [{ consumedRequests: 1 }],
			admissions: [{ state: "failed_known" }],
			claims: [{ claimed: 1 }],
		});
	});
});

it("three contract denials durably close the window, record review and halt the exact run without reentry", async () => {
	upstream();
	await gate(
		"three-denials",
		async (f) => {
			await f.start();
			await bounded(f.settled);
			expect(calls).toHaveLength(0);
			expect(await f.snapshot()).toMatchObject({
				windows: [
					{
						consumedRequests: 0,
						contractDenials: 3,
						closeReason: "contract_denials",
					},
				],
				runs: [{ state: "failed" }],
				claims: [{ claimed: 0 }],
			});
			expect(
				await env.DB.prepare(
					"SELECT runtimeFailureReasonCode FROM workspace_sessions",
				).first(),
			).toEqual({ runtimeFailureReasonCode: "model_contract_review" });
		},
		{ threeDenials: true },
	);
});

it("concurrent private requests cannot consume an exact window or live claim twice", async () => {
	upstream();
	await gate(
		"duplicate-request",
		async (f) => {
			await f.start();
			await bounded(f.settled);
			await f.host.waitIdle();
			expect(await f.snapshot()).toMatchObject({
				calls: 1,
				windows: [{ consumedRequests: 1 }],
				admissions: [{ state: "complete" }],
				claims: [{ claimed: 1 }],
			});
		},
		{ duplicate: true },
	);
});

it("identical local effect IDs remain independently scoped to owned workspace identities", async () => {
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO workspace_sessions(id,projectId,userId,status,sandboxIdentityId,runtimeOwner,runtimeOwnerVersion) VALUES('session-2','project','owner','active','executor-2','trusted_v1',1)",
		),
		env.DB.prepare(
			"INSERT INTO sandbox_identities(id,kind,sandboxId,containerId,userId,projectId,workspaceSessionId,state,controllerClass,controllerNamespace,incarnationId) VALUES('executor-2','workspace_session','sandbox-2','container-2','owner','project','session-2','ready','Sandbox','fixture-execution-v1','incarnation-2')",
		),
		env.DB.prepare(
			"INSERT INTO session_commands(id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,payloadVersion,userMessageId,assistantMessageId,payloadDigest,acceptedAt,deadlineAt) VALUES('command-2','owner','workspace_session','session-2','project','session-2','prompt',1,1,'user-message-2','assistant-2','fixture-digest',0,?)",
		).bind(Date.now() + 600000),
		env.DB.prepare(
			"INSERT INTO runtime_command_memberships(commandId,sessionId,runId,userMessageId,assistantMessageId,runEpoch) VALUES('command-2','session-2','run','user-message-2','assistant-2',1)",
		),
	]);
	const policy = new ModelProductAuthority(env.DB);
	const descriptor: ModelTransportDescriptorV1 = {
		version: 1,
		subject,
		requestDigest: "0".repeat(64),
		attempt: {
			version: 1,
			effectId: "local-effect",
			operationId: "local-operation",
			runId: "run",
			commandId: "command",
			assistantId: "assistant",
			taskId: 1,
			epoch: 1,
			attempt: 1,
			generation: 1,
			deadlineAt: Date.now() + 10000,
			requestDigest: "0".repeat(64),
			kind: "generation",
		},
	};
	const second: ModelTransportDescriptorV1 = {
		...descriptor,
		subject: {
			...subject,
			workspaceSessionId: "session-2",
			identityId: "executor-2",
			incarnationId: "incarnation-2",
		},
		attempt: {
			...descriptor.attempt,
			commandId: "command-2",
			assistantId: "assistant-2",
		},
	};
	const body = parseSyntheticModelBodyV1({
		version: 1,
		protocol: "ditto-synthetic-ndjson-1",
		purpose: "generation",
		model: "faux-1",
		thinking: "off",
		transcript: "Synthetic policy fixture",
		options: { maxTokens: 128 },
	});
	expect(await policy.reserve(descriptor, body)).not.toBeNull();
	expect(await policy.reserve(second, body)).not.toBeNull();
	expect(await policy.reserve(descriptor, body)).toBeNull();
	expect(
		(
			await env.DB.prepare(
				"SELECT effectId,windowId FROM model_request_admissions",
			).all()
		).results,
	).toHaveLength(2);
	expect(calls).toHaveLength(0);
});

it("window expiry during credential preparation denies before host claim and fetch", async () => {
	upstream();
	await credential.holdModel("credentials");
	await gate("expired-window", async (f) => {
		await f.start();
		await bounded(credential.waitModel());
		await env.DB.prepare("UPDATE privileged_operations SET expiresAt=1").run();
		await credential.releaseModel();
		await bounded(f.settled);
		expect(await f.snapshot()).toMatchObject({
			calls: 0,
			windows: [{ consumedRequests: 1 }],
			admissions: [{ state: "failed_known" }],
			claims: [{ claimed: 0 }],
		});
	});
});

it("production credentials remain unavailable even with connected fixture records", async () => {
	const stub = env.CodexCredential.getByName("owner");
	await runInDurableObject(stub, async (_instance, state) => {
		const production = new CodexCredential(state, env);
		expect(
			await production.requestModel(
				{},
				{
					describe: async () => {
						throw new Error("must not inspect");
					},
					claim: async () => ({ status: "admitted" }),
					halt: async () => ({ status: "halted" }),
				},
			),
		).toEqual({ version: 1, status: "unavailable" });
	});
	expect(calls).toHaveLength(0);
});

it.each([
	"faux-1",
	"faux-2",
] as const)("a known %s generation failure retries as a separate admitted attempt", async (model) => {
	upstream(503, "", 1);
	upstream();
	await gate(
		"generation-retry",
		async (f) => {
			await f.start();
			await until(() => calls.length === 2);
			await f.host.waitIdle();
			expect(calls.map((call) => call.body.model)).toEqual([model, model]);
			expect(
				f.storage.sql
					.exec("SELECT state FROM host_effects")
					.toArray()
					.every((row) => row.state === "pi-committed"),
			).toBe(true);
			expect(await f.snapshot()).toMatchObject({
				calls: 2,
				windows: [
					{ consumedRequests: 1, closeReason: "failed_known" },
					{ consumedRequests: 1, closeReason: "complete" },
				],
				admissions: [{ state: "failed_known" }, { state: "complete" }],
				claims: [{ claimed: 1 }, { claimed: 1 }],
			});
		},
		{ retry: true, model },
	);
});

it("Git metadata's reserved attempt is never refunded after a known failure", async () => {
	upstream(503, "", 1);
	upstream();
	await gate(
		"metadata-reservation",
		async (f) => {
			await f.start();
			await until(
				() =>
					f.storage.sql.exec("SELECT id FROM host_effects").toArray().length ===
					2,
			);
			await bounded(f.settled);
			await f.host.yield();
			expect(calls).toHaveLength(1);
			expect(await f.snapshot()).toMatchObject({
				windows: [{ consumedRequests: 1 }],
				admissions: [{ purpose: "git_metadata", state: "failed_known" }],
			});
		},
		{ retry: true, purpose: "git_metadata" },
	);
});

it("Stop after host acknowledgment retains the credential-bearing start and late product evidence", async () => {
	upstream();
	await gate("stop-after-admission", async (f) => {
		await f.start();
		await until(() => calls.length === 1);
		await f.host.stop("stop", "run");
		await bounded(f.settled);
		expect(calls).toHaveLength(1);
		expect(await f.snapshot()).toMatchObject({
			admissions: [{ state: "complete" }],
			claims: [{ claimed: 1 }],
		});
		expect(
			f.storage.sql.exec("SELECT state FROM host_effects").one().state,
		).toBe("admitted");
		console.log("[007-product-stop-after]", JSON.stringify(await f.snapshot()));
	});
});

it("accepted custom summaries use the same private transport and exactly one fresh association", async () => {
	upstream();
	await gate(
		"custom-summary",
		async (f) => {
			await f.start();
			await until(async () => {
				const row = f.storage.sql
					.exec<{ task: number }>(
						"SELECT task FROM host_tasks WHERE kind='pi.generation'",
					)
					.toArray()[0];
				return (
					!!row &&
					(await f.host.task(row.task as Parameters<typeof f.host.task>[0]))
						?.state.status === "terminal"
				);
			});
			await f.host.compact("command");
			await until(() => calls.length === 2);
			await f.host.waitIdle();
			expect(calls.map((call) => call.body.purpose)).toEqual([
				"generation",
				"custom_summary",
			]);
			expect(calls[1].body.transcript).toContain("Synthetic request");
			expect(await f.snapshot()).toMatchObject({
				admissions: [
					{ purpose: "generation", state: "complete" },
					{ purpose: "custom_summary", state: "complete" },
				],
				claims: [{ claimed: 1 }, { claimed: 1 }],
			});
			console.log(
				"[007-product-summary]",
				JSON.stringify({
					body: calls[1].body,
					frames,
					snapshot: await f.snapshot(),
				}),
			);
		},
		{ retry: true },
	);
});

it.each([
	"faux-1",
	"faux-2",
] as const)("a known %s custom summary failure spends its one attempt without an automatic retry", async (model) => {
	upstream(200, encodedFrames, 1);
	upstream(503, "");
	await gate(
		"custom-summary-failure",
		async (f) => {
			await f.start();
			await until(async () => {
				const row = f.storage.sql
					.exec<{ task: number }>(
						"SELECT task FROM host_tasks WHERE kind='pi.generation'",
					)
					.toArray()[0];
				return (
					!!row &&
					(await f.host.task(row.task as Parameters<typeof f.host.task>[0]))
						?.state.status === "terminal"
				);
			});
			await f.host.compact("command");
			await until(() => calls.length === 2);
			await until(
				async () =>
					!!(await env.DB.prepare(
						"SELECT 1 FROM model_request_admissions WHERE purpose='custom_summary' AND state='failed_known'",
					).first()),
			);
			await f.host.waitIdle();
			await f.host.yield();
			expect(calls.map((call) => call.body.model)).toEqual([model, model]);
			expect(
				f.storage.sql
					.exec("SELECT state FROM host_effects WHERE kind='model'")
					.toArray()
					.every((row) => row.state !== "admitted"),
			).toBe(true);
			expect(calls.map((call) => call.body.purpose)).toEqual([
				"generation",
				"custom_summary",
			]);
			expect(await f.snapshot()).toMatchObject({
				admissions: [
					{ state: "complete" },
					{ purpose: "custom_summary", state: "failed_known" },
				],
				claims: [{ claimed: 1 }, { claimed: 1 }],
				runs: [{ state: "failed" }],
			});
		},
		{ retry: true, model },
	);
});

it("disconnect of the local credential record while preparation is held prevents fetch even before a D1 projection", async () => {
	upstream();
	await credential.holdModel("credentials");
	await gate("local-disconnect", async (f) => {
		await f.start();
		await bounded(credential.waitModel());
		await env.CodexCredential.getByName("owner").revoke("owner", 2);
		await credential.releaseModel();
		await bounded(f.settled);
		expect(calls).toHaveLength(0);
		expect(await f.snapshot()).toMatchObject({
			admissions: [{ state: "failed_known" }],
			claims: [{ claimed: 0 }],
		});
	});
});

it("real epoch-first Stop during the claim durability flush prevents fetch without refunding consumption", async () => {
	upstream();
	await gate("claim-flush-stop", async (f) => {
		const hold = f.claimFlush();
		await f.start();
		await bounded(hold.entered);
		const stopped = f.host.stop("stop", "run");
		expect(
			f.storage.sql.exec("SELECT epoch FROM host_runs WHERE id='run'").one()
				.epoch,
		).toBe(2);
		hold.release();
		await bounded(stopped);
		await bounded(f.settled);
		expect(calls).toHaveLength(0);
		expect(await f.snapshot()).toMatchObject({
			admissions: [{ state: "failed_known" }],
			claims: [{ claimed: 1 }],
		});
	});
});

it("product revocation during the final host authority await is rechecked before fetch", async () => {
	const entered = deferred(),
		released = deferred();
	await gate(
		"final-host-read-product-revoke",
		async (f) => {
			try {
				await f.start();
				await bounded(entered.promise);
				await env.DB.prepare(
					"UPDATE codex_fixture_capabilities SET revision=2",
				).run();
			} finally {
				released.resolve();
			}
			await bounded(f.settled);
			expect(await f.snapshot()).toMatchObject({
				calls: 0,
				windows: [{ consumedRequests: 1 }],
				admissions: [{ state: "failed_known" }],
				claims: [{ claimed: 1 }],
			});
			console.log(
				"[007-correction-final-product]",
				JSON.stringify(await f.snapshot()),
			);
		},
		{ finalAuthorityHold: { entered, released } },
	);
});

it("actual transport after host reopen uses invocation generation 2 and D1 identity lifecycle 1", async () => {
	await gate(
		"unequal-generations",
		async (f) => {
			await f.start();
			await bounded(f.settled);
			await f.host.waitIdle();
			expect(calls).toHaveLength(1);
			expect(
				f.storage.sql
					.exec("SELECT generation,state FROM host_invocations ORDER BY rowid")
					.toArray(),
			).toEqual([
				{ generation: 1, state: "closed" },
				{ generation: 2, state: "active" },
			]);
			expect(
				await env.DB.prepare(
					"SELECT lifecycleGeneration FROM sandbox_identities",
				).first(),
			).toEqual({ lifecycleGeneration: 1 });
			expect(await f.snapshot()).toMatchObject({
				admissions: [{ state: "complete" }],
				claims: [{ claimed: 1 }],
				runs: [{ state: "complete" }],
			});
			console.log(
				"[007-correction-reopen]",
				JSON.stringify(await f.snapshot()),
			);
		},
		{ reopen: true },
	);
});

for (const phase of ["capability", "permit"] as const)
	for (const expiry of ["command", "window"] as const)
		it(`held actual D1 ${phase} query expires ${expiry} with valid host deadline and zero fetches`, async () => {
			const entered = deferred(),
				released = deferred();
			let now = Date.now();
			let descriptor: ModelTransportDescriptorV1 | undefined;
			const db = new Proxy(env.DB, {
				get(target, key) {
					if (key === "prepare")
						return (sql: string) => {
							const statement = target.prepare(sql);
							const match =
								phase === "capability"
									? sql.startsWith(
											"SELECT snapshot FROM codex_fixture_capabilities",
										)
									: sql.includes(
											"FROM privileged_operations w JOIN model_request_admissions",
										);
							if (!match) return statement;
							const wrap = (inner: D1PreparedStatement): D1PreparedStatement =>
								new Proxy(inner, {
									get(item, property) {
										if (property === "bind")
											return (...args: unknown[]) => wrap(item.bind(...args));
										if (property === "first")
											return async (
												...args: Parameters<D1PreparedStatement["first"]>
											) => {
												const row = await item.first(...args);
												entered.resolve();
												await released.promise;
												return row;
											};
										const value: unknown = Reflect.get(item, property, item);
										return typeof value === "function"
											? value.bind(item)
											: value;
									},
								});
							return wrap(statement);
						};
					const value: unknown = Reflect.get(target, key, target);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			await gate(
				`query-${phase}-${expiry}`,
				async (f) => {
					try {
						await f.start();
						await bounded(entered.promise);
						now += 100;
						if (!descriptor) throw new Error("Missing held-query descriptor");
						expect(now).toBeLessThan(descriptor.attempt.deadlineAt);
					} finally {
						released.resolve();
					}
					await bounded(f.settled);
					expect(await f.snapshot()).toMatchObject({
						calls: 0,
						windows: [{ consumedRequests: 1 }],
						claims: [{ claimed: 1 }],
					});
					console.log(
						"[007-correction-expiry]",
						JSON.stringify({
							phase,
							expiry,
							hostDeadlineValid:
								!!descriptor && now < descriptor.attempt.deadlineAt,
							snapshot: await f.snapshot(),
						}),
					);
				},
				{
					permit: async (request, d) => {
						descriptor = d;
						now = Date.now();
						await env.DB.prepare(
							expiry === "command"
								? "UPDATE session_commands SET deadlineAt=?"
								: "UPDATE privileged_operations SET expiresAt=?",
						)
							.bind(now + 50)
							.run();
						const body = parseSyntheticModelBodyV1(
							parseSyntheticModelRequestV1(request).body,
						);
						return {
							status: (await new ModelProductAuthority(db, () => now).permit(
								d,
								body,
							))
								? "current"
								: "denied",
						};
					},
				},
			);
		});

for (const response of [
	"truncated",
	`${JSON.stringify(frames[1])}\n{}\n`,
	"x".repeat(131073),
])
	it("malformed upstream outcomes retain uncertain admission without redispatch", async () => {
		upstream(200, response);
		await gate("unknown-upstream", async (f) => {
			await f.start();
			await bounded(f.settled);
			await f.host.yield();
			expect(await f.snapshot()).toMatchObject({
				calls: 1,
				windows: [{ consumedRequests: 1 }],
				admissions: [{ state: "outcome_unknown" }],
				claims: [{ claimed: 1 }],
			});
		});
	});
