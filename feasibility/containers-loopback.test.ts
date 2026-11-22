// The owner's loopback doorway to a deployed workspace (#32), against a stand-in Worker. The
// doorway adds the run key, so it must refuse any page in the owner's browser that is not its own.
import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { serveLoopback } from "./containers/loopback.ts";

const KEY = "loopback-run-key-SIMULATED-0123456789abcdef";

async function standIn() {
	const seen: http.IncomingHttpHeaders[] = [];
	const server = http.createServer((request, response) => {
		seen.push(request.headers);
		response.end("forwarded");
	});
	server.on("upgrade", (request, socket) => {
		seen.push(request.headers);
		socket.end(
			"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return { url: `http://127.0.0.1:${port}`, seen, close: () => server.close() };
}

function upgrade(url: string, origin?: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const request = http.request(url, {
			headers: {
				connection: "Upgrade",
				upgrade: "websocket",
				"sec-websocket-version": "13",
				"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
				...(origin ? { origin } : {}),
			},
		});
		request.on("upgrade", (answer, socket) => {
			socket.destroy();
			resolve(answer.statusCode ?? 0);
		});
		request.on("response", (answer) => {
			answer.resume();
			resolve(answer.statusCode ?? 0);
		});
		request.on("error", reject);
		request.end();
	});
}

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

async function doorway() {
	const worker = await standIn();
	const loopback = await serveLoopback({
		workerUrl: worker.url,
		workspace: "ws-takeover",
		route: "devtools",
		port: 0,
		key: KEY,
	});
	cleanup.push(worker.close, loopback.close);
	return { worker, loopback };
}

describe("loopback doorway", () => {
	it("forwards the owner's own requests with the run key", async () => {
		const { worker, loopback } = await doorway();

		const plain = await fetch(`${loopback.url}/json/list`);
		const sameOrigin = await upgrade(`${loopback.url}/devtools/page/1`, loopback.url);

		expect(await plain.text()).toBe("forwarded");
		expect(sameOrigin).toBe(101);
		expect(worker.seen.map((headers) => headers["x-trial-key"])).toEqual([KEY, KEY]);
	});

	it.each(["https://evil.example", "http://127.0.0.1:1", "null"])(
		"refuses a page from %s and never forwards it the run key",
		async (origin) => {
			const { worker, loopback } = await doorway();

			const page = await fetch(`${loopback.url}/json/list`, { headers: { origin } });
			const socket = await upgrade(`${loopback.url}/devtools/page/1`, origin);

			expect(page.status).toBe(403);
			expect(socket).toBe(403);
			expect(worker.seen).toEqual([]);
		},
	);
});
