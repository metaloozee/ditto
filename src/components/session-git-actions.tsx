import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	FileDiffIcon,
	GitCommitHorizontalIcon,
	GitPullRequestIcon,
	LoaderCircleIcon,
	RefreshCwIcon,
	UploadIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { useTRPC } from "#/integrations/trpc/react";
import type { SessionGitStatus } from "#/lib/session-git";
import { cn } from "#/lib/utils";

type SessionGitActionsProps = {
	projectId: string;
	sessionId: string;
	disabled?: boolean;
};

type WorkflowStepId = "sync" | "commit" | "push" | "pr";

/**
 * Compact git-state capsule: icon + count.
 * Intent: glanceable pending work — not a status sentence.
 */
function GitCountCapsule({
	count,
	icon,
	ariaLabel,
	tooltip,
	tone = "neutral",
}: {
	count: number;
	icon: ReactNode;
	ariaLabel: string;
	tooltip: ReactNode;
	tone?: "neutral" | "pending" | "ready";
}) {
	if (count <= 0) {
		return null;
	}

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						aria-label={ariaLabel}
						className={cn(
							"inline-flex h-6 max-w-full cursor-default items-center gap-1 rounded-full border px-2 font-medium text-[11px] tabular-nums transition-colors duration-150",
							"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
							"active:scale-[0.97]",
							tone === "pending" &&
								"border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
							tone === "ready" &&
								"border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-400",
							tone === "neutral" &&
								"border-border bg-muted/50 text-muted-foreground",
						)}
					>
						<span className="shrink-0 [&_svg]:size-3" aria-hidden>
							{icon}
						</span>
						<span className="min-w-[0.75rem] text-center">{count}</span>
					</button>
				}
			/>
			<TooltipContent side="top" className="max-w-xs">
				{tooltip}
			</TooltipContent>
		</Tooltip>
	);
}

function StatusTooltipBody({
	summary,
	files,
}: {
	summary: string;
	files: string[];
}) {
	const preview = files.slice(0, 6);
	const remaining = files.length - preview.length;

	return (
		<div className="flex flex-col gap-1.5 text-left">
			<p className="font-medium text-[11px] leading-snug">{summary}</p>
			{preview.length > 0 ? (
				<ul className="flex flex-col gap-0.5 border-background/15 border-t pt-1.5 font-mono text-[10px] opacity-90">
					{preview.map((file) => (
						<li key={file} className="truncate" title={file}>
							{file}
						</li>
					))}
					{remaining > 0 ? (
						<li className="opacity-70">+{remaining} more</li>
					) : null}
				</ul>
			) : null}
		</div>
	);
}

/**
 * One step in the Commit → Push → PR pipeline.
 * Grouped as a single segmented control; only the next step is filled (primary).
 */
function WorkflowStep({
	label,
	icon,
	disabled,
	active,
	pending,
	tooltip,
	onClick,
	isLast = false,
}: {
	label: string;
	icon: ReactNode;
	disabled: boolean;
	/** True when this is the recommended next action in the pipeline. */
	active: boolean;
	pending: boolean;
	tooltip: string;
	onClick: () => void;
	isLast?: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						disabled={disabled || pending}
						aria-label={label}
						title={tooltip}
						aria-current={active ? "step" : undefined}
						onClick={onClick}
						className={cn(
							"inline-flex h-6 min-w-0 cursor-pointer items-center gap-1 px-2 font-medium text-[11px] transition-[background-color,color,opacity,transform] duration-150 ease-out",
							"focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
							"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
							"active:enabled:scale-[0.97]",
							!isLast && "border-border/70 border-r",
							active
								? "bg-primary text-primary-foreground hover:bg-primary/90"
								: "bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground",
						)}
					>
						<span className="shrink-0 [&_svg]:size-3" aria-hidden>
							{pending ? <LoaderCircleIcon className="animate-spin" /> : icon}
						</span>
						<span className="truncate">{label}</span>
					</button>
				}
			/>
			<TooltipContent side="top">{tooltip}</TooltipContent>
		</Tooltip>
	);
}

