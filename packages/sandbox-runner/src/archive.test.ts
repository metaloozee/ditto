import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type DiskStat,
	main,
	parseArchiveCliArgs,
	runCreate,
	runRestore,
} from "./archive-cli.js";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	vi.restoreAllMocks();
});

function makeWorkspace(): { workspacePath: string; archivePath: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ditto-archive-"));
	tempDirs.push(root);
	const workspacePath = path.join(root, "workspace");
	const archivePath = path.join(root, "ditto-workspace-archive.tar.gz");
	fs.mkdirSync(workspacePath);
	return { workspacePath, archivePath };
}

function writeFile(
	workspacePath: string,
	relativePath: string,
	body: string,
): void {
	const absolute = path.join(workspacePath, relativePath);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, body);
}

function plentyOfDisk(): DiskStat {
	return {
		totalBytes: 10 * 1024 * 1024 * 1024,
		usedBytes: 1024 * 1024,
		availableBytes: 9 * 1024 * 1024 * 1024,
	};
}

const generousLimits = {
	maxCompressedBytes: 1024 * 1024,
	maxExtractedBytes: 1024 * 1024,
	maxDiskPercent: 100,
};

describe("archive-cli argv", () => {
	it("rejects path overrides and traversal", async () => {
		const { writes, spy } = captureStdout();
		expect(await main(["create", "/tmp/evil.tar.gz"])).toBe(2);
		expect(await main(["create", "--output", "out.tar.gz"])).toBe(2);
		expect(await main(["create", "-C", "/workspace"])).toBe(2);
		expect(await main(["restore", "../escape"])).toBe(2);
		spy.mockRestore();
		expect(writes.some((line) => line.includes("path_override"))).toBe(true);
	});

	it("rejects unknown flags that look like tar overrides", () => {
		expect(
			parseArchiveCliArgs(["create", "--directory", "/tmp"]).error?.error,
		).toBe("path_override");
		expect(parseArchiveCliArgs(["create", "--file", "x"]).error?.error).toBe(
			"path_override",
		);
	});

	it("accepts numeric limits only", () => {
		const parsed = parseArchiveCliArgs([
			"create",
			"--max-compressed-bytes",
			"100",
			"--max-extracted-bytes",
			"200",
			"--max-disk-percent",
			"70",
		]);
		expect(parsed.error).toBeUndefined();
		expect(parsed.limits).toEqual({
			maxCompressedBytes: 100,
			maxExtractedBytes: 200,
			maxDiskPercent: 70,
		});
	});
});

