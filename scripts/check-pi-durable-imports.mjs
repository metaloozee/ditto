import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRequire = createRequire(path.join(root, "apps/runtime/package.json"));
const ts = runtimeRequire("typescript");
const alchemyRequire = createRequire(import.meta.resolve("alchemy"));
const { build } = alchemyRequire("esbuild");
const printer = ts.createPrinter({ removeComments: true });

function parse(text) {
	return ts.createSourceFile("candidate.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}
function canonical(node, source) {
	const text = printer.printNode(ts.EmitHint.Unspecified, node, source);
	const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
	const tokens = [];
	while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) tokens.push(scanner.getTokenText());
	return tokens.join(" ");
}
function statement(text) {
	const source = parse(text);
	return canonical(source.statements[0], source);
}
function owner(node) {
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (ts.isFunctionDeclaration(parent)) return parent.name?.text;
	}
	return undefined;
}
function references(source, name) {
	const found = [];
	function visit(node) {
		if (ts.isIdentifier(node) && node.text === name) found.push(node);
		ts.forEachChild(node, visit);
	}
	visit(source);
	return found;
}

// This audit is intentionally tied to the pinned synthetic entry, not a general JS safety checker.
export function assertCandidateBundle(bundle) {
	const forbidden = Object.keys(bundle.metafile.inputs).filter((input) =>
		/apps\/web|session-brain|sandbox-runner|pi-coding-agent|env\/node|sqlite\/node/.test(input),
	);
	assert.deepEqual(forbidden, [], "Forbidden candidate inputs");
	const source = parse(bundle.outputFiles[0].text);
	assert.equal(source.parseDiagnostics.length, 0, "Invalid candidate bundle");
	const imports = [];
	const dynamic = [];
	const globals = [];
	function visit(node) {
		if (ts.isImportDeclaration(node)) imports.push(node.moduleSpecifier.text);
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) dynamic.push(node);
		if (ts.isIdentifier(node) && ["require", "eval"].includes(node.text)) {
			assert.fail(`Unreviewed execution capability: ${node.text}`);
		}
		if (ts.isIdentifier(node) && node.text === "Function" &&
			!(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
			if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
				if (node.parent.expression.getText(source) === "globalThis") {
					assert(ts.isNewExpression(node.parent.parent));
					assert.equal(owner(node), "Evaluate");
				}
			} else {
				assert(
					(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && node.parent.name.text === "prototype") ||
					(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && node.parent.right === node),
					"Unreviewed Function constructor access",
				);
			}
		}
		if (ts.isNewExpression(node) && /(?:^|\.)Function$/.test(node.expression.getText(source))) {
			assert.equal(owner(node), "Evaluate", "Unreviewed code generation");
			assert.equal(canonical(node.parent.parent.parent, source), statement(
				"function Evaluate(...args) { return new globalThis.Function(...args); }",
			), "TypeBox code generation body changed");
		}
		if (ts.isIdentifier(node) && node.text === "process" &&
			!(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
			!(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) globals.push(node);
		if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === "globalThis" && node.name.text === "process") globals.push(node);
		if (ts.isElementAccessExpression(node) && node.expression.getText(source) === "globalThis") {
			assert.equal(node.argumentExpression.getText(source), "WORKERS_MODULE_SYMBOL", "Unreviewed global capability lookup");
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	assert.deepEqual([...new Set(imports)].sort(), ["cloudflare:workers", "node:path/posix"]);
	assert.equal(dynamic.length, 1, "Unreviewed dynamic import");
	const declaration = dynamic[0].parent.parent;
	assert(ts.isVariableDeclaration(declaration));
	assert.equal(canonical(declaration.parent.parent, source), statement(
		"var importNodeModule = (specifier) => import(__rewriteRelativeImportExtension(specifier));",
	));

	const auth = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "defaultProviderAuthContext");
	assert(auth, "Pinned default auth context missing");
	assert.equal(canonical(auth, source), statement(`function defaultProviderAuthContext() {
		return {
			async env(name) {
				const value = getProcessEnv()?.[name];
				return typeof value === "string" && value.trim().length > 0 ? value : void 0;
			},
			async fileExists(path2) {
				try {
					const fs = await importNodeModule("node:fs/promises");
					let resolved = path2;
					if (resolved.startsWith("~")) {
						const os = await importNodeModule("node:os");
						resolved = os.homedir() + resolved.slice(1);
					}
					await fs.access(resolved);
					return true;
				} catch { return false; }
			}
		};
	}`), "Default auth capability body changed; review required");
	const importer = references(source, "importNodeModule");
	assert.equal(importer.length, 3);
	for (const use of importer.filter((node) => !ts.isVariableDeclaration(node.parent))) {
		assert.equal(owner(use), "defaultProviderAuthContext", "Auth importer escaped default context");
	}
	const defaults = references(source, "defaultProviderAuthContext");
	assert.equal(defaults.length, 2, "Default auth gained another caller");
	const fallback = defaults.find((node) => ts.isCallExpression(node.parent));
	assert(fallback);
	assert.equal(canonical(fallback.parent.parent.parent, source), statement(
		"this.authContext = options?.authContext ?? defaultProviderAuthContext();",
	).replace(/\s*;$/, ""));
	const constructor = fallback.parent.parent.parent.parent.parent.parent;
	assert(ts.isConstructorDeclaration(constructor));
	assert(ts.isVariableDeclaration(constructor.parent.parent));
	assert.equal(constructor.parent.parent.name.text, "ModelsImpl");
	assert.equal(canonical(constructor, source), statement(`class ModelsImpl {
		constructor(options) {
			this.credentials = options?.credentials ?? new InMemoryCredentialStore();
			this.modelsStore = options?.modelsStore ?? new InMemoryModelsStore();
			this.authContext = options?.authContext ?? defaultProviderAuthContext();
		}
	}`).slice("class ModelsImpl { ".length, -2));

	const modelRefs = references(source, "ModelsImpl");
	assert.equal(modelRefs.length, 2, "Models constructor gained another caller");
	assert.equal(owner(modelRefs.find((node) => ts.isNewExpression(node.parent))), "createModels");
	const factories = references(source, "createModels");
	assert.equal(factories.length, 2, "Models factory gained another caller");
	const factoryCall = factories.find((node) => ts.isCallExpression(node.parent));
	assert.equal(owner(factoryCall), "runFixture");
	const factory = factories.find((node) => ts.isFunctionDeclaration(node.parent)).parent;
	assert.equal(canonical(factory, source), statement("function createModels(options) { return new ModelsImpl(options); }"));
	assert.equal(canonical(factoryCall.parent, source), statement(
		"createModels({ authContext: { env: async () => void 0, fileExists: async () => false } });",
	).replace(/\s*;$/, ""), "Fixture must inject closed auth context");

	assert.equal(globals.length, 4, "Unreviewed process capability");
	assert.deepEqual(globals.map(owner).sort(), ["getEnvVar", "getEnvVar", "getEnvVar", "getProcessEnv"]);
	for (const name of ["getEnvVar", "getProcessEnv"]) {
		const node = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
		assert(node);
		const expected = name === "getProcessEnv"
			? "function getProcessEnv() { const proc = globalThis.process; return proc?.env; }"
			: `function getEnvVar(name) {
				if (typeof process !== "undefined" && process.env) return process.env[name];
				if (typeof Bun !== "undefined") {
					const bunEnv = Bun.env;
					if (bunEnv) return bunEnv[name];
				}
			}`;
		assert.equal(canonical(node, source), statement(expected), "Process lookup body changed");
	}
	const envRefs = references(source, "getProcessEnv");
	assert.equal(envRefs.length, 2);
	assert.equal(owner(envRefs.find((node) => ts.isCallExpression(node.parent))), "defaultProviderAuthContext");
	return {
		staticExternals: [...new Set(imports)].sort(),
		dynamicImports: [{ importer: "importNodeModule", callers: ["defaultProviderAuthContext.fileExists"], destinations: ["node:fs/promises", "node:os"], reachable: false, reason: "Only ModelsImpl constructor calls default context; sole factory caller supplies non-null closed auth context" }],
		processAccess: "Sandbox logging reads environment only; Pi default auth environment reader is unreachable",
		limits: "Pinned synthetic entry only. Does not prove Docker startup or requested compatibility date.",
	};
}

export async function buildCandidateBundle() {
	const bundle = await build({
		absWorkingDir: root,
		entryPoints: ["apps/runtime/src/pi-durable-local-entry.ts"],
		bundle: true,
		format: "esm",
		platform: "browser",
		external: ["cloudflare:workers", "node:path/posix"],
		metafile: true,
		write: false,
	});
	return { bundle, assessment: assertCandidateBundle(bundle) };
}
