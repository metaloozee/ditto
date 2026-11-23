// The hosts a Browser Run page requested and the ones its guardrails refused. Browser Run keeps no
// log the harness can read, so this listens on its own DevTools connection to the page, as the
// Containers trial's egress filter logged its decisions. It records hosts and statuses only:
// request URLs can carry tokens. It sees the page's own requests, not those of other tabs.
import { Tab } from "../takeover/cdp.ts";

type Response = { url: string; status: number; headers: Record<string, string> };
export type Decision = { host: string; decision: "allow" | "deny" };

const hostOf = (url: string) => {
	try {
		const { protocol, host } = new URL(url);
		return ["http:", "https:", "ws:", "wss:"].includes(protocol) ? host : undefined;
	} catch {
		return undefined;
	}
};

/** Browser Run answers a request its guardrails refuse with 403 and `cf-mitigated: guardrails`. */
export const refusedByGuardrails = (response: Pick<Response, "status" | "headers">) =>
	response.status === 403 &&
	Object.entries(response.headers).some(
		([name, value]) => name.toLowerCase() === "cf-mitigated" && value.trim() === "guardrails",
	);

export class RequestLog {
	private log: Decision[] = [];
	private documents: Response[] = [];
	private tab: Tab;

	private constructor(tab: Tab) {
		this.tab = tab;
	}

	static async attach(devtools: string): Promise<RequestLog> {
		const tab = await Tab.open(devtools);
		const log = new RequestLog(tab);
		await tab.listen("Network", (method, params) => log.record(method, params));
		return log;
	}

	private record(method: string, params: unknown) {
		const event = params as {
			type?: string;
			url?: string;
			request?: { url: string };
			response?: Response;
		};
		if (method === "Network.requestWillBeSent" && event.request) {
			this.add(event.request.url, "allow");
		}
		if (method === "Network.webSocketCreated" && event.url) this.add(event.url, "allow");
		if (method === "Network.responseReceived" && event.response) {
			if (refusedByGuardrails(event.response)) this.add(event.response.url, "deny");
			if (event.type === "Document") this.documents.push(event.response);
		}
	}

	private add(url: string, decision: Decision["decision"]) {
		const host = hostOf(url);
		if (host) this.log.push({ host, decision });
	}

	/** Every decision so far, oldest first. A refused host is logged as asked, then refused. */
	decisions(): Decision[] {
		return [...this.log];
	}

	/** Distinct hosts requested and refused since `from` decisions. */
	since(from: number): { requested: string[]; refused: string[] } {
		const recent = this.log.slice(from);
		const distinct = (list: Decision[]) => [...new Set(list.map((d) => d.host))].sort();
		return {
			requested: distinct(recent),
			refused: distinct(recent.filter((d) => d.decision === "deny")),
		};
	}

	/** The last top-level document response for this host: status and guardrail refusal only. */
	document(host: string): { status: number; refused: boolean } | undefined {
		const found = this.documents.filter((response) => hostOf(response.url) === host).at(-1);
		return found && { status: found.status, refused: refusedByGuardrails(found) };
	}

	close(): void {
		this.tab.close();
	}
}
