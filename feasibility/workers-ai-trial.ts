// The Workers AI trial (#35): the included model (ADR-0011) through the `AI` binding, from the
// Bot Durable Object. Pi's `cloudflare-workers-ai` provider speaks the binding: its models point
// at AI Gateway's Workers AI passthrough, which the binding serves at `workers-binding.ai`, and
// Pi's `createAiBindingFetch` sends each request through `env.AI.fetch()`. The binding carries
// the account, so no Cloudflare API token is involved. Every request names the Ditto account in
// `cf-aig-metadata`, and the gateway's log for it is read back to prove the attribution.
import {
	type Api,
	type AssistantMessage,
	createModels,
	InMemoryCredentialStore,
	type Message,
	type Model,
	PI_AI_VERSION,
} from "@earendil-works/pi-ai";
import {
	type AiBinding,
	CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL,
	createAiBindingFetch,
} from "@earendil-works/pi-ai/api/cloudflare-ai-binding";
import { cloudflareWorkersAIProvider } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai";

import { redact } from "./redact.ts";

/** The fields of an AI Gateway log entry the trial records (`AiGatewayLog` in workers-types). */
export interface GatewayLog {
	id: string;
	provider: string;
	model: string;
	success: boolean;
	tokens_in?: number | null;
	tokens_out?: number | null;
	cost?: number | null;
	metadata?: Record<string, string | number | boolean | null> | null;
}

/** `env.AI`: the binding's gateway passthrough, and the gateway's log. */
export interface WorkersAiBinding extends AiBinding {
	/** An RPC stand-in returns a stub, which holds the Durable Object's invocation open until disposed. */
	gateway(id: string): { getLog(logId: string): Promise<GatewayLog>; [Symbol.dispose]?(): void };
}

export const DEFAULT_WORKERS_AI_MODEL = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
const PROVIDER = "cloudflare-workers-ai";

export interface GatewayRequest {
	status: number;
	logId?: string;
	/** The gateway's log entry, or why it could not be read. */
	log?: GatewayLog;
	logError?: string;
}

export interface WorkersAiTurn {
	label: "plain turn" | "tool-calling turn";
	ok: boolean;
	detail: string;
	latencyMs: number;
	requests: GatewayRequest[];
	/** Pi's estimate from its model catalogue, in USD. */
	piCost: number;
}

export interface WorkersAiRun {
	model: string;
	account: string;
	startedAt: Date;
	turns: WorkersAiTurn[];
	outcome: "pass" | "fail";
	/** CPU and wall time of the Bot's invocation, as Cloudflare reported it. */
	request?: { cpuMs: number; wallMs: number };
}

export interface WorkersAiTrialInput {
	ai: WorkersAiBinding;
	gatewayId: string;
	/** The Ditto account that sends the turns, named in the gateway metadata. */
	account: string;
	model?: string;
	now?: () => Date;
	/** How long to wait for the gateway to write a request's log. */
	logWaitMs?: number;
}

const PLAIN_PROMPT = "Reply with exactly one word: pong";
const TOOL = {
	name: "get_secret_word",
	description: "Returns today's secret word. Takes no arguments.",
	parameters: { type: "object", properties: {}, additionalProperties: false },
};
const TOOL_PROMPT =
	"Call the get_secret_word tool, then reply with exactly the word it returns and nothing else.";

