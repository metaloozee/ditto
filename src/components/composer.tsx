import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, GitBranchIcon, MicIcon } from "lucide-react";
import {
	type Dispatch,
	memo,
	type SetStateAction,
	useCallback,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
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
import {
	streamAgentRun,
	toolNameFromAgentEvent,
} from "#/lib/agent-stream-client";
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

export type ComposerStreamingState = {
	active: boolean;
	text: string;
	toolName?: string | null;
};

type ComposerProps = {
	projectId?: string;
	sessionId?: string | null;
	disabledReason?: string;
	onStreamingChange?: Dispatch<SetStateAction<ComposerStreamingState | null>>;
	onWorkspaceRefresh?: (sessionId: string) => void | Promise<void>;
};

export function Composer({
	projectId,
	sessionId,
	disabledReason,
	onStreamingChange,
	onWorkspaceRefresh,
}: ComposerProps) {
	const [text, setText] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const activeSessionIdRef = useRef<string | null>(sessionId ?? null);
	const model = useUserPreferencesStore((state) => state.selectedModel);
	const setModel = useUserPreferencesStore((state) => state.setSelectedModel);
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	async function refreshWorkspace(): Promise<void> {
		const invalidations = [
			queryClient.invalidateQueries(trpc.projects.list.queryFilter()),
		];

		if (projectId) {
			invalidations.push(
				queryClient.invalidateQueries(
					trpc.projects.get.queryFilter({ id: projectId }),
				),
			);
		}

		await Promise.all(invalidations);
	}

	function clearStreamingState(): void {
		setIsStreaming(false);
		onStreamingChange?.(null);
	}

	async function handleSubmit(message: PromptInputMessage) {
		if (!message.text.trim() && message.files.length === 0) {
			return;
		}

		if (!projectId) {
			setText("");
			return;
		}

		if (disabledReason || isStreaming) {
			return;
		}

		const prompt = message.text;
		setText("");
		setIsStreaming(true);
		onStreamingChange?.({ active: true, text: "", toolName: null });

		let streamSessionId = sessionId ?? undefined;

		try {
			await streamAgentRun(
				{
					projectId,
					sessionId: streamSessionId,
					message: prompt,
					model,
				},
				{
					onMeta: async (meta) => {
						streamSessionId = meta.sessionId;
						activeSessionIdRef.current = meta.sessionId;

						if (meta.createdSession) {
							await navigate({
								to: "/project/$projectId/session/$sessionId",
								params: { projectId, sessionId: meta.sessionId },
							});
						}
					},
					onDelta: (delta) => {
						onStreamingChange?.((previous) => {
							const base = previous ?? {
								active: true,
								text: "",
								toolName: null,
							};
							return {
								...base,
								active: true,
								text: base.text + delta,
							};
						});
					},
					onAgent: (event) => {
						const toolName = toolNameFromAgentEvent(event);
						if (!toolName) {
							return;
						}
						onStreamingChange?.((previous) => {
							const base = previous ?? {
								active: true,
								text: "",
								toolName: null,
							};
							return { ...base, active: true, toolName };
						});
					},
					onError: (errorMessage) => {
						toast.error(errorMessage);
					},
					onDone: async () => {
						clearStreamingState();
						await refreshWorkspace();
						const resolvedSessionId =
							activeSessionIdRef.current ?? streamSessionId;
						if (resolvedSessionId) {
							await onWorkspaceRefresh?.(resolvedSessionId);
						}
					},
				},
			);
		} catch (streamError) {
			clearStreamingState();
			toast.error(
				streamError instanceof Error
					? streamError.message
					: "Failed to run agent.",
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
	const submitDisabled = !text.trim() || isStreaming || Boolean(disabledReason);

	return (
		<section className="mx-auto flex w-full max-w-3xl flex-col justify-end gap-5 px-2 pb-2">
			<div className="flex flex-col items-center justify-center gap-1 rounded-lg border bg-card p-1 shadow-sm">
				<PromptInput
					className="w-full rounded-lg bg-background"
					onSubmit={handleSubmit}
					globalDrop
					multiple
				>
					<PromptInputBody>
						<PromptInputTextarea
							onChange={(event) => setText(event.currentTarget.value)}
							value={text}
							placeholder="Ask Ditto to inspect the workspace..."
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
								aria-label="Submit"
								disabled={submitDisabled}
							/>
						</PromptInputTools>
					</PromptInputFooter>
				</PromptInput>
				<div className="flex w-full justify-between gap-5 px-2 text-xs text-muted-foreground">
					<div className="flex items-center gap-1">
						<GitBranchIcon className="size-3" />
						<p>master</p>
					</div>
				</div>
			</div>
		</section>
	);
}
