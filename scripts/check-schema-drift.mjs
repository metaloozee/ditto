import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrations = path.join(root, "apps/web/migrations");
const BREAKPOINT = "--> statement-breakpoint";

function applySql(db, sqlText) {
	for (const part of sqlText.split(BREAKPOINT)) {
		if (part.trim()) db.exec(part);
	}
}

function buildRealDb() {
	const db = new DatabaseSync(":memory:");
	const journal = JSON.parse(fs.readFileSync(path.join(migrations, "meta/_journal.json"), "utf8"));
	for (const entry of journal.entries) {
		applySql(db, fs.readFileSync(path.join(migrations, `${entry.tag}.sql`), "utf8"));
	}
	return db;
}

function buildSchemaDb() {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ditto-drift-"));
	try {
		execFileSync(
			"pnpm",
			[
				"--filter",
				"@ditto/web",
				"exec",
				"drizzle-kit",
				"generate",
				"--dialect=sqlite",
				"--schema=./src/db/schema.ts",
				`--out=${tmp}`,
				"--name=drift",
			],
			{ cwd: root, stdio: ["ignore", "pipe", "inherit"] },
		);
		const db = new DatabaseSync(":memory:");
		const files = fs.readdirSync(tmp).filter((f) => f.endsWith(".sql"));
		if (files.length !== 1) throw new Error(`expected one generated sql file, got ${files.join(",")}`);
		applySql(db, fs.readFileSync(path.join(tmp, files[0]), "utf8"));
		return db;
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

function normalize(expr, table) {
	return expr
		.toLowerCase()
		.replace(/[\s"'`]/g, "")
		.split(`${table.toLowerCase()}.`)
		.join("");
}

// Returns every CHECK(...) expression in a CREATE TABLE statement, balanced-paren aware.
function extractChecks(createSql, table) {
	const checks = [];
	const lower = createSql.toLowerCase();
	let i = 0;
	while ((i = lower.indexOf("check", i)) !== -1) {
		const before = lower[i - 1];
		let j = i + 5;
		while (/\s/.test(lower[j] ?? "")) j++;
		if ((before && /[a-z0-9_]/.test(before)) || lower[j] !== "(") {
			i += 5;
			continue;
		}
		let depth = 0;
		let k = j;
		let quote = null;
		for (; k < createSql.length; k++) {
			const c = createSql[k];
			if (quote) {
				if (c === quote) quote = null;
			} else if (c === "'" || c === '"' || c === "`") quote = c;
			else if (c === "(") depth++;
			else if (c === ")" && --depth === 0) break;
		}
		checks.push(normalize(createSql.slice(j + 1, k), table));
		i = k;
	}
	return checks.sort();
}

function shape(db) {
	const tables = {};
	const triggers = [];
	for (const r of db.prepare("SELECT type,name,sql FROM sqlite_master").all()) {
		if (r.type === "trigger") triggers.push(r.name);
		if (r.type !== "table" || r.name.startsWith("sqlite_") || r.name.startsWith("_cf_")) continue;
		const q = `"${r.name}"`;
		const columns = db
			.prepare(`pragma table_info(${q})`)
			.all()
			.map((c) => `${c.name}|${String(c.type).toUpperCase()}|nn=${c.notnull}|d=${c.dflt_value}|pk=${c.pk}`)
			.sort();
		const unique = [];
		const indexes = [];
		for (const ix of db.prepare(`pragma index_list(${q})`).all()) {
			const cols = db
				.prepare(`pragma index_info("${ix.name}")`)
				.all()
				.map((c) => c.name);
			if (ix.unique) unique.push([...cols].sort().join(","));
			else indexes.push(`${ix.name}:${cols.join(",")}`);
		}
		const foreignKeys = db
			.prepare(`pragma foreign_key_list(${q})`)
			.all()
			.map((f) => `${f.table}|${f.from}|${f.to}|${f.on_update}|${f.on_delete}`)
			.sort();
		tables[r.name] = {
			columns,
			unique: unique.sort(),
			indexes: indexes.sort(),
			foreignKeys,
			checks: extractChecks(r.sql ?? "", r.name),
		};
	}
	return { tables, triggers: triggers.sort() };
}

const real = shape(buildRealDb());
const schema = shape(buildSchemaDb());
const allow = new Set(
	JSON.parse(fs.readFileSync(path.join(root, "scripts/schema-drift-allowlist.json"), "utf8")).triggers,
);

const diffs = [];
const fmt = (v) => JSON.stringify(v);
const names = [...new Set([...Object.keys(real.tables), ...Object.keys(schema.tables)])].sort();
for (const name of names) {
	const a = real.tables[name];
	const b = schema.tables[name];
	if (!a || !b) {
		diffs.push(`${name}.table: real=${a ? "present" : "missing"} schema=${b ? "present" : "missing"}`);
		continue;
	}
	for (const kind of Object.keys(a)) {
		if (fmt(a[kind]) !== fmt(b[kind])) {
			diffs.push(`${name}.${kind}: real=${fmt(a[kind])} schema=${fmt(b[kind])}`);
		}
	}
}
for (const t of real.triggers) {
	if (!allow.has(t)) diffs.push(`trigger.${t}: real=present schema=missing (not allowlisted)`);
}
for (const t of allow) {
	if (!real.triggers.includes(t)) diffs.push(`trigger.${t}: allowlisted but missing from real`);
}
for (const t of schema.triggers) diffs.push(`trigger.${t}: schema=present`);

if (diffs.length) {
	console.error(diffs.join("\n"));
	process.exit(1);
}
console.log("no drift");
