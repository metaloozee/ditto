// The #27 and #28 local checks, repeated on a Cloudflare Containers instance (#32) through the
// run-key gated Worker, plus the identity, fence and resource readings only a deployed runtime
// can answer. Each check renders as one entry in the docs/feasibility/evidence.md format.
import {
	HTTP2_PAGE,
	http2Probe,
	WEBSOCKET_PAGE,
	type WebSocketSession,
	websocketProbe,
} from "../egress/probes.ts";
import { Tab } from "../takeover/cdp.ts";
import { assertClean } from "../takeover/redact.ts";

export const CHECK_WORKSPACE = "ws-cloud-trial";

export type Decision = {
	workspace: string;
	host: string;
	decision: "allow" | "deny";
	method?: string;
	url?: string;
	http_version?: string;
	upstream_alpn?: string | null;
};

export type Started = { workspace: string; instanceType: string; startupMs: number };
export type Memory = {
	currentMib: number;
	peakMib: number | null;
	limitMib: number | null;
	memTotalMib: number | null;
};

export interface Instance {
	devtools: string;
	decisions(): Promise<Decision[]>;
	control<T>(path: "/isolation" | "/bypass" | "/memory"): Promise<T>;
}

type Check = {
	title: string;
	outcome: "pass" | "fail";
	route: string;
	expected: string;
	observed: string;
	compare: string;
};

const mib = (value: number | null) => (value === null ? "unknown" : `${value} MiB`);
const json = (value: unknown) => `\`${JSON.stringify(value).replaceAll(",", ", ")}\``;
const decisionLine = (d: Decision) =>
	json(
		Object.fromEntries(
			Object.entries(d).filter(([key]) =>
				["workspace", "host", "decision", "method", "http_version", "upstream_alpn"].includes(key),
			),
		),
	);

