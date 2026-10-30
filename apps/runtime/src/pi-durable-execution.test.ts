import { env, runInDurableObject } from "cloudflare:test";
import {
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import {
	createRegistry,
	defineExtension,
	GenerationTask,
	hook,
} from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import {
	fakeArchiveProduct,
	fakeProduct,
	fakeRestoreProduct,
	seed,
} from "./pi-durable-checkpoint.fixture.ts";
import {
	composeCandidateExecution,
	type ExecutionSandbox,
} from "./pi-durable-execution.ts";
import { candidateGit } from "./pi-durable-execution-session.ts";
import {
	PiDurableHost,
	type PiDurableHostFixture,
	requestDigest,
	semanticTranscript,
} from "./pi-durable-host.ts";
import { previewToken, previewTokenDigest } from "./pi-durable-preview.ts";
import {
	collect,
	encoder,
	fakeBranch,
	HEAD,
	sha256,
	streamOf,
} from "./pi-durable-recovery.fixture.ts";
import { createRemoteTools } from "./pi-durable-tools.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
		RECOVERY_ARTIFACTS: R2Bucket;
	}
}

const DAY = 24 * 60 * 60 * 1000;

/** A sandbox whose commands are scripted from what the image-owned CLIs print. */
function scriptedSandbox() {
	const state = {
		files: { "README.md": "seed" } as Record<string, string>,
		head: HEAD,
		blob: new Uint8Array(),
		commands: [] as string[],
		writes: [] as [string, string][],
		streamWrites: 0,
		restoredDigests: [] as string[],
		outbound: [] as { name: string; params: unknown; commandsSeen: number }[],
		fetchFails: false,
		exposed: new Map<number, string>(),
		process: null as { status: string } | null,
		calls: [] as string[],
		readyFails: false,
		unexposeFails: false,
		unexposeThrows: false,
		unexposeNoop: false,
		getProcessThrows: false,
		slowKill: 0,
		killed: false,
		reads: 0,
	};
	const json = (value: unknown) => ({
		exitCode: 0,
		stdout: JSON.stringify(value),
	});
	const sandbox: ExecutionSandbox = {
		async exec(command) {
			state.commands.push(command);
			if (command.startsWith("ditto-exec init")) return json({});
			if (command.startsWith("ditto-exec run ")) {
				const request = state.writes.at(-1);
				const operation = JSON.parse(request?.[1] ?? "{}") as {
					operationId: string;
				};
				return json({
					version: 1,
					operationId: operation.operationId,
					status: "completed",
					isError: false,
					text: "ok",
					truncated: false,
				});
			}
			if (command.includes("archive-cli.js create")) {
				state.blob = encoder.encode(
					JSON.stringify({ files: state.files, head: state.head }),
				);
				return json({
					ok: true,
					action: "create",
					compressedBytes: state.blob.byteLength,
					extractedBytes: state.blob.byteLength,
					digest: await sha256(state.blob),
				});
			}
			if (command.includes("archive-cli.js restore")) {
				const expected = /--expected-sha256 ([0-9a-f]{64})/.exec(command)?.[1];
				const actual = await sha256(state.blob);
				if (expected !== actual)
					return json({ ok: false, error: "precheck_digest_mismatch" });
				state.restoredDigests.push(actual);
				const parsed = JSON.parse(new TextDecoder().decode(state.blob)) as {
					files: Record<string, string>;
					head: string;
				};
				state.files = parsed.files;
				state.head = parsed.head;
				return json({
					ok: true,
					action: "restore",
					compressedBytes: state.blob.byteLength,
					extractedBytes: state.blob.byteLength,
					digest: actual,
				});
			}
			if (command.includes("rev-parse --verify"))
				return { exitCode: 0, stdout: `${state.head}\n` };
			if (command.includes("--is-inside-work-tree"))
				return { exitCode: 0, stdout: "true\n" };
			if (command.startsWith("ditto-workspace status"))
				return json({ ok: true, branch: "b", head: state.head, changed: 2 });
			if (command.startsWith("ditto-workspace fetch"))
				return state.fetchFails
					? json({ ok: false, error: "git_failed" })
					: json({ ok: true, head: HEAD });
			if (command.startsWith("ditto-workspace preview command"))
				return json({
					ok: true,
					command: "npx vite --port 10000",
					cwd: "/workspace",
					env: { PORT: "10000" },
				});
			if (command.startsWith("ditto-workspace preview ready"))
				return state.readyFails
					? json({ ok: false, error: "not_ready" })
					: json({ ok: true, ready: true });
			if (command.startsWith("ditto-workspace commit"))
				return json({ ok: true, committed: true, head: "c".repeat(40) });
			return { exitCode: 0, stdout: "" };
		},
		async startProcess() {
			state.calls.push("startProcess");
			state.process = { status: "running" };
			state.killed = false;
			return {};
		},
		async getProcess() {
			state.calls.push("getProcess");
			if (state.getProcessThrows) throw new Error("rpc");
			if (state.killed) {
				state.reads += 1;
				if (state.reads > state.slowKill) state.process = null;
			}
			return state.process;
		},
		async killProcess() {
			state.calls.push("killProcess");
			state.killed = true;
			state.reads = 0;
			if (state.slowKill === 0) state.process = null;
			return {};
		},
		async exposePort(port, options) {
			state.calls.push("exposePort");
			state.exposed.set(port, options.token);
			return { url: `http://10000-c-workspace-${options.token}.localhost/` };
		},
		async unexposePort(port) {
			state.calls.push("unexposePort");
			if (state.unexposeThrows || state.unexposeFails)
				throw new Error("unexpose failed");
			if (!state.unexposeNoop) state.exposed.delete(port);
			return {};
		},
		async getExposedPorts() {
			return [...state.exposed].map(([port, token]) => ({
				port,
				url: `http://10000-c-workspace-${token}.localhost/`,
			}));
		},
		async setOutboundHandler(name, params) {
			state.outbound.push({
				name,
				params,
				commandsSeen: state.commands.length,
			});
		},
		async readFile(_path, _options) {
			return { content: streamOf(state.blob) };
		},
		async writeFile(path, content) {
			if (typeof content === "string") state.writes.push([path, content]);
			else {
				state.streamWrites += 1;
				state.blob = await collect(content);
			}
			return {};
		},
	};
	return { sandbox, state };
}

