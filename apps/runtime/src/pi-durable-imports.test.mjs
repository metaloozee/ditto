import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertCandidateBundle,
	buildCandidateBundle,
} from "../../../scripts/check-pi-durable-imports.mjs";

// Node runs the bundler/audit. None of this test's host APIs enter the Worker graph.
const { bundle } = await buildCandidateBundle();
function changed(text) {
	return { ...bundle, outputFiles: [{ text }] };
}

test("audits the candidate's static imports, variable importer and closed auth path", () => {
	const audit = assertCandidateBundle(bundle);
	assert.equal(audit.dynamicImports[0].reachable, false);
});

test("rejects filesystem and process execution imports, including variable specifiers", () => {
	for (const injected of [
		'import fs from "node:fs";',
		'import("node:child_process");',
		"const hidden = (name) => import(name);",
		'process.getBuiltinModule("node:fs");',
		'globalThis["process"].exec();',
		'const escape = eval("1");',
		'Function("return process")();',
	]) {
		assert.throws(
			() =>
				assertCandidateBundle(
					changed(`${bundle.outputFiles[0].text}\n${injected}`),
				),
			undefined,
			injected,
		);
	}
});

test("rejects omitted closed auth, escaped default auth and additional Models callers", () => {
	const original = bundle.outputFiles[0].text;
	const closed =
		"authContext: { env: async () => void 0, fileExists: async () => false }";
	assert(original.includes(closed));
	assert.throws(() =>
		assertCandidateBundle(
			changed(original.replace(closed, "authContext: undefined")),
		),
	);
	for (const injected of [
		'defaultProviderAuthContext().fileExists("/tmp/marker");',
		"const escaped = importNodeModule;",
		"createModels();",
		"new ModelsImpl();",
	])
		assert.throws(() =>
			assertCandidateBundle(changed(`${original}\n${injected}`)),
		);
});

test("remote tool module has no trusted-host file, process or stock coding-tool fallback", async () => {
	const { readFile } = await import("node:fs/promises");
	const source = await readFile(
		new URL("./pi-durable-tools.ts", import.meta.url),
		"utf8",
	);
	for (const name of [
		"node:fs",
		"node:child_process",
		"@earendil-works/pi-durable/tools",
		"@earendil-works/pi-durable/env",
		"CodingTools",
		"createBashTool",
	])
		assert.equal(
			source.includes(name),
			false,
			`pi-durable-tools references ${name}`,
		);
});
