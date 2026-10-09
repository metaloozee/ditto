import { env, runInDurableObject } from "cloudflare:test";
import { awaitWithContext } from "@earendil-works/chord/context";
import type { Storage } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { openHostField, sealHostField } from "./host-private.ts";
import {
	cooperativeFixture,
	pendingRemote,
} from "./pi-durable-cooperative-fixture.ts";
import {
	type HostFixtureDependencies,
	type HostGuard,
	type LocalAuthority,
	type ModelDispatch,
	PiDurableHost,
	type PiDurableHostFixture,
} from "./pi-durable-host.ts";
import {
	createPrivateModelAdapter,
	ExactModelClaim,
	type OwnedModelRequest,
} from "./pi-durable-models.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
		MODEL_CLAIM_RELAY: {
			forward(
				attempt: unknown,
				owned: unknown,
				capability: unknown,
			): Promise<{ status: "admitted" | "denied" }>;
		};
	}
}

async function boundary(
	name: string,
	encrypted: boolean,
	test: (fixture: {
		host: PiDurableHost;
		storage: DurableObjectStorage;
		dispatch: ModelDispatch;
		release(): void;
		settled: Promise<void>;
		started: Promise<void>;
		calls(): number;
		revoke(): void;
		changeAuthority(change: Partial<LocalAuthority>): void;
		expire(): void;
		hold(phase: "task" | "flush"): { entered: Promise<void>; release(): void };
		failFlush(): void;
		reopen(): Promise<void>;
		snapshot(): Promise<{
			claimed: number;
			receiptState: unknown;
			encryptedReceipt: boolean;
			effectState: string;
			epoch: number;
			calls: number;
		}>;
	}) => Promise<void>,
	claim: (dispatch: ModelDispatch) => Promise<void> = (dispatch) =>
		dispatch.claim(dispatch.attempt),
) {
	const stub = env.PI_HOST_STORAGE.getByName(
		`model-claim-${name}-${encrypted}`,
	);
	await runInDurableObject(stub, async (_instance, state) => {
		let now = Date.now() + 60_000;
		let authority: LocalAuthority = {
			current: true,
			generation: 1,
			executor: 1,
		};
		const entered = pendingRemote<ModelDispatch>();
		const productCheck = pendingRemote<void>();
		const settled = pendingRemote<void>();
		let fixture!: ReturnType<typeof cooperativeFixture>;
		const fixtures: ReturnType<typeof cooperativeFixture>[] = [];
		const waits = new Map<
			"task" | "flush",
			{
				entered: ReturnType<typeof pendingRemote<void>>;
				released: ReturnType<typeof pendingRemote<void>>;
			}
		>();
		const allWaits: ReturnType<typeof pendingRemote<void>>[] = [];
		const pause = async (phase: "task" | "flush") => {
			const wait = waits.get(phase);
			if (!wait) return;
			waits.delete(phase);
			wait.entered.resolve();
			await wait.released.promise;
		};
		let failFlush = false;
		const storage = new Proxy(state.storage, {
			get(target, key) {
				if (key === "sync")
					return async () => {
						await pause("flush");
						await target.sync();
						if (failFlush) {
							failFlush = false;
							throw new Error("Synthetic crash after claim persistence");
						}
					};
				const value: unknown = Reflect.get(target, key, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const dependencies: HostFixtureDependencies = {
			now: () => now,
			authority: async () => authority,
			budgets: { workMs: 10_000, drainMs: 1000 },
			operationMs: { model: 1000, tool: 1000 },
			wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
			piStorage: (records) =>
				new Proxy(records, {
					get(target, key) {
						if (key === "task")
							return async (...args: Parameters<Storage["task"]>) => {
								const value = await target.task(...args);
								await pause("task");
								return value;
							};
						const value: unknown = Reflect.get(target, key, target);
						return typeof value === "function" ? value.bind(target) : value;
					},
				}),
			retained: encrypted
				? {
						ownerId: "synthetic-owner",
						workspaceSessionId: "synthetic-session",
						keyring: await importRuntimeKeyringFromBytes("fixture", {
							fixture: new Uint8Array(32).fill(71),
						}),
					}
				: undefined,
			options: (guard) => {
				fixture = cooperativeFixture(
					"request",
					(kind, id, context) => guard.admit(kind, id, context),
					(id, context, evidence) => guard.result(id, context, evidence),
					{
						...guard,
						model: (request, context, start) =>
							guard.model(request, context, async (dispatch) => {
								entered.resolve(dispatch);
								try {
									await awaitWithContext(productCheck.promise, context);
									await claim(dispatch);
									return await start(dispatch);
								} finally {
									settled.resolve();
								}
							}),
					},
				);
				fixtures.push(fixture);
				return {
					now: () => now,
					models: fixture.models,
					registry: fixture.registry,
					settings: {
						extensions: [fixture.extension],
						retry: { enabled: false },
						compaction: { enabled: false },
					},
				};
			},
		};
		let host = await PiDurableHost.open(storage, dependencies);
		try {
			await host.accept("command", "Synthetic request", {
				run: "run",
				user: "user-message",
				assistant: "assistant",
				sequence: 1,
			});
			await host.schedule("command");
			const dispatch = await entered.promise;
			await test({
				get host() {
					return host;
				},
				storage: state.storage,
				dispatch,
				release: () => productCheck.resolve(),
				settled: settled.promise,
				started: fixture.entered.promise,
				calls: () =>
					fixtures.reduce((count, item) => count + item.providerCalls, 0),
				revoke: () => {
					authority = { ...authority, current: false };
				},
				changeAuthority: (change) => {
					authority = { ...authority, ...change };
				},
				expire: () => {
					now += 1001;
				},
				hold: (phase) => {
					const entered = pendingRemote<void>(),
						released = pendingRemote<void>();
					waits.set(phase, { entered, released });
					allWaits.push(released);
					return {
						entered: entered.promise,
						release: () => released.resolve(),
					};
				},
				failFlush: () => {
					failFlush = true;
				},
				reopen: async () => {
					await host.yield();
					host = await PiDurableHost.open(storage, dependencies);
				},
				snapshot: async () => {
					const effect = state.storage.sql
						.exec<{ id: string; state: string; model_dispatch?: string }>(
							"SELECT * FROM host_effects",
						)
						.one();
					let receiptState: unknown = "absent";
					if (effect.model_dispatch) {
						const plain = dependencies.retained
							? await openHostField(
									dependencies.retained,
									`effect:${effect.id}:model_dispatch`,
									effect.model_dispatch,
								)
							: effect.model_dispatch;
						const parsed: unknown = JSON.parse(plain);
						if (parsed && typeof parsed === "object" && "state" in parsed)
							receiptState = parsed.state;
					}
					const snapshot = {
						claimed: Number(
							state.storage.sql
								.exec("SELECT claimed FROM host_model_dispatch")
								.one().claimed,
						),
						receiptState,
						encryptedReceipt: !!effect.model_dispatch?.includes("aes-256-gcm"),
						effectState: effect.state,
						epoch: Number(
							state.storage.sql
								.exec("SELECT epoch FROM host_runs WHERE id='run'")
								.one().epoch,
						),
						calls: fixtures.reduce(
							(count, item) => count + item.providerCalls,
							0,
						),
					};
					console.log(
						"[007-model-claim-snapshot]",
						JSON.stringify({ name, encrypted, ...snapshot }),
					);
					return snapshot;
				},
			});
		} finally {
			for (const wait of allWaits) wait.resolve();
			failFlush = false;
			productCheck.resolve();
			for (const item of fixtures) item.remote.resolve();
			await host.yield();
			await state.storage.deleteAlarm();
			await state.storage.sync();
		}
	});
}

for (const encrypted of [false, true]) {
	for (const change of [{ current: false }, { executor: 2 }, { generation: 2 }])
		it(`held product callback denies changed host authority ${JSON.stringify(change)}, encrypted=${encrypted}`, async () =>
			boundary(`product-${JSON.stringify(change)}`, encrypted, async (f) => {
				const entered = pendingRemote<void>(),
					released = pendingRemote<void>();
				f.dispatch.bindProductAuthority(async () => {
					entered.resolve();
					await released.promise;
				});
				const claim = f.dispatch.claim(f.dispatch.attempt);
				const denied = expect(claim).rejects.toThrow();
				try {
					await entered.promise;
					f.changeAuthority(change);
				} finally {
					released.resolve();
				}
				await denied;
				expect(await f.snapshot()).toMatchObject({
					claimed: 1,
					receiptState: "consumed",
					effectState: "admitted",
					calls: 0,
				});
				await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow();
			}));

	it(`a rewound live claim cannot acknowledge consumption again, encrypted=${encrypted}`, async () =>
		boundary("rewound", encrypted, async (f) => {
			await f.dispatch.claim(f.dispatch.attempt);
			f.storage.sql.exec("UPDATE host_model_dispatch SET claimed=0");
			await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow();
			expect(await f.snapshot()).toMatchObject({
				receiptState: "consumed",
				effectState: "admitted",
				calls: 0,
			});
		}));

	for (const phase of ["task", "flush"] as const)
		for (const change of ["authority", "Stop"] as const)
			it(`claim denies ${change} during held ${phase}, encrypted=${encrypted}`, async () =>
				boundary(`${phase}-${change}`, encrypted, async (f) => {
					const hold = f.hold(phase);
					const claim = f.dispatch.claim(f.dispatch.attempt);
					// Observe rejection immediately so cancellation never becomes an unhandled promise.
					const denied = expect(claim).rejects.toThrow();
					await hold.entered;
					const before = await f.snapshot();
					let stop: Promise<void> | undefined;
					if (change === "authority") f.revoke();
					else {
						stop = f.host.stop("stop", "run");
						expect(
							Number(
								f.storage.sql
									.exec("SELECT epoch FROM host_runs WHERE id='run'")
									.one().epoch,
							),
						).toBeGreaterThan(f.dispatch.attempt.epoch);
					}
					hold.release();
					await denied;
					await stop;
					const after = await f.snapshot();
					expect(after.calls).toBe(0);
					expect(after.effectState).toBe("admitted");
					if (phase === "flush") {
						expect(before).toMatchObject({
							claimed: 1,
							receiptState: "consumed",
						});
						expect(after).toMatchObject({
							claimed: 1,
							receiptState: "consumed",
						});
					}
					await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow();
				}));

	it(`concurrent exact claims reserve only once, encrypted=${encrypted}`, async () =>
		boundary("concurrent", encrypted, async (f) => {
			const hold = f.hold("task");
			const first = f.dispatch.claim(f.dispatch.attempt);
			await hold.entered;
			await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow(
				"competing reservation",
			);
			hold.release();
			await first;
			await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow(
				"competing reservation",
			);
			expect(await f.snapshot()).toMatchObject({
				claimed: 1,
				receiptState: "consumed",
				calls: 0,
			});
		}));

	it(`actual joined close cancels a held claim flush without refund, encrypted=${encrypted}`, async () =>
		boundary("close-held-flush", encrypted, async (f) => {
			const hold = f.hold("flush");
			const claim = f.dispatch.claim(f.dispatch.attempt);
			const denied = expect(claim).rejects.toThrow();
			await hold.entered;
			const started = Date.now();
			await f.host.yield();
			const elapsedMs = Date.now() - started;
			console.log(
				"[007-model-claim-close]",
				JSON.stringify({ encrypted, elapsedMs }),
			);
			expect(elapsedMs).toBeLessThan(1000);
			await denied;
			expect(
				f.storage.sql
					.exec(
						"SELECT state FROM host_invocations ORDER BY rowid DESC LIMIT 1",
					)
					.one().state,
			).toBe("closed");
			expect(await f.snapshot()).toMatchObject({
				claimed: 1,
				receiptState: "consumed",
				effectState: "admitted",
				calls: 0,
			});
			hold.release();
			await f.reopen();
			await expect(f.host.schedule("command")).rejects.toThrow();
			expect(await f.snapshot()).toMatchObject({
				claimed: 1,
				receiptState: "consumed",
				effectState: "admitted",
				calls: 0,
			});
		}));

	it(`lost claim acknowledgment retains consumption across two reopens, encrypted=${encrypted}`, async () =>
		boundary("lost-ack", encrypted, async (f) => {
			f.failFlush();
			await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow(
				"Synthetic crash",
			);
			const before = await f.snapshot();
			expect(before).toMatchObject({
				claimed: 1,
				receiptState: "consumed",
				effectState: "admitted",
				calls: 0,
			});
			for (let n = 0; n < 2; n++) {
				await f.reopen();
				await expect(f.host.schedule("command")).rejects.toThrow();
				await f.host.accept(`replacement-${n}`, "Synthetic replacement");
				await expect(f.host.schedule(`replacement-${n}`)).rejects.toThrow();
				await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow();
				expect(await f.snapshot()).toMatchObject({
					claimed: 1,
					receiptState: "consumed",
					effectState: "admitted",
					calls: 0,
				});
			}
		}));

	for (const tamper of ["corrupt", "foreign-record"] as const)
		it(`dispatch receipt ${tamper} substitution denies live and reopened admission, encrypted=${encrypted}`, async () =>
			boundary(`receipt-${tamper}`, encrypted, async (f) => {
				const id = f.dispatch.attempt.effectId;
				const receiptId = `effect:${id}:model_dispatch`;
				let replacement = "invalid-receipt";
				if (tamper === "foreign-record") {
					const plain = JSON.stringify({
						version: 1,
						state: "reserved",
						attempt: { ...f.dispatch.attempt, effectId: "foreign-effect" },
					});
					if (encrypted) {
						const sealed = await sealHostField(
							{
								ownerId: "synthetic-owner",
								workspaceSessionId: "synthetic-session",
								keyring: await importRuntimeKeyringFromBytes("fixture", {
									fixture: new Uint8Array(32).fill(71),
								}),
							},
							"effect:foreign-effect:model_dispatch",
							plain,
						);
						replacement = sealed.ciphertext;
						f.storage.sql.exec(
							"UPDATE host_seal SET digest=? WHERE record_id=?",
							sealed.digest,
							receiptId,
						);
					} else replacement = plain;
				}
				f.storage.sql.exec(
					"UPDATE host_effects SET model_dispatch=? WHERE id=?",
					replacement,
					id,
				);
				await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow();
				expect(f.calls()).toBe(0);
				expect(
					f.storage.sql.exec("SELECT state FROM host_effects").one().state,
				).toBe("admitted");
				if (encrypted) await expect(f.reopen()).rejects.toThrow();
				else {
					await f.reopen();
					await expect(f.host.schedule("command")).rejects.toThrow();
				}
				expect(f.calls()).toBe(0);
			}));

	it(`an older reserved receipt cannot refund an uncertain effect across reopens, encrypted=${encrypted}`, async () =>
		boundary("reserved-rollback", encrypted, async (f) => {
			const id = f.dispatch.attempt.effectId;
			const receiptId = `effect:${id}:model_dispatch`;
			const original = f.storage.sql
				.exec<{ model_dispatch: string }>(
					"SELECT model_dispatch FROM host_effects WHERE id=?",
					id,
				)
				.one().model_dispatch;
			const oldSeal = encrypted
				? f.storage.sql
						.exec<{ digest: string }>(
							"SELECT digest FROM host_seal WHERE record_id=?",
							receiptId,
						)
						.one().digest
				: undefined;
			await f.dispatch.claim(f.dispatch.attempt);
			expect(await f.snapshot()).toMatchObject({
				claimed: 1,
				receiptState: "consumed",
			});
			f.storage.sql.exec(
				"UPDATE host_effects SET model_dispatch=? WHERE id=?",
				original,
				id,
			);
			f.storage.sql.exec("UPDATE host_model_dispatch SET claimed=0");
			if (oldSeal)
				f.storage.sql.exec(
					"UPDATE host_seal SET digest=? WHERE record_id=?",
					oldSeal,
					receiptId,
				);
			await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow();
			for (let n = 0; n < 2; n++) {
				await f.reopen();
				await expect(f.host.schedule("command")).rejects.toThrow();
				expect(await f.snapshot()).toMatchObject({
					effectState: "admitted",
					calls: 0,
				});
				expect(
					f.storage.sql.exec("SELECT * FROM host_effects").toArray(),
				).toHaveLength(1);
			}
		}));

	it(`dispatch digest substitution denies before consumption, encrypted=${encrypted}`, async () =>
		boundary("digest-substitution", encrypted, async (f) => {
			f.storage.sql.exec(
				"UPDATE host_model_dispatch SET request_digest=?",
				"0".repeat(64),
			);
			await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow();
			expect(await f.snapshot()).toMatchObject({
				claimed: 0,
				receiptState: "reserved",
				calls: 0,
			});
		}));

	it(`a claimed exact attempt starts once and Stop retains its admitted work, encrypted=${encrypted}`, async () =>
		boundary("claimed-stop", encrypted, async (f) => {
			f.release();
			await f.started;
			expect(f.calls()).toBe(1);
			expect(
				f.storage.sql.exec("SELECT claimed FROM host_model_dispatch").one()
					.claimed,
			).toBe(1);
			await f.host.stop("stop", "run");
			await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow();
			expect(f.calls()).toBe(1);
			expect(
				f.storage.sql.exec("SELECT state FROM host_effects").one().state,
			).toBe("admitted");
		}));

	it(`host model claim denies Stop while transport check is held, encrypted=${encrypted}`, async () =>
		boundary("stop", encrypted, async (f) => {
			const epoch = f.dispatch.attempt.epoch;
			await f.host.stop("stop", "run");
			expect(
				f.storage.sql.exec("SELECT epoch FROM host_runs WHERE id='run'").one()
					.epoch,
			).toBeGreaterThan(epoch);
			await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow();
			f.release();
			await f.settled;
			expect(f.calls()).toBe(0);
			expect(
				f.storage.sql.exec("SELECT claimed FROM host_model_dispatch").one()
					.claimed,
			).toBe(0);
			expect(
				f.storage.sql.exec("SELECT state FROM host_effects").one().state,
			).toBe("admitted");
		}));

	it(`host model claim rechecks local revocation after a held check, encrypted=${encrypted}`, async () =>
		boundary("revoke", encrypted, async (f) => {
			f.revoke();
			f.release();
			await f.settled;
			expect(f.calls()).toBe(0);
			expect(
				f.storage.sql.exec("SELECT claimed FROM host_model_dispatch").one()
					.claimed,
			).toBe(0);
		}));

	it(`host model claim denies an expired admitted attempt, encrypted=${encrypted}`, async () =>
		boundary("expire", encrypted, async (f) => {
			f.expire();
			f.release();
			await f.settled;
			expect(f.calls()).toBe(0);
			expect(
				f.storage.sql.exec("SELECT claimed FROM host_model_dispatch").one()
					.claimed,
			).toBe(0);
		}));

	it(`exact claim is one-shot and independent of the waiting provider lane, encrypted=${encrypted}`, async () =>
		boundary("exact", encrypted, async (f) => {
			for (const changed of [
				{ epoch: f.dispatch.attempt.epoch + 1 },
				{ effectId: "foreign-effect" },
				{ taskId: f.dispatch.attempt.taskId + 1 },
				{ requestDigest: "0".repeat(64) },
			]) {
				await expect(
					f.dispatch.claim({ ...f.dispatch.attempt, ...changed }),
				).rejects.toThrow("mismatch");
			}
			await f.dispatch.claim(f.dispatch.attempt);
			expect(
				f.storage.sql.exec("SELECT claimed FROM host_model_dispatch").one()
					.claimed,
			).toBe(1);
			await expect(f.dispatch.claim(f.dispatch.attempt)).rejects.toThrow(
				"competing reservation",
			);
			// The original held transport cannot consume the same attempt again.
			f.release();
			await f.settled;
			expect(f.calls()).toBe(0);
		}));
}

for (const aborted of [false, true])
	it(`registered adapter terminal error retains faux-2 identity, aborted=${aborted}`, async () => {
		const controller = new AbortController();
		const unavailable = async (): Promise<never> => {
			if (aborted) controller.abort();
			throw new Error("Synthetic pre-dispatch denial");
		};
		const guard: HostGuard = {
			summarize: unavailable,
			bindGeneration: unavailable,
			bindCompaction: unavailable,
			model: unavailable,
			tool: unavailable,
			admit: unavailable,
			result: unavailable,
		};
		const adapter = createPrivateModelAdapter(
			guard,
			{ requestModel: unavailable, readModelPermit: unavailable },
			{
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
			},
		);
		const model = adapter.models.getModel("faux", "faux-2");
		if (!model) throw new Error("Missing synthetic supported faux-2");
		const response = await adapter.models.completeSimple(
			model,
			{
				messages: [
					{ role: "user", content: "Synthetic request", timestamp: 0 },
				],
			},
			{ signal: controller.signal },
		);
		expect(response).toMatchObject({
			provider: "faux",
			model: "faux-2",
			stopReason: aborted ? "aborted" : "error",
		});
	});

const ownedRpcRequest: OwnedModelRequest = {
	userId: "synthetic-owner",
	projectId: "synthetic-project",
	workspaceSessionId: "synthetic-session",
	requestDigest: "a".repeat(64),
};
const rpcAdmission = (dispatch: ModelDispatch) =>
	env.MODEL_CLAIM_RELAY.forward(
		dispatch.attempt,
		ownedRpcRequest,
		new ExactModelClaim(dispatch, ownedRpcRequest),
	);
const rpcClaim = async (dispatch: ModelDispatch) => {
	const result = await rpcAdmission(dispatch);
	if (result.status !== "admitted")
		throw new Error("Private RPC admission denied");
};

for (const encrypted of [false, true]) {
	it(`private Worker RPC carries the live exact claim and admits one start, encrypted=${encrypted}`, async () =>
		boundary(
			"rpc-admit",
			encrypted,
			async (f) => {
				f.release();
				await f.started;
				expect(f.calls()).toBe(1);
				expect(await f.snapshot()).toMatchObject({
					claimed: 1,
					receiptState: "consumed",
					effectState: "admitted",
				});
				expect(await rpcAdmission(f.dispatch)).toEqual({ status: "denied" });
				expect(f.calls()).toBe(1);
			},
			rpcClaim,
		));

	it(`real epoch-first Stop wins before a private RPC acknowledgment, encrypted=${encrypted}`, async () =>
		boundary(
			"rpc-stop-first",
			encrypted,
			async (f) => {
				const hold = f.hold("flush");
				f.release();
				await hold.entered;
				const stopped = f.host.stop("rpc-stop", "run");
				expect(
					f.storage.sql.exec("SELECT epoch FROM host_runs WHERE id='run'").one()
						.epoch,
				).toBe(2);
				hold.release();
				await stopped;
				await f.settled;
				expect(f.calls()).toBe(0);
				expect(await f.snapshot()).toMatchObject({
					epoch: 3,
					receiptState: "consumed",
					effectState: "admitted",
				});
			},
			rpcClaim,
		));

	it(`Stop after a private RPC acknowledgment retains the admitted start, encrypted=${encrypted}`, async () =>
		boundary(
			"rpc-stop-after",
			encrypted,
			async (f) => {
				f.release();
				await f.started;
				await f.host.stop("rpc-stop", "run");
				expect(f.calls()).toBe(1);
				expect(await f.snapshot()).toMatchObject({
					epoch: 2,
					claimed: 1,
					receiptState: "consumed",
					effectState: "admitted",
				});
			},
			rpcClaim,
		));

	it(`private RPC rejects foreign owned context and a JSON-only association, encrypted=${encrypted}`, async () =>
		boundary("rpc-foreign", encrypted, async (f) => {
			const target = new ExactModelClaim(f.dispatch, ownedRpcRequest);
			expect(
				await env.MODEL_CLAIM_RELAY.forward(
					f.dispatch.attempt,
					{ ...ownedRpcRequest, workspaceSessionId: "foreign-session" },
					target,
				),
			).toEqual({ status: "denied" });
			expect(
				await env.MODEL_CLAIM_RELAY.forward(
					f.dispatch.attempt,
					ownedRpcRequest,
					{ attempt: f.dispatch.attempt },
				),
			).toEqual({ status: "denied" });
			expect(await f.snapshot()).toMatchObject({ claimed: 0, calls: 0 });
		}));
}
