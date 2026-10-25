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
import { sandboxArtifactExecution } from "./pi-durable-artifacts.ts";
import {
	fakeArchiveProduct,
	fakeProduct,
	fakeRestoreProduct,
	seed,
} from "./pi-durable-checkpoint.fixture.ts";
import { createCheckpointPublisher } from "./pi-durable-checkpoints.ts";
import {
	composeCandidateExecution,
	type ExecutionSandbox,
	sandboxStreams,
} from "./pi-durable-execution.ts";
import {
	PiDurableHost,
	type PiDurableHostFixture,
	requestDigest,
	semanticTranscript,
} from "./pi-durable-host.ts";
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
			if (command.startsWith("ditto-workspace commit"))
				return json({ ok: true, committed: true, head: "c".repeat(40) });
			return { exitCode: 0, stdout: "" };
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
		/** Establishes the baseline the way tests do: brokered fetch is not composed, so it is faked. */
		baseline(): Promise<{ id: string }>;
		/** A publisher over the same sandbox adapters and R2 store, for boundary pairs. */
		publisher(): ReturnType<typeof createCheckpointPublisher>;
		model: { calls: number };
	}) => Promise<void>,
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
			const composed = composeCandidateExecution({
				storage: state.storage,
				binding,
				sandbox: sandbox.sandbox,
				bucket: env.RECOVERY_ARTIFACTS,
				branch: "b",
				now: () => control.now,
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
			// Brokered fetch is not composed, so the baseline uses a test-only fetch.
			const publisher = () =>
				createCheckpointPublisher({
					storage: state.storage,
					host: (host as PiDurableHost).checkpointPort(),
					binding,
					execution: {
						...sandboxArtifactExecution(
							sandboxStreams(sandbox.sandbox),
							() => control.now,
						),
						fetchBranch: async () => ({ head: HEAD }),
					},
					store: composed.store,
					branch: fakeBranch().branch,
					now: () => control.now,
				});
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

it("rejects preview without running a preview command", async () => {
	await harness("execution-preview", async (context) => {
		const host = await context.open();
		await context.baseline();
		const before = context.sandbox.state.commands.length;
		const result = await host.workspaceAction({
			version: 1,
			kind: "preview_start",
		});
		expect(result).toMatchObject({ status: "rejected" });
		expect(
			context.sandbox.state.commands
				.slice(before)
				.filter((command) => /preview/i.test(command)),
		).toEqual([]);
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
