import { proxyToSandbox } from "@cloudflare/sandbox";
import {
	parseCandidatePreviewHost,
	previewTokenDigest,
} from "./pi-durable-preview.ts";

const notFound = () => new Response("Not Found", { status: 404 });

/** Admits one preview request against its session, then forwards it to the candidate sandbox. */
export async function candidatePreviewFetch(
	request: Request,
	deps: {
		session(workspaceSessionId: string): {
			previewAdmit(digest: string): Promise<boolean>;
		};
		proxy(request: Request): Promise<Response | null>;
	},
): Promise<Response> {
	const host = parseCandidatePreviewHost(new URL(request.url).hostname);
	if (!host) return notFound();
	try {
		const digest = await previewTokenDigest(host.token);
		if (!(await deps.session(host.workspaceSessionId).previewAdmit(digest)))
			return notFound();
	} catch {
		return notFound();
	}
	return (await deps.proxy(request)) ?? notFound();
}

/** The SDK proxy bound to the candidate sandbox namespace instead of `env.Sandbox`. */
export function candidatePreviewProxy(env: {
	CandidateSandbox: DurableObjectNamespace<
		import("@cloudflare/sandbox").Sandbox
	>;
}): (request: Request) => Promise<Response | null> {
	return (request) =>
		proxyToSandbox(request, { Sandbox: env.CandidateSandbox });
}