type Control = { now: number };

/** A host composed through `composeCandidateExecution`, as the execution session composes it. */
async function harness(
	name: string,
	run: (context: {
		host(): PiDurableHost;
		open(): Promise<PiDurableHost>;
		storage: DurableObjectStorage;
		sandbox: ReturnType<typeof scriptedSandbox>;
		composed: ReturnType<typeof composeCandidateExecution>;
		control: Control;
		branch: ReturnType<typeof fakeBranch>;
		/** Establishes the baseline through the composed publisher and its brokered fetch. */
		baseline(): Promise<{ id: string }>;
		/** A publisher over the same sandbox adapters and R2 store, for boundary pairs. */
		publisher(): ReturnType<
			ReturnType<typeof composeCandidateExecution>["restorer"]
		>;
		model: { calls: number };
	}) => Promise<void>,
	options: { previewHostname?: string | null } = {},
) {
	await runInDurableObject(
		env.PI_HOST_STORAGE.getByName(name),
		async (_instance, state) => {
			const keyring = await importRuntimeKeyringFromBytes("v1", {
				v1: new Uint8Array(32).fill(3),
			});
			const control: Control = { now: Date.now() + 60_000 };
			const sandbox = scriptedSandbox();
			const binding = {
				ownerId: "owner",
				workspaceSessionId: "workspace",
				keyring,
			};
			const branch = fakeBranch();
			const scope = {
				version: 2,
				userId: "owner",
				projectId: "project",
				workspaceSessionId: "workspace",
				ownerVersion: 1,
			};
			const composed = composeCandidateExecution({
				storage: state.storage,
				binding,
				sandbox: sandbox.sandbox,
				bucket: env.RECOVERY_ARTIFACTS,
				branchAuthority: branch.branch,
				outboundScope: scope,
				branch: "b",
				now: () => control.now,
				previewHostname:
					options.previewHostname === null
						? undefined
						: (options.previewHostname ?? "localhost"),
				sleep: async () => {},
			});
			const product = fakeProduct();
			const restore = fakeRestoreProduct();
			const archive = fakeArchiveProduct();
			const model = { calls: 0 };
			const faux = fauxProvider({ tokensPerSecond: 0 });
			const steps: ((context: unknown) => AssistantMessage)[] = [
				() =>
					fauxAssistantMessage([fauxToolCall("ls", {}, { id: "call-0" })], {
						stopReason: "toolUse",
						timestamp: 1,
					}),
				() => fauxAssistantMessage("done", { timestamp: 2 }),
			];
			let host: PiDurableHost | undefined;
			const open = async () => {
				host = await PiDurableHost.open(state.storage, {
					now: () => control.now,
					authority: async () => ({
						current: true,
						generation: 1,
						executor: 1,
						liveExecutors: 1,
					}),
					budgets: { workMs: 10_000, drainMs: 1000 },
					operationMs: { model: 60_000, tool: 60_000 },
					wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
					retained: { ...binding },
					checkpoints: {
						applyProjections: product.apply,
						completeRestore: restore.apply,
						completeArchive: archive.apply,
						restorer: composed.restorer,
						workspace: composed.workspace,
						store: composed.store,
					},
					options: (guard) => {
						const models = createModels({
							authContext: {
								env: async () => undefined,
								fileExists: async () => false,
							},
						});
						const stream: typeof faux.provider.stream = (
							fauxModel,
							transcript,
							options,
						) => {
							const events = createAssistantMessageEventStream();
							const context = options?.signal
								? withAbortSignal(options.signal, BACKGROUND_CONTEXT)
								: BACKGROUND_CONTEXT;
							void (async () => {
								try {
									const admitted = await guard.model(
										{
											model: {
												provider: fauxModel.provider,
												id: fauxModel.id,
											},
											transcript,
											options: { ...options },
										},
										context,
										async () => {
											const step = steps[model.calls++];
											if (!step) throw new Error("Unscripted model call");
											return {
												...step(transcript),
												model: fauxModel.id,
												provider: fauxModel.provider,
											};
										},
									);
									const message = await admitted.response;
									await guard.result(
										admitted.effect,
										context,
										JSON.stringify(message),
									);
									events.push({
										type: "done",
										reason:
											message.stopReason === "toolUse" ? "toolUse" : "stop",
										message,
									});
								} catch (error) {
									events.push({
										type: "error",
										reason: "error",
										error: fauxAssistantMessage([], {
											stopReason: "error",
											errorMessage:
												error instanceof Error ? error.message : "error",
										}),
									});
								} finally {
									events.end();
								}
							})();
							return events;
						};
						models.setProvider({
							...faux.provider,
							stream,
							streamSimple: stream,
						});
						const remote = createRemoteTools(guard, {
							workspaceSessionId: "workspace",
							executor: () => composed.executor,
							projectValues: async (request) => ({
								version: 1,
								operationId: request.operationId,
								status: "granted",
								values: [],
							}),
							now: () => control.now,
						});
						const binder = defineExtension({
							name: "ditto-test-generation",
							hooks: [
								hook(GenerationTask, {
									beforeRequest: async (request, api, context) => {
										await guard.bindGeneration(
											api,
											await requestDigest(
												semanticTranscript(
													normalizeContext({ messages: [...request.messages] }),
												),
											),
											context,
										);
										return undefined;
									},
								}),
							],
						});
						const registry = createRegistry();
						registry.install(binder);
						registry.install(remote.extension);
						return {
							now: () => control.now,
							models,
							registry,
							settings: {
								extensions: [binder, remote.extension],
								toolExecution: "sequential",
								retry: { enabled: false },
								compaction: { enabled: false, backgroundTokens: 0 },
							},
						};
					},
				});
				return host;
			};
			const publisher = () =>
				composed.restorer((host as PiDurableHost).checkpointPort());
			try {
				await run({
					open,
					host: () => {
						if (!host) throw new Error("Host not open");
						return host;
					},
					storage: state.storage,
					sandbox,
					composed,
					control,
					model,
					branch,
					publisher,
					async baseline() {
						const result = await publisher().establishBaseline({
							seed: await seed(composed.store),
							branch: "b",
						});
						if (result.status !== "published")
							throw new Error(JSON.stringify(result));
						return result.manifest;
					},
				});
			} finally {
				await host?.yield().catch(() => undefined);
				await host?.awaitClosure().catch(() => undefined);
				await state.storage.deleteAlarm();
			}
		},
	);
}

