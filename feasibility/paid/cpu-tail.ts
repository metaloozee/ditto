// Tail Worker for the paid model trial (#31). A Worker cannot time its own CPU, but Cloudflare
// reports each invocation's CPU and wall time to its tail consumers after the invocation ends.
// This keeps those figures per trial run, keyed by the run id the owner's command sent.

interface TraceItem {
	event: { request?: TraceRequest } | null;
	cpuTime: number;
	wallTime: number;
	outcome: string;
}
interface TraceRequest {
	method: string;
	url: string;
	headers: Record<string, string>;
	/** Cloudflare redacts header values that look like ids. The run id is one. */
	getUnredacted?(): TraceRequest;
}

export interface CpuReading {
	cpuTimeMs: number;
	wallTimeMs: number;
	outcome: string;
}

export default {
	async tail(
		events: TraceItem[],
		env: { CPU: { put(key: string, value: string): Promise<void> } },
	) {
		for (const item of events) {
			const request = item.event?.request;
			if (!request || request.method !== "POST") continue;
			if (new URL(request.url).pathname !== "/model-trial") continue;
			const run = (request.getUnredacted?.() ?? request).headers["x-trial-run"];
			if (!run) continue;
			// Only the figures are stored. The request's headers, with the run key, are not.
			const reading: CpuReading = {
				cpuTimeMs: item.cpuTime,
				wallTimeMs: item.wallTime,
				outcome: item.outcome,
			};
			await env.CPU.put(`cpu:${run}`, JSON.stringify(reading));
		}
	},
};
