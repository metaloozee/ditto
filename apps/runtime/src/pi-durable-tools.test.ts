import { env, runInDurableObject } from "cloudflare:test";
import {
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import type {
	AssistantMessage,
	Context as ModelContext,
} from "@earendil-works/pi-ai";
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
import type { ProjectValueRequestV1 } from "../../../packages/runtime-contracts/src/project-values.js";
import type { ToolOperationV1 } from "../../../packages/runtime-contracts/src/tool-execution.js";
import {
	type HostFixtureDependencies,
	type LocalAuthority,
	PiDurableHost,
	requestDigest,
	semanticTranscript,
} from "./pi-durable-host.ts";
import {
	createRemoteTools,
	EXEC_VALUES_ENV,
	type ProjectValues,
	type RemoteExecutor,
	sandboxExecutor,
} from "./pi-durable-tools.ts";

type Step = (context: ModelContext) => AssistantMessage;

/** In-memory executor with the same identity rules as the runner's journal. */
function fakeExecutor() {
	const files = new Map<string, string>();
	const journal = new Map<string, { key: string; outcome: unknown }>();
	let generation = 1;
	let loseResponse: "before" | "after" | "always" | undefined;
	const dispatched: ToolOperationV1[] = [];
	const values: (ProjectValues | undefined)[] = [];
	const executor: RemoteExecutor = {
		async dispatch(operation, _signal, granted) {
			if (loseResponse === "before" || loseResponse === "always") {
				if (loseResponse === "before") loseResponse = undefined;
				throw new Error("Synthetic transport loss before dispatch");
			}
			dispatched.push(operation);
			values.push(granted);
			const key = JSON.stringify(operation);
			const prior = journal.get(operation.operationId);
			if (prior) {
				if (prior.key !== key)
					return {
						version: 1,
						operationId: operation.operationId,
						status: "rejected",
						reason: "conflict",
						message: "Conflict",
					};
				return prior.outcome;
			}
			const done = (text: string, isError = false) => ({
				version: 1,
				operationId: operation.operationId,
				status: "completed",
				isError,
				text,
				truncated: false,
			});
			let outcome: unknown;
			if (operation.executorGeneration !== generation)
				outcome = {
					version: 1,
					operationId: operation.operationId,
					status: "rejected",
					reason: "generation",
					message: "Executor generation mismatch",
				};
			else if (operation.tool === "write") {
				files.set(operation.arguments.path, operation.arguments.content);
				outcome = done(
					`Successfully wrote ${operation.arguments.content.length} bytes to ${operation.arguments.path}`,
				);
			} else if (operation.tool === "read") {
				const value = files.get(operation.arguments.path);
				outcome =
					value === undefined
						? done(`ENOENT: ${operation.arguments.path}`, true)
						: done(value);
			} else if (
				operation.tool === "bash" &&
				operation.arguments.command === "printenv"
			) {
				const text = (granted ?? [])
					.map((v) => `${v.key}=${v.value}`)
					.join("\n");
				files.set("left-behind", text);
				outcome = done(text);
			} else if (operation.tool === "bash")
				outcome = {
					version: 1,
					operationId: operation.operationId,
					status: "unknown",
					message: "Shell dispatch was interrupted; outcome unknown",
				};
			else outcome = done("");
			journal.set(operation.operationId, { key, outcome });
			if (loseResponse === "after") {
				loseResponse = undefined;
				throw new Error("Synthetic transport loss after dispatch");
			}
			return outcome;
		},
	};
	return {
		executor,
		files,
		dispatched,
		values,
		set generation(value: number) {
			generation = value;
		},
		set loseResponse(value: typeof loseResponse) {
			loseResponse = value;
		},
	};
}

function composition(storage: DurableObjectStorage, steps: Step[]) {
	const remote = fakeExecutor();
	let executorAvailable = true;
	let authority: LocalAuthority = { current: true, generation: 1, executor: 1 };
	let providerCalls = 0;
	let projectValues:
		| ((request: ProjectValueRequestV1) => Promise<unknown>)
		| undefined;
	const valueRequests: ProjectValueRequestV1[] = [];
	let skew = 0;
	const faux = fauxProvider({ tokensPerSecond: 0 });
	const dependencies: HostFixtureDependencies = {
		now: () => Date.now(),
		authority: async () => authority,
		budgets: { workMs: 10_000, drainMs: 1000 },
		operationMs: { model: 60_000, tool: 60_000 },
		wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
		options: (guard) => {
			const models = createModels({
				authContext: {
					env: async () => undefined,
					fileExists: async () => false,
				},
			});
			const stream: typeof faux.provider.stream = (
				model,
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
								model: { provider: model.provider, id: model.id },
								transcript,
								options: { ...options },
							},
							context,
							async () => {
								const step = steps[providerCalls++];
								if (!step) throw new Error("Unscripted model call");
								return {
									...step(transcript),
									model: model.id,
									provider: model.provider,
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
							reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
							message,
						});
					} catch (error) {
						events.push({
							type: "error",
							reason: "error",
							error: fauxAssistantMessage([], {
								stopReason: "error",
								errorMessage: error instanceof Error ? error.message : "error",
							}),
						});
					} finally {
						events.end();
					}
				})();
				return events;
			};
			models.setProvider({ ...faux.provider, stream, streamSimple: stream });
			const remoteTools = createRemoteTools(guard, {
				workspaceSessionId: "session",
				executor: () => (executorAvailable ? remote.executor : undefined),
				projectValues: async (request: ProjectValueRequestV1) => {
					valueRequests.push(request);
					return projectValues
						? projectValues(request)
						: {
								version: 1,
								operationId: request.operationId,
								status: "granted",
								values: [],
							};
				},
				now: () => Date.now() + skew,
			});
			const binding = defineExtension({
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
			registry.install(binding);
			registry.install(remoteTools.extension);
			return {
				now: () => Date.now(),
				models,
				registry,
				settings: {
					extensions: [binding, remoteTools.extension],
					toolExecution: "sequential",
					retry: { enabled: false },
					compaction: { enabled: false, backgroundTokens: 0 },
				},
			};
		},
	};
	let host: PiDurableHost;
	return {
		remote,
		get host() {
			return host;
		},
		get providerCalls() {
			return providerCalls;
		},
		set authority(value: LocalAuthority) {
			authority = value;
		},
		set executorAvailable(value: boolean) {
			executorAvailable = value;
		},
		set projectValues(value: typeof projectValues) {
			projectValues = value;
		},
		set skew(value: number) {
			skew = value;
		},
		valueRequests,
		storage,
		async open() {
			host = await PiDurableHost.open(storage, dependencies);
			return host;
		},
		async run(id = "command") {
			await host.accept(id, "Synthetic coding request");
			await host.schedule(id);
			await host.waitIdle();
		},
		effects() {
			return storage.sql
				.exec<{ kind: string; state: string; correlation: string; id: string }>(
					"SELECT * FROM host_effects ORDER BY rowid",
				)
				.toArray();
		},
		async dispose() {
			await host?.yield();
			await storage.deleteAlarm();
			await storage.sync();
		},
	};
}