const execCommands = (commands: string[]) =>
	commands.filter((command) => command.startsWith("ditto-exec run"));
const listed = async () =>
	(await env.RECOVERY_ARTIFACTS.list()).objects.map((object) => object.key);

it("dispatches no tool before a baseline and reaches the sandbox executor after one", async () => {
	await harness("execution-baseline", async (context) => {
		const host = await context.open();
		await host.accept("first", "Synthetic request");
		await host.schedule("first").catch(() => undefined);
		await host.waitIdle().catch(() => undefined);
		expect(context.model.calls).toBe(0);
		expect(context.sandbox.state.commands).toEqual([]);

		await context.baseline();
		await host.schedule("first");
		await host.waitIdle();
		expect(execCommands(context.sandbox.state.commands)).toHaveLength(1);
		expect(
			context.sandbox.state.commands.some((command) =>
				command.startsWith("ditto-exec init "),
			),
		).toBe(true);
	});
});

it("establishes the baseline once through the host and releases queued work", async () => {
	await harness("execution-host-baseline", async (context) => {
		const host = await context.open();
		await host.accept("first", "Synthetic request");
		await host.schedule("first").catch(() => undefined);
		await host.waitIdle().catch(() => undefined);
		expect(context.model.calls).toBe(0);

		const input = { seed: await seed(context.composed.store), branch: "b" };
		const first = await host.establishCandidateBaseline(input);
		expect(first.status).toBe("published");
		await host.schedule("first");
		await host.waitIdle();
		expect(execCommands(context.sandbox.state.commands)).toHaveLength(1);

		const before = [...context.sandbox.state.commands];
		expect(await host.establishCandidateBaseline(input)).toEqual({
			status: "deferred",
			reason: "baseline_exists",
		});
		expect(context.sandbox.state.commands).toEqual(before);
	});
});

