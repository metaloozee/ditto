import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, expect, it } from "vite-plus/test";

// WebSocket and HTTP/2 through the egress filter (#28). Its own Compose project, so it
// can run beside egress.test.ts. The WebSocket is held for EGRESS_WS_HOLD_MS
// (default 5s); set it to 65000 for the one-minute acceptance run.
const run = promisify(execFile);
const egress = path.join(import.meta.dirname, "egress");
const workspace = "ws-trial";
const destinations = mkdtempSync(path.join(tmpdir(), "ditto-egress-protocols-"));
const holdMs = Number(process.env.EGRESS_WS_HOLD_MS ?? 5_000);

const env = { ...process.env, WORKSPACE_ID: workspace, DESTINATIONS_DIR: destinations };
const compose = (...args: string[]) =>
	run(
		"docker",
		[
			"compose",
			"-p",
			"ditto-feasibility-egress-protocols",
			"-f",
			path.join(egress, "compose.yaml"),
			"-f",
			path.join(egress, "protocols.compose.yaml"),
			...args,
		],
		{ env, maxBuffer: 16 * 1024 * 1024 },
	);

/** Opens `url` in the running browser and returns what `expression` resolves to in the page. */
async function inPage<T>(url: string, expression: string): Promise<T> {
	const { stdout } = await compose("run", "--rm", "driver", url, expression);
	return JSON.parse(stdout) as T;
}

type Decision = {
	workspace: string;
	host: string;
	decision: "allow" | "deny";
	method?: string;
	http_version?: string;
	upstream_alpn?: string;
};

async function filterLog(): Promise<Decision[]> {
	const { stdout } = await compose("logs", "--no-log-prefix", "filter");
	return stdout
		.split("\n")
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as Decision);
}

beforeAll(async () => {
	writeFileSync(path.join(destinations, `${workspace}.txt`), "echo.websocket.org\nexample.com\n");
	await compose("up", "-d", "--build", "--wait", "filter", "browser");
}, 600_000);

afterAll(async () => {
	await compose("down", "-v");
	rmSync(destinations, { recursive: true, force: true });
}, 120_000);

type Session = {
	opened: boolean;
	greeting: string | null;
	sent: number;
	echoed: number;
	openForMs: number;
	openAtEnd: boolean;
	closeCode: number | null;
};

it(
	"holds a WebSocket open through the filter and exchanges messages both ways",
	async () => {
		const session = await inPage<Session>(
			"https://echo.websocket.org/",
			`new Promise((resolve) => {
				const ws = new WebSocket("wss://echo.websocket.org/");
				const s = { opened: false, greeting: null, sent: 0, echoed: 0, openForMs: 0, openAtEnd: false, closeCode: null };
				let start = 0, timer;
				const send = () => { ws.send("ping " + s.sent); s.sent++; };
				ws.onmessage = ({ data }) => {
					if (String(data).startsWith("ping ")) s.echoed++;
					else s.greeting ??= String(data).slice(0, 40);
				};
				ws.onclose = (e) => { s.closeCode = e.code; clearInterval(timer); s.openForMs = Date.now() - start; resolve(s); };
				ws.onopen = () => {
					s.opened = true;
					start = Date.now();
					send();
					timer = setInterval(send, 2000);
					setTimeout(() => {
						clearInterval(timer);
						s.openForMs = Date.now() - start;
						s.openAtEnd = ws.readyState === WebSocket.OPEN;
						// Let the last echo arrive, then hang up.
						setTimeout(() => { resolve({ ...s }); ws.close(); }, 2000);
					}, ${holdMs});
				};
			})`,
		);

		expect(session).toMatchObject({ opened: true, openAtEnd: true, closeCode: null });
		expect(session.greeting).toMatch(/^Request served by/);
		expect(session.openForMs).toBeGreaterThanOrEqual(holdMs);
		expect(session.echoed).toBe(session.sent);
		expect(session.sent).toBeGreaterThanOrEqual(2);

		expect(await filterLog()).toContainEqual(
			expect.objectContaining({
				workspace,
				host: "echo.websocket.org",
				decision: "allow",
				method: "WEBSOCKET",
			}),
		);
	},
	holdMs + 120_000,
);

it("negotiates HTTP/2 from Chrome to the filter and from the filter to the origin", async () => {
	const protocol = await inPage<string>(
		"https://example.com/",
		`performance.getEntriesByType("navigation")[0].nextHopProtocol`,
	);
	expect(protocol).toBe("h2");

	expect(await filterLog()).toContainEqual(
		expect.objectContaining({
			workspace,
			host: "example.com",
			decision: "allow",
			method: "GET",
			http_version: "HTTP/2.0",
			upstream_alpn: "h2",
		}),
	);
}, 120_000);
