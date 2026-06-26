import type { LanguageModelUsage } from "ai";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	CheckIcon,
	GitBranchIcon,
	MicIcon,
	ShieldAlertIcon,
} from "lucide-react";
import { memo, useCallback, useState } from "react";
import {
	Context,
	ContextCacheUsage,
	ContextContent,
	ContextContentBody,
	ContextContentFooter,
	ContextContentHeader,
	ContextInputUsage,
	ContextOutputUsage,
	ContextReasoningUsage,
	ContextTrigger,
} from "#/components/ai-elements/context";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorLogo,
	ModelSelectorLogoGroup,
	ModelSelectorName,
	ModelSelectorTrigger,
} from "#/components/ai-elements/model-selector";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	type PromptInputMessage,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "#/components/ai-elements/prompt-input";
import { useTRPC } from "#/integrations/trpc/react";

const models = [
	{
		chef: "OpenAI",
		chefSlug: "openai",
		id: "gpt-4o",
		name: "GPT-4o",
		providers: ["openai", "azure"],
	},
	{
		chef: "OpenAI",
		chefSlug: "openai",
		id: "gpt-4o-mini",
		name: "GPT-4o Mini",
		providers: ["openai", "azure"],
	},
	{
		chef: "OpenAI",
		chefSlug: "openai",
		id: "o1",
		name: "o1",
		providers: ["openai", "azure"],
	},
	{
		chef: "OpenAI",
		chefSlug: "openai",
		id: "o1-mini",
		name: "o1 Mini",
		providers: ["openai", "azure"],
	},
	{
		chef: "Anthropic",
		chefSlug: "anthropic",
		id: "claude-opus-4-20250514",
		name: "Claude 4 Opus",
		providers: ["anthropic", "azure", "google-vertex", "amazon-bedrock"],
	},
	{
		chef: "Anthropic",
		chefSlug: "anthropic",
		id: "claude-sonnet-4-20250514",
		name: "Claude 4 Sonnet",
		providers: ["anthropic", "azure", "google-vertex", "amazon-bedrock"],
	},
	{
		chef: "Anthropic",
		chefSlug: "anthropic",
		id: "claude-3.5-sonnet",
		name: "Claude 3.5 Sonnet",
		providers: ["anthropic", "azure", "google-vertex", "amazon-bedrock"],
	},
	{
		chef: "Anthropic",
		chefSlug: "anthropic",
		id: "claude-3.5-haiku",
		name: "Claude 3.5 Haiku",
		providers: ["anthropic", "azure", "google-vertex", "amazon-bedrock"],
	},
	{
		chef: "Google",
		chefSlug: "google",
		id: "gemini-2.0-flash-exp",
		name: "Gemini 2.0 Flash",
		providers: ["google", "google-vertex"],
	},
	{
		chef: "Google",
		chefSlug: "google",
		id: "gemini-1.5-pro",
		name: "Gemini 1.5 Pro",
		providers: ["google", "google-vertex"],
	},
	{
		chef: "Google",
		chefSlug: "google",
		id: "gemini-1.5-flash",
		name: "Gemini 1.5 Flash",
		providers: ["google", "google-vertex"],
	},
	{
		chef: "Meta",
		chefSlug: "llama",
		id: "llama-3.3-70b",
		name: "Llama 3.3 70B",
		providers: ["groq", "togetherai", "amazon-bedrock"],
	},
	{
		chef: "Meta",
		chefSlug: "llama",
		id: "llama-3.1-405b",
		name: "Llama 3.1 405B",
		providers: ["togetherai", "amazon-bedrock"],
	},
	{
		chef: "Meta",
		chefSlug: "llama",
		id: "llama-3.1-70b",
		name: "Llama 3.1 70B",
		providers: ["groq", "togetherai", "amazon-bedrock"],
	},
	{
		chef: "Meta",
		chefSlug: "llama",
		id: "llama-3.1-8b",
		name: "Llama 3.1 8B",
		providers: ["groq", "togetherai"],
	},
	{
		chef: "DeepSeek",
		chefSlug: "deepseek",
		id: "deepseek-r1",
		name: "DeepSeek R1",
		providers: ["deepseek", "openrouter"],
	},
	{
		chef: "DeepSeek",
		chefSlug: "deepseek",
		id: "deepseek-v3",
		name: "DeepSeek V3",
		providers: ["deepseek", "openrouter"],
	},
	{
		chef: "DeepSeek",
		chefSlug: "deepseek",
		id: "deepseek-coder-v2",
		name: "DeepSeek Coder V2",
		providers: ["deepseek", "openrouter"],
	},
	{
		chef: "Mistral AI",
		chefSlug: "mistral",
		id: "mistral-large",
		name: "Mistral Large",
		providers: ["mistral", "azure"],
	},
	{
		chef: "Mistral AI",
		chefSlug: "mistral",
		id: "mistral-small",
		name: "Mistral Small",
		providers: ["mistral", "azure"],
	},
	{
		chef: "Mistral AI",
		chefSlug: "mistral",
		id: "codestral",
		name: "Codestral",
		providers: ["mistral"],
	},
	{
		chef: "Alibaba",
		chefSlug: "alibaba",
		id: "qwen-2.5-72b",
		name: "Qwen 2.5 72B",
		providers: ["alibaba", "openrouter"],
	},
	{
		chef: "Alibaba",
		chefSlug: "alibaba",
		id: "qwen-2.5-coder-32b",
		name: "Qwen 2.5 Coder 32B",
		providers: ["alibaba", "openrouter"],
	},
	{
		chef: "Alibaba",
		chefSlug: "alibaba",
		id: "qwen-max",
		name: "Qwen Max",
		providers: ["alibaba"],
	},
	{
		chef: "Cohere",
		chefSlug: "cohere",
		id: "command-r-plus",
		name: "Command R+",
		providers: ["cohere", "azure", "amazon-bedrock"],
	},
	{
		chef: "Cohere",
		chefSlug: "cohere",
		id: "command-r",
		name: "Command R",
		providers: ["cohere", "azure", "amazon-bedrock"],
	},
	{
		chef: "xAI",
		chefSlug: "xai",
		id: "grok-3",
		name: "Grok 3",
		providers: ["xai"],
	},
	{
		chef: "xAI",
		chefSlug: "xai",
		id: "grok-2-1212",
		name: "Grok 2 1212",
		providers: ["xai"],
	},
	{
		chef: "xAI",
		chefSlug: "xai",
		id: "grok-vision",
		name: "Grok Vision",
		providers: ["xai"],
	},
	{
		chef: "Moonshot AI",
		chefSlug: "moonshotai",
		id: "moonshot-v1-128k",
		name: "Moonshot v1 128K",
		providers: ["moonshotai"],
	},
	{
		chef: "Moonshot AI",
		chefSlug: "moonshotai",
		id: "moonshot-v1-32k",
		name: "Moonshot v1 32K",
		providers: ["moonshotai"],
	},
	{
		chef: "Perplexity",
		chefSlug: "perplexity",
		id: "sonar-pro",
		name: "Sonar Pro",
		providers: ["perplexity"],
	},
	{
		chef: "Perplexity",
		chefSlug: "perplexity",
		id: "sonar",
		name: "Sonar",
		providers: ["perplexity"],
	},
	{
		chef: "Vercel",
		chefSlug: "v0",
		id: "v0-chat",
		name: "v0 Chat",
		providers: ["vercel"],
	},
	{
		chef: "Amazon",
		chefSlug: "amazon-bedrock",
		id: "nova-pro",
		name: "Nova Pro",
		providers: ["amazon-bedrock"],
	},
	{
		chef: "Amazon",
		chefSlug: "amazon-bedrock",
		id: "nova-lite",
		name: "Nova Lite",
		providers: ["amazon-bedrock"],
	},
	{
		chef: "Amazon",
		chefSlug: "amazon-bedrock",
		id: "nova-micro",
		name: "Nova Micro",
		providers: ["amazon-bedrock"],
	},
] satisfies Model[];