it("does not touch the restorer once the host has yielded", async () => {
	await harness("execution-host-baseline-sealed", async (context) => {
		const host = await context.open();
		const input = { seed: await seed(context.composed.store), branch: "b" };
		await host.yield();
		await host.awaitClosure();
		const before = [...context.sandbox.state.commands];
		expect(await host.establishCandidateBaseline(input)).toEqual({
			status: "deferred",
			reason: "unavailable",
		});
		expect(context.sandbox.state.commands).toEqual(before);
		expect(context.sandbox.state.streamWrites).toBe(0);
	});
});

it("publishes pairs to R2 and restores them through the same store with the published digest", async () => {
	await harness("execution-recovery", async (context) => {
		await context.open();
		const manifest = (await context.baseline()) as {
			id: string;
			archive: { objectKey: string; digest: string };
			context: { objectKey: string };
		};
		const keys = await listed();
		expect(keys).toContain(manifest.archive.objectKey);
		expect(keys).toContain(manifest.context.objectKey);
		expect(context.sandbox.state.streamWrites).toBeGreaterThan(0);

		context.sandbox.state.files = { "README.md": "changed" };
		const restorer = context.composed.restorer(context.host().checkpointPort());
		const restored = await restorer.restorePair(
			manifest.id,
			async (_, confirm) => {
				confirm();
				return 1;
			},
		);
		expect(restored.status).toBe("restored");
		expect(context.sandbox.state.restoredDigests).toContain(
			manifest.archive.digest,
		);
		expect(context.sandbox.state.files).toEqual({ "README.md": "seed" });
	});
});

