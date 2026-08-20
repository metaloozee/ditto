import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
	createLockedChatResourceLoader,
	IMAGE_OWNED_DITTO_EXTENSION_PATH,
} from "./locked-resource-loader.js";

const DITTO_EXTENSION_FIXTURE = fileURLToPath(
	new URL("./ditto-extension.ts", import.meta.url),
);

const HOSTILE_EXTENSION = `export default function () {
	throw new Error("hostile extension loaded");
}
`;

const HOSTILE_SKILL = `---
name: hostile-skill
description: A skill that must not be discovered by locked chat loading.
---

# Hostile Skill

Do not load this.
`;

const HOSTILE_PROMPT = `---
description: Hostile prompt template
---
This prompt must not load.
`;

const HOSTILE_THEME = `{
	"name": "hostile"
}
`;

function writeFile(filePath: string, contents: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents);
}

function writeHostileRepo(root: string): void {
	writeFile(
		path.join(root, ".pi", "extensions", "hostile.ts"),
		HOSTILE_EXTENSION,
	);
	writeFile(
		path.join(root, ".pi", "extensions", "ditto-extension.ts"),
		HOSTILE_EXTENSION,
	);
	writeFile(
		path.join(root, ".pi", "skills", "hostile-skill", "SKILL.md"),
		HOSTILE_SKILL,
	);
	writeFile(path.join(root, ".pi", "prompts", "hostile.md"), HOSTILE_PROMPT);
	writeFile(path.join(root, ".pi", "themes", "hostile.json"), HOSTILE_THEME);
	writeFile(
		path.join(root, ".pi", "settings.json"),
		JSON.stringify({
			extensions: [".pi/extensions/hostile.ts"],
			skills: [".pi/skills"],
			packages: ["npm:hostile-package"],
		}),
	);
	writeFile(path.join(root, ".pi", "SYSTEM.md"), "HOSTILE_SYSTEM_MD");
	writeFile(
		path.join(root, ".pi", "APPEND_SYSTEM.md"),
		"HOSTILE_APPEND_SYSTEM_MD",
	);
	writeFile(path.join(root, "AGENTS.md"), "HOSTILE_AGENTS_MD_CONTENT");
	writeFile(path.join(root, "CLAUDE.md"), "HOSTILE_CLAUDE_MD_CONTENT");
}

function writeHostileAgentDir(root: string): void {
	writeFile(
		path.join(root, "extensions", "hostile-agent.ts"),
		HOSTILE_EXTENSION,
	);
	writeFile(
		path.join(root, "skills", "hostile-agent-skill", "SKILL.md"),
		HOSTILE_SKILL.replace("hostile-skill", "hostile-agent-skill"),
	);
	writeFile(path.join(root, "SYSTEM.md"), "HOSTILE_AGENT_SYSTEM_MD");
	writeFile(path.join(root, "APPEND_SYSTEM.md"), "HOSTILE_AGENT_APPEND_MD");
	writeFile(path.join(root, "AGENTS.md"), "HOSTILE_AGENT_AGENTS_MD");
}

describe("IMAGE_OWNED_DITTO_EXTENSION_PATH", () => {
	it("is the image-owned runner path", () => {
		expect(IMAGE_OWNED_DITTO_EXTENSION_PATH).toBe(
			"/opt/ditto-runner/dist/ditto-extension.js",
		);
	});
});

describe("createLockedChatResourceLoader", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	function tempDir(prefix: string): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		tempDirs.push(dir);
		return dir;
	}

	it("loads only the image-owned Ditto extension from a hostile repository", async () => {
		const cwd = tempDir("ditto-locked-cwd-");
		const agentDir = tempDir("ditto-locked-agent-");
		writeHostileRepo(cwd);
		writeHostileAgentDir(agentDir);

		const loader = await createLockedChatResourceLoader({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: true },
				followUpMode: "one-at-a-time",
			}),
			extensionPath: DITTO_EXTENSION_FIXTURE,
		});

		const extensions = loader.getExtensions();
		expect(extensions.errors).toEqual([]);
		expect(extensions.extensions).toHaveLength(1);
		const loaded = extensions.extensions[0];
		expect(loaded).toBeDefined();
		if (!loaded) {
			throw new Error("expected the Ditto extension to load");
		}
		expect(path.resolve(loaded.resolvedPath)).toBe(
			path.resolve(DITTO_EXTENSION_FIXTURE),
		);
		expect(path.resolve(loaded.path)).not.toBe(
			path.resolve(cwd, ".pi", "extensions", "ditto-extension.ts"),
		);
		expect(loaded.tools.has("ditto_push_branch")).toBe(true);
		expect(loaded.tools.has("ditto_open_pull_request")).toBe(true);

		expect(loader.getSkills().skills).toEqual([]);
		expect(loader.getPrompts().prompts).toEqual([]);
		expect(loader.getThemes().themes).toEqual([]);
		expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
		expect(loader.getSystemPrompt()).toBeUndefined();
		expect(loader.getAppendSystemPrompt()).toEqual([]);
	});

	it("rejects a missing image-owned extension path", async () => {
		const cwd = tempDir("ditto-locked-missing-cwd-");
		const agentDir = tempDir("ditto-locked-missing-agent-");
		writeHostileRepo(cwd);

		await expect(
			createLockedChatResourceLoader({
				cwd,
				agentDir,
				settingsManager: SettingsManager.inMemory({
					compaction: { enabled: true },
					followUpMode: "one-at-a-time",
				}),
				extensionPath: path.join(cwd, "missing-ditto-extension.js"),
			}),
		).rejects.toThrow();
	});

	it("does not load a repository file that shadows the Ditto extension name", async () => {
		const cwd = tempDir("ditto-locked-shadow-cwd-");
		const agentDir = tempDir("ditto-locked-shadow-agent-");
		writeHostileRepo(cwd);

		const loader = await createLockedChatResourceLoader({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: true },
				followUpMode: "one-at-a-time",
			}),
			extensionPath: DITTO_EXTENSION_FIXTURE,
		});

		const loadedPaths = loader
			.getExtensions()
			.extensions.map((extension) => path.resolve(extension.resolvedPath));
		expect(loadedPaths).toEqual([path.resolve(DITTO_EXTENSION_FIXTURE)]);
		expect(loadedPaths).not.toContain(
			path.resolve(cwd, ".pi", "extensions", "ditto-extension.ts"),
		);
	});
});
