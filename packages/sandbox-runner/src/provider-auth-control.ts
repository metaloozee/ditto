import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import {
	type AuthControlRequest,
	type AuthControlResponse,
	parseAuthControlRequest,
} from "./provider-auth-protocol.js";
import { AUTH_CONTROL_DIR, MAX_PROMPT_ANSWER_BYTES } from "./provider-matrix.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_REQUEST_BYTES = MAX_PROMPT_ANSWER_BYTES + 1024;

export type AuthControlServer = {
	socketPath: string;
	close: () => Promise<void>;
};

function boundedError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return (message.trim() || "Control request failed").slice(0, 500);
}

export function authSocketPathForAttempt(attemptId: string): string {
	const digest = createHash("sha256")
		.update(attemptId)
		.digest("hex")
		.slice(0, 32);
	return `${AUTH_CONTROL_DIR}/ditto-auth-${digest}.sock`;
}

async function unlinkSocket(socketPath: string): Promise<void> {
	try {
		await fs.unlink(socketPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

export async function startAuthControlServer(options: {
	attemptId: string;
	handle: (request: AuthControlRequest) => Promise<AuthControlResponse>;
	socketPath?: string;
}): Promise<AuthControlServer> {
	await fs.mkdir(AUTH_CONTROL_DIR, { recursive: true, mode: 0o700 });
	const socketPath =
		options.socketPath ?? authSocketPathForAttempt(options.attemptId);
	await unlinkSocket(socketPath);
	let queue = Promise.resolve();
	const sockets = new Set<net.Socket>();

	const server = net.createServer((socket) => {
		sockets.add(socket);
		socket.setTimeout(DEFAULT_TIMEOUT_MS);
		let bytes = 0;
		let input = "";
		let handled = false;

		const respond = (response: AuthControlResponse) => {
			if (handled) return;
			handled = true;
			socket.end(`${JSON.stringify(response)}\n`);
		};

		socket.on("data", (chunk: Buffer) => {
			if (handled) return;
			bytes += chunk.byteLength;
			if (bytes > MAX_REQUEST_BYTES) {
				respond({ accepted: false, message: "Control request is too large" });
				return;
			}
			input += chunk.toString("utf8");
			const newline = input.indexOf("\n");
			if (newline === -1) return;
			if (input.slice(newline + 1).trim().length > 0) {
				respond({
					accepted: false,
					message: "Only one control request is allowed",
				});
				return;
			}

			let request: AuthControlRequest;
			try {
				request = parseAuthControlRequest(JSON.parse(input.slice(0, newline)));
			} catch (error) {
				respond({ accepted: false, message: boundedError(error) });
				return;
			}
			if (request.attemptId !== options.attemptId) {
				respond({ accepted: false, message: "Auth attempt is no longer active" });
				return;
			}

			const task = queue.then(async () => {
				try {
					respond(await options.handle(request));
				} catch (error) {
					respond({ accepted: false, message: boundedError(error) });
				}
			});
			queue = task.catch(() => undefined);
		});
		socket.on("timeout", () => {
			respond({ accepted: false, message: "Control request timed out" });
		});
		socket.on("error", () => undefined);
		socket.on("close", () => sockets.delete(socket));
	});

	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(socketPath, () => {
				server.off("error", reject);
				resolve();
			});
		});
	} catch (error) {
		await unlinkSocket(socketPath);
		throw error;
	}

	let closed = false;
	return {
		socketPath,
		close: async () => {
			if (closed) return;
			closed = true;
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
			await queue;
			await unlinkSocket(socketPath);
		},
	};
}

export async function sendAuthControlRequest(
	request: AuthControlRequest,
	options: { socketPath?: string; timeoutMs?: number } = {},
): Promise<AuthControlResponse> {
	const socketPath =
		options.socketPath ?? authSocketPathForAttempt(request.attemptId);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return new Promise<AuthControlResponse>((resolve, reject) => {
		const socket = net.createConnection(socketPath);
		let input = "";
		let bytes = 0;
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			callback();
		};
		socket.setTimeout(timeoutMs);
		socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
		socket.on("data", (chunk: Buffer) => {
			bytes += chunk.byteLength;
			if (bytes > MAX_REQUEST_BYTES) {
				finish(() => reject(new Error("Control response is too large")));
				return;
			}
			input += chunk.toString("utf8");
			const newline = input.indexOf("\n");
			if (newline === -1) return;
			try {
				const response = JSON.parse(input.slice(0, newline)) as AuthControlResponse;
				finish(() => resolve(response));
			} catch (error) {
				finish(() => reject(error));
			}
		});
		socket.on("timeout", () =>
			finish(() => reject(new Error("Control request timed out"))),
		);
		socket.on("error", (error) => finish(() => reject(error)));
		socket.on("end", () => {
			if (!settled)
				finish(() => reject(new Error("Control response was incomplete")));
		});
	});
}