it("answers Git actions from the workspace CLI and sends the commit message only through writeFile", async () => {
	await harness("execution-git", async (context) => {
		const host = await context.open();
		await context.baseline();
		expect(
			await host.workspaceAction({ version: 1, kind: "git_status" }),
		).toEqual({ status: "git_status", branch: "b", head: HEAD, changed: 2 });
		const message = "it's a message; touch /tmp/x";
		const committed = await host.workspaceAction({
			version: 1,
			kind: "git_commit",
			message,
		});
		expect(committed).toMatchObject({ status: "committed" });
		const { commands, writes } = context.sandbox.state;
		expect(commands.some((command) => command.includes(message))).toBe(false);
		expect(writes.some(([, content]) => content === message)).toBe(true);
		expect(
			commands.some((command) => command.startsWith("ditto-workspace commit")),
		).toBe(true);
	});
});

it("starts, repeats, rotates and revokes a preview through the sandbox", async () => {
	const start = { version: 1, kind: "preview_start" } as const;
	const stop = { version: 1, kind: "preview_stop" } as const;
	const tokenOf = (result: unknown) => {
		const { url } = result as { url: string };
		const token = previewToken(url);
		if (!token) throw new Error("No token");
		return { url, token };
	};
	// 1. No hostname: rejected without a preview CLI call or an exposure.
	await harness(
		"execution-preview-none",
		async (context) => {
			const host = await context.open();
			await context.baseline();
			const result = await host.workspaceAction(start);
			expect(result).toMatchObject({ status: "rejected" });
			expect(
				context.sandbox.state.commands.filter((c) =>
					c.startsWith("ditto-workspace preview"),
				),
			).toEqual([]);
			expect(context.sandbox.state.calls).not.toContain("exposePort");
		},
		{ previewHostname: null },
	);
	await harness("execution-preview", async (context) => {
		const host = await context.open();
		await context.baseline();
		const { state } = context.sandbox;
		// 2. Start.
		const first = await host.workspaceAction(start);
		expect(first).toMatchObject({ status: "preview_running" });
		const one = tokenOf(first);
		expect(state.calls).toEqual([
			"unexposePort",
			"killProcess",
			"startProcess",
			"getProcess",
			"exposePort",
		]);
		expect(host.previewAdmits(await previewTokenDigest(one.token))).toBe(true);
		expect(host.previewAdmits(await previewTokenDigest("other"))).toBe(false);
		// 3. Repeated start returns the same URL without rotating.
		state.calls.length = 0;
		const again = await host.workspaceAction(start);
		expect(tokenOf(again).url).toBe(one.url);
		expect(state.calls).not.toContain("exposePort");
		// 7. Leak check: neither the token nor the URL is stored anywhere.
		const tables = context.storage.sql
			.exec<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
			)
			.toArray();
		const stored = [
			...tables.map(({ name }) =>
				JSON.stringify(
					context.storage.sql.exec(`SELECT * FROM "${name}"`).toArray(),
				),
			),
			JSON.stringify([...(await context.storage.list()).entries()]),
		].join("\n");
		expect(stored).not.toContain(one.token);
		expect(stored).not.toContain(one.url);
		expect(
			JSON.stringify(
				context.storage.sql
					.exec("SELECT * FROM workspace_preview_grant")
					.toArray(),
			),
		).toContain(await previewTokenDigest(one.token));
		// 4. Stop then start rotates; a surviving old exposure cannot be reused.
		expect(await host.workspaceAction(stop)).toMatchObject({
			status: "preview_stopped",
		});
		expect(host.previewAdmits(await previewTokenDigest(one.token))).toBe(false);
		state.unexposeNoop = true;
		const stale = state.exposed.size;
		const two = tokenOf(await host.workspaceAction(start));
		expect(stale).toBe(0);
		expect(two.token).not.toBe(one.token);
		expect(host.previewAdmits(await previewTokenDigest(one.token))).toBe(false);
		expect(host.previewAdmits(await previewTokenDigest(two.token))).toBe(true);
		// With unexpose a no-op for the stop too, the old token survives yet stays denied.
		await host.workspaceAction(stop);
		expect(state.exposed.size).toBe(1);
		const three = tokenOf(await host.workspaceAction(start));
		expect(three.token).not.toBe(two.token);
		expect(host.previewAdmits(await previewTokenDigest(two.token))).toBe(false);
		expect(host.previewAdmits(await previewTokenDigest(three.token))).toBe(
			true,
		);
		state.unexposeNoop = false;
		await host.workspaceAction(stop);
	});
	// 4a. Slow kill.
	await harness("execution-preview-slow", async (context) => {
		const host = await context.open();
		await context.baseline();
		const { state } = context.sandbox;
		await host.workspaceAction(start);
		state.slowKill = 3;
		expect(await host.workspaceAction(stop)).toMatchObject({
			status: "preview_stopped",
		});
		await host.workspaceAction(start);
		state.slowKill = 1000;
		expect(await host.workspaceAction(stop)).toEqual({ status: "unknown" });
	});
	// 4b. Start whose unexposePort throws is unknown, with no grant.
	await harness("execution-preview-start-throws", async (context) => {
		const host = await context.open();
		await context.baseline();
		context.sandbox.state.unexposeThrows = true;
		expect(await host.workspaceAction(start)).toEqual({ status: "unknown" });
		expect(
			context.storage.sql
				.exec("SELECT * FROM workspace_preview_grant")
				.toArray(),
		).toEqual([]);
	});
	// 5. Stop revokes before it kills; a failed revocation keeps the preview running.
	await harness("execution-preview-stop-order", async (context) => {
		const host = await context.open();
		await context.baseline();
		const { state } = context.sandbox;
		const { token } = tokenOf(await host.workspaceAction(start));
		state.calls.length = 0;
		state.unexposeThrows = true;
		expect(await host.workspaceAction(stop)).toMatchObject({
			status: "rejected",
		});
		expect(state.calls).not.toContain("killProcess");
		expect(host.previewAdmits(await previewTokenDigest(token))).toBe(true);
		state.unexposeThrows = false;
		state.calls.length = 0;
		await host.workspaceAction(stop);
		expect(state.calls.indexOf("unexposePort")).toBeLessThan(
			state.calls.indexOf("killProcess"),
		);
	});
	// 6. Ready fails: the process and exposure are torn down.
	await harness("execution-preview-not-ready", async (context) => {
		const host = await context.open();
		await context.baseline();
		const { state } = context.sandbox;
		state.readyFails = true;
		expect(await host.workspaceAction(start)).toMatchObject({
			status: "rejected",
		});
		expect(state.calls).toEqual([
			"unexposePort",
			"killProcess",
			"startProcess",
			"unexposePort",
			"killProcess",
		]);
		expect(
			context.storage.sql
				.exec("SELECT * FROM workspace_preview_grant")
				.toArray(),
		).toEqual([]);
		expect(
			context.storage.sql
				.exec<{ state: string }>("SELECT state FROM workspace_preview")
				.one().state,
		).toBe("stopped");
	});
});

