import path from "node:path";
import {
	DefaultResourceLoader,
	type ResourceLoader,
	type SettingsManager,
} from "@earendil-works/pi-coding-agent";

export const IMAGE_OWNED_DITTO_EXTENSION_PATH =
	"/opt/ditto-runner/dist/ditto-extension.js";

const DITTO_GIT_TOOL_NAMES = [
	"ditto_push_branch",
	"ditto_open_pull_request",
] as const;

function isImageOwnedExtension(
	extension: { path: string; resolvedPath: string },
	extensionPath: string,
): boolean {
	const expected = path.resolve(extensionPath);
	return (
		path.resolve(extension.path) === expected ||
		path.resolve(extension.resolvedPath) === expected
	);
}

export async function createLockedChatResourceLoader(options: {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
	extensionPath: string;
}): Promise<ResourceLoader> {
	const loader = new DefaultResourceLoader({
		cwd: options.cwd,
		agentDir: options.agentDir,
		settingsManager: options.settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		additionalExtensionPaths: [options.extensionPath],
		systemPromptOverride: () => undefined,
		appendSystemPromptOverride: () => [],
	});
	await loader.reload();

	const loaded = loader.getExtensions();
	if (loaded.errors.length > 0) {
		throw new Error(
			loaded.errors[0]?.error ?? "Ditto extension failed to load",
		);
	}

	const imageOwned = loaded.extensions.find((extension) =>
		isImageOwnedExtension(extension, options.extensionPath),
	);
	if (!imageOwned || loaded.extensions.length !== 1) {
		throw new Error("Ditto extension did not load");
	}
	for (const toolName of DITTO_GIT_TOOL_NAMES) {
		if (!imageOwned.tools.has(toolName)) {
			throw new Error("Ditto extension is missing Git tools");
		}
	}

	return loader;
}
