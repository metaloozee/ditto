export const PROJECT_CODER_MODELS = [
	{
		id: "opencode-go/deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/qwen3.7-plus",
		name: "Qwen3.7 Plus",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/kimi-k2.6",
		name: "Kimi K2.6",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
] as const;

export const DEFAULT_PROJECT_CODER_MODEL = PROJECT_CODER_MODELS[0].id;
export const PROJECT_CODER_MODEL_IDS = PROJECT_CODER_MODELS.map(
	(model) => model.id,
);

export type ProjectCoderModelSpecifier =
	(typeof PROJECT_CODER_MODELS)[number]["id"];

export function isProjectCoderModelSpecifier(
	value: string,
): value is ProjectCoderModelSpecifier {
	return PROJECT_CODER_MODEL_IDS.includes(value as ProjectCoderModelSpecifier);
}
