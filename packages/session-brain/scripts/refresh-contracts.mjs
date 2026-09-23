#!/usr/bin/env node
/**
 * Refresh @ditto/runtime-contracts for npm 12.0.2 file: directory installs.
 *
 * Supported resolution:
 * - symlink to the sibling source (npm install-links=false): clean rebuild is enough
 * - copied directory (install-links=true): replace owned generated dist after clean rebuild
 *
 * `npm install` / `--force` are not assumed to recopy an unchanged version.
 * Ordinary `tsc -p tsconfig.json` retains stale emitted files, so this helper
 * cleans only the owned producer dist before that build.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACTS_NAME = "@ditto/runtime-contracts";
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.resolve(pkgRoot, "..");
const contractsRoot = path.resolve(packagesDir, "runtime-contracts");
const ownedInstallRoot = path.resolve(
	pkgRoot,
	`node_modules/${CONTRACTS_NAME}`,
);

function isInside(candidate, root) {
	const resolvedCandidate = path.resolve(candidate);
	const resolvedRoot = path.resolve(root);
	return (
		resolvedCandidate === resolvedRoot ||
		resolvedCandidate.startsWith(resolvedRoot + path.sep)
	);
}

function lstatIfPresent(target) {
	try {
		return fs.lstatSync(target);
	} catch (error) {
		if (error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

function readContractsPackage(packageRoot) {
	const manifestPath = path.join(packageRoot, "package.json");
	if (!fs.existsSync(manifestPath)) {
		throw new Error(`Missing package.json at ${packageRoot}`);
	}
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	if (manifest.name !== CONTRACTS_NAME) {
		throw new Error(
			`Unexpected contracts package ${manifest.name ?? "<missing>"} at ${packageRoot}`,
		);
	}
}

function ownedDist(packageRoot) {
	const dist = path.resolve(packageRoot, "dist");
	if (path.relative(packageRoot, dist) !== "dist") {
		throw new Error(`Refusing unexpected contracts dist at ${dist}`);
	}
	return dist;
}

function assertReplaceableDist(dist, packageRoot, action) {
	const src = path.resolve(packageRoot, "src");
	const stat = lstatIfPresent(dist);
	if (!stat) {
		return;
	}
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(
			`Refusing to ${action} contracts dist outside ${packageRoot}`,
		);
	}
	const real = fs.realpathSync(dist);
	if (!isInside(real, packageRoot) || real === packageRoot || real === src) {
		throw new Error(
			`Refusing to ${action} contracts dist outside ${packageRoot}`,
		);
	}
}

function refuseOutside() {
	throw new Error(`Refusing to refresh contracts outside ${ownedInstallRoot}`);
}

function classifyOwnedInstall(sourceRoot) {
	const stat = lstatIfPresent(ownedInstallRoot);
	if (!stat) {
		return "missing";
	}
	if (stat.isSymbolicLink()) {
		if (fs.realpathSync(ownedInstallRoot) === sourceRoot) {
			return "source-link";
		}
		refuseOutside();
	}
	if (!stat.isDirectory()) {
		refuseOutside();
	}
	if (fs.realpathSync(ownedInstallRoot) !== ownedInstallRoot) {
		refuseOutside();
	}
	return "plain-owned";
}

if (path.basename(contractsRoot) !== "runtime-contracts") {
	throw new Error(`Refusing unexpected contracts package at ${contractsRoot}`);
}
if (!lstatIfPresent(contractsRoot)) {
	throw new Error(`Missing contracts package at ${contractsRoot}`);
}
const sourceRoot = fs.realpathSync(contractsRoot);
if (!isInside(sourceRoot, packagesDir)) {
	throw new Error(`Refusing contracts package outside ${packagesDir}`);
}
readContractsPackage(sourceRoot);

const sourceDist = ownedDist(sourceRoot);
assertReplaceableDist(sourceDist, sourceRoot, "clean");

const consumerRequire = createRequire(path.join(pkgRoot, "package.json"));
let resolvedInstall = null;
try {
	resolvedInstall = path.resolve(
		path.dirname(consumerRequire.resolve(CONTRACTS_NAME)),
		"..",
	);
} catch {
	resolvedInstall = null;
}
if (resolvedInstall !== null) {
	readContractsPackage(resolvedInstall);
}

let installKind;
if (resolvedInstall === null) {
	installKind = classifyOwnedInstall(sourceRoot);
} else if (fs.realpathSync(resolvedInstall) === sourceRoot) {
	installKind = "source-link";
} else if (path.resolve(resolvedInstall) !== ownedInstallRoot) {
	refuseOutside();
} else {
	installKind = classifyOwnedInstall(sourceRoot);
}

if (installKind === "plain-owned") {
	assertReplaceableDist(
		path.join(ownedInstallRoot, "dist"),
		ownedInstallRoot,
		"replace",
	);
}

if (lstatIfPresent(sourceDist)) {
	fs.rmSync(sourceDist, { recursive: true, force: true });
}

execFileSync("npm", ["run", "build"], {
	cwd: sourceRoot,
	stdio: "inherit",
});

if (installKind !== "plain-owned") {
	process.exit(0);
}

if (!fs.existsSync(sourceDist) || !fs.statSync(sourceDist).isDirectory()) {
	throw new Error(`Missing contracts dist at ${sourceDist}`);
}
const sourceDistReal = fs.realpathSync(sourceDist);
if (!isInside(sourceDistReal, sourceRoot)) {
	throw new Error(`Refusing to copy contracts dist outside ${sourceRoot}`);
}

const destDist = path.join(ownedInstallRoot, "dist");
if (lstatIfPresent(destDist)) {
	const destDistReal = fs.realpathSync(destDist);
	if (destDistReal === sourceRoot || destDistReal === sourceDistReal) {
		throw new Error("Refusing to delete source contracts dist");
	}
	fs.rmSync(destDist, { recursive: true, force: true });
}

fs.mkdirSync(ownedInstallRoot, { recursive: true });
fs.cpSync(sourceDist, destDist, { recursive: true });
fs.copyFileSync(
	path.join(sourceRoot, "package.json"),
	path.join(ownedInstallRoot, "package.json"),
);
