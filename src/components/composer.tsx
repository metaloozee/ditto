import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { LanguageModelUsage } from "ai";
import { CheckIcon, GitBranchIcon, MicIcon } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
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
import {
	PROJECT_CODER_MODELS,
	type ProjectCoderModelSpecifier,
} from "#/lib/agent-models";
import { useUserPreferencesStore } from "#/lib/user-preferences-store";

const models = PROJECT_CODER_MODELS.map((model) => ({
	chef: model.providerName,
	chefSlug: model.provider,
	id: model.id,
	name: model.name,
	providers: [model.provider],
})) satisfies Model[];

interface Model {
	chef: string;
	chefSlug: string;
	id: ProjectCoderModelSpecifier;
	name: string;
	providers: string[];
}

interface ModelItemProps {
	model: Model;
	onSelect: (id: ProjectCoderModelSpecifier) => void;
	selectedModel: ProjectCoderModelSpecifier;
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
	const model = useUserPreferencesStore((state) => state.selectedModel);
	const setModel = useUserPreferencesStore((state) => state.setSelectedModel);
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

	async function refreshWorkspace(): Promise<void> {
		const invalidations = [
			queryClient.invalidateQueries(trpc.projects.list.queryFilter()),
		];

		if (projectId) {
			invalidations.push(
				queryClient.invalidateQueries(
					trpc.workspace.get.queryFilter({
						projectId,
						sessionId: sessionId ?? undefined,
					}),
				),
			);
		}

		await Promise.all(invalidations);
	}

	async function handleSubmit(message: PromptInputMessage): Promise<void> {
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
			const result = await startRunMutation.mutateAsync({
				projectId,
				sessionId: sessionId ?? undefined,
				message: message.text,
				modelSpecifier: model,
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
			toast.error(
				mutationError instanceof Error
					? mutationError.message
					: "Failed to start agent run.",
			);
		}
	}

	async function handleStop(): Promise<void> {
		if (!activeRunId) {
			return;
		}

		try {
			await cancelRunMutation.mutateAsync({ runId: activeRunId });
			await refreshWorkspace();
		} catch (mutationError) {
			toast.error(
				mutationError instanceof Error
					? mutationError.message
					: "Failed to stop agent run.",
			);
		}
	}

	const handleModelSelect = useCallback(
		(id: ProjectCoderModelSpecifier) => {
			setModel(id);
			setModelSelectorOpen(false);
		},
		[setModel],
	);

	const selectedModel = models.find((modelOption) => modelOption.id === model);
	const chefs = [...new Set(models.map((modelOption) => modelOption.chef))];
	const submitDisabled =
		!text.trim() ||
		startRunMutation.isPending ||
		Boolean(activeRunId) ||
		Boolean(disabledReason);

	return (
		<section className="w-full max-w-3xl mx-auto flex flex-col justify-end gap-5 pb-2 px-2">
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
							placeholder="Ask Ditto to inspect, edit, or explain the workspace..."
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
				<div className="flex w-full justify-between gap-5 px-2 text-muted-foreground text-xs">
					<div className="flex items-center gap-1">
						<GitBranchIcon className="size-3" />
						<p>master</p>
					</div>
					<Context
						maxTokens={128_000}
						modelId={selectedModel?.id}
						usedTokens={14_000}
						usage={contextUsage}
					>
						<ContextTrigger className="p-0! hover:bg-transparent!" />
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
				</div>
			</div>
		</section>
	);
}
