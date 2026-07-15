import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";

const MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_ERROR_LENGTH = 500;

export type FollowUpControlRequest = {
	action: "follow_up";
	requestId: string;
	runId: string;
	sessionId: string;
	model: string;
	text: string;
	userMessageId: string;
	assistantMessageId: string;
};

export type StopControlRequest = {
	action: "stop";
	requestId: string;
	runId: string;
	sessionId: string;
};

export type ControlRequest = FollowUpControlRequest | StopControlRequest;

export type FollowUpControlResponse = {
	accepted: true;
	action: "follow_up";
	requestId: string;
	runId: string;
	sessionId: string;
	userMessageId: string;
	assistantMessageId: string;
};

export type StopControlResponse = {
	accepted: true;
	action: "stop";
	requestId: string;
	runId: string;
	sessionId: string;
	removedFollowUps: string[];
};

export type RejectedControlResponse = {
	accepted: false;
	requestId?: string;
	message: string;
};

export type ControlResponse =
	| FollowUpControlResponse
	| StopControlResponse
	| RejectedControlResponse;

export type ControlServer = {
	socketPath: string;
	close: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function isBoundedString(value: unknown, max: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function boundedControlError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.trim() || "Control request failed";
	return normalized.slice(0, MAX_ERROR_LENGTH);
}

export function socketPathForRun(runId: string): string {
	const digest = createHash("sha256").update(runId).digest("hex").slice(0, 32);
	return `/tmp/ditto-agent-${digest}.sock`;
}

export function parseControlRequest(value: unknown): ControlRequest {
	if (!isRecord(value)) throw new Error("Control request must be an object");

	if (value.action === "follow_up") {
		const keys = [
			"action",
			"requestId",
			"runId",
			"sessionId",
			"model",
			"text",
			"userMessageId",
			"assistantMessageId",
		] as const;
		if (!hasExactKeys(value, keys)) {
			throw new Error("Invalid follow-up control fields");
		}
		if (
			!isBoundedString(value.requestId, 128) ||
			!isBoundedString(value.runId, 128) ||
			!isBoundedString(value.sessionId, 128) ||
			!isBoundedString(value.model, 256) ||
			!isBoundedString(value.text, 32_000) ||
			!value.text.trim() ||
			!isBoundedString(value.userMessageId, 128) ||
			!isBoundedString(value.assistantMessageId, 128)
		) {
			throw new Error("Invalid follow-up control request");
		}
		return value as FollowUpControlRequest;
	}

	if (value.action === "stop") {
		const keys = ["action", "requestId", "runId", "sessionId"] as const;
		if (!hasExactKeys(value, keys)) {
			throw new Error("Invalid stop control fields");
		}
		if (
			!isBoundedString(value.requestId, 128) ||
			!isBoundedString(value.runId, 128) ||
			!isBoundedString(value.sessionId, 128)
		) {
			throw new Error("Invalid stop control request");
		}
		return value as StopControlRequest;
	}

	throw new Error("Unknown control action");
}

export function parseControlResponse(value: unknown): ControlResponse {
	if (!isRecord(value) || typeof value.accepted !== "boolean") {
		throw new Error("Invalid control response");
	}
	if (!value.accepted) {
		if (
			!hasExactKeys(
				value,
				value.requestId === undefined
					? ["accepted", "message"]
					: ["accepted", "requestId", "message"],
			) ||
			(value.requestId !== undefined &&
				!isBoundedString(value.requestId, 128)) ||
			!isBoundedString(value.message, MAX_ERROR_LENGTH)
		) {
			throw new Error("Invalid rejected control response");
		}
		return value as RejectedControlResponse;
	}
	if (value.action === "follow_up") {
		if (
			!hasExactKeys(value, [
				"accepted",
				"action",
				"requestId",
				"runId",
				"sessionId",
				"userMessageId",
				"assistantMessageId",
			]) ||
			!isBoundedString(value.requestId, 128) ||
			!isBoundedString(value.runId, 128) ||
			!isBoundedString(value.sessionId, 128) ||
			!isBoundedString(value.userMessageId, 128) ||
			!isBoundedString(value.assistantMessageId, 128)
		) {
			throw new Error("Invalid follow-up control response");
		}
		return value as FollowUpControlResponse;
	}
	if (value.action === "stop") {
		if (
			!hasExactKeys(value, [
				"accepted",
				"action",
				"requestId",
				"runId",
				"sessionId",
				"removedFollowUps",
			]) ||
			!isBoundedString(value.requestId, 128) ||
			!isBoundedString(value.runId, 128) ||
			!isBoundedString(value.sessionId, 128) ||
			!Array.isArray(value.removedFollowUps) ||
			!value.removedFollowUps.every((item) => typeof item === "string")
		) {
			throw new Error("Invalid stop control response");
		}
		return value as StopControlResponse;
	}
	throw new Error("Unknown control response action");
}

async function unlinkSocket(socketPath: string): Promise<void> {
	try {
		await fs.unlink(socketPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

export async function startControlServer(options: {
	runId: string;
	sessionId: string;
	handle: (request: ControlRequest) => Promise<ControlResponse>;
	socketPath?: string;
}): Promise<ControlServer> {
	const socketPath = options.socketPath ?? socketPathForRun(options.runId);
	await unlinkSocket(socketPath);
	let queue = Promise.resolve();
	const sockets = new Set<net.Socket>();

	const server = net.createServer((socket) => {
		sockets.add(socket);
		socket.setTimeout(DEFAULT_TIMEOUT_MS);
		let bytes = 0;
		let input = "";
		let handled = false;

		const respond = (response: ControlResponse) => {
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
			const rawLine = input.slice(0, newline);
			if (input.slice(newline + 1).trim().length > 0) {
				respond({
					accepted: false,
					message: "Only one control request is allowed",
				});
				return;
			}

			let request: ControlRequest;
			try {
				request = parseControlRequest(JSON.parse(rawLine));
			} catch (error) {
				respond({ accepted: false, message: boundedControlError(error) });
				return;
			}
			if (
				request.runId !== options.runId ||
				request.sessionId !== options.sessionId
			) {
				respond({
					accepted: false,
					requestId: request.requestId,
					message: "Control target is no longer active",
				});
				return;
			}

			const task = queue.then(async () => {
				try {
					respond(parseControlResponse(await options.handle(request)));
				} catch (error) {
					respond({
						accepted: false,
						requestId: request.requestId,
						message: boundedControlError(error),
					});
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

export async function sendControlRequest(
	request: ControlRequest,
	options: { socketPath?: string; timeoutMs?: number } = {},
): Promise<ControlResponse> {
	const socketPath = options.socketPath ?? socketPathForRun(request.runId);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return new Promise<ControlResponse>((resolve, reject) => {
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
				const response = parseControlResponse(
					JSON.parse(input.slice(0, newline)),
				);
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
