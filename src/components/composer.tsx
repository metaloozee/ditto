import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, GitBranchIcon, MicIcon } from "lucide-react";
import { type Dispatch, type SetStateAction, useRef, useState } from "react";
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
import { SessionGitActions } from "#/components/session-git-actions";
import {
	PROJECT_CODER_MODELS,
	type ProjectCoderModelSpecifier,
} from "#/lib/agent-models";
import {
	type AssistantMessagePart,
	appendAssistantTextDelta,
	applyAgentToolEventToParts,
	type DonePayload,
	finalizeAssistantParts,
	partsToText,
	partsToTools,
	type StreamToolCall,
	streamAgentRun,
} from "#/lib/agent-stream-client";
import { useUserPreferencesStore } from "#/lib/user-preferences-store";

const models = PROJECT_CODER_MODELS.map((model) => ({
	chef: model.providerName,
	chefSlug: model.provider,
	id: model.id,
	name: model.name,
	providers: [model.provider],
})) satisfies Model[];

const modelsByChef = new Map<string, Model[]>();
for (const modelOption of models) {
	const group = modelsByChef.get(modelOption.chef);
	if (group) {
		group.push(modelOption);
	} else {
		modelsByChef.set(modelOption.chef, [modelOption]);
	}
}

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

function ModelItem({ model, onSelect, selectedModel }: ModelItemProps) {
	return (
		<ModelSelectorItem onSelect={() => onSelect(model.id)} value={model.id}>
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
}

export type ComposerStreamingState = {
	active: boolean;
	text: string;
	userText: string;
	userMessageId?: string;
	assistantMessageId?: string;
	tools: StreamToolCall[];
	parts: AssistantMessagePart[];
	model?: string;
};

export type StreamCommitPayload = {
	sessionId: string;
	createdSession: boolean;
	user: {
		id: string;
		role: "user";
		content: string;
	};
	assistant: {
		id: string;
		role: "assistant";
		content: string;
		model?: string | null;
		tools?: StreamToolCall[];
		parts?: AssistantMessagePart[];
	};
};

type ComposerProps = {
	projectId?: string;
	sessionId?: string | null;
	branchName?: string | null;
	gitExportEnabled?: boolean;
	disabledReason?: string;
	onStreamingChange?: Dispatch<SetStateAction<ComposerStreamingState | null>>;
	onStreamCommit?: (payload: StreamCommitPayload) => void;
	onWorkspaceRefresh?: (sessionId: string) => void;
};

export function Composer({
	projectId,
	sessionId,
	branchName,
	gitExportEnabled = false,
	disabledReason,
	onStreamingChange,
	onStreamCommit,
	onWorkspaceRefresh,
}: ComposerProps) {
	const [text, setText] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const activeSessionIdRef = useRef<string | null>(sessionId ?? null);
	const shouldNavigateToSessionRef = useRef(false);
	const streamSettledRef = useRef(false);
	const isStreamingRef = useRef(false);
	const userMessageIdRef = useRef<string | null>(null);
	const assistantMessageIdRef = useRef<string | null>(null);
	const partsRef = useRef<AssistantMessagePart[]>([]);
	const promptRef = useRef("");
	const assistantTextRef = useRef("");
	const model = useUserPreferencesStore((state) => state.selectedModel);
	const setModel = useUserPreferencesStore((state) => state.setSelectedModel);
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
	const navigate = useNavigate();

	function clearStreamingState(): void {
		isStreamingRef.current = false;
		setIsStreaming(false);
		onStreamingChange?.(null);
	}

	function emptyStreaming(prompt: string): ComposerStreamingState {
		return {
			active: true,
			text: "",
			userText: prompt,
			tools: [],
			parts: [],
			model,
		};
	}

	function settleAfterStream(
		resolvedSessionId: string | undefined,
		done?: DonePayload,
	): void {
		if (streamSettledRef.current) {
			return;
		}
		streamSettledRef.current = true;

		const session = resolvedSessionId ?? activeSessionIdRef.current;
		const userMessageId = userMessageIdRef.current;
		const assistantMessageId =
			done?.assistantMessageId ?? assistantMessageIdRef.current;
		const sourceParts =
			partsRef.current.length > 0
				? partsRef.current
				: done?.parts && done.parts.length > 0
					? done.parts
					: [];
		const finalParts = finalizeAssistantParts(sourceParts);
		const assistantContent =
			(done?.content && done.content.length > 0
				? done.content
				: partsToText(finalParts) || assistantTextRef.current) || "";

		if (session && userMessageId && assistantMessageId) {
			onStreamCommit?.({
				sessionId: session,
				createdSession: shouldNavigateToSessionRef.current,
				user: {
					id: userMessageId,
					role: "user",
					content: promptRef.current,
				},
				assistant: {
					id: assistantMessageId,
					role: "assistant",
					content: assistantContent,
					model,
					tools: partsToTools(finalParts),
					parts: finalParts,
				},
			});
			if (done?.ok !== false) {
				onWorkspaceRefresh?.(session);
			}
		}

		if (done && done.ok === false && !assistantContent.trim()) {
			// error toast already fired from onError when present
		} else if (!done && !assistantContent.trim()) {
			toast.error("Agent stream ended before a response was received.");
		}

		clearStreamingState();

		if (shouldNavigateToSessionRef.current && projectId && session) {
			shouldNavigateToSessionRef.current = false;
			void navigate({
				to: "/project/$projectId/session/$sessionId",
				params: { projectId, sessionId: session },
			});
		}
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
		isStreamingRef.current = true;
		setIsStreaming(true);
		promptRef.current = prompt;
		assistantTextRef.current = "";
		partsRef.current = [];
		userMessageIdRef.current = null;
		assistantMessageIdRef.current = null;
		onStreamingChange?.(emptyStreaming(prompt));
		shouldNavigateToSessionRef.current = false;
		streamSettledRef.current = false;
		activeSessionIdRef.current = sessionId ?? null;

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
					onMeta: (meta) => {
						streamSessionId = meta.sessionId;
						activeSessionIdRef.current = meta.sessionId;
						userMessageIdRef.current = meta.userMessageId;
						assistantMessageIdRef.current = meta.assistantMessageId;
						if (meta.createdSession) {
							shouldNavigateToSessionRef.current = true;
						}
						onStreamingChange?.((previous) => {
							const base = previous ?? emptyStreaming(prompt);
							return {
								...base,
								active: true,
								userMessageId: meta.userMessageId,
								assistantMessageId: meta.assistantMessageId,
								model,
							};
						});
					},
					onDelta: (delta) => {
						assistantTextRef.current += delta;
						partsRef.current = appendAssistantTextDelta(
							partsRef.current,
							delta,
						);
						const nextParts = partsRef.current;
						onStreamingChange?.((previous) => {
							const base = previous ?? emptyStreaming(prompt);
							return {
								...base,
								active: true,
								text: partsToText(nextParts),
								parts: nextParts,
								tools: partsToTools(nextParts),
							};
						});
					},
					onAgent: (event) => {
						const nextParts = applyAgentToolEventToParts(
							partsRef.current,
							event,
						);
						if (!nextParts) {
							return;
						}
						partsRef.current = nextParts;
						onStreamingChange?.((previous) => {
							const base = previous ?? emptyStreaming(prompt);
							return {
								...base,
								active: true,
								parts: nextParts,
								tools: partsToTools(nextParts),
								text: partsToText(nextParts),
							};
						});
					},
					onError: (errorMessage) => {
						toast.error(errorMessage);
					},
					onDone: (done) => {
						const resolvedSessionId =
							activeSessionIdRef.current ?? streamSessionId;
						settleAfterStream(resolvedSessionId, done);
					},
				},
			);

			if (!streamSettledRef.current) {
				const resolvedSessionId = activeSessionIdRef.current ?? streamSessionId;
				settleAfterStream(resolvedSessionId);
			} else if (isStreamingRef.current) {
				clearStreamingState();
			}
		} catch (streamError) {
			clearStreamingState();
			toast.error(
				streamError instanceof Error
					? streamError.message
					: "Failed to run agent.",
			);
		}
	}

	function handleModelSelect(id: ProjectCoderModelSpecifier): void {
		setModel(id);
		setModelSelectorOpen(false);
	}

	const selectedModel = models.find((modelOption) => modelOption.id === model);
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
									{[...modelsByChef.entries()].map(([chef, chefModels]) => (
										<ModelSelectorGroup heading={chef} key={chef}>
											{chefModels.map((modelOption) => (
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
				<div className="flex w-full flex-wrap items-center justify-between gap-2 px-2 py-0.5 text-muted-foreground">
					<div className="flex min-w-0 items-center gap-1.5 text-[11px]">
						<GitBranchIcon className="size-3 shrink-0" aria-hidden />
						<p
							className="truncate font-medium"
							title={branchName?.trim() || undefined}
						>
							{branchName?.trim() || "—"}
						</p>
					</div>
					{gitExportEnabled && projectId && sessionId ? (
						<SessionGitActions
							projectId={projectId}
							sessionId={sessionId}
							disabled={Boolean(disabledReason) || isStreaming}
							onAfterAction={() => onWorkspaceRefresh?.(sessionId)}
						/>
					) : null}
				</div>
			</div>
		</section>
	);
}
