import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_LIMITS } from "@ditto/runtime-contracts";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { assistantToolUse, buildRestorationFixture } from "./main.ts";

const contractsPackageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../runtime-contracts",
);

function digestEmittedContracts(distDir: string): string {
	const hash = createHash("sha256");
	const files = fs
		.readdirSync(distDir)
		.filter((name) => name.endsWith(".js") || name.endsWith(".d.ts"))
		.sort();
	if (files.length === 0) {
		throw new Error(`No emitted JS/declarations in ${distDir}`);
	}
	for (const name of files) {
		hash.update(name);
		hash.update(fs.readFileSync(path.join(distDir, name)));
	}
	return hash.digest("hex");
}

function resolveImportedContractsDist(): string {
	const resolved = createRequire(import.meta.url).resolve(
		"@ditto/runtime-contracts",
	);
	const distDir = path.dirname(resolved);
	const packageName = JSON.parse(
		fs.readFileSync(path.join(distDir, "../package.json"), "utf8") as string,
	) as { name?: string };
	if (packageName.name !== "@ditto/runtime-contracts") {
		throw new Error(
			`Unexpected contracts package ${packageName.name ?? "<missing>"}`,
		);
	}
	return distDir;
}

function freshContractsDist(tempRoot: string): string {
	const outDir = path.join(tempRoot, "dist");
	const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
	execFileSync(
		process.execPath,
		[
			tsc,
			"-p",
			path.join(contractsPackageRoot, "tsconfig.json"),
			"--outDir",
			outDir,
		],
		{ cwd: contractsPackageRoot, stdio: "pipe" },
	);
	return outDir;
}

describe("Pi 0.85.1 continuation characterization", () => {
	it("does not treat an assistant tool request without results as a continuable user turn", () => {
		const fixture = buildRestorationFixture("/image/workspace");
		const manager = SessionManager.inMemory(
			"/image/workspace",
			undefined,
			fixture.fileEntries.slice(0, 5),
		);
		manager.branch("ent-a1");
		const last = manager.buildSessionContext().messages.at(-1);
		expect(last?.role).toBe("assistant");
		if (last?.role !== "assistant") throw new Error("expected assistant");
		expect(last.content).toHaveLength(2);
	});
	it("does not synthesize a missing sibling result when one result is appended", () => {
		const fixture = buildRestorationFixture("/image/workspace");
		const manager = SessionManager.inMemory(
			"/image/workspace",
			undefined,
			fixture.fileEntries.slice(0, 5),
		);
		manager.branch("ent-a1");
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "call-a",
			toolName: "tool_a",
			content: [{ type: "text", text: "tool_a:1" }],
			isError: false,
			timestamp: 5,
		});
		const context = manager.buildSessionContext();
		expect(context.messages.at(-1)).toMatchObject({
			role: "toolResult",
			toolCallId: "call-a",
		});
		expect(
			context.messages.some(
				(message) =>
					message.role === "toolResult" && message.toolCallId === "call-b",
			),
		).toBe(false);
	});
	it("normal tool batches preserve both call IDs and corresponding result IDs", () => {
		const response = assistantToolUse({
			provider: "offline",
			model: "offline-1",
			api: "faux",
			timestamp: 1,
			calls: [
				{ id: "call-a", name: "tool_a", arguments: { n: 1 } },
				{ id: "call-b", name: "tool_b", arguments: { n: 2 } },
			],
		});
		const calls = response.content.filter((block) => block.type === "toolCall");
		expect(calls.map((call) => call.id)).toEqual(["call-a", "call-b"]);
	});
});

