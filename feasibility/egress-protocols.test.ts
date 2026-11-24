import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, expect, it } from "vite-plus/test";

import {
	HTTP2_PAGE,
	http2Probe,
	WEBSOCKET_PAGE,
	type WebSocketSession,
	websocketProbe,
} from "./egress/probes.ts";

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

it(
	"holds a WebSocket open through the filter and exchanges messages both ways",
	async () => {
		const session = await inPage<WebSocketSession>(WEBSOCKET_PAGE, websocketProbe(holdMs));

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
	const protocol = await inPage<string>(HTTP2_PAGE, http2Probe);
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