export async function runWorkersAiTrial(input: WorkersAiTrialInput): Promise<WorkersAiRun> {
	const now = input.now ?? (() => new Date());
	const startedAt = now();
	const modelId = input.model ?? DEFAULT_WORKERS_AI_MODEL;
	const finish = (turns: WorkersAiTurn[]): WorkersAiRun => ({
		model: modelId,
		account: input.account,
		startedAt,
		turns,
		outcome: turns.every((t) => t.ok) ? "pass" : "fail",
	});

	const credentials = new InMemoryCredentialStore();
	// Pi's provider wants a Cloudflare key and account before it dispatches. The binding is
	// pre-authenticated, so the key is Pi's sentinel and the account a placeholder never sent.
	await credentials.modify(PROVIDER, async () => ({
		type: "api_key",
		key: CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL,
		env: { CLOUDFLARE_ACCOUNT_ID: "binding" },
	}));
	const models = createModels({
		credentials,
		authContext: { env: async () => undefined, fileExists: async () => false },
	});
	models.setProvider(cloudflareWorkersAIProvider());
	const catalogued = models.getModel(PROVIDER, modelId);
	if (!catalogued) {
		return finish([
			{
				label: "plain turn",
				ok: false,
				detail: `Pi ${PI_AI_VERSION} has no Workers AI model \`${modelId}\``,
				latencyMs: 0,
				requests: [],
				piCost: 0,
			},
		]);
	}
	const model: Model<Api> = {
		...catalogued,
		baseUrl: `https://workers-binding.ai/ai-gateway/gateways/${input.gatewayId}/workers-ai/v1`,
	};

	const bindingFetch = createAiBindingFetch(input.ai);
	let requests: GatewayRequest[] = [];
	const options = {
		fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
			const response = await bindingFetch(
				url instanceof URL ? url : (url as Request | string),
				init,
			);
			requests.push({
				status: response.status,
				logId: response.headers.get("cf-aig-log-id") ?? undefined,
			});
			return response;
		}) as typeof fetch,
		headers: {
			"cf-aig-authorization": `Bearer ${CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL}`,
			"cf-aig-metadata": JSON.stringify({ dittoAccount: input.account }),
			Authorization: null,
			"x-api-key": null,
		},
	};
	const complete = (messages: Message[], tools?: (typeof TOOL)[]) =>
		models.complete(model, { messages, tools }, options);

	const turn = async (
		label: WorkersAiTurn["label"],
		run: () => Promise<{ ok: boolean; detail: string; replies: AssistantMessage[] }>,
	): Promise<WorkersAiTurn> => {
		requests = [];
		const started = Date.now();
		let result: { ok: boolean; detail: string; replies: AssistantMessage[] };
		try {
			result = await run();
		} catch (error) {
			result = {
				ok: false,
				detail: error instanceof Error ? error.message : String(error),
				replies: [],
			};
		}
		const latencyMs = Date.now() - started;
		const sent = requests;
		for (const request of sent) await readLog(input, request);
		return {
			label,
			ok: result.ok,
			detail: result.detail,
			latencyMs,
			requests: sent,
			piCost: result.replies.reduce((sum, r) => sum + r.usage.cost.total, 0),
		};
	};

	const plain = await turn("plain turn", async () => {
		const reply = await complete([{ role: "user", content: PLAIN_PROMPT, timestamp: Date.now() }]);
		const failed = failure(reply);
		if (failed) return { ok: false, detail: failed, replies: [reply] };
		const text = textOf(reply);
		const ok = /pong/i.test(text);
		return {
			ok,
			detail: `${ok ? "replied" : "unexpected reply"} "${text.slice(0, 40)}", ${reply.usage.output} output tokens`,
			replies: [reply],
		};
	});

	const word = `word-${crypto.randomUUID().slice(0, 8)}`;
	const tool = await turn("tool-calling turn", async () => {
		const messages: Message[] = [{ role: "user", content: TOOL_PROMPT, timestamp: Date.now() }];
		const first = await complete(messages, [TOOL]);
		const failed = failure(first);
		if (failed) return { ok: false, detail: failed, replies: [first] };
		const call = first.content.find((block) => block.type === "toolCall");
		if (call?.type !== "toolCall" || call.name !== TOOL.name) {
			return {
				ok: false,
				detail: `no call to \`${TOOL.name}\`: answered "${textOf(first).slice(0, 60)}" (stop reason ${first.stopReason})`,
				replies: [first],
			};
		}
		messages.push(first, {
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: [{ type: "text", text: word }],
			isError: false,
			timestamp: Date.now(),
		});
		const second = await complete(messages, [TOOL]);
		const failedAgain = failure(second);
		if (failedAgain)
			return {
				ok: false,
				detail: `called the tool, then ${failedAgain}`,
				replies: [first, second],
			};
		const text = textOf(second);
		const ok = text.includes(word);
		return {
			ok,
			detail: `called \`${TOOL.name}\`, then ${ok ? "replied with its result" : `did not use its result: "${text.slice(0, 60)}"`}`,
			replies: [first, second],
		};
	});

	return finish([plain, tool]);
}

function failure(reply: AssistantMessage): string | undefined {
	if (reply.stopReason === "error" || reply.stopReason === "aborted") {
		return reply.errorMessage ?? reply.stopReason;
	}
	return undefined;
}

function textOf(reply: AssistantMessage): string {
	return reply.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("")
		.trim();
}