describe("contracts-consumer-freshness", () => {
	it("contracts-consumer-freshness: imported emitted JS/declarations match a fresh contracts build", () => {
		expect(RUNTIME_LIMITS.commandBodyBytes).toBe(64 * 1024);
		const installedDist = resolveImportedContractsDist();
		const installedReal = fs.realpathSync(installedDist);
		const sourceDist = fs.realpathSync(path.join(contractsPackageRoot, "dist"));
		const resolution = installedReal === sourceDist ? "link" : "copy";
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "contracts-fresh-"));
		try {
			const freshDist = freshContractsDist(tempRoot);
			expect(
				digestEmittedContracts(installedDist),
				`stale ${resolution} of @ditto/runtime-contracts; run npm run contracts:refresh --prefix packages/session-brain`,
			).toBe(digestEmittedContracts(freshDist));
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("contracts-consumer-freshness: isolated npm copy is stale until the documented npm refresh recipe", () => {
		const npmVersion = execFileSync("npm", ["--version"], {
			encoding: "utf8",
		}).trim();
		expect(npmVersion).toBe("12.0.2");
		const brainManifest = JSON.parse(
			fs.readFileSync(
				path.join(
					path.dirname(fileURLToPath(import.meta.url)),
					"../package.json",
				),
				"utf8",
			),
		) as { scripts: Record<string, string>; engines: { npm: string } };
		expect(brainManifest.engines.npm).toBe("12.0.2");
		const refreshCommand = brainManifest.scripts["contracts:refresh"];
		expect(refreshCommand).toBe("node ./scripts/refresh-contracts.mjs");
		const fixtureRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "contracts-npm-copy-"),
		);
		const npmEnv: NodeJS.ProcessEnv = {
			...Object.fromEntries(
				Object.entries(process.env).filter(
					([key]) => !key.toLowerCase().startsWith("npm_"),
				),
			),
			npm_config_offline: "true",
			npm_config_audit: "false",
			npm_config_fund: "false",
			npm_config_install_links: "true",
		};
		const runNpm = (args: string[], cwd: string) => {
			try {
				return execFileSync("npm", args, {
					cwd,
					env: { ...npmEnv, INIT_CWD: cwd, PWD: cwd },
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				});
			} catch (error) {
				const err = error as { stderr?: string; stdout?: string };
				throw new Error(
					`npm ${args.join(" ")}\n${err.stdout ?? ""}\n${err.stderr ?? ""}`,
				);
			}
		};
		try {
			const contractsDir = path.join(fixtureRoot, "runtime-contracts");
			const consumerDir = path.join(fixtureRoot, "consumer");
			fs.cpSync(contractsPackageRoot, contractsDir, {
				recursive: true,
				filter: (source) =>
					!source.includes(`${path.sep}node_modules`) &&
					!source.includes(`${path.sep}dist`),
			});
			const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
			const typescriptRoot = path.dirname(
				createRequire(import.meta.url).resolve("typescript/package.json"),
			);
			const contractsManifest = JSON.parse(
				fs.readFileSync(path.join(contractsDir, "package.json"), "utf8"),
			) as {
				scripts?: Record<string, string>;
				devDependencies?: Record<string, string>;
			};
			contractsManifest.scripts = {
				...contractsManifest.scripts,
				build: `${process.execPath} ${tsc} -p tsconfig.json`,
			};
			contractsManifest.devDependencies = {
				...contractsManifest.devDependencies,
				typescript: `file:${typescriptRoot}`,
			};
			fs.writeFileSync(
				path.join(contractsDir, "package.json"),
				JSON.stringify(contractsManifest, null, 2),
			);
			const contractsBuild = () => {
				execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
					cwd: contractsDir,
					stdio: "pipe",
				});
			};
			fs.writeFileSync(
				path.join(contractsDir, "src/obsolete.ts"),
				"export const obsolete = true;\n",
			);
			runNpm(["install", "--ignore-scripts"], contractsDir);
			contractsBuild();
			fs.mkdirSync(path.join(consumerDir, "scripts"), { recursive: true });
			fs.copyFileSync(
				path.join(
					path.dirname(fileURLToPath(import.meta.url)),
					"../scripts/refresh-contracts.mjs",
				),
				path.join(consumerDir, "scripts/refresh-contracts.mjs"),
			);
			fs.writeFileSync(
				path.join(consumerDir, "package.json"),
				JSON.stringify(
					{
						name: "contracts-copy-consumer",
						private: true,
						type: "module",
						engines: { node: ">=22.19.0", npm: "12.0.2" },
						scripts: { "contracts:refresh": refreshCommand },
						dependencies: {
							"@ditto/runtime-contracts": "file:../runtime-contracts",
						},
					},
					null,
					2,
				),
			);
			runNpm(["install", "--ignore-scripts"], consumerDir);
			const resolveInstalled = () =>
				createRequire(path.join(consumerDir, "package.json")).resolve(
					"@ditto/runtime-contracts",
				);
			const installedJs = resolveInstalled();
			const installedDist = path.dirname(installedJs);
			expect(
				fs
					.realpathSync(installedJs)
					.startsWith(fs.realpathSync(contractsDir) + path.sep),
			).toBe(false);
			const before = digestEmittedContracts(installedDist);
			const importMarker = (cwd: string) =>
				execFileSync(
					process.execPath,
					[
						"--input-type=module",
						"-e",
						"const m = await import('@ditto/runtime-contracts'); console.log('fixtureMarker' in m ? m.fixtureMarker : 'before')",
					],
					{ cwd, encoding: "utf8" },
				).trim();
			expect(importMarker(consumerDir)).toBe("before");
			expect(fs.existsSync(path.join(installedDist, "obsolete.js"))).toBe(true);
			expect(fs.existsSync(path.join(installedDist, "obsolete.d.ts"))).toBe(
				true,
			);
			fs.appendFileSync(
				path.join(contractsDir, "src/index.ts"),
				'\nexport const fixtureMarker = "refreshed";\n',
			);
			fs.unlinkSync(path.join(contractsDir, "src/obsolete.ts"));
			contractsBuild();
			const rebuilt = digestEmittedContracts(path.join(contractsDir, "dist"));
			expect(rebuilt).not.toBe(before);
			expect(digestEmittedContracts(installedDist)).toBe(before);
			expect(importMarker(consumerDir)).toBe("before");
			expect(
				fs.readFileSync(path.join(installedDist, "index.d.ts"), "utf8"),
			).not.toContain("fixtureMarker");
			expect(fs.existsSync(path.join(installedDist, "obsolete.js"))).toBe(true);
			expect(fs.existsSync(path.join(installedDist, "obsolete.d.ts"))).toBe(
				true,
			);
			expect(fs.existsSync(path.join(contractsDir, "dist/obsolete.js"))).toBe(
				true,
			);
			expect(fs.existsSync(path.join(contractsDir, "dist/obsolete.d.ts"))).toBe(
				true,
			);
			runNpm(["run", "contracts:refresh"], consumerDir);
			const afterJs = resolveInstalled();
			expect(afterJs.startsWith(consumerDir)).toBe(true);
			const afterDist = path.dirname(afterJs);
			expect(fs.existsSync(path.join(afterDist, "obsolete.js"))).toBe(false);
			expect(fs.existsSync(path.join(afterDist, "obsolete.d.ts"))).toBe(false);
			expect(fs.existsSync(path.join(contractsDir, "dist/obsolete.js"))).toBe(
				false,
			);
			expect(fs.existsSync(path.join(contractsDir, "dist/obsolete.d.ts"))).toBe(
				false,
			);
			expect(digestEmittedContracts(afterDist)).toBe(
				digestEmittedContracts(path.join(contractsDir, "dist")),
			);
			const freshRoot = fs.mkdtempSync(
				path.join(os.tmpdir(), "contracts-fresh-compile-"),
			);
			try {
				const freshDist = path.join(freshRoot, "dist");
				execFileSync(
					process.execPath,
					[tsc, "-p", "tsconfig.json", "--outDir", freshDist],
					{ cwd: contractsDir, stdio: "pipe" },
				);
				const freshDigest = digestEmittedContracts(freshDist);
				expect(digestEmittedContracts(path.join(contractsDir, "dist"))).toBe(
					freshDigest,
				);
				expect(digestEmittedContracts(afterDist)).toBe(freshDigest);
			} finally {
				fs.rmSync(freshRoot, { recursive: true, force: true });
			}
			expect(importMarker(consumerDir)).toBe("refreshed");
			expect(fs.readFileSync(afterJs, "utf8")).toContain("fixtureMarker");
			expect(
				fs.readFileSync(path.join(afterDist, "index.d.ts"), "utf8"),
			).toContain("fixtureMarker");
		} finally {
			fs.rmSync(fixtureRoot, { recursive: true, force: true });
		}
	}, 60_000);

	it("contracts-consumer-freshness: refresh refuses a consumer symlink to an external sentinel", () => {
		const fixtureRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "contracts-path-safety-"),
		);
		const sentinelRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "contracts-external-sentinel-"),
		);
		const sentinelMarker = path.join(sentinelRoot, "SENTINEL");
		const sentinelJs = path.join(sentinelRoot, "dist/index.js");
		const assertSentinelUntouched = () => {
			expect(fs.readFileSync(sentinelMarker, "utf8")).toBe("alive");
			expect(fs.readFileSync(sentinelJs, "utf8")).toContain("do-not-touch");
		};
		try {
			fs.mkdirSync(path.join(sentinelRoot, "dist"), { recursive: true });
			fs.writeFileSync(sentinelMarker, "alive");
			fs.writeFileSync(sentinelJs, 'export const sentinel = "do-not-touch";\n');
			fs.writeFileSync(
				path.join(sentinelRoot, "package.json"),
				JSON.stringify(
					{
						name: "@ditto/runtime-contracts",
						type: "module",
						exports: "./dist/index.js",
					},
					null,
					2,
				),
			);
			const contractsDir = path.join(fixtureRoot, "runtime-contracts");
			const consumerDir = path.join(fixtureRoot, "consumer");
			fs.mkdirSync(contractsDir, { recursive: true });
			fs.writeFileSync(
				path.join(contractsDir, "package.json"),
				JSON.stringify(
					{
						name: "@ditto/runtime-contracts",
						private: true,
						type: "module",
						scripts: { build: 'node -e "process.exit(1)"' },
					},
					null,
					2,
				),
			);
			fs.mkdirSync(path.join(consumerDir, "scripts"), { recursive: true });
			fs.copyFileSync(
				path.join(
					path.dirname(fileURLToPath(import.meta.url)),
					"../scripts/refresh-contracts.mjs",
				),
				path.join(consumerDir, "scripts/refresh-contracts.mjs"),
			);
			fs.writeFileSync(
				path.join(consumerDir, "package.json"),
				JSON.stringify(
					{
						name: "contracts-copy-consumer",
						private: true,
						type: "module",
						scripts: {
							"contracts:refresh": "node ./scripts/refresh-contracts.mjs",
						},
					},
					null,
					2,
				),
			);
			fs.mkdirSync(path.join(consumerDir, "node_modules/@ditto"), {
				recursive: true,
			});
			fs.symlinkSync(
				sentinelRoot,
				path.join(consumerDir, "node_modules/@ditto/runtime-contracts"),
			);
			const runHelper = (env: NodeJS.ProcessEnv = {}) => {
				try {
					execFileSync(process.execPath, ["./scripts/refresh-contracts.mjs"], {
						cwd: consumerDir,
						env: { ...process.env, ...env },
						encoding: "utf8",
						stdio: ["ignore", "pipe", "pipe"],
					});
					return { ok: true, output: "" };
				} catch (error) {
					const err = error as {
						stdout?: string;
						stderr?: string;
					};
					return {
						ok: false,
						output: `${err.stdout ?? ""}\n${err.stderr ?? ""}`,
					};
				}
			};
			const refused = runHelper();
			expect(refused.ok).toBe(false);
			expect(refused.output).toMatch(/Refusing to refresh contracts outside/);
			assertSentinelUntouched();
			const refusedWithPreserve = runHelper({
				NODE_OPTIONS: "--preserve-symlinks",
			});
			expect(refusedWithPreserve.ok).toBe(false);
			expect(refusedWithPreserve.output).toMatch(
				/Refusing to refresh contracts outside/,
			);
			assertSentinelUntouched();
		} finally {
			fs.rmSync(fixtureRoot, { recursive: true, force: true });
			fs.rmSync(sentinelRoot, { recursive: true, force: true });
		}
	});
});
