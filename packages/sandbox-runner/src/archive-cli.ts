#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXED_WORKSPACE_PATH = "/workspace";
export const FIXED_ARCHIVE_PATH = "/tmp/ditto-workspace-archive.tar.gz";

export const DEFAULT_MAX_COMPRESSED_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_MAX_EXTRACTED_BYTES = 3 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_DISK_PERCENT = 70;

const EXCLUDED_DIR_NAMES = new Set([
	"node_modules",
	".pnpm-store",
	".cache",
	".turbo",
	".next",
	"dist",
	"build",
]);

export type ArchiveCliAction = "create" | "restore";

export type ArchiveCliLimits = {
	maxCompressedBytes: number;
	maxExtractedBytes: number;
	maxDiskPercent: number;
};

export type DiskStat = {
	totalBytes: number;
	usedBytes: number;
	availableBytes: number;
};

export type ArchiveCliSuccess = {
	ok: true;
	action: ArchiveCliAction;
	compressedBytes: number;
	extractedBytes: number;
	digest: string;
};

export type ArchiveCliFailure = {
	ok: false;
	error:
		| "invalid_args"
		| "path_override"
		| "limit_compressed"
		| "limit_extracted"
		| "limit_disk"
		| "unsafe_path"
		| "symlink_escape"
		| "special_file"
		| "archive_missing"
		| "archive_failed";
	message: string;
};

export type ArchiveCliResult = ArchiveCliSuccess | ArchiveCliFailure;

export type ArchiveCliPaths = {
	workspacePath: string;
	archivePath: string;
};

const KNOWN_FLAGS = new Set([
	"--max-compressed-bytes",
	"--max-extracted-bytes",
	"--max-disk-percent",
]);

function looksLikePath(value: string): boolean {
	return (
		value.includes("/") ||
		value.includes("\\") ||
		value === "." ||
		value === ".." ||
		value.includes("..")
	);
}

export function parseArchiveCliArgs(argv: string[]): {
	action?: ArchiveCliAction;
	limits: ArchiveCliLimits;
	error?: ArchiveCliFailure;
} {
	const limits: ArchiveCliLimits = {
		maxCompressedBytes: DEFAULT_MAX_COMPRESSED_BYTES,
		maxExtractedBytes: DEFAULT_MAX_EXTRACTED_BYTES,
		maxDiskPercent: DEFAULT_MAX_DISK_PERCENT,
	};

	if (argv.length === 0) {
		return {
			limits,
			error: fail("invalid_args", "Usage: archive-cli create|restore"),
		};
	}

	const action = argv[0];
	if (action !== "create" && action !== "restore") {
		if (looksLikePath(action)) {
			return {
				limits,
				error: fail("path_override", "Archive paths are not configurable."),
			};
		}
		return {
			limits,
			error: fail("invalid_args", "Usage: archive-cli create|restore"),
		};
	}

	for (let index = 1; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token) {
			return {
				limits,
				error: fail("invalid_args", "Missing argument."),
			};
		}
		if (looksLikePath(token) || token === "-C" || token === "--directory") {
			return {
				limits,
				error: fail("path_override", "Archive paths are not configurable."),
			};
		}
		if (token.startsWith("-") && !KNOWN_FLAGS.has(token)) {
			return {
				limits,
				error: fail("path_override", "Archive paths are not configurable."),
			};
		}
		if (!KNOWN_FLAGS.has(token)) {
			return {
				limits,
				error: fail("invalid_args", "Unexpected archive argument."),
			};
		}
		const rawValue = argv[index + 1];
		if (!rawValue) {
			return {
				limits,
				error: fail("invalid_args", `${token} requires an integer.`),
			};
		}
		if (looksLikePath(rawValue)) {
			return {
				limits,
				error: fail("path_override", "Archive paths are not configurable."),
			};
		}
		if (!/^[0-9]+$/.test(rawValue)) {
			return {
				limits,
				error: fail("invalid_args", `${token} requires an integer.`),
			};
		}
		const value = Number.parseInt(rawValue, 10);
		if (!Number.isSafeInteger(value) || value < 0) {
			return {
				limits,
				error: fail("invalid_args", `${token} requires an integer.`),
			};
		}
		if (token === "--max-compressed-bytes") {
			limits.maxCompressedBytes = value;
		} else if (token === "--max-extracted-bytes") {
			limits.maxExtractedBytes = value;
		} else {
			if (value > 100) {
				return {
					limits,
					error: fail("invalid_args", "--max-disk-percent must be 0-100."),
				};
			}
			limits.maxDiskPercent = value;
		}
		index += 1;
	}

	return { action, limits };
}

function fail(
	error: ArchiveCliFailure["error"],
	message: string,
): ArchiveCliFailure {
	return { ok: false, error, message };
}