function SessionGitActionsView({
	status,
	statusLoading,
	canRun,
	busy,
	pendingStep,
	onSync,
	onCommit,
	onPush,
	onOpenPullRequest,
}: {
	status: SessionGitStatus | undefined;
	statusLoading: boolean;
	canRun: boolean;
	busy: boolean;
	pendingStep: WorkflowStepId | null;
	onSync: () => void;
	onCommit: () => void;
	onPush: () => void;
	onOpenPullRequest: () => void;
}) {
	const workflow = status?.workflow;
	const dirty = status?.dirty ?? false;
	const aheadCount = status?.ahead ?? 0;
	const changedCount = status?.changedFiles.length ?? 0;
	const syncDisabled =
		!canRun || busy || statusLoading || workflow?.kind !== "sync";
	const commitDisabled = !canRun || busy || !dirty || statusLoading;
	const pushDisabled =
		!canRun || busy || statusLoading || !status || workflow?.kind !== "push";
	const existingPullRequest =
		workflow?.kind === "open-pr-existing" ||
		workflow?.kind === "closed-pr" ||
		workflow?.kind === "merged-pr"
			? workflow.pullRequest
			: null;
	const canOpenPullRequest =
		workflow?.kind === "open-pr" || workflow?.kind === "push";
	const openPrDisabled =
		!canRun ||
		busy ||
		statusLoading ||
		!status ||
		(!existingPullRequest && !canOpenPullRequest);
	const viewPrDisabled = !canRun || busy || statusLoading;
	const nextStep: WorkflowStepId | null =
		workflow?.kind === "sync"
			? "sync"
			: workflow?.kind === "commit"
				? "commit"
				: workflow?.kind === "push"
					? "push"
					: workflow?.kind === "open-pr"
						? "pr"
						: null;

	const syncLabel = "Sync";
	const syncTooltip =
		workflow?.kind === "sync"
			? `Merge the latest ${workflow.baseBranch} into this session`
			: "Session already includes the latest base branch";
	const commitTooltip = commitDisabled
		? dirty
			? "Working…"
			: "No uncommitted changes"
		: "Commit local changes on this session branch";
	const pushTooltip =
		workflow?.kind === "push" && workflow.reason === "remote-branch-missing"
			? "Restore deleted branch on GitHub"
			: pushDisabled
				? dirty
					? "Commit changes before pushing"
					: aheadCount <= 0
						? "Branch is up to date with remote"
						: "Working…"
				: `Push ${aheadCount} ${aheadCount === 1 ? "commit" : "commits"} to GitHub`;
	const prLabel =
		workflow?.kind === "merged-pr"
			? `Merged #${workflow.pullRequest.number}`
			: workflow?.kind === "closed-pr"
				? `Closed #${workflow.pullRequest.number}`
				: existingPullRequest
					? `#${existingPullRequest.number}`
					: "Open PR";
	const prTooltip =
		workflow?.kind === "merged-pr"
			? "View merged pull request on GitHub"
			: workflow?.kind === "closed-pr"
				? "View closed pull request on GitHub"
				: existingPullRequest
					? "Open pull request on GitHub"
					: openPrDisabled
						? workflow?.kind === "idle"
							? "No session changes to open as a pull request"
							: workflow?.kind === "unavailable"
								? "GitHub status is currently unavailable"
								: dirty
									? "Commit changes before opening a PR"
									: "Working…"
						: workflow?.kind === "push"
							? "Push branch and open a pull request"
							: "Open a pull request for this branch";

	return (
		<TooltipProvider delay={200}>
			<div className="flex flex-wrap items-center justify-end gap-2">
				{status ? (
					<div className="flex items-center gap-1">
						<GitCountCapsule
							count={changedCount}
							icon={<FileDiffIcon />}
							ariaLabel={`${changedCount} changed ${changedCount === 1 ? "file" : "files"}`}
							tone="pending"
							tooltip={
								<StatusTooltipBody
									summary={status.summary}
									files={status.changedFiles}
								/>
							}
						/>
						{!dirty ? (
							<GitCountCapsule
								count={aheadCount}
								icon={<GitCommitHorizontalIcon />}
								ariaLabel={`${aheadCount} ${aheadCount === 1 ? "commit" : "commits"} ahead`}
								tone="ready"
								tooltip={
									<StatusTooltipBody summary={status.summary} files={[]} />
								}
							/>
						) : null}
					</div>
				) : null}

				<fieldset className="m-0 inline-flex h-6 items-stretch overflow-hidden rounded-md border border-border bg-background/60 p-0 shadow-xs">
					<legend className="sr-only">Session git workflow</legend>
					<WorkflowStep
						label={syncLabel}
						icon={<RefreshCwIcon />}
						disabled={syncDisabled}
						active={nextStep === "sync"}
						pending={pendingStep === "sync"}
						tooltip={syncTooltip}
						onClick={onSync}
					/>
					<WorkflowStep
						label="Commit"
						icon={<GitCommitHorizontalIcon />}
						disabled={commitDisabled}
						active={nextStep === "commit"}
						pending={pendingStep === "commit"}
						tooltip={commitTooltip}
						onClick={onCommit}
					/>
					<WorkflowStep
						label="Push"
						icon={<UploadIcon />}
						disabled={pushDisabled}
						active={nextStep === "push"}
						pending={pendingStep === "push"}
						tooltip={pushTooltip}
						onClick={onPush}
					/>
					<WorkflowStep
						label={prLabel}
						icon={<GitPullRequestIcon />}
						disabled={existingPullRequest ? viewPrDisabled : openPrDisabled}
						active={nextStep === "pr"}
						pending={pendingStep === "pr"}
						tooltip={prTooltip}
						isLast
						onClick={() => {
							if (existingPullRequest) {
								window.open(existingPullRequest.url, "_blank", "noopener");
								return;
							}
							onOpenPullRequest();
						}}
					/>
				</fieldset>
			</div>
		</TooltipProvider>
	);
}

