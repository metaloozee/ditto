// The #26 model-trial Worker, deployed on Workers Paid (#31). It takes a credential in the request
// body and spends it, so every route sits behind the owner's run key. The Worker keeps
// no credential at rest: the owner's command sends it per run and keeps the rotated one.
import modelWorker, { type ModelTrialEnv } from "../model-worker.ts";
import { coloOf, requireRunKey } from "../run-key.ts";

export interface PaidTrialEnv extends ModelTrialEnv {
	/** Sent by the owner's run command in the `x-trial-key` header. Empty refuses every request. */
	TRIAL_RUN_KEY: string;
	/** Written by the CPU tail Worker, one entry per trial run. */
	CPU: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
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
			const saved = await env.CPU.get(`cpu:${url.searchParams.get("run") ?? ""}`);
			return saved
				? new Response(saved, { headers: { "content-type": "application/json" } })
				: new Response("Not recorded yet", { status: 404 });
		}
		const response = await modelWorker.fetch(request, env, ctx);
		const headers = new Headers(response.headers);
		headers.set("x-trial-colo", coloOf(request));
		return new Response(response.body, { status: response.status, headers });
	},
};
