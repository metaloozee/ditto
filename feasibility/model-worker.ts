// The #25 model trial inside workerd (#26). `model-baseline.ts --runtime workerd` drives it:
// GET /model-trial reports the runtime, POST /model-trial runs one trial and streams NDJSON.
import { type Credential, InMemoryCredentialStore, PI_AI_VERSION } from "@earendil-works/pi-ai";
import { registerLazyOAuthFlows } from "@earendil-works/pi-ai/lazy-oauth";

import { COMPATIBILITY, COMPATIBILITY_TEXT } from "./compatibility.ts";
import { runModelTrial, type TrialRoute, type TrialRun } from "./model-trial.ts";

// Pi loads OAuth flows through a variable import specifier, which a Worker bundle cannot
// resolve at runtime. Literal dynamic imports put the flows in bundled chunks instead.
registerLazyOAuthFlows();

export interface TrialRequest {
	route: TrialRoute;
	model?: string;
	credential: Credential;
}

/** One NDJSON line of the POST /model-trial response. */
export type TrialEvent =
	| { type: "step"; label: string }
	| {
			type: "done";
			run: Omit<TrialRun, "startedAt"> & { startedAt: string };
			credential: Credential | undefined;
	  };

const PROVIDER_ID = { chatgpt: "openai-codex", opencode: "opencode" } as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** The request body, or undefined when it cannot start a trial. */
function parseTrialRequest(body: unknown): TrialRequest | undefined {
	if (!isRecord(body) || (body.route !== "chatgpt" && body.route !== "opencode")) return undefined;
	if (body.model !== undefined && typeof body.model !== "string") return undefined;
	const credential = body.credential;
	if (!isRecord(credential)) return undefined;
	const valid =
		body.route === "chatgpt"
			? credential.type === "oauth" &&
				typeof credential.access === "string" &&
				typeof credential.refresh === "string" &&
				typeof credential.expires === "number"
			: credential.type === "api_key" && typeof credential.key === "string";
	return valid
		? { route: body.route, model: body.model, credential: credential as Credential }
		: undefined;
}

export interface ModelTrialEnv {
	/** Bound only in test stages: a simulated provider in place of the internet. */
	PROVIDER?: { fetch(request: Request): Promise<Response> };
}

export default {
	async fetch(
		request: Request,
		env: ModelTrialEnv,
		ctx: { waitUntil(promise: Promise<unknown>): void },
	): Promise<Response> {
		if (new URL(request.url).pathname !== "/model-trial") {
			return new Response("Not found", { status: 404 });
		}
		if (request.method === "GET") {
			return Response.json({
				pi: PI_AI_VERSION,
				compatibilityDate: COMPATIBILITY.date,
				runtime: COMPATIBILITY_TEXT,
				simulatedProvider: Boolean(env.PROVIDER),
			});
		}
		if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

		const input = parseTrialRequest(await request.json().catch(() => undefined));
		if (!input) {
			return new Response("Expected a route (chatgpt or opencode) and its credential", {
				status: 400,
			});
		}
		const providerId = PROVIDER_ID[input.route];
		const credentials = new InMemoryCredentialStore();
		await credentials.modify(providerId, async () => input.credential);

		const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
		const writer = writable.getWriter();
		const send = (event: TrialEvent) =>
			writer.write(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
		const provider = env.PROVIDER;
		ctx.waitUntil(
			(async () => {
				const run = await runModelTrial({
					route: input.route,
					model: input.model,
					credentials,
					fetch: provider ? (url, init) => provider.fetch(new Request(url, init)) : undefined,
					async onStep(step) {
						await send({ type: "step", label: step.label });
						// The driver samples workerd's CPU when this line arrives. Idle time costs no
						// CPU, so a short pause keeps the next step's work out of this sample.
						await new Promise((resolve) => setTimeout(resolve, 100));
					},
				});
				await send({
					type: "done",
					run: { ...run, startedAt: run.startedAt.toISOString() },
					credential: await credentials.read(providerId),
				});
				await writer.close();
			})().catch((error: unknown) => writer.abort(error)),
		);
		return new Response(readable, { headers: { "content-type": "application/x-ndjson" } });
	},
};
