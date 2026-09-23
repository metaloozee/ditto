import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webSrc = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../web/src",
);
const webLib = path.join(webSrc, "lib");

const roots = [
	"workspace-runtime-policy.ts",
	"workspace-runtime-capacity.ts",
	"sandbox-bootstrap.ts",
	"sandbox-archive.ts",
	"workspace-recovery.ts",
];

const forbidden = [
	"github-app",
	"auth.ts",
	"auth.client",
	"auth.functions",
	"agent-run-service",
	"agent-run.ts",
	"workspace-runtime.ts",
	"session-preview",
];

function localImports(source: string, fromFile: string): string[] {
	const matches = source.matchAll(/from\s+["']([^"']+)["']/g);
	const resolved: string[] = [];
	for (const match of matches) {
		const spec = match[1];
		if (!spec) continue;
		if (spec.startsWith("#/")) {
			const abs = path.join(webSrc, spec.slice(2));
			resolved.push(abs.endsWith(".ts") ? abs : `${abs}.ts`);
			continue;
		}
		if (spec.startsWith("./") || spec.startsWith("../")) {
			const abs = path.resolve(path.dirname(fromFile), spec);
			resolved.push(abs.endsWith(".ts") ? abs : `${abs}.ts`);
		}
	}
	return resolved;
}

describe("shared runtime policy import graph", () => {
	it("does not import product auth, GitHub, agent, preview, or workspace-runtime orchestration", () => {
		const seen = new Set<string>();
		const queue = roots.map((name) => path.join(webLib, name));
		while (queue.length > 0) {
			const file = queue.pop();
			if (!file || seen.has(file) || !file.startsWith(webSrc)) continue;
			seen.add(file);
			if (!fs.existsSync(file)) continue;
			const source = fs.readFileSync(file, "utf8");
			for (const name of forbidden) {
				expect(source, `${path.basename(file)} imports ${name}`).not.toMatch(
					new RegExp(`${name.replace(".", "\\.")}["']`),
				);
			}
			for (const next of localImports(source, file)) {
				queue.push(next);
			}
		}
		expect(seen.size).toBeGreaterThanOrEqual(roots.length);
	});
});