it("retires an old pair after the retention period and deletes its objects from R2", async () => {
	await harness("execution-retention", async (context) => {
		await context.open();
		const ids = [await context.baseline()] as {
			id: string;
			archive: { objectKey: string };
			context: { objectKey: string };
		}[];
		for (const version of [1, 2, 3]) {
			context.sandbox.state.files = { "README.md": `version ${version}` };
			const published = await context.publisher().publishBoundary();
			if (published.status !== "published")
				throw new Error(JSON.stringify(published));
			ids.push(published.manifest);
		}
		// Records stay inline in this fixture, so each pair gets a synthetic pin to retire.
		for (const manifest of ids)
			context.storage.sql.exec(
				"INSERT INTO checkpoint_pins (pair, write_id) VALUES (?, ?)",
				manifest.id,
				`write-${manifest.id}`,
			);
		const [, first, , third] = ids;
		expect(await listed()).toContain(first?.archive.objectKey);
		let host = context.host();
		await host.alarm();
		for (const _ of [1, 2]) {
			await host.yield();
			await host.awaitClosure();
			context.control.now += DAY;
			host = await context.open();
			await host.alarm();
		}
		const keys = await listed();
		expect(keys).not.toContain(first?.archive.objectKey);
		expect(keys).not.toContain(first?.context.objectKey);
		expect(keys).toContain(third?.archive.objectKey);
		expect(keys).toContain(third?.context.objectKey);
	});
});

