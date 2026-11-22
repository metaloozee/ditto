// The owner's loopback doorway to a deployed workspace (#32). A browser cannot send the run key
// header, so this forwards 127.0.0.1:<port> to /w/<workspace>/<route>/ on the Worker and adds the
// key itself. The key never reaches a URL, a page or the container; only loopback can connect.
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";

export type Route = "view" | "devtools" | "control";

export async function serveLoopback(options: {
	workerUrl: string;
	workspace: string;
	route: Route;
	port: number;
	key: string;
}): Promise<{ url: string; close(): Promise<void> }> {
	const base = new URL(options.workerUrl);
	const client = base.protocol === "https:" ? https : http;
	const target = (path: string) => new URL(`/w/${options.workspace}/${options.route}${path}`, base);
	const headers = (incoming: http.IncomingHttpHeaders) => {
		const out: http.OutgoingHttpHeaders = { ...incoming, "x-trial-key": options.key };
		delete out.host;
		delete out.origin;
		return out;
	};

	const server = http.createServer((request, response) => {
		const upstream = client.request(
			target(request.url ?? "/"),
			{ method: request.method, headers: headers(request.headers) },
			(answer) => {
				response.writeHead(answer.statusCode ?? 502, answer.headers);
				answer.pipe(response);
			},
		);
		upstream.on("error", () => response.writeHead(502).end());
		request.pipe(upstream);
	});

	// WebSockets: noVNC's screen and DevTools sessions.
	server.on("upgrade", (request, socket, head) => {
		const upstream = client.request(target(request.url ?? "/"), {
			method: "GET",
			headers: headers(request.headers),
		});
		upstream.on("upgrade", (answer, remote, remoteHead) => {
			const lines = [`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}`];
			for (let i = 0; i < answer.rawHeaders.length; i += 2) {
				lines.push(`${answer.rawHeaders[i]}: ${answer.rawHeaders[i + 1]}`);
			}
			socket.write(`${lines.join("\r\n")}\r\n\r\n`);
			if (remoteHead.length) socket.write(remoteHead);
			if (head.length) remote.write(head);
			remote.pipe(socket).pipe(remote);
			remote.on("error", () => socket.destroy());
			socket.on("error", () => remote.destroy());
		});
		upstream.on("response", (answer) => {
			socket.end(`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}\r\n\r\n`);
		});
		upstream.on("error", () => socket.destroy());
		upstream.end();
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port, "127.0.0.1", resolve);
	});
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
