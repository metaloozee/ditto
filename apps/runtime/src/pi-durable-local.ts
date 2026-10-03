import { DurableObject } from "cloudflare:workers";
import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	AssistantEntry,
	createRegistry,
	defineExtension,
	defineTool,
	Harness,
} from "@earendil-works/pi-durable";
import {
	type SqliteDatabase,
	type SqliteExecutor,
	SqliteStorage,
	type SqliteValue,
} from "@earendil-works/pi-durable/storage/sqlite";
import { Type } from "typebox";

export const FIXTURE_MARKER = "ditto-disposable-l0";
export const FIXTURE_ANSWER = "Synthetic sandbox marker verified.";

// Plaintext is restricted to fresh synthetic L0 state. This is not a retained-state adapter.
export function fixtureDatabase(storage: DurableObjectStorage): SqliteDatabase {
	let line: Promise<unknown> = Promise.resolve();
	let closed = false;
	function enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = line.then(() => {
			if (closed) throw new Error("Fixture database closed");
			return operation();
		});
		line = result.catch(() => undefined);
		return result;
	}
	function executor(isActive: () => boolean): SqliteExecutor {
		function rows<T extends object>(sql: string, params: SqliteValue[]): T[] {
			if (!isActive()) throw new Error("Expired fixture transaction");
			const bindings = params.map((value) => {
				if (typeof value === "bigint") {
					const number = Number(value);
					if (!Number.isSafeInteger(number))
						throw new Error("Unsafe SQLite integer");
					return number;
				}
				return value instanceof Uint8Array ? value.slice().buffer : value;
			});
			return storage.sql
				.exec<T & Record<string, SqlStorageValue>>(sql, ...bindings)
				.toArray();
		}
		return {
			async exec(sql) {
				rows(sql, []);
			},
			async run(sql, ...params) {
				rows(sql, params);
			},
			async get<T extends object>(
				sql: string,
				...params: SqliteValue[]
			): Promise<T | undefined> {
				return rows<T>(sql, params)[0];
			},
			async all<T extends object>(sql: string, ...params: SqliteValue[]) {
				return rows<T>(sql, params);
			},
		};
	}
	const direct = executor(() => !closed);
	return {
		exec: (sql) => enqueue(() => direct.exec(sql)),
		run: (sql, ...params) => enqueue(() => direct.run(sql, ...params)),
		get: <T extends object>(sql: string, ...params: SqliteValue[]) =>
			enqueue(() => direct.get<T>(sql, ...params)),
		all: <T extends object>(sql: string, ...params: SqliteValue[]) =>
			enqueue(() => direct.all<T>(sql, ...params)),
		transaction: <T>(callback: (tx: SqliteExecutor) => Promise<T>) =>
			enqueue(async () => {
				let active = true;
				try {
					return await storage.transaction(() =>
						callback(executor(() => active)),
					);
				} finally {
					active = false;
				}
			}),
		close: () =>
			enqueue(async () => {
				closed = true;
			}),
	};
}

export interface FixtureExecutor {
	write(path: string, content: string): Promise<void>;
	read(path: string): Promise<string>;
}

