import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
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

	it("measures real disk usage before the archive file exists", () => {
		const { workspacePath, archivePath } = makeWorkspace();
		writeFile(workspacePath, "a.txt", "a");
		expect(
			runCreate({
				paths: { workspacePath, archivePath },
				limits: { ...generousLimits, maxDiskPercent: 100 },
			}),
		).toMatchObject({ ok: true });
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

/** Minimal ustar writer so tests can build members GNU tar would sanitize. */
function tarMember(
	name: string,
	type: "0" | "1" | "2" | "3" | "5",
	body = "",
	linkName = "",
): Buffer {
	const header = Buffer.alloc(512);
	const field = (value: string, offset: number, length: number) =>
		header.write(value, offset, length, "utf8");
	const octal = (value: number, offset: number, length: number) =>
		field(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length);
	field(name, 0, 100);
	octal(type === "5" ? 0o755 : 0o644, 100, 8);
	octal(0, 108, 8);
	octal(0, 116, 8);
	octal(Buffer.byteLength(body), 124, 12);
	octal(1_700_000_000, 136, 12);
	field("        ", 148, 8);
	field(type, 156, 1);
	field(linkName, 157, 100);
	field("ustar\0", 257, 6);
	field("00", 263, 2);
	let sum = 0;
	for (const byte of header) sum += byte;
	field(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
	const data = Buffer.alloc(Math.ceil(Buffer.byteLength(body) / 512) * 512);
	data.write(body);
	return Buffer.concat([header, data]);
}

function writeTarGz(archivePath: string, members: Buffer[]): void {
	const tar = Buffer.concat([...members, Buffer.alloc(1024)]);
	fs.writeFileSync(archivePath, gzipSync(tar));
}

describe("archive-cli restore of hostile archives", () => {
	const restore = (
		paths: { workspacePath: string; archivePath: string },
		expectedDigest?: string,
	) =>
		runRestore({
			paths,
			limits: generousLimits,
			expectedDigest,
			diskStat: plentyOfDisk,
		});

	it.each([
		["parent traversal", [tarMember("../escape.txt", "0", "x")], "unsafe_path"],
		["absolute path", [tarMember("/tmp/escape.txt", "0", "x")], "unsafe_path"],
		[
			"escaping symlink",
			[tarMember("link", "2", "", "/etc")],
			"symlink_escape",
		],
		[
			"relative escaping symlink",
			[tarMember("dir/link", "2", "", "../../outside")],
			"symlink_escape",
		],
		// GNU tar lists these sanitized or in another shape; any rejection is enough.
		["absolute hard link", [tarMember("hard", "1", "", "/etc/passwd")], null],
		["traversing hard link", [tarMember("hard", "1", "", "../outside")], null],
		["device file", [tarMember("dev", "3")], null],
	])("rejects %s before extraction", (_label, members, error) => {
		const paths = makeWorkspace();
		writeTarGz(paths.archivePath, members);
		expect(restore(paths)).toMatchObject(
			error ? { ok: false, error } : { ok: false },
		);
		expect(fs.readdirSync(paths.workspacePath)).toEqual([]);
		expect(fs.existsSync(paths.archivePath)).toBe(false);
		expect(
			fs.existsSync(path.join(path.dirname(paths.workspacePath), "outside")),
		).toBe(false);
	});

	it("rejects a symlink whose name hides an absolute target in the listing", () => {
		const paths = makeWorkspace();
		writeTarGz(paths.archivePath, [tarMember("evil", "2", "", "/etc -> safe")]);
		expect(restore(paths)).toMatchObject({ ok: false, error: "unsafe_path" });
		expect(fs.readdirSync(paths.workspacePath)).toEqual([]);
	});

	it("rejects a digest mismatch before touching the workspace", () => {
		const paths = makeWorkspace();
		writeTarGz(paths.archivePath, [tarMember("ok.txt", "0", "fine")]);
		expect(restore(paths, "0".repeat(64))).toMatchObject({
			ok: false,
			error: "digest_mismatch",
		});
		expect(fs.readdirSync(paths.workspacePath)).toEqual([]);
	});

	it("rejects truncated and non-gzip archives", () => {
		const paths = makeWorkspace();
		writeTarGz(paths.archivePath, [tarMember("ok.txt", "0", "fine")]);
		const bytes = fs.readFileSync(paths.archivePath);
		fs.writeFileSync(paths.archivePath, bytes.subarray(0, bytes.length - 12));
		expect(restore(paths)).toMatchObject({ ok: false });
		fs.writeFileSync(paths.archivePath, "not an archive");
		expect(restore(paths)).toMatchObject({ ok: false });
	});

	it("restores a captured workspace with Git state, links and its digest", () => {
		const source = makeWorkspace();
		writeFile(source.workspacePath, "src/a.ts", "export const a = 1;\n");
		execFileSync("git", ["init", "-q", "-b", "main"], {
			cwd: source.workspacePath,
		});
		execFileSync(
			"git",
			["-c", "user.email=t@example.com", "-c", "user.name=t", "add", "."],
			{ cwd: source.workspacePath },
		);
		execFileSync(
			"git",
			[
				"-c",
				"user.email=t@example.com",
				"-c",
				"user.name=t",
				"commit",
				"-qm",
				"seed",
			],
			{ cwd: source.workspacePath },
		);
		fs.symlinkSync("src/a.ts", path.join(source.workspacePath, "alias.ts"));
		fs.linkSync(
			path.join(source.workspacePath, "src/a.ts"),
			path.join(source.workspacePath, "hard.ts"),
		);
		const head = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: source.workspacePath,
			encoding: "utf8",
		}).trim();
		const created = runCreate({
			paths: source,
			limits: generousLimits,
			diskStat: plentyOfDisk,
		});
		if (!created.ok) throw new Error(created.message);

		const target = makeWorkspace();
		fs.copyFileSync(source.archivePath, target.archivePath);
		const restored = restore(target, created.digest);
		expect(restored).toMatchObject({
			ok: true,
			digest: created.digest,
			compressedBytes: created.compressedBytes,
		});
		expect(
			execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: target.workspacePath,
				encoding: "utf8",
			}).trim(),
		).toBe(head);
		expect(
			execFileSync("git", ["status", "--porcelain"], {
				cwd: target.workspacePath,
				encoding: "utf8",
			}),
		).toBe("?? alias.ts\n?? hard.ts\n");
		expect(fs.readlinkSync(path.join(target.workspacePath, "alias.ts"))).toBe(
			"src/a.ts",
		);
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
