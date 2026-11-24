import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { Tab } from "./takeover/cdp.ts";

// A fake DevTools endpoint with just enough WebSocket to answer CDP commands. A fresh browser can
// replace its first page within seconds (#36 saw it on Browser Run), so the page /json/list names
// can be gone by the time a client connects: DevTools then closes with 1008 "Target not found".

const frame = (opcode: number, payload: Buffer) => {
	const header =
		payload.length < 126
			? Buffer.from([0x80 | opcode, payload.length])
			: Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff]);
	return Buffer.concat([header, payload]);
};

const closeFrame = (code: number, reason: string) => {
	const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
	payload.writeUInt16BE(code);
	payload.write(reason, 2);
	return frame(0x8, payload);
};

/** Unmasks the client's text frames (one frame per read is enough for CDP commands). */
function messages(data: Buffer): string[] {
	const out: string[] = [];
	let at = 0;
	while (at + 2 <= data.length) {
		let length = (data[at + 1] ?? 0) & 0x7f;
		let offset = at + 2;
		if (length === 126) {
			length = data.readUInt16BE(offset);
			offset += 2;
		}
		const mask = data.subarray(offset, offset + 4);
		const body = data.subarray(offset + 4, offset + 4 + length);
		if (((data[at] ?? 0) & 0x0f) === 0x1) {
			out.push(Buffer.from(body.map((b, i) => b ^ (mask[i % 4] ?? 0))).toString());
		}
		at = offset + 4 + length;
	}
	return out;
}

type Page = "gone" | "live";

function devtools(pages: () => { id: string; state: Page }[]) {
	const sockets = new Set<Socket>();
	const server = http.createServer((request, response) => {
		const port = (server.address() as AddressInfo).port;
		response.setHeader("content-type", "application/json");
		response.end(
			JSON.stringify(
				pages().map(({ id }) => ({
					id,
					type: "page",
					url: "about:blank",
					webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}`,
				})),
			),
		);
	});
	server.on("upgrade", (request, socket: Socket) => {
		sockets.add(socket);
		const accept = createHash("sha1")
			.update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
			.digest("base64");
		socket.write(
			`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
		);
		const id = request.url?.split("/").at(-1);
		const page = pages().find((p) => p.id === id);
		if (page?.state !== "live") {
			socket.end(closeFrame(1008, "Target not found"));
			return;
		}
		socket.on("data", (data) => {
			if (socket.writableEnded) return;
			for (const text of messages(data)) {
				const { id: commandId } = JSON.parse(text) as { id: number };
				const reply = { id: commandId, result: { result: { value: "complete" } } };
				socket.write(frame(0x1, Buffer.from(JSON.stringify(reply))));
			}
		});
	});
	return new Promise<{ url: string; drop(): void; close(): Promise<void> }>((resolve) =>
		server.listen(0, "127.0.0.1", () =>
			resolve({
				url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
				drop: () => {
					for (const socket of sockets) socket.end(closeFrame(1008, "Target not found"));
				},
				close: () =>
					new Promise((done) => {
						for (const socket of sockets) socket.destroy();
						server.close(() => done());
					}),
			}),
		),
	);
}

let server: Awaited<ReturnType<typeof devtools>> | undefined;
afterEach(async () => {
	await server?.close();
	server = undefined;
});

describe("DevTools tab", () => {
	it("moves to the page that replaced the one it was first listed", async () => {
		let listed = 0;
		server = await devtools(() =>
			// The first listing names the launch page, already replaced; later listings name its successor.
			listed++ === 0 ? [{ id: "LAUNCH", state: "gone" }] : [{ id: "SETTLED", state: "live" }],
		);

		const tab = await Tab.open(server.url, 10_000);

		expect(await tab.evaluate<string>("document.readyState")).toBe("complete");
		tab.close();
	}, 15_000);

	it("fails a command when the page goes away, instead of waiting for ever", async () => {
		server = await devtools(() => [{ id: "SETTLED", state: "live" }]);
		const tab = await Tab.open(server.url, 10_000);

		server.drop();

		await expect(tab.evaluate("1")).rejects.toThrow(/DevTools closed: 1008 Target not found/);
	}, 15_000);
});
