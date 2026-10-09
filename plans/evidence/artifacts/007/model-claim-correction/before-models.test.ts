import { env, runInDurableObject } from "cloudflare:test";
import { awaitWithContext } from "@earendil-works/chord/context";
import { expect, it } from "vitest";
import {
	cooperativeFixture,
	pendingRemote,
} from "./pi-durable-cooperative-fixture.ts";
import {
	type HostFixtureDependencies,
	type LocalAuthority,
	type ModelDispatch,
	PiDurableHost,
	type PiDurableHostFixture,
} from "./pi-durable-host.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
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
		expire(): void;
	}) => Promise<void>,
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
		const dependencies: HostFixtureDependencies = {
			now: () => now,
			authority: async () => authority,
			budgets: { workMs: 10_000, drainMs: 1000 },
			operationMs: { model: 1000, tool: 1000 },
			wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
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
									await dispatch.claim(dispatch.attempt);
									return await start(dispatch);
								} finally {
									settled.resolve();
								}
							}),
					},
				);
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
		const host = await PiDurableHost.open(state.storage, dependencies);
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
				host,
				storage: state.storage,
				dispatch,
				release: () => productCheck.resolve(),
				settled: settled.promise,
				started: fixture.entered.promise,
				calls: () => fixture.providerCalls,
				revoke: () => {
					authority = { ...authority, current: false };
				},
				expire: () => {
					now += 1001;
				},
			});
		} finally {
			productCheck.resolve();
			fixture.remote.resolve();
			await host.yield();
			await state.storage.deleteAlarm();
			await state.storage.sync();
		}
	});
}

for (const encrypted of [false, true]) {
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
