import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export const PREVIEW_PORT = 10000;

const JSON_MAX_BYTES = 64 * 1024;

export type PreviewResult =
	| { ok: true; command: string; cwd: string; env: Record<string, string> }
	| { ok: true; ready: true }
	| {
			ok: false;
			error:
				| "unsupported_project"
				| "not_ready"
				| "invalid_args"
				| "preview_failed";
	  };

type Framework = "vite" | "next" | "astro";

const MIN_VERSIONS: Partial<Record<Framework, [number, number]>> = {
	vite: [6, 1],
	astro: [5, 4],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringMap(value: unknown): Record<string, string> | null {
	if (!isPlainObject(value)) return null;
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (key.length === 0 || key.length > 256) return null;
		if (typeof entry !== "string" || entry.length > 1024) return null;
		out[key] = entry;
	}
	return out;
}

function parseSemver(raw: string): [number, number, number] | null {
	const match = raw.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/);
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function meetsMinimum(
	version: string,
	[minMajor, minMinor]: [number, number],
): boolean {
	const parsed = parseSemver(version);
	if (!parsed) return false;
	const [major, minor] = parsed;
	if (major !== minMajor) return major > minMajor;
	return minor >= minMinor;
}

function readJson(file: string): unknown {
	try {
		const stat = fs.statSync(file);
		if (!stat.isFile() || stat.size > JSON_MAX_BYTES) return undefined;
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

function exists(file: string): boolean {
	try {
		fs.statSync(file);
		return true;
	} catch {
		return false;
	}
}

const unsupported: PreviewResult = { ok: false, error: "unsupported_project" };

export function discoverPreview(workspace: string): PreviewResult {
	const pkg = readJson(path.join(workspace, "package.json"));
	if (!isPlainObject(pkg)) return unsupported;

	const scripts = asStringMap(pkg.scripts);
	if (!scripts) return unsupported;
	const dependencies = asStringMap(pkg.dependencies) ?? {};
	const devDependencies = asStringMap(pkg.devDependencies) ?? {};

	const devScript = scripts.dev?.trim();
	if (!devScript) return unsupported;
	if (scripts.predev || scripts.postdev) return unsupported;

	let framework: Framework;
	if (devScript === "vite" || devScript === "vite dev") framework = "vite";
	else if (devScript === "next" || devScript === "next dev") framework = "next";
	else if (devScript === "astro" || devScript === "astro dev")
		framework = "astro";
	else return unsupported;

	if (!(framework in dependencies) && !(framework in devDependencies)) {
		return unsupported;
	}

	const min = MIN_VERSIONS[framework];
	if (min) {
		const installed = readJson(
			path.join(workspace, "node_modules", framework, "package.json"),
		);
		if (!isPlainObject(installed) || typeof installed.version !== "string") {
			return unsupported;
		}
		if (!meetsMinimum(installed.version, min)) return unsupported;
	}

	if (!exists(path.join(workspace, "node_modules", ".bin", framework))) {
		return unsupported;
	}

	const port = String(PREVIEW_PORT);
	if (framework === "next") {
		return {
			ok: true,
			command: `./node_modules/.bin/next dev --hostname 0.0.0.0 --port ${port}`,
			cwd: workspace,
			env: { HOST: "0.0.0.0", PORT: port },
		};
	}
	return {
		ok: true,
		command:
			framework === "vite"
				? `./node_modules/.bin/vite --host 0.0.0.0 --port ${port} --strictPort`
				: `./node_modules/.bin/astro dev --host 0.0.0.0 --port ${port} --allowed-hosts=.ayn.wtf`,
		cwd: workspace,
		env: {
			HOST: "0.0.0.0",
			PORT: port,
			__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".ayn.wtf",
		},
	};
}

function tcpConnect(port: number, attemptMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.createConnection({ host: "127.0.0.1", port });
		const finish = (value: boolean) => {
			clearTimeout(timer);
			socket.destroy();
			resolve(value);
		};
		const timer = setTimeout(() => finish(false), Math.max(0, attemptMs));
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

export async function waitForPreview(
	port: number,
	timeoutMs: number,
	connect: (port: number, attemptMs: number) => Promise<boolean> = tcpConnect,
): Promise<PreviewResult> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await connect(port, Math.min(1000, deadline - Date.now()))) {
			return { ok: true, ready: true };
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		await new Promise((resolve) =>
			setTimeout(resolve, Math.min(250, remaining)),
		);
	}
	return { ok: false, error: "not_ready" };
}