export async function runChecks(
	instance: Instance,
	started: Started,
	options: { holdMs: number; log: (message: string) => void },
): Promise<Check[]> {
	const { log } = options;
	const checks: Check[] = [];
	const tab = await Tab.open(instance.devtools);
	const since = async (count: number) => (await instance.decisions()).slice(count);

	try {
		log("Loading an approved destination…");
		let before = (await instance.decisions()).length;
		await tab.goto("https://example.com/");
		const title = await tab.evaluate<string>("document.title");
		const allowed = (await since(before)).find(
			(d) => d.host === "example.com" && d.decision === "allow",
		);
		checks.push({
			title: "Chrome loads an approved destination",
			outcome:
				title === "Example Domain" && allowed?.workspace === CHECK_WORKSPACE ? "pass" : "fail",
			route: `headed Chromium in the instance, \`--proxy-server=http://127.0.0.1:8080\`, loads \`https://example.com/\` with \`example.com\` on the \`${CHECK_WORKSPACE}\` list`,
			expected: `the page loads against the filter's CA and the filter logs an allow with workspace \`${CHECK_WORKSPACE}\``,
			observed: `document title \`${title}\`. Filter logged ${allowed ? decisionLine(allowed) : "no allow for `example.com`"}.`,
			compare: "#27 local: pass, title `Example Domain`, allow logged with `ws-trial`",
		});

		log("Loading an unapproved destination…");
		before = (await instance.decisions()).length;
		const refusal = await tab
			.goto("https://example.org/")
			.then(() => "the page loaded")
			.catch((error: Error) => error.message.replace(/^Navigation failed: /, ""));
		const denied = (await since(before)).find((d) => d.host === "example.org");
		checks.push({
			title: "Chrome is refused an unapproved destination",
			outcome:
				refusal.includes("ERR_TUNNEL_CONNECTION_FAILED") && denied?.decision === "deny"
					? "pass"
					: "fail",
			route: "the same Chromium loads `https://example.org/`, which is not on the list",
			expected: "the filter refuses the tunnel and logs the deny with the workspace",
			observed: `navigation: \`${refusal}\`. Filter logged ${denied ? decisionLine(denied) : "nothing for `example.org`"}.`,
			compare: "#27 local: pass, `net::ERR_TUNNEL_CONNECTION_FAILED`, deny logged",
		});

		log("Probing for a route around the filter…");
		const isolation = await instance.control<{ isolation: string }>("/isolation");
		const bypass = await instance.control<{ dns: string; direct: string }>("/bypass");
		checks.push({
			title: "Chrome has no route around the filter",
			outcome: bypass.dns === "failed" && bypass.direct === "failed" ? "pass" : "fail",
			route:
				"as the browser user, resolve `example.com` and open TCP to `1.1.1.1:443` without the proxy. One instance shares one network namespace, so only the entrypoint's owner-match fence (needs `NET_ADMIN`) can stop this",
			expected: "both fail: only the filter's user may open outbound connections",
			observed: `fence ${json(isolation)}. Probe ${json(bypass)}.`,
			compare:
				"#27 local: pass, `ERR_NAME_NOT_RESOLVED`; Docker's internal network gave Chrome no route at all",
		});

		log(`Holding a WebSocket for ${options.holdMs} ms…`);
		before = (await instance.decisions()).length;
		await tab.goto(WEBSOCKET_PAGE);
		const session = await tab.evaluate<WebSocketSession>(websocketProbe(options.holdMs));
		const upgrade = (await since(before)).find(
			(d) => d.host === "echo.websocket.org" && d.method === "WEBSOCKET",
		);
		const wsPass =
			session.opened &&
			session.openAtEnd &&
			session.closeCode === null &&
			session.openForMs >= options.holdMs &&
			session.sent >= 2 &&
			session.echoed === session.sent &&
			upgrade?.decision === "allow";
		checks.push({
			title: "WebSocket held open through the filter",
			outcome: wsPass ? "pass" : "fail",
			route: `the same Chromium opens \`${WEBSOCKET_PAGE}\`, then \`wss://echo.websocket.org/\`, pinging every 2 seconds for ${options.holdMs} ms`,
			expected:
				"the socket opens, every ping is echoed, it is still open at the end, and the filter logs the WebSocket allow with the workspace",
			observed: `opened: ${session.opened}, greeting ${session.greeting ? "`Request served by <instance id>`" : "none"}, ${session.echoed} of ${session.sent} pings echoed, open for ${session.openForMs} ms, open at end: ${session.openAtEnd}, close code: ${session.closeCode ?? "none"}. Filter logged ${upgrade ? decisionLine(upgrade) : "no WEBSOCKET decision"}.`,
			compare: "#28 local: pass, 7 of 7 echoed, open after 65,189 ms, no RFC 8441",
		});

		log("Checking HTTP/2…");
		before = (await instance.decisions()).length;
		// A fresh URL, so the earlier example.com load can't answer it from Chrome's cache.
		await tab.goto(`${HTTP2_PAGE}?h2=${Date.now()}`);
		const protocol = await tab.evaluate<string>(http2Probe);
		const h2 = (await since(before)).find(
			(d) => d.host === "example.com" && d.method === "GET" && d.decision === "allow",
		);
		checks.push({
			title: "HTTP/2 negotiated end to end through the filter",
			outcome:
				protocol === "h2" && h2?.http_version === "HTTP/2.0" && h2.upstream_alpn === "h2"
					? "pass"
					: "fail",
			route: `the same Chromium loads \`${HTTP2_PAGE}\` through the filter`,
			expected:
				"Chrome negotiates `h2` with the filter and the filter negotiates `h2` with the origin. A fallback to HTTP/1.1 is a downgrade",
			observed: `\`nextHopProtocol\` was \`${protocol}\`. Filter logged ${h2 ? decisionLine(h2) : "no GET for `example.com`"}.`,
			compare: "#28 local: pass, `h2` on both legs",
		});
	} finally {
		tab.close();
	}

	const all = await instance.decisions();
	const others = all.filter((d) => d.workspace !== CHECK_WORKSPACE);
	checks.unshift({
		title: "filter logs the workspace identity the runtime passed",
		outcome: all.length > 0 && others.length === 0 ? "pass" : "fail",
		route: `the Worker's Durable Object for \`${started.workspace}\` starts the instance with \`WORKSPACE_ID=${started.workspace}\`; the entrypoint hands it to the filter, which reads \`/destinations/<WORKSPACE_ID>.txt\``,
		expected: "every decision the filter logs carries that workspace, and no other",
		observed: `${all.length} decisions logged, ${others.length} with another workspace. First: ${all[0] ? decisionLine(all[0]) : "none"}.`,
		compare: "#27 local: Compose passed `WORKSPACE_ID`; every decision carried `ws-trial`",
	});

	const memory = await instance.control<Memory>("/memory");
	checks.push({
		title: "instance size, memory and startup time",
		outcome: "pass",
		route: `\`${started.instanceType}\` instance running headed Chromium, Xvfb, x11vnc, noVNC and the filter`,
		expected: "Chrome becomes ready and the instance reports its memory after the checks",
		observed: [
			`**Instance size:** \`${started.instanceType}\`.`,
			`**Startup time:** ${started.startupMs} ms from \`start()\` to Chrome's DevTools answering.`,
			`**Observed memory:** ${memory.currentMib} MiB in use after the checks, peak ${mib(memory.peakMib)}, cgroup limit ${mib(memory.limitMib)}, the instance reports ${mib(memory.memTotalMib)} total.`,
		].join(" "),
		compare: "local Docker: no size limit and no startup reading recorded",
	});
	return checks;
}

export function renderChecks(checks: Check[], options: { at: Date; local: boolean }): string {
	const date = options.at.toISOString().slice(0, 10);
	const time = options.at.toISOString().slice(11, 16);
	const where = options.local ? "under alchemy dev" : "on Cloudflare";
	const text = checks
		.map((check) =>
			[
				`#### ${date} · ${check.title} ${where} · ${check.outcome}`,
				"",
				`- **Route:** ${check.route}`,
				`- **Date:** ${date}, ${time} UTC`,
				`- **Network origin:** ${options.local ? "container (alchemy dev, local Docker)" : "Cloudflare container"}`,
				`- **Expected:** ${check.expected}`,
				`- **Observed:** ${check.observed}`,
				`- **Compared with the local trial:** ${check.compare}`,
				"- **Retries:** _none_",
				`- **Fallback:** ${check.outcome === "pass" ? "none needed" : "_owner to name_"}`,
				"",
			].join("\n"),
		)
		.join("\n");
	assertClean(text);
	return text;
}