describe("archive-cli create/restore", () => {
	it("includes .env and excludes node_modules and the temp archive file", () => {
		const { workspacePath, archivePath } = makeWorkspace();
		writeFile(workspacePath, ".env", "SECRET=1\n");
		writeFile(workspacePath, "README.md", "hello\n");
		writeFile(workspacePath, "node_modules/pkg/index.js", "nope\n");
		writeFile(workspacePath, "dist/out.js", "built\n");
		fs.writeFileSync(archivePath, "not-an-archive");

		const created = runCreate({
			paths: { workspacePath, archivePath },
			limits: generousLimits,
			diskStat: plentyOfDisk,
		});
		expect(created.ok).toBe(true);
		if (!created.ok) {
			return;
		}

		const listing = execFileSync("tar", ["-tzf", archivePath], {
			encoding: "utf8",
		});
		expect(listing).toContain(".env");
		expect(listing).toContain("README.md");
		expect(listing).not.toContain("node_modules");
		expect(listing).not.toContain("dist/");
		expect(listing).not.toContain("ditto-workspace-archive.tar.gz");

		const restoreRoot = path.join(path.dirname(workspacePath), "restored");
		fs.mkdirSync(restoreRoot);
		const restored = runRestore({
			paths: { workspacePath: restoreRoot, archivePath },
			limits: generousLimits,
			diskStat: plentyOfDisk,
		});
		expect(restored.ok).toBe(true);
		expect(fs.readFileSync(path.join(restoreRoot, ".env"), "utf8")).toBe(
			"SECRET=1\n",
		);
		expect(fs.existsSync(path.join(restoreRoot, "node_modules"))).toBe(false);
		expect(fs.existsSync(archivePath)).toBe(false);
	});

	it("rejects escaping symlinks", () => {
		const { workspacePath, archivePath } = makeWorkspace();
		fs.symlinkSync("/etc/passwd", path.join(workspacePath, "escape"));

		const created = runCreate({
			paths: { workspacePath, archivePath },
			limits: generousLimits,
			diskStat: plentyOfDisk,
		});
		expect(created).toMatchObject({ ok: false, error: "symlink_escape" });
		expect(fs.existsSync(archivePath)).toBe(false);
	});

	it("rejects sockets and device files", async () => {
		const { workspacePath, archivePath } = makeWorkspace();
		const socketPath = path.join(workspacePath, "app.sock");
		const server = net.createServer();
		await new Promise<void>((resolve, reject) => {
			server.on("error", reject);
			server.listen(socketPath, resolve);
		});
		try {
			const created = runCreate({
				paths: { workspacePath, archivePath },
				limits: generousLimits,
				diskStat: plentyOfDisk,
			});
			expect(created).toMatchObject({ ok: false, error: "special_file" });
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("does not recurse the temp archive into itself", () => {
		const { workspacePath } = makeWorkspace();
		writeFile(workspacePath, "README.md", "ok\n");
		const archivePath = path.join(
			workspacePath,
			"ditto-workspace-archive.tar.gz",
		);

		const created = runCreate({
			paths: { workspacePath, archivePath },
			limits: generousLimits,
			diskStat: plentyOfDisk,
		});
		expect(created.ok).toBe(true);
		if (!created.ok) {
			return;
		}
		const listing = execFileSync("tar", ["-tzf", archivePath], {
			encoding: "utf8",
		});
		expect(listing).not.toContain("ditto-workspace-archive.tar.gz");
	});

	it("fails closed on extracted, compressed, and peak-disk limits", () => {
		const { workspacePath, archivePath } = makeWorkspace();
		writeFile(workspacePath, "big.txt", "abcdefghij");

		expect(
			runCreate({
				paths: { workspacePath, archivePath },
				limits: { ...generousLimits, maxExtractedBytes: 4 },
				diskStat: plentyOfDisk,
			}),
		).toMatchObject({ ok: false, error: "limit_extracted" });
		expect(fs.existsSync(archivePath)).toBe(false);

		expect(
			runCreate({
				paths: { workspacePath, archivePath },
				limits: { ...generousLimits, maxCompressedBytes: 1 },
				diskStat: plentyOfDisk,
			}),
		).toMatchObject({ ok: false, error: "limit_compressed" });
		expect(fs.existsSync(archivePath)).toBe(false);

		expect(
			runCreate({
				paths: { workspacePath, archivePath },
				limits: { ...generousLimits, maxDiskPercent: 70 },
				diskStat: () => ({
					totalBytes: 1000,
					usedBytes: 900,
					availableBytes: 100,
				}),
			}),
		).toMatchObject({ ok: false, error: "limit_disk" });

		const created = runCreate({
			paths: { workspacePath, archivePath },
			limits: generousLimits,
			diskStat: plentyOfDisk,
		});
		expect(created.ok).toBe(true);
		expect(
			runRestore({
				paths: { workspacePath, archivePath },
				limits: { ...generousLimits, maxExtractedBytes: 4 },
				diskStat: plentyOfDisk,
			}),
		).toMatchObject({ ok: false, error: "limit_extracted" });
	});
});

function captureStdout() {
	const writes: string[] = [];
	const spy = vi.spyOn(process.stdout, "write").mockImplementation(((
		chunk: string,
	) => {
		writes.push(String(chunk));
		return true;
	}) as typeof process.stdout.write);
	return { writes, spy };
}