/** The gateway writes a request's log shortly after the response. */
async function readLog(input: WorkersAiTrialInput, request: GatewayRequest) {
	if (!request.logId) {
		request.logError = "no cf-aig-log-id header";
		return;
	}
	const deadline = Date.now() + (input.logWaitMs ?? 15_000);
	for (;;) {
		try {
			const gateway = input.ai.gateway(input.gatewayId);
			try {
				request.log = await gateway.getLog(request.logId);
			} finally {
				gateway[Symbol.dispose]?.();
			}
			return;
		} catch (error) {
			if (Date.now() >= deadline) {
				request.logError = error instanceof Error ? error.message : String(error);
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const clock = (d: Date) => `${d.toISOString().slice(11, 16)} UTC`;
const usd = (value: number) => `$${value.toFixed(6)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const eachRun = (runs: WorkersAiRun[], text: (run: WorkersAiRun) => string) =>
	runs.length > 1 ? runs.map((r, i) => `run ${i + 1}: ${text(r)}`).join("; ") : text(runs[0]!);

function turnCost(turn: WorkersAiTurn): string {
	if (!turn.requests.length) return `${turn.label} not sent`;
	const missing = turn.requests.find((r) => typeof r.log?.cost !== "number");
	if (missing) return `${turn.label} not logged (${missing.logError ?? "no cost in the log"})`;
	return `${turn.label} ${usd(turn.requests.reduce((sum, r) => sum + (r.log?.cost ?? 0), 0))}`;
}

/** One evidence entry for the Model route > Workers AI (#35) slot. Holds no credential. */
export function formatWorkersAiEvidence(runs: WorkersAiRun[], options: { origin: string }): string {
	const [first, ...retries] = runs;
	if (!first) throw new Error("formatWorkersAiEvidence needs at least one run");
	const outcome = runs.every((r) => r.outcome === "pass") ? "pass" : "fail";
	const passed = runs.filter((r) => r.outcome === "pass").length;
	const tally = runs.length > 1 ? ` ${passed} of ${runs.length} runs passed.` : "";
	const requests = runs.flatMap((r) => r.turns.flatMap((t) => t.requests));
	const attributed = requests.filter((r) => r.log?.metadata?.dittoAccount === first.account);
	const rest = [
		...new Set(
			requests
				.filter((r) => !attributed.includes(r))
				.map((r) => r.logError ?? `metadata ${JSON.stringify(r.log?.metadata ?? null)}`),
		),
	];
	const observed = first.turns
		.map((t) => {
			const statuses = t.requests.some((r) => r.status !== 200)
				? `, HTTP ${t.requests.map((r) => r.status).join(", ")}`
				: "";
			return `${t.label} ${t.ok ? "passed" : "failed"} in ${t.latencyMs}ms (${plural(t.requests.length, "request")}${statuses}): ${t.detail}`;
		})
		.join(". ");
	const toolsFailed = runs.some((r) =>
		r.turns.some((t) => t.label === "tool-calling turn" && !t.ok),
	);
	const cpu = runs.some((r) => r.request)
		? [
				`- **CPU time:** ${eachRun(runs, (r) => (r.request ? `${Math.round(r.request.cpuMs)}ms CPU, ${Math.round(r.request.wallMs)}ms wall` : "not reported"))}, from the Bot's tail event.`,
			]
		: [];
	const entry = [
		`#### ${day(first.startedAt)} · Workers AI \`${first.model}\` from ${options.origin} · ${outcome}`,
		"",
		`- **Route:** Pi \`cloudflare-workers-ai\` provider, model \`${first.model}\`, through AI Gateway on the \`AI\` binding (\`env.AI.fetch()\` through Pi's \`createAiBindingFetch\`), Ditto account \`${first.account}\` in \`cf-aig-metadata\`. A plain turn, then a turn that must call \`get_secret_word\` and reply with its result. No refresh: the binding has no token.`,
		`- **Runtime:** Pi \`@earendil-works/pi-ai\` ${PI_AI_VERSION} in the Bot Durable Object on Workers Paid`,
		`- **Date:** ${day(first.startedAt)}, ${clock(first.startedAt)}`,
		`- **Network origin:** ${options.origin}`,
		'- **Expected:** the plain turn replies "pong". The tool-calling turn calls `get_secret_word`, then replies with the word it returned.',
		`- **Observed:** ${observed}.${tally}`,
		`- **Retries:** ${retries.length ? retries.map((r) => `${clock(r.startedAt)} ${r.outcome}`).join(", ") : "none"}`,
		`- **Cost:** as AI Gateway logged it, ${eachRun(runs, (r) => r.turns.map(turnCost).join(", "))}. Pi's catalogue estimate: ${eachRun(runs, (r) => r.turns.map((t) => `${t.label} ${usd(t.piCost)}`).join(", "))}.`,
		`- **Attribution:** ${attributed.length} of ${requests.length} requests logged by AI Gateway with metadata \`dittoAccount: ${first.account}\`.${rest.length ? ` The rest: ${rest.join("; ")}.` : ""}`,
		...cpu,
		`- **Fallback:** ${outcome === "pass" ? "none needed" : `none yet: try another \`@cf/\` model${toolsFailed ? "; if none calls tools, Ditto offers no included model and relies on the OpenCode API key" : ""}`}`,
		"",
	].join("\n");
	return redact(entry, []);
}