export function SessionGitActions({
	projectId,
	sessionId,
	disabled = false,
}: SessionGitActionsProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const hasIds = Boolean(projectId && sessionId);
	const canRun = hasIds && !disabled;

	const {
		data: status,
		isError: statusError,
		isLoading,
	} = useQuery(
		trpc.sessionGit.gitStatus.queryOptions(
			{ projectId, sessionId },
			{
				enabled: hasIds,
				retry: false,
				refetchOnWindowFocus: true,
				placeholderData: (previous) => previous,
			},
		),
	);

	const invalidateStatus = () => {
		void queryClient.invalidateQueries(
			trpc.sessionGit.gitStatus.queryFilter({ projectId, sessionId }),
		);
	};

	const commitMutation = useMutation(
		trpc.sessionGit.commit.mutationOptions({
			onSuccess: (result) => {
				if (result.committed) {
					toast.success("Changes committed.");
				} else {
					toast.message("Nothing to commit.");
				}
				invalidateStatus();
			},
			onError: (error) => {
				toast.error(error.message);
			},
		}),
	);

	const syncMutation = useMutation(
		trpc.sessionGit.sync.mutationOptions({
			onSuccess: (result) => {
				toast.success(`Session synced with ${result.baseBranch}.`);
				invalidateStatus();
			},
			onError: (error) => {
				toast.error(error.message);
			},
		}),
	);

	const pushMutation = useMutation(
		trpc.sessionGit.push.mutationOptions({
			onSuccess: () => {
				toast.success("Branch pushed to GitHub.");
				invalidateStatus();
			},
			onError: (error) => {
				toast.error(error.message);
			},
		}),
	);

	const openPrMutation = useMutation(
		trpc.sessionGit.openPullRequest.mutationOptions({
			onSuccess: (result) => {
				queryClient.setQueryData(
					trpc.sessionGit.gitStatus.queryOptions({ projectId, sessionId })
						.queryKey,
					(previous) =>
						previous
							? {
									...previous,
									ahead: 0,
									remoteBranchExists: true,
									pullRequest: {
										url: result.url,
										number: result.number,
										state: "open" as const,
									},
									workflow: {
										kind: "open-pr-existing" as const,
										pullRequest: {
											url: result.url,
											number: result.number,
											state: "open" as const,
										},
									},
								}
							: previous,
				);
				toast.success("Pull request opened.", {
					action: {
						label: "View",
						onClick: () => window.open(result.url, "_blank", "noopener"),
					},
				});
				invalidateStatus();
			},
			onError: (error) => {
				toast.error(error.message);
			},
		}),
	);

	const statusLoading = isLoading && !status;
	const busy =
		syncMutation.isPending ||
		commitMutation.isPending ||
		pushMutation.isPending ||
		openPrMutation.isPending;

	if (!hasIds) {
		return null;
	}

	if (statusError && !status) {
		return (
			<span className="text-muted-foreground text-[11px]">Git unavailable</span>
		);
	}

	return (
		<SessionGitActionsView
			status={status}
			statusLoading={statusLoading}
			canRun={canRun}
			busy={busy}
			pendingStep={
				syncMutation.isPending
					? "sync"
					: commitMutation.isPending
						? "commit"
						: pushMutation.isPending
							? "push"
							: openPrMutation.isPending
								? "pr"
								: null
			}
			onSync={() => syncMutation.mutate({ projectId, sessionId })}
			onCommit={() => commitMutation.mutate({ projectId, sessionId })}
			onPush={() => pushMutation.mutate({ projectId, sessionId })}
			onOpenPullRequest={() => openPrMutation.mutate({ projectId, sessionId })}
		/>
	);
}
