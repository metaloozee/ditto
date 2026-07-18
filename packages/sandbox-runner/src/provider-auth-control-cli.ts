#!/usr/bin/env node
import fs from "node:fs";
import {
	type AuthControlRequest,
	parseAuthControlRequest,
} from "./provider-auth-protocol.js";
import { sendAuthControlRequest } from "./provider-auth-control.js";

const MAX_OUTPUT = 64 * 1024;

function writeJson(value: unknown): void {
	const text = `${JSON.stringify(value)}\n`;
	process.stdout.write(text.slice(0, MAX_OUTPUT));
}

function parseArgs(argv: string[]): {
	requestPath?: string;
	socketPath?: string;
	error?: string;
} {
	const reqIndex = argv.indexOf("--request");
	if (reqIndex === -1) return { error: "--request is required" };
	const requestPath = argv[reqIndex + 1];
	if (!requestPath) return { error: "--request requires a path" };

	const sockIndex = argv.indexOf("--socket");
	const socketPath = sockIndex === -1 ? undefined : argv[sockIndex + 1];
	if (sockIndex !== -1 && !socketPath) {
		return { error: "--socket requires a path" };
	}
	return { requestPath, socketPath };
}

async function main(): Promise<number> {
	const { requestPath, socketPath, error } = parseArgs(process.argv.slice(2));
	if (error || !requestPath) {
		writeJson({ accepted: false, message: error ?? "Invalid arguments" });
		return 2;
	}

	// Verify mode 0600 before reading.
	let stat: fs.Stats;
	try {
		stat = fs.statSync(requestPath);
	} catch {
		writeJson({ accepted: false, message: "Unable to read control request" });
		return 2;
	}
	const mode = stat.mode & 0o777;
	if (mode !== 0o600) {
		writeJson({ accepted: false, message: "Control request has unsafe mode" });
		try {
			fs.unlinkSync(requestPath);
		} catch {
			// ignore
		}
		return 2;
	}

	let raw: string;
	try {
		raw = fs.readFileSync(requestPath, "utf8");
	} finally {
		try {
			fs.unlinkSync(requestPath);
		} catch {
			// ignore
		}
	}

	let request: AuthControlRequest;
	try {
		request = parseAuthControlRequest(JSON.parse(raw));
	} catch (err) {
		const message = err instanceof Error ? err.message : "Invalid request";
		writeJson({ accepted: false, message: message.slice(0, 500) });
		return 2;
	}

	try {
		const response = await sendAuthControlRequest(request, { socketPath });
		writeJson(response);
		return response.accepted ? 0 : 1;
	} catch (err) {
		const message = err instanceof Error ? err.message : "Control failed";
		writeJson({ accepted: false, message: message.slice(0, 500) });
		return 1;
	}
}

main()
	.then((code) => process.exit(code))
	.catch(() => {
		writeJson({ accepted: false, message: "Control failed" });
		process.exit(1);
	});