function posixJoin(...parts: string[]): string {
	return parts.filter((part) => part.length > 0).join("/");
}

function isExcludedRelative(relativePath: string): boolean {
	if (relativePath === "") {
		return false;
	}
	const parts = relativePath.split("/");
	for (const part of parts) {
		if (EXCLUDED_DIR_NAMES.has(part)) {
			return true;
		}
	}
	if (parts[0] === ".yarn" && parts[1] === "cache") {
		return true;
	}
	if (parts[0] === ".npm") {
		return true;
	}
	return false;
}

function assertInsideRoot(
	root: string,
	candidate: string,
	label: string,
): void {
	const resolvedRoot = path.resolve(root);
	const resolvedCandidate = path.resolve(candidate);
	if (
		resolvedCandidate !== resolvedRoot &&
		!resolvedCandidate.startsWith(resolvedRoot + path.sep)
	) {
		throw fail("unsafe_path", `${label} escapes the workspace.`);
	}
	const relative = path.relative(resolvedRoot, resolvedCandidate);
	if (relative.split(path.sep).includes("..")) {
		throw fail("unsafe_path", `${label} escapes the workspace.`);
	}
}

function readLinkTarget(linkPath: string, workspacePath: string): string {
	const target = fs.readlinkSync(linkPath);
	if (
		target.startsWith("/") &&
		!target.startsWith(path.resolve(workspacePath))
	) {
		throw fail("symlink_escape", "Symlink escapes the workspace.");
	}
	const resolved = path.resolve(path.dirname(linkPath), target);
	assertInsideRoot(workspacePath, resolved, "Symlink");
	return resolved;
}

export function readDiskStat(targetPath: string): DiskStat {
	const output = execFileSync("df", ["-kP", targetPath], {
		encoding: "utf8",
		timeout: 10_000,
	});
	const lines = output.trim().split("\n");
	const dataLine = lines.at(-1);
	if (!dataLine) {
		throw fail("limit_disk", "Unable to measure disk usage.");
	}
	const columns = dataLine.trim().split(/\s+/);
	const totalKb = Number(columns[1]);
	const usedKb = Number(columns[2]);
	const availableKb = Number(columns[3]);
	if (
		!Number.isFinite(totalKb) ||
		!Number.isFinite(usedKb) ||
		!Number.isFinite(availableKb) ||
		totalKb <= 0
	) {
		throw fail("limit_disk", "Unable to measure disk usage.");
	}
	return {
		totalBytes: totalKb * 1024,
		usedBytes: usedKb * 1024,
		availableBytes: availableKb * 1024,
	};
}

function assertDiskLimit(
	disk: DiskStat,
	additionalBytes: number,
	limits: ArchiveCliLimits,
): void {
	if (additionalBytes > disk.availableBytes) {
		throw fail("limit_disk", "Archive would exhaust available disk.");
	}
	const peakUsed = disk.usedBytes + additionalBytes;
	const peakPercent = (peakUsed / disk.totalBytes) * 100;
	if (peakPercent > limits.maxDiskPercent) {
		throw fail("limit_disk", "Archive would exceed peak disk use.");
	}
}

type WalkEntry = {
	relativePath: string;
	absolutePath: string;
	kind: "file" | "directory" | "symlink";
	size: number;
};

function walkWorkspace(
	workspacePath: string,
	archivePath: string,
): { entries: WalkEntry[]; extractedBytes: number } {
	const entries: WalkEntry[] = [];
	let extractedBytes = 0;
	const archiveRealPath = fs.existsSync(archivePath)
		? fs.realpathSync(archivePath)
		: path.resolve(archivePath);

	const visit = (absolutePath: string, relativePath: string): void => {
		if (isExcludedRelative(relativePath)) {
			return;
		}
		let stats: fs.Stats;
		try {
			stats = fs.lstatSync(absolutePath);
		} catch {
			throw fail("archive_failed", "Unable to inspect workspace files.");
		}

		if (
			stats.isSocket() ||
			stats.isFIFO() ||
			stats.isCharacterDevice() ||
			stats.isBlockDevice()
		) {
			throw fail("special_file", "Workspace contains a socket or device file.");
		}

		if (stats.isSymbolicLink()) {
			const target = readLinkTarget(absolutePath, workspacePath);
			if (
				target === archiveRealPath ||
				path.resolve(absolutePath) === archiveRealPath
			) {
				return;
			}
			entries.push({
				relativePath: relativePath || ".",
				absolutePath,
				kind: "symlink",
				size: 0,
			});
			return;
		}

		if (path.resolve(absolutePath) === archiveRealPath) {
			return;
		}

		if (stats.isDirectory()) {
			if (relativePath !== "") {
				entries.push({
					relativePath,
					absolutePath,
					kind: "directory",
					size: 0,
				});
			}
			const children = fs.readdirSync(absolutePath);
			for (const child of children) {
				if (child === "." || child === "..") {
					continue;
				}
				visit(
					path.join(absolutePath, child),
					relativePath ? posixJoin(relativePath, child) : child,
				);
			}
			return;
		}

		if (!stats.isFile()) {
			throw fail(
				"special_file",
				"Workspace contains an unsupported file type.",
			);
		}

		extractedBytes += stats.size;
		entries.push({
			relativePath: relativePath || path.basename(absolutePath),
			absolutePath,
			kind: "file",
			size: stats.size,
		});
	};

	visit(path.resolve(workspacePath), "");
	return { entries, extractedBytes };
}