interface Model {
	chef: string;
	chefSlug: string;
	id: string;
	name: string;
	providers: string[];
}

interface ModelItemProps {
	model: Model;
	onSelect: (id: string) => void;
	selectedModel: string;
}

const ModelItem = memo(({ model, onSelect, selectedModel }: ModelItemProps) => {
	const handleSelect = useCallback(
		() => onSelect(model.id),
		[model.id, onSelect],
	);

	return (
		<ModelSelectorItem onSelect={handleSelect} value={model.id}>
			<ModelSelectorLogo className="size-5" provider={model.chefSlug} />
			<ModelSelectorName>{model.name}</ModelSelectorName>
			<ModelSelectorLogoGroup>
				{model.providers.map((provider) => (
					<ModelSelectorLogo key={provider} provider={provider} />
				))}
			</ModelSelectorLogoGroup>
			{selectedModel === model.id ? (
				<CheckIcon className="ml-auto size-4" />
			) : (
				<div className="ml-auto size-4" />
			)}
		</ModelSelectorItem>
	);
});

ModelItem.displayName = "ModelItem";

const contextUsage: LanguageModelUsage = {
	cachedInputTokens: 1600,
	inputTokens: 9200,
	inputTokenDetails: {
		noCacheTokens: 7600,
		cacheReadTokens: 1600,
		cacheWriteTokens: 0,
	},
	outputTokens: 1100,
	outputTokenDetails: {
		textTokens: 1100,
		reasoningTokens: 2300,
	},
	reasoningTokens: 2300,
	totalTokens: 12300,
};