function calls(...items: [string, Record<string, unknown>][]): Step {
	return () =>
		fauxAssistantMessage(
			items.map(([name, args], index) =>
				fauxToolCall(name, args as Parameters<typeof fauxToolCall>[1], {
					id: `call-${index}`,
				}),
			),
			{ stopReason: "toolUse", timestamp: 1 },
		);
}
function toolResults(context: ModelContext) {
	return context.messages
		.filter((message) => message.role === "toolResult")
		.map((message) => ({
			name: message.toolName,
			isError: message.isError,
			text: message.content
				.map((part) => (part.type === "text" ? part.text : ""))
				.join(""),
		}));
}

async function run(
	name: string,
	steps: Step[],
	test: (f: ReturnType<typeof composition>) => Promise<void>,
) {
	await runInDurableObject(
		env.PI_HOST_STORAGE.getByName(`009-tools-${name}`),
		async (_instance, state) => {
			const f = composition(state.storage, steps);
			await f.open();
			try {
				await test(f);
			} finally {
				await f.dispose();
			}
		},
	);
}

it("admits each remote tool before dispatch and returns executor results to Pi", async () => {
	let seen: ReturnType<typeof toolResults> = [];
	await run(
		"roundtrip",
		[
			calls(
				["write", { path: "a.txt", content: "remote" }],
				["read", { path: "a.txt" }],
			),
			(context) => {
				seen = toolResults(context);
				return fauxAssistantMessage("Done", { timestamp: 2 });
			},
		],
		async (f) => {
			await f.run();
			expect(seen).toEqual([
				{
					name: "write",
					isError: false,
					text: "Successfully wrote 6 bytes to a.txt",
				},
				{ name: "read", isError: false, text: "remote" },
			]);
			expect(f.remote.files.get("a.txt")).toBe("remote");
			const tools = f.effects().filter((row) => row.kind === "tool");
			expect(tools.map((row) => row.state)).toEqual([
				"pi-committed",
				"pi-committed",
			]);
			expect(
				f.remote.dispatched.map((op) => [
					op.tool,
					op.operationId,
					op.epoch,
					op.executorGeneration,
				]),
			).toEqual(
				tools.map((row, index) => [
					index === 0 ? "write" : "read",
					row.id.replace(/\/attempt\/1$/, ""),
					1,
					1,
				]),
			);
			const correlation = JSON.parse(tools[0]!.correlation);
			expect(JSON.parse(correlation.arguments)).toEqual({
				arguments: { path: "a.txt", content: "remote" },
				operation: { kind: "mutation" },
			});
			expect(correlation.replay).toBe("never");
		},
	);
});