function hashFile(filePath: string): string {
	const hash = createHash("sha256");
	const fd = fs.openSync(filePath, "r");
	try {
		const buffer = Buffer.alloc(64 * 1024);
		for (;;) {
			const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
			if (bytesRead === 0) {
				break;
			}
			hash.update(buffer.subarray(0, bytesRead));
		}
	} finally {
		fs.closeSync(fd);
	}
	return hash.digest("hex");
}

function runTar(args: string[]): string {
	try {
		return execFileSync("tar", args, {
			encoding: "utf8",
			timeout: 10 * 60 * 1000,
			maxBuffer: 32 * 1024 * 1024,
		});
	} catch (error) {
		const err = error as { stderr?: string | Buffer; message?: string };
		const stderr =
			typeof err.stderr === "string"
				? err.stderr
				: Buffer.isBuffer(err.stderr)
					? err.stderr.toString("utf8")
					: "";
		throw fail("archive_failed", stderr.trim() || err.message || "tar failed.");
	}
}

function writeFileList(entries: WalkEntry[], listPath: string): void {
	const body = `${entries
		.filter((entry) => entry.relativePath !== "." && entry.kind !== "directory")
		.map((entry) => entry.relativePath)
		.join("\n")}\n`;
	fs.writeFileSync(listPath, body, { encoding: "utf8" });
}

function parseTarVerboseLine(line: string): {
	type: string;
	size: number;
	path: string;
	linkTarget?: string;
} {
	const match = line.match(
		/^([a-zA-Z-])[A-Za-z-]{9}\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.*)$/,
	);
	if (!match || !match[1] || !match[2] || match[3] === undefined) {
		throw fail("unsafe_path", "Archive member list is malformed.");
	}
	const type = match[1];
	const size = Number(match[2]);
	let memberPath = match[3];
	let linkTarget: string | undefined;
	if (type === "l") {
		const separator = " -> ";
		const index = memberPath.lastIndexOf(separator);
		if (index === -1) {
			throw fail("unsafe_path", "Archive symlink member is malformed.");
		}
		linkTarget = memberPath.slice(index + separator.length);
		memberPath = memberPath.slice(0, index);
	}
	return { type, size, path: memberPath.replace(/\/$/, ""), linkTarget };
}

function assertSafeArchiveMember(
	workspacePath: string,
	member: { type: string; path: string; linkTarget?: string },
): void {
	if (
		member.path.startsWith("/") ||
		member.path.split("/").includes("..") ||
		member.path.includes("\0")
	) {
		throw fail("unsafe_path", "Archive contains an unsafe path.");
	}
	assertInsideRoot(
		workspacePath,
		path.resolve(workspacePath, member.path || "."),
		"Archive member",
	);
	if (
		member.type === "s" ||
		member.type === "c" ||
		member.type === "b" ||
		member.type === "p"
	) {
		throw fail("special_file", "Archive contains a socket or device file.");
	}
	if (member.type === "l") {
		if (!member.linkTarget) {
			throw fail("symlink_escape", "Archive symlink member is malformed.");
		}
		if (
			member.linkTarget.startsWith("/") ||
			member.linkTarget.split("/").includes("..")
		) {
			throw fail("symlink_escape", "Archive symlink escapes the workspace.");
		}
		assertInsideRoot(
			workspacePath,
			path.resolve(workspacePath, path.dirname(member.path), member.linkTarget),
			"Archive symlink",
		);
	}
}

function inspectArchive(
	workspacePath: string,
	archivePath: string,
): { extractedBytes: number } {
	const listing = runTar(["-t", "-z", "-v", "-f", archivePath]);
	let extractedBytes = 0;
	for (const line of listing.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		const member = parseTarVerboseLine(line);
		assertSafeArchiveMember(workspacePath, member);
		if (member.type === "-" || member.type === "f") {
			extractedBytes += member.size;
		}
	}
	return { extractedBytes };
}

function unlinkQuiet(targetPath: string): void {
	try {
		fs.unlinkSync(targetPath);
	} catch {
		// already gone
	}
}

