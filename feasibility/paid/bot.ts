// The Sign in with ChatGPT trial from a Durable Object (#34), shaped like a bot that holds its
// owner's model access. Following OpenAI's self-hosted guide, the owner signs in locally and
// transfers the credential here once. From then on this object owns the sign-in: it keeps the
// credential in its storage, refreshes it, and keeps its own agent host ID, apart from the owner's machine's.
// Trial-only: the credential is at rest in Durable Object storage until the stage is destroyed.
import { type Credential, InMemoryCredentialStore } from "@earendil-works/pi-ai";

import { PI_PROVIDER, runModelTrial } from "../model-trial.ts";
import { type ModelTrialEnv, trialStream } from "../model-worker.ts";

interface BotState {
	storage: {
		get<T>(key: string): Promise<T | undefined>;
		put(key: string, value: unknown): Promise<void>;
	};
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** A Sign in with ChatGPT credential: the client ID OpenAI issued, needed to refresh it, and the plan-usage grant. */
function signInCredential(value: unknown): Credential | undefined {
	if (!isRecord(value)) return undefined;
	const valid =
		value.type === "oauth" &&
		typeof value.access === "string" &&
		typeof value.refresh === "string" &&
		typeof value.expires === "number" &&
		typeof value.clientId === "string" &&
		Array.isArray(value.scopes) &&
		value.scopes.includes("chatgpt.tokens.use.direct");
	return valid ? (value as Credential) : undefined;
}

export class Bot {
	constructor(
		private state: BotState,
		private env: ModelTrialEnv,
	) {}

	async fetch(request: Request): Promise<Response> {
		if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
		const path = new URL(request.url).pathname;
		if (path === "/siwc/import") return this.import(request);
		if (path === "/siwc/trial") return this.trial(request);
		return new Response("Not found", { status: 404 });
	}

	/** Takes over a sign-in made on the owner's machine. The host ID stays this object's own. */
	private async import(request: Request): Promise<Response> {
		const body: unknown = await request.json().catch(() => undefined);
		const credential = signInCredential(isRecord(body) ? body.credential : undefined);
		if (!credential) {
			return new Response(
				"Expected a Sign in with ChatGPT credential with its client ID and plan-usage scope",
				{
					status: 400,
				},
			);
		}
		let hostId = await this.state.storage.get<string>("hostId");
		if (!hostId) {
			hostId = crypto.randomUUID();
			await this.state.storage.put("hostId", hostId);
		}
		await this.state.storage.put("credential", credential);
		return Response.json({ hostId: `urn:uuid:${hostId}` });
	}

	/** Turn, refresh and turn on the sign-in this object owns. It keeps the rotated tokens. */
	private async trial(request: Request): Promise<Response> {
		const saved = signInCredential(await this.state.storage.get<unknown>("credential"));
		if (!saved) {
			return new Response("No sign-in here yet. Run: pnpm feasibility:paid transfer-siwc", {
				status: 409,
			});
		}
		const body: unknown = await request.json().catch(() => ({}));
		const model = isRecord(body) && typeof body.model === "string" ? body.model : undefined;
		const providerId = PI_PROVIDER.siwc;
		const credentials = new InMemoryCredentialStore();
		await credentials.modify(providerId, async () => saved);
		const provider = this.env.PROVIDER;
		// A refresh retires the old refresh token, so keep the newest after every step, not only
		// once the trial ends.
		const keep = async () => {
			const current = await credentials.read(providerId);
			if (current) await this.state.storage.put("credential", current);
		};
		return trialStream(async (onStep) => {
			const run = await runModelTrial({
				route: "siwc",
				model,
				credentials,
				fetch: provider ? (url, init) => provider.fetch(new Request(url, init)) : undefined,
				onStep: async (step) => {
					await keep();
					await onStep(step);
				},
			});
			await keep();
			// The credential never leaves: this object owns its refreshes.
			return { run, credential: undefined };
		});
	}
}