type ComposerProps = {
	projectId?: string;
	sessionId?: string | null;
	activeRunId?: string | null;
	disabledReason?: string;
};

export function Composer({
	projectId,
	sessionId,
	activeRunId,
	disabledReason,
}: ComposerProps) {
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [model, setModel] = useState(models[0].id);
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const startRunMutation = useMutation(
		trpc.workspace.startRun.mutationOptions(),
	);
	const cancelRunMutation = useMutation(
		trpc.workspace.cancelRun.mutationOptions(),
	);

	async function refreshWorkspace() {
		await Promise.all([
			queryClient.invalidateQueries(trpc.projects.list.queryFilter()),
			projectId
				? queryClient.invalidateQueries(
						trpc.workspace.get.queryFilter({
							projectId,
							sessionId: sessionId ?? undefined,
						}),
					)
				: Promise.resolve(),
		]);
	}

	async function handleSubmit(message: PromptInputMessage) {
		if (!message.text.trim() && message.files.length === 0) {
			return;
		}

		if (!projectId) {
			setText("");
			return;
		}

		if (activeRunId || disabledReason) {
			return;
		}

		try {
			setError(null);
			const result = await startRunMutation.mutateAsync({
				projectId,
				sessionId: sessionId ?? undefined,
				message: message.text,
				isMutating: true,
			});

			setText("");
			await refreshWorkspace();

			if (result.createdSession) {
				await navigate({
					to: "/project/$projectId/session/$sessionId",
					params: { projectId, sessionId: result.session.id },
				});
			}
		} catch (mutationError) {
			setError(
				mutationError instanceof Error
					? mutationError.message
					: "Failed to start agent run.",
			);
		}
	}

	async function handleStop() {
		if (!activeRunId) {
			return;
		}

		try {
			setError(null);
			await cancelRunMutation.mutateAsync({ runId: activeRunId });
			await refreshWorkspace();
		} catch (mutationError) {
			setError(
				mutationError instanceof Error
					? mutationError.message
					: "Failed to stop agent run.",
			);
		}
	}

	const handleModelSelect = useCallback((id: string) => {
		setModel(id);
		setModelSelectorOpen(false);
	}, []);

	const selectedModel = models.find((modelOption) => modelOption.id === model);
	const chefs = [...new Set(models.map((modelOption) => modelOption.chef))];
	const submitDisabled =
		!text.trim() ||
		startRunMutation.isPending ||
		Boolean(activeRunId) ||
		Boolean(disabledReason);
	const alertMessage = disabledReason ?? error;

	return (
		<section className="absolute left-0 bottom-0 w-full flex flex-col justify-end gap-5 p-2">
			<div className="flex flex-col items-center justify-center gap-1 rounded-lg border bg-card p-1 shadow-sm">
				<PromptInput
					className="w-full bg-background rounded-lg"
					onSubmit={handleSubmit}
					globalDrop
					multiple
				>
					<PromptInputBody>
						<PromptInputTextarea
							onChange={(event) => setText(event.currentTarget.value)}
							value={text}
							placeholder="Your message here..."
						/>
					</PromptInputBody>
					<PromptInputFooter>
						<ModelSelector
							open={modelSelectorOpen}
							onOpenChange={setModelSelectorOpen}
						>
							<ModelSelectorTrigger
								render={
									<PromptInputButton aria-label="Select model">
										{selectedModel?.chefSlug ? (
											<ModelSelectorLogo
												className="size-3.5"
												provider={selectedModel.chefSlug}
											/>
										) : null}
										{selectedModel?.name ? (
											<ModelSelectorName>
												{selectedModel.name}
											</ModelSelectorName>
										) : null}
									</PromptInputButton>
								}
							/>

							<ModelSelectorContent showCloseButton={false}>
								<ModelSelectorInput placeholder="Search models..." />
								<ModelSelectorList>
									<ModelSelectorEmpty>No model found.</ModelSelectorEmpty>
									{chefs.map((chef) => (
										<ModelSelectorGroup heading={chef} key={chef}>
											{models
												.filter((modelOption) => modelOption.chef === chef)
												.map((modelOption) => (
													<ModelItem
														key={modelOption.id}
														model={modelOption}
														onSelect={handleModelSelect}
														selectedModel={model}
													/>
												))}
										</ModelSelectorGroup>
									))}
								</ModelSelectorList>
							</ModelSelectorContent>
						</ModelSelector>
						<PromptInputTools>
							<Context
								maxTokens={128_000}
								modelId={selectedModel?.id}
								usedTokens={14_000}
								usage={contextUsage}
							>
								<ContextTrigger />
								<ContextContent>
									<ContextContentHeader />
									<ContextContentBody className="flex flex-col gap-2 bg-card">
										<ContextInputUsage />
										<ContextOutputUsage />
										<ContextReasoningUsage />
										<ContextCacheUsage />
									</ContextContentBody>
									<ContextContentFooter className="bg-background" />
								</ContextContent>
							</Context>
							<PromptInputButton tooltip="Voice input">
								<MicIcon />
							</PromptInputButton>
							<PromptInputSubmit
								aria-label={activeRunId ? "Stop active run" : "Submit"}
								variant={activeRunId ? "destructive" : "default"}
								status={activeRunId ? "streaming" : undefined}
								onStop={handleStop}
								disabled={
									activeRunId ? cancelRunMutation.isPending : submitDisabled
								}
							/>
						</PromptInputTools>
					</PromptInputFooter>
				</PromptInput>
				{alertMessage ? (
					<p
						className={`w-full px-2 text-xs ${disabledReason ? "text-muted-foreground" : "text-destructive"}`}
						role="alert"
					>
						{alertMessage}
					</p>
				) : null}
				<div className="flex w-full justify-between gap-5 px-2 py-1.5 text-muted-foreground text-xs">
					<div className="flex items-center gap-1">
						<GitBranchIcon className="size-3" />
						<p>master</p>
					</div>
					<p>Build</p>
					<div className="flex items-center gap-1">
						<ShieldAlertIcon className="size-3" />
						<p>Full access</p>
					</div>
				</div>
			</div>
		</section>
	);
}
