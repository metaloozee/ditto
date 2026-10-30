import { WorkerEntrypoint } from "cloudflare:workers";
import { ContainerProxy } from "@cloudflare/sandbox";
import {
	type ExecutionSessionBindings,
	PiDurableCandidateSandbox,
	PiDurableExecutionSession,
} from "./pi-durable-execution-session.ts";
import {
	candidatePreviewFetch,
	candidatePreviewProxy,
} from "./pi-durable-preview-fetch.ts";

export { ContainerProxy, PiDurableCandidateSandbox, PiDurableExecutionSession };

/** Product-only preview hop; the runtime has no public origin. */
export class CandidatePreview extends WorkerEntrypoint<ExecutionSessionBindings> {
	fetch(request: Request) {
		const { CandidateSandbox, CandidateSessions } = this.env;
		if (!CandidateSandbox) return new Response("Not Found", { status: 404 });
		return candidatePreviewFetch(request, {
			session: (id) => CandidateSessions.getByName(id),
			proxy: candidatePreviewProxy({ CandidateSandbox }),
		});
	}
}

export default { fetch: () => new Response("Not Found", { status: 404 }) };
