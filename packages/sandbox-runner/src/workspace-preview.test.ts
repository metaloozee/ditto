import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPreview } from "./workspace-cli.js";
import { discoverPreview, waitForPreview } from "./workspace-preview.js";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function project(options: {
	pkg?: unknown;
	rawPackage?: string;
	installed?: { name: string; version: string };
	bin?: string;
}): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ditto-preview-"));
	dirs.push(dir);
	if (options.rawPackage !== undefined) {
		fs.writeFileSync(path.join(dir, "package.json"), options.rawPackage);
	} else if (options.pkg !== undefined) {
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify(options.pkg),
		);
	}
	if (options.installed) {
		const modDir = path.join(dir, "node_modules", options.installed.name);
		fs.mkdirSync(modDir, { recursive: true });
		fs.writeFileSync(
			path.join(modDir, "package.json"),
			JSON.stringify({ version: options.installed.version }),
		);
	}
	if (options.bin) {
		const binDir = path.join(dir, "node_modules", ".bin");
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(path.join(binDir, options.bin), "");
	}
	return dir;
}

function viteProject(
	overrides: { pkg?: Record<string, unknown>; version?: string } = {},
) {
	return project({
		pkg: {
			scripts: { dev: "vite" },
			devDependencies: { vite: "^6.1.0" },
			...overrides.pkg,
		},
		installed: { name: "vite", version: overrides.version ?? "6.1.0" },
		bin: "vite",
	});
}

const ALLOWED = { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".ayn.wtf" };
const unsupported = { ok: false, error: "unsupported_project" };

describe("discoverPreview", () => {
	it("returns the vite command for Vite 6.1.0", () => {
		const dir = viteProject();
		expect(discoverPreview(dir)).toEqual({
			ok: true,
			command:
				"./node_modules/.bin/vite --host 0.0.0.0 --port 10000 --strictPort",
			cwd: dir,
			env: { HOST: "0.0.0.0", PORT: "10000", ...ALLOWED },
		});
	});

	it("rejects Vite 6.0.9", () => {
		expect(discoverPreview(viteProject({ version: "6.0.9" }))).toEqual(
			unsupported,
		);
	});

	it("rejects a Vite prerelease", () => {
		expect(discoverPreview(viteProject({ version: "6.2.0-beta.1" }))).toEqual(
			unsupported,
		);
	});

	it("returns the next command without a version check", () => {
		const dir = project({
			pkg: { scripts: { dev: "next dev" }, dependencies: { next: "15" } },
			bin: "next",
		});
		expect(discoverPreview(dir)).toEqual({
			ok: true,
			command: "./node_modules/.bin/next dev --hostname 0.0.0.0 --port 10000",
			cwd: dir,
			env: { HOST: "0.0.0.0", PORT: "10000" },
		});
	});

	it("enforces the Astro minimum of 5.4", () => {
		const make = (version: string) =>
			project({
				pkg: { scripts: { dev: "astro dev" }, dependencies: { astro: "5" } },
				installed: { name: "astro", version },
				bin: "astro",
			});
		const ok = make("5.4.0");
		expect(discoverPreview(ok)).toEqual({
			ok: true,
			command:
				"./node_modules/.bin/astro dev --host 0.0.0.0 --port 10000 --allowed-hosts=.ayn.wtf",
			cwd: ok,
			env: { HOST: "0.0.0.0", PORT: "10000", ...ALLOWED },
		});
		expect(discoverPreview(make("5.3.0"))).toEqual(unsupported);
	});

	it("rejects unsupported projects", () => {
		const base = { scripts: { dev: "vite" }, devDependencies: { vite: "6" } };
		const cases: string[] = [
			viteProject({ pkg: { scripts: { dev: "vite", predev: "echo" } } }),
			viteProject({ pkg: { scripts: { dev: "vite --open" } } }),
			viteProject({ pkg: { devDependencies: {} } }),
			project({ pkg: base, installed: { name: "vite", version: "6.1.0" } }),
			project({
				rawPackage: JSON.stringify({ ...base, pad: "x".repeat(70 * 1024) }),
				installed: { name: "vite", version: "6.1.0" },
				bin: "vite",
			}),
			project({
				rawPackage: "{nope",
				installed: { name: "vite", version: "6.1.0" },
				bin: "vite",
			}),
		];
		const dirDir = project({});
		fs.mkdirSync(path.join(dirDir, "package.json"));
		cases.push(dirDir);
		for (const dir of cases) {
			expect(discoverPreview(dir)).toEqual(unsupported);
		}
	});

	it("handles padded scripts, empty predev, missing next package.json and bad dependencies", () => {
		expect(
			discoverPreview(viteProject({ pkg: { scripts: { dev: "  vite  " } } }))
				.ok,
		).toBe(true);
		expect(
			discoverPreview(
				viteProject({ pkg: { scripts: { dev: "vite", predev: "" } } }),
			).ok,
		).toBe(true);
		expect(
			discoverPreview(
				project({
					pkg: { scripts: { dev: "next" }, dependencies: { next: "15" } },
					bin: "next",
				}),
			).ok,
		).toBe(true);
		expect(
			discoverPreview(
				viteProject({
					pkg: { dependencies: ["vite"], devDependencies: { vite: "6" } },
				}),
			).ok,
		).toBe(true);
	});
});

describe("runPreview", () => {
	it.each([
		[["ready", "--timeout-ms", "0"]],
		[["ready", "--timeout-ms", "abc"]],
		[["ready", "--timeout-ms", "1e3"]],
		[["ready", "--timeout-ms", "0x10"]],
		[["ready", "--timeout-ms", " 5"]],
		[["ready", "--timeout-ms", "120001"]],
		[["start"]],
		[[]],
		[["command", "extra"]],
	])("rejects %j", async (argv) => {
		expect(await runPreview(argv)).toEqual({
			ok: false,
			error: "invalid_args",
		});
	});
});

describe("waitForPreview", () => {
	it("returns ready once connect succeeds", async () => {
		let calls = 0;
		const result = await waitForPreview(10000, 5000, async () => ++calls > 2);
		expect(result).toEqual({ ok: true, ready: true });
		expect(calls).toBe(3);
	});

	it("times out without overrunning the deadline", async () => {
		const attempts: number[] = [];
		const started = Date.now();
		const result = await waitForPreview(10000, 300, async (_port, ms) => {
			attempts.push(ms);
			return false;
		});
		expect(result).toEqual({ ok: false, error: "not_ready" });
		expect(Date.now() - started).toBeLessThan(800);
		expect(attempts.length).toBeGreaterThan(0);
		for (const ms of attempts) expect(ms).toBeLessThanOrEqual(300);
	});

	it("is ready against a real listening socket", async () => {
		const server = net.createServer();
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		try {
			const { port } = server.address() as net.AddressInfo;
			expect(await waitForPreview(port, 2000)).toEqual({
				ok: true,
				ready: true,
			});
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});
});