export async function runFixture(
	storage: DurableObjectStorage,
	execution: FixtureExecutor,
	path: string,
) {
	const models = createModels({
		authContext: { env: async () => undefined, fileExists: async () => false },
	});
	const faux = fauxProvider({
		tokensPerSecond: 0,
		tokenSize: { min: 1000, max: 1000 },
	});
	models.setProvider(faux.provider);
	const tool = defineTool({
		name: "fixture_marker",
		description:
			"Write and read the disposable synthetic marker in the remote executor.",
		parameters: Type.Object({}),
		execute: async () => {
			await execution.write(path, FIXTURE_MARKER);
			const content = await execution.read(path);
			if (content !== FIXTURE_MARKER)
				throw new Error("Incorrect remote marker");
			return { content: [{ type: "text" as const, text: content }] };
		},
	});
	const fixture = defineExtension({ name: "ditto-l0-fixture", tools: [tool] });
	const registry = createRegistry();
	registry.install(fixture);
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("fixture_marker", {}, { id: "fixture-call" }),
			{ stopReason: "toolUse", timestamp: 1 },
		),
		(context) => {
			const result = context.messages.find(
				(message) => message.role === "toolResult",
			);
			if (!result || result.role !== "toolResult" || result.isError) {
				return fauxAssistantMessage("Executor unavailable", {
					stopReason: "error",
					errorMessage: "Executor unavailable",
					timestamp: 2,
				});
			}
			return fauxAssistantMessage(FIXTURE_ANSWER, { timestamp: 2 });
		},
	]);
	const harness = await Harness.open(
		await SqliteStorage.open(fixtureDatabase(storage)),
		{
			models,
			registry,
			settings: {
				extensions: [fixture],
				toolExecution: "sequential",
				retry: { enabled: false },
				compaction: { enabled: false, backgroundTokens: 0 },
			},
		},
		BACKGROUND_CONTEXT,
	);
	try {
		const root = await harness.root(BACKGROUND_CONTEXT, {
			agent: {
				model: { provider: "faux", modelId: "faux-1" },
				extensions: [fixture],
				tools: [tool],
			},
		});
		const settled = await (
			await root.submit(
				{
					type: "input",
					content: "Verify the synthetic marker.",
					requestId: "fixture-turn",
				},
				BACKGROUND_CONTEXT,
			)
		).wait(BACKGROUND_CONTEXT);
		if (settled.status !== "done" || settled.type !== "input")
			throw new Error("Synthetic turn did not commit an answer");
		const answer = await root.commit(
			(tx) => tx.entry(AssistantEntry, settled.answer),
			BACKGROUND_CONTEXT,
		);
		const entries = await root.entries({}, 20, undefined, BACKGROUND_CONTEXT);
		const toolResult = entries.items
			.flatMap((entry) => entry.model ?? [])
			.find((message) => message.role === "toolResult");
		return { answer: answer?.model?.[0], toolResult, path };
	} finally {
		await harness.close(BACKGROUND_CONTEXT);
	}
}

export class PiDurableLocalSandbox extends Sandbox {}

interface FixtureBindings {
	PI_DURABLE_LOCAL: string;
	FIXTURE_ID: string;
	FIXTURE_PORT: string;
	PiDurableLocalRuntime: DurableObjectNamespace<PiDurableLocalRuntime>;
	PiDurableLocalSandbox: DurableObjectNamespace<Sandbox>;
}

export class PiDurableLocalRuntime extends DurableObject<FixtureBindings> {
	private started = false;
	async verify(): Promise<{
		answer: string;
		toolResult: string;
		path: string;
		marker: string;
		credentialBoundary: "passed";
	}> {
		if (
			Object.keys(this.env).some((key) =>
				/^(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)$/.test(key),
			)
		)
			throw new Error("Host credentials entered Worker bindings");
		if (this.env.PI_DURABLE_LOCAL !== "1" || this.started)
			throw new Error("Fixture not admitted");
		this.started = true;
		const sandbox = getSandbox(
			this.env.PiDurableLocalSandbox,
			this.env.FIXTURE_ID,
			{ transport: "rpc" },
		);
		const path = `/tmp/ditto-l0-${this.env.FIXTURE_ID}.txt`;
		try {
			const result = await runFixture(
				this.ctx.storage,
				{
					write: async (file, content) => {
						await sandbox.writeFile(file, content);
					},
					read: async (file) => (await sandbox.readFile(file)).content,
				},
				path,
			);
			const boundary = await sandbox.exec(
				`test -z "\${CLOUDFLARE_API_TOKEN+x}" && test -z "\${CLOUDFLARE_ACCOUNT_ID+x}"`,
			);
			if (!boundary.success)
				throw new Error("Host credentials entered execution environment");
			return {
				answer:
					result.answer?.role === "assistant"
						? result.answer.content
								.filter((block) => block.type === "text")
								.map((block) => block.text)
								.join("")
						: "",
				toolResult:
					result.toolResult?.content
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("") ?? "",
				path,
				marker: (await sandbox.readFile(path)).content,
				credentialBoundary: "passed",
			};
		} finally {
			await sandbox.destroy();
		}
	}
}

export default {
	async fetch(request: Request, env: FixtureBindings): Promise<Response> {
		const url = new URL(request.url);
		if (
			env.PI_DURABLE_LOCAL !== "1" ||
			url.hostname !== "127.0.0.1" ||
			url.port !== env.FIXTURE_PORT ||
			request.headers.get("x-ditto-fixture") !== env.FIXTURE_ID
		)
			return new Response("Denied", { status: 403 });
		if (request.method === "GET" && url.pathname === "/ready")
			return new Response("ready");
		if (request.method !== "POST" || url.pathname !== "/verify")
			return new Response("Denied", { status: 403 });
		return Response.json(
			await env.PiDurableLocalRuntime.getByName(env.FIXTURE_ID).verify(),
		);
	},
};