const fetchCommands = (commands: string[]) =>
	commands.filter((command) => command.startsWith("ditto-workspace fetch"));

it("publishes the baseline through the composed brokered fetch, binding Git before the fetch command", async () => {
	await harness("execution-brokered-baseline", async (context) => {
		await context.open();
		const manifest = await context.baseline();
		expect(manifest.id).toBeTruthy();
		expect(context.sandbox.state.outbound).toHaveLength(1);
		const [binding] = context.sandbox.state.outbound;
		expect(binding?.name).toBe("candidateGit");
		expect(binding?.params).toMatchObject({
			userId: "owner",
			workspaceSessionId: "workspace",
		});
		const fetches = fetchCommands(context.sandbox.state.commands);
		expect(fetches).toHaveLength(1);
		expect(fetches[0]).toBe(
			"ditto-workspace fetch --repository 'owner/repo' --ref 'refs/heads/feature' --branch 'b'",
		);
		// Binding ran before any fetch command was issued.
		const firstFetch = context.sandbox.state.commands.findIndex((command) =>
			command.startsWith("ditto-workspace fetch"),
		);
		expect(binding?.commandsSeen).toBeLessThanOrEqual(firstFetch);
		expect(context.branch.state.opened).toHaveLength(1);
		expect(context.branch.state.closed).toEqual(
			context.branch.state.opened.map((operation) => `window-${operation}`),
		);
	});
});

it("closes the window when the fetch command fails", async () => {
	await harness("execution-fetch-fails", async (context) => {
		await context.open();
		context.sandbox.state.fetchFails = true;
		const result = await context.publisher().establishBaseline({
			seed: await seed(context.composed.store),
			branch: "b",
		});
		expect(result.status).not.toBe("published");
		expect(context.branch.state.opened).toHaveLength(1);
		expect(context.branch.state.closed).toHaveLength(1);
	});
});

it("fails the baseline with authority_denied and runs no fetch when the open is denied", async () => {
	await harness("execution-fetch-denied", async (context) => {
		await context.open();
		context.branch.state.decision = "deny";
		const result = await context.publisher().establishBaseline({
			seed: await seed(context.composed.store),
			branch: "b",
		});
		expect(JSON.stringify(result)).toContain("authority_denied");
		expect(fetchCommands(context.sandbox.state.commands)).toEqual([]);
		expect(context.sandbox.state.outbound).toEqual([]);
	});
});

it("forwards a valid outbound scope to the product with the container id and refuses malformed params", async () => {
	const calls: { scope: unknown; containerId: string }[] = [];
	const product = {
		async brokerCandidateGit(
			scope: unknown,
			_request: Request,
			containerId: string,
		) {
			calls.push({ scope, containerId });
			return new Response("ok");
		},
	};
	const environment = { CandidateProduct: product } as never;
	const scope = {
		version: 2,
		userId: "owner",
		projectId: "project",
		workspaceSessionId: "workspace",
		ownerVersion: 1,
	};
	const request = new Request("https://github.com/owner/repo.git/info/refs");
	const ok = await candidateGit(request, environment, {
		containerId: "container-1",
		className: "PiDurableCandidateSandbox",
		params: scope,
	});
	expect(ok.status).toBe(200);
	expect(calls).toEqual([{ scope, containerId: "container-1" }]);
	for (const params of [undefined, {}, { ...scope, extra: 1 }, "x"]) {
		const denied = await candidateGit(request, environment, {
			containerId: "container-1",
			className: "PiDurableCandidateSandbox",
			params,
		});
		expect(denied.status).toBe(403);
	}
	expect(calls).toHaveLength(1);
});