it("rejects invalid arguments and a missing executor before any effect or dispatch", async () => {
	for (const scenario of ["invalid", "no-executor"] as const) {
		let seen: ReturnType<typeof toolResults> = [];
		await run(
			`pre-admission-${scenario}`,
			[
				scenario === "invalid"
					? calls(["read", { path: "a", image: true }])
					: calls(["ls", {}]),
				(context) => {
					seen = toolResults(context);
					return fauxAssistantMessage("Done", { timestamp: 2 });
				},
			],
			async (f) => {
				if (scenario === "no-executor") f.executorAvailable = false;
				await f.run();
				expect(seen).toHaveLength(1);
				expect(seen[0]?.isError).toBe(true);
				expect(seen[0]?.text).toMatch(
					scenario === "invalid"
						? /unknown field|image/
						: /Remote executor unavailable/,
				);
				expect(f.effects().filter((row) => row.kind === "tool")).toHaveLength(
					0,
				);
				expect(f.remote.dispatched).toHaveLength(0);
			},
		);
	}
});

it("records known pre-dispatch rejection without blocking later work", async () => {
	let seen: ReturnType<typeof toolResults> = [];
	await run(
		"rejected",
		[
			calls(["read", { path: "a" }]),
			(context) => {
				seen = toolResults(context);
				return fauxAssistantMessage("Done", { timestamp: 2 });
			},
		],
		async (f) => {
			f.remote.generation = 2;
			await f.run();
			expect(seen).toEqual([
				{ name: "read", isError: true, text: "Executor generation mismatch" },
			]);
			expect(f.effects().map((row) => [row.kind, row.state])).toEqual([
				["model", "pi-committed"],
				["tool", "pi-committed"],
				["model", "pi-committed"],
			]);
		},
	);
});

it("reconciles a lost response with the same operation instead of replaying it", async () => {
	for (const loss of ["before", "after"] as const)
		await run(
			`loss-${loss}`,
			[
				calls(["write", { path: "a.txt", content: "once" }]),
				() => fauxAssistantMessage("Done", { timestamp: 2 }),
			],
			async (f) => {
				f.remote.loseResponse = loss;
				await f.run();
				const ids = f.remote.dispatched.map((op) => op.operationId);
				expect(ids).toHaveLength(loss === "before" ? 1 : 2);
				expect(new Set(ids).size).toBe(1);
				expect(
					f
						.effects()
						.filter((row) => row.kind === "tool")
						.map((row) => row.state),
				).toEqual(["pi-committed"]);
				expect(f.providerCalls).toBe(2);
			},
		);
});

it("leaves unknown shell and lost outcomes unresolved and blocks later model and tool calls across two reopens", async () => {
	for (const scenario of ["unknown-shell", "lost-write", "lost-read"] as const)
		await run(
			scenario,
			[
				calls(
					scenario === "unknown-shell"
						? ["bash", { command: "rm -rf build" }]
						: scenario === "lost-write"
							? ["write", { path: "a", content: "x" }]
							: ["read", { path: "a" }],
				),
				() => fauxAssistantMessage("Must not run", { timestamp: 2 }),
			],
			async (f) => {
				// A failed remote read or write has no local fallback: nothing else
				// receives the operation and the effect stays unresolved.
				if (scenario !== "unknown-shell") f.remote.loseResponse = "always";
				await f.run();
				const tool = f.effects().find((row) => row.kind === "tool")!;
				expect(tool.state).toBe("admitted");
				expect(f.providerCalls).toBe(1);
				expect(f.remote.files.size).toBe(0);
				const dispatches = f.remote.dispatched.length;
				// The same command is retried after each of two restarts.
				for (let restart = 0; restart < 2; restart++) {
					await f.host.yield();
					await f.open();
					await expect(f.run("second")).rejects.toThrow(/Unresolved effect/);
				}
				expect(f.providerCalls).toBe(1);
				expect(f.remote.dispatched).toHaveLength(dispatches);
				expect(f.effects().filter((row) => row.kind === "tool")).toHaveLength(
					1,
				);
				expect(f.effects().find((row) => row.kind === "tool")?.state).toBe(
					"admitted",
				);
			},
		);
});

