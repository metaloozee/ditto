// Shared by the owner commands of the deployed feasibility stages. Each stage runs alchemy from
// its own folder, so its state stays in that folder's .alchemy.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const alchemyBin = path.join(import.meta.dirname, "..", "node_modules", ".bin", "alchemy");

/** Kept outside the repo: sign-ins and run keys. */
export const configDir = path.join(homedir(), ".config", "ditto-feasibility");

/** One deployed stage: the folder its alchemy.run.ts lives in, its stack name and its stage. */
export type Stack = { dir: string; name: string; stage: string };

export function alchemy(
	stack: Stack,
	command: "deploy" | "destroy",
	env: Record<string, string>,
): Promise<number> {
	const child = spawn(
		alchemyBin,
		[command, "--stage", stack.stage, "--yes", "--no-input", "--env-file", "/dev/null"],
		// Secrets reach alchemy only through this child's environment, never a file in the repo.
		{ cwd: stack.dir, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } },
	);
	return new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
}

/** The deployed stage's URL from Alchemy's local state, or undefined when it isn't deployed. */
export async function deployedUrl(stack: Stack): Promise<string | undefined> {
	const file = path.join(
		stack.dir,
		".alchemy",
		"state",
		stack.name,
		stack.stage,
		"__stack_output__.json",
	);
	const saved = await readFile(file, "utf8").catch(() => undefined);
	return saved ? (JSON.parse(saved) as { url?: string }).url : undefined;
}

/** The stage's run key: created on first deploy, readable only by the owner. */
export async function runKey(file: string): Promise<string> {
	const saved = await readFile(file, "utf8").catch(() => undefined);
	if (saved) return saved.trim();
	const key = randomBytes(32).toString("hex");
	await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	await writeFile(file, key, { mode: 0o600 });
	return key;
}

/** The run key a deploy saved. Never creates one: it would not match the deployed secret. */
export async function savedRunKey(file: string, deployCommand: string): Promise<string> {
	const key = (await readFile(file, "utf8").catch(() => "")).trim();
	if (!key) throw new Error(`No run key in ${file}. Run: ${deployCommand}`);
	return key;
}