export function runCreate(options: {
	paths: ArchiveCliPaths;
	limits: ArchiveCliLimits;
	diskStat?: (targetPath: string) => DiskStat;
}): ArchiveCliResult {
	const workspacePath = path.resolve(options.paths.workspacePath);
	const archivePath = path.resolve(options.paths.archivePath);
	const listPath = `${archivePath}.files`;
	try {
		if (
			!fs.existsSync(workspacePath) ||
			!fs.statSync(workspacePath).isDirectory()
		) {
			return fail("archive_failed", "Workspace is missing.");
		}
		fs.mkdirSync(path.dirname(archivePath), { recursive: true });
		unlinkQuiet(archivePath);

		const { entries, extractedBytes } = walkWorkspace(
			workspacePath,
			archivePath,
		);
		if (extractedBytes > options.limits.maxExtractedBytes) {
			return fail(
				"limit_extracted",
				"Workspace exceeds the extracted size limit.",
			);
		}
		const disk = (options.diskStat ?? readDiskStat)(archivePath);
		assertDiskLimit(disk, extractedBytes, options.limits);

		writeFileList(entries, listPath);
		runTar([
			"-c",
			"-z",
			"-f",
			archivePath,
			"-C",
			workspacePath,
			"-T",
			listPath,
		]);

		const compressedBytes = fs.statSync(archivePath).size;
		if (compressedBytes > options.limits.maxCompressedBytes) {
			unlinkQuiet(archivePath);
			return fail(
				"limit_compressed",
				"Compressed archive exceeds the size limit.",
			);
		}

		return {
			ok: true,
			action: "create",
			compressedBytes,
			extractedBytes,
			digest: hashFile(archivePath),
		};
	} catch (error) {
		unlinkQuiet(archivePath);
		if (error && typeof error === "object" && "ok" in error) {
			return error as ArchiveCliFailure;
		}
		return fail("archive_failed", "Failed to create workspace archive.");
	} finally {
		unlinkQuiet(listPath);
	}
}

export function runRestore(options: {
	paths: ArchiveCliPaths;
	limits: ArchiveCliLimits;
	diskStat?: (targetPath: string) => DiskStat;
}): ArchiveCliResult {
	const workspacePath = path.resolve(options.paths.workspacePath);
	const archivePath = path.resolve(options.paths.archivePath);
	try {
		if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
			return fail("archive_missing", "Workspace archive is missing.");
		}
		const compressedBytes = fs.statSync(archivePath).size;
		if (compressedBytes > options.limits.maxCompressedBytes) {
			return fail(
				"limit_compressed",
				"Compressed archive exceeds the size limit.",
			);
		}
		if (!fs.existsSync(workspacePath)) {
			fs.mkdirSync(workspacePath, { recursive: true });
		}

		const { extractedBytes } = inspectArchive(workspacePath, archivePath);
		if (extractedBytes > options.limits.maxExtractedBytes) {
			return fail(
				"limit_extracted",
				"Archive exceeds the extracted size limit.",
			);
		}
		const disk = (options.diskStat ?? readDiskStat)(workspacePath);
		assertDiskLimit(disk, extractedBytes, options.limits);

		runTar(["-x", "-z", "-f", archivePath, "-C", workspacePath]);

		return {
			ok: true,
			action: "restore",
			compressedBytes,
			extractedBytes,
			digest: hashFile(archivePath),
		};
	} catch (error) {
		if (error && typeof error === "object" && "ok" in error) {
			return error as ArchiveCliFailure;
		}
		return fail("archive_failed", "Failed to extract workspace archive.");
	} finally {
		unlinkQuiet(archivePath);
	}
}

function writeResult(result: ArchiveCliResult): void {
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

/** Testable main; does not auto-run on import. */
export async function main(
	argv: string[] = process.argv.slice(2),
): Promise<number> {
	const parsed = parseArchiveCliArgs(argv);
	if (parsed.error || !parsed.action) {
		writeResult(
			parsed.error ?? fail("invalid_args", "Invalid archive arguments."),
		);
		return 2;
	}

	const paths: ArchiveCliPaths = {
		workspacePath: FIXED_WORKSPACE_PATH,
		archivePath: FIXED_ARCHIVE_PATH,
	};
	const result =
		parsed.action === "create"
			? runCreate({ paths, limits: parsed.limits })
			: runRestore({ paths, limits: parsed.limits });
	writeResult(result);
	return result.ok ? 0 : 1;
}

const isDirectRun =
	typeof process.argv[1] === "string" &&
	(path.basename(process.argv[1]) === "archive-cli.ts" ||
		path.basename(process.argv[1]) === "archive-cli.js" ||
		fileURLToPath(import.meta.url) === process.argv[1]);

if (isDirectRun) {
	main()
		.then((code) => {
			process.exitCode = code;
		})
		.catch(() => {
			writeResult(fail("archive_failed", "Archive command failed."));
			process.exitCode = 1;
		});
}