it("denies dispatch when executor authority changes after the tool call is prepared", async () => {
	const holder: { f?: ReturnType<typeof composition> } = {};
	await run(
		"authority",
		[
			() => {
				holder.f!.authority = {
					current: true,
					generation: 1,
					executor: 1,
					liveExecutors: 2,
				};
				return calls(["read", { path: "a" }])({ messages: [] });
			},
			() => fauxAssistantMessage("Must not run", { timestamp: 2 }),
		],
		async (f) => {
			holder.f = f;
			await f.run().catch(() => undefined);
			expect(f.remote.dispatched).toHaveLength(0);
			expect(f.effects().filter((row) => row.kind === "tool")).toHaveLength(0);
			expect(f.providerCalls).toBe(1);
		},
	);
});

it("sends the exact operation through the sandbox command transport", async () => {
	const commands: string[] = [];
	const writes: [string, string][] = [];
	const executor = sandboxExecutor(
		{
			async writeFile(path, content) {
				writes.push([path, content]);
			},
			async exec(command) {
				commands.push(command);
				return command.startsWith("ditto-exec init")
					? { exitCode: 0, stdout: "{}" }
					: {
							exitCode: 0,
							stdout: JSON.stringify({
								version: 1,
								operationId: "op",
								status: "completed",
								isError: false,
								text: "ok",
								truncated: false,
							}),
						};
			},
		},
		{ workspaceSessionId: "it's" },
	);
	const operation: ToolOperationV1 = {
		version: 1,
		operationId: "op",
		workspaceSessionId: "it's",
		executorGeneration: 3,
		epoch: 1,
		deadlineAt: Date.now() + 1000,
		tool: "ls",
		arguments: {},
	};
	await executor.dispatch(operation);
	await executor.dispatch(operation);
	expect(commands[0]).toBe("ditto-exec init 'it'\\''s' 3");
	expect(
		commands.filter((command) => command.startsWith("ditto-exec init")),
	).toHaveLength(1);
	expect(JSON.parse(writes[0]![1])).toEqual(operation);
	await expect(
		executor.dispatch({ ...operation, workspaceSessionId: "other" }),
	).rejects.toThrow(/mismatch/);
});

const SYNTHETIC = "synthetic-project-value-015";
function grant(request: ProjectValueRequestV1) {
	return {
		version: 1,
		operationId: request.operationId,
		status: "granted",
		values: [
			{ key: "API_TOKEN", value: SYNTHETIC },
			{ key: "MODE", value: "dev" },
		],
	};
}
/** Every row of every table in the host's storage, as text. */
function storedText(storage: DurableObjectStorage) {
	return storage.sql
		.exec<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
		)
		.toArray()
		.map(({ name }) =>
			JSON.stringify(storage.sql.exec(`SELECT * FROM "${name}"`).toArray()),
		)
		.join("\n");
}

