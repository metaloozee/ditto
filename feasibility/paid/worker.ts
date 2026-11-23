// The #26 model-trial Worker, deployed on Workers Paid (#31). It takes a credential in the request
// body and spends it, so every route sits behind the owner's run key. The Worker keeps
// no credential at rest: the owner's command sends it per run and keeps the rotated one.
// `/siwc/*` goes to the Bot Durable Object (#34), which does keep its transferred sign-in, and so
// does `/workers-ai/*`, the included model through the Bot's `AI` binding (#35).
import modelWorker, { type ModelTrialEnv } from "../model-worker.ts";
import { coloOf, requireRunKey } from "../run-key.ts";

export { Bot } from "./bot.ts";

export interface PaidTrialEnv extends ModelTrialEnv {
	/** Sent by the owner's run command in the `x-trial-key` header. Empty refuses every request. */
	TRIAL_RUN_KEY: string;
	/** Written by the CPU tail Worker, one entry per trial run. */
	CPU: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
	BOT: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
}

export default {
	async fetch(
		request: Request,
		env: PaidTrialEnv,
		ctx: { waitUntil(promise: Promise<unknown>): void },
	): Promise<Response> {
		const refused = await requireRunKey(request, env.TRIAL_RUN_KEY);
		if (refused) return refused;
		const url = new URL(request.url);
		if (url.pathname === "/model-trial/cpu") {
			// `part` names a Durable Object class, whose invocation Cloudflare reports separately.
			const part = url.searchParams.get("part");
			const saved = await env.CPU.get(
				`cpu:${url.searchParams.get("run") ?? ""}${part ? `:${part}` : ""}`,
			);
			return saved
				? new Response(saved, { headers: { "content-type": "application/json" } })
				: new Response("Not recorded yet", { status: 404 });
		}
		// One bot per stage: the trial needs one owner's sign-in, not a fleet.
		const response =
			url.pathname.startsWith("/siwc/") || url.pathname.startsWith("/workers-ai/")
				? await env.BOT.getByName("siwc-trial").fetch(request)
				: await modelWorker.fetch(request, env, ctx);
		const headers = new Headers(response.headers);
		headers.set("x-trial-colo", coloOf(request));
		return new Response(response.body, { status: response.status, headers });
	},
};
