import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { cooperativeFixture, pendingRemote } from "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime/src/pi-durable-cooperative-fixture.ts";
import { PiDurableHost, type ModelDispatch, type LocalAuthority, type HostFixtureDependencies } from "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime/src/pi-durable-host.ts";
import { importRuntimeKeyringFromBytes } from "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime/src/runtime-crypto.ts";

for (const encrypted of [false, true]) {
	for (const scenario of ["rewound-claim", "revocation-during-flush"] as const) {
		it(`advisor: ${scenario} must deny, encrypted=${encrypted}`, async () => {
			const stub = env.PI_HOST_STORAGE.getByName(`advisor-${scenario}-${encrypted}`);
			await runInDurableObject(stub, async (_instance, state) => {
				let authority: LocalAuthority = { current: true, generation: 1, executor: 1 };
				const entered = pendingRemote<ModelDispatch>();
				const hold = pendingRemote<void>();
				const flushEntered = pendingRemote<void>();
				const flushRelease = pendingRemote<void>();
				let holdFlush = false;
				const storage = new Proxy(state.storage, {
					get(target, key) {
						if (key === "sync") return async () => {
							if (holdFlush) { flushEntered.resolve(); await flushRelease.promise; }
							await target.sync();
						};
						const value = Reflect.get(target, key, target);
						return typeof value === "function" ? value.bind(target) : value;
					},
				});
				let fixture!: ReturnType<typeof cooperativeFixture>;
				const dependencies: HostFixtureDependencies = {
					now: () => Date.now() + 60_000,
					authority: async () => authority,
					budgets: { workMs: 10_000, drainMs: 1000 },
					operationMs: { model: 10_000, tool: 1000 },
					wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
					retained: encrypted ? {
						ownerId: "synthetic-owner", workspaceSessionId: "synthetic-session",
						keyring: await importRuntimeKeyringFromBytes("fixture", { fixture: new Uint8Array(32).fill(71) }),
					} : undefined,
					options: (guard) => {
						fixture = cooperativeFixture("request", (kind, id, context) => guard.admit(kind, id, context), (id, context, evidence) => guard.result(id, context, evidence), {
							...guard,
							model: (request, context, start) => guard.model(request, context, async (dispatch) => {
								entered.resolve(dispatch);
								await hold.promise;
								return start(dispatch);
							}),
						});
						return { now: dependencies.now, models: fixture.models, registry: fixture.registry, settings: { extensions: [fixture.extension], retry: { enabled: false }, compaction: { enabled: false } } };
					},
				};
				const host = await PiDurableHost.open(storage, dependencies);
				try {
					await host.accept("command", "Synthetic request", { run: "run", user: "user-message", assistant: "assistant", sequence: 1 });
					await host.schedule("command");
					const dispatch = await entered.promise;
					if (scenario === "rewound-claim") {
						await dispatch.claim(dispatch.attempt);
						state.storage.sql.exec("UPDATE host_model_dispatch SET claimed=0");
						await expect(dispatch.claim(dispatch.attempt)).rejects.toThrow();
					} else {
						holdFlush = true;
						const claim = dispatch.claim(dispatch.attempt);
						await flushEntered.promise;
						authority = { ...authority, current: false };
						holdFlush = false;
						flushRelease.resolve();
						await expect(claim).rejects.toThrow();
					}
				} finally {
					holdFlush = false;
					flushRelease.resolve();
					hold.resolve();
					fixture.remote.resolve();
					await host.yield();
					await state.storage.deleteAlarm();
					await state.storage.sync();
				}
			});
		});
	}
}