it("delivers project values only to the admitted shell dispatch and redacts them from the result", async () => {
	let seen: ReturnType<typeof toolResults> = [];
	await run(
		"values-delivered",
		[
			calls(
				["bash", { command: "printenv" }],
				["write", { path: "a", content: "x" }],
				["ls", {}],
			),
			// A later tool shows a value the command left in a file.
			calls(["read", { path: "left-behind" }]),
			(context) => {
				seen = toolResults(context);
				return fauxAssistantMessage("Done", { timestamp: 2 });
			},
		],
		async (f) => {
			f.projectValues = async (request) => grant(request);
			await f.run();
			const [shell] = f.remote.dispatched;
			expect(f.valueRequests).toEqual([
				{
					version: 1,
					role: "repository_command",
					workspaceSessionId: "session",
					operationId: shell!.operationId,
					executorGeneration: shell!.executorGeneration,
					epoch: shell!.epoch,
					deadlineAt: shell!.deadlineAt,
				},
			]);
			expect(f.remote.dispatched.map((op) => op.tool)).toEqual([
				"bash",
				"write",
				"ls",
				"read",
			]);
			expect(f.remote.values).toEqual([
				grant(shell as unknown as ProjectValueRequestV1).values,
				undefined,
				undefined,
				undefined,
			]);
			expect(seen.at(-1)).toEqual({
				name: "read",
				isError: false,
				text: "API_TOKEN=[REDACTED]\nMODE=dev",
			});
			expect(seen[0]).toEqual({
				name: "bash",
				isError: false,
				text: "API_TOKEN=[REDACTED]\nMODE=dev",
			});
			expect(JSON.stringify(f.remote.dispatched)).not.toContain(SYNTHETIC);
			expect(storedText(f.storage)).not.toContain(SYNTHETIC);
			expect(
				f
					.effects()
					.filter((row) => row.kind === "tool")
					.map((row) => row.state),
			).toEqual([
				"pi-committed",
				"pi-committed",
				"pi-committed",
				"pi-committed",
			]);
		},
	);
});

it("refuses a shell command before dispatch when its values are denied, unavailable, mismatched or late", async () => {
	const scenarios: [
		string,
		(request: ProjectValueRequestV1) => Promise<unknown>,
		string,
	][] = [
		[
			"denied",
			async (request) => ({
				version: 1,
				operationId: request.operationId,
				status: "denied",
				reason: "authority",
			}),
			"Project values are unavailable for this command",
		],
		[
			"failed",
			async () => {
				throw new Error("product unavailable");
			},
			"Project values are unavailable for this command",
		],
		[
			"mismatched",
			async (request) => grant({ ...request, operationId: "other" }),
			"Project values are unavailable for this command",
		],
		[
			"late",
			async (request) => grant(request),
			"Operation deadline passed before dispatch",
		],
	];
	for (const [name, handler, message] of scenarios) {
		let seen: ReturnType<typeof toolResults> = [];
		await run(
			`values-refused-${name}`,
			[
				calls(["bash", { command: "printenv" }]),
				(context) => {
					seen = toolResults(context);
					return fauxAssistantMessage("Done", { timestamp: 2 });
				},
			],
			async (f) => {
				f.projectValues = async (request) => {
					if (name === "late") f.skew = 120_000;
					return handler(request);
				};
				await f.run();
				expect(f.remote.dispatched).toHaveLength(0);
				expect(seen).toEqual([{ name: "bash", isError: true, text: message }]);
				// The refusal is known before dispatch, so later work continues.
				expect(f.providerCalls).toBe(2);
				expect(
					f
						.effects()
						.filter((row) => row.kind === "tool")
						.map((row) => row.state),
				).toEqual(["pi-committed"]);
			},
		);
	}
});

it("passes values to one sandbox run through its environment, never the request file", async () => {
	const runs: { command: string; env?: Record<string, string> }[] = [];
	const writes: string[] = [];
	const executor = sandboxExecutor(
		{
			async writeFile(_path, content) {
				writes.push(content);
			},
			async exec(command, options) {
				runs.push({ command, ...(options?.env ? { env: options.env } : {}) });
				return {
					exitCode: 0,
					stdout: command.startsWith("ditto-exec init")
						? "{}"
						: JSON.stringify({
								version: 1,
								operationId: "op",
								status: "completed",
								isError: false,
								text: "ok",
								truncated: false,
							}),
				};
			},
		},
		{ workspaceSessionId: "session" },
	);
	const operation: ToolOperationV1 = {
		version: 1,
		operationId: "op",
		workspaceSessionId: "session",
		executorGeneration: 1,
		epoch: 1,
		deadlineAt: Date.now() + 1000,
		tool: "bash",
		arguments: { command: "printenv" },
	};
	await executor.dispatch(operation, undefined, [
		{ key: "API_TOKEN", value: SYNTHETIC },
	]);
	await executor.dispatch(operation);
	expect(runs.map((entry) => entry.env)).toEqual([
		undefined,
		{ [EXEC_VALUES_ENV]: JSON.stringify({ API_TOKEN: SYNTHETIC }) },
		undefined,
	]);
	expect(writes.join("")).not.toContain(SYNTHETIC);
	await expect(
		executor.dispatch({ ...operation, tool: "ls", arguments: {} }, undefined, [
			{ key: "API_TOKEN", value: SYNTHETIC },
		]),
	).rejects.toThrow(/only for shell/);
});
