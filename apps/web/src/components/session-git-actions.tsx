import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronDownIcon,
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
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
	children?: ReactNode;
};

type WorkflowStepId = "sync" | "commit" | "push" | "pr";

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
							"inline-flex h-6 max-w-full cursor-default items-center gap-1 rounded-md border px-2 font-medium text-xs tabular-nums",
							"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
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
						<span className="min-w-3 text-center">{count}</span>
					</button>
				}
			/>
			<TooltipContent side="bottom" className="max-w-xs">
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
			<p className="text-xs font-medium leading-snug text-pretty">{summary}</p>
			{preview.length > 0 ? (
				<ul className="flex flex-col gap-0.5 border-background/15 border-t pt-1.5 font-mono text-xs opacity-90">
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

function SessionGitActionsView({
	status,
	statusLoading,
	canRun,
	isPending,
	pendingStep,
	onSync,
	onCommit,
	onPush,
	onOpenPullRequest,
	children,
}: {
	status: SessionGitStatus | undefined;
	statusLoading: boolean;
	canRun: boolean;
	isPending: boolean;
	pendingStep: WorkflowStepId | null;
	onSync: () => void;
	onCommit: () => void;
	onPush: () => void;
	onOpenPullRequest: () => void;
	children?: ReactNode;
}) {
	const workflow = status?.workflow;
	const dirty = status?.dirty ?? false;
	const aheadCount = status?.ahead ?? 0;
	const changedCount = status?.changedFiles.length ?? 0;
	const syncDisabled =
		!canRun || isPending || statusLoading || workflow?.kind !== "sync";
	const commitDisabled = !canRun || isPending || !dirty || statusLoading;
	const pushDisabled =
		!canRun ||
		isPending ||
		statusLoading ||
		!status ||
		workflow?.kind !== "push";
	const pullRequestFromWorkflow =
		workflow?.kind === "open-pr-existing" ||
		workflow?.kind === "closed-pr" ||
		workflow?.kind === "merged-pr"
			? workflow.pullRequest
			: null;
	const pullRequest = pullRequestFromWorkflow ?? status?.pullRequest ?? null;
	const canOpenPullRequest =
		workflow?.kind === "open-pr" || workflow?.kind === "push";
	const openPrDisabled =
		!canRun ||
		isPending ||
		statusLoading ||
		!status ||
		(!pullRequest && !canOpenPullRequest);
	const viewPrDisabled = !canRun || isPending || statusLoading;
	const prDisabled = pullRequest ? viewPrDisabled : openPrDisabled;
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
	const primaryStep: WorkflowStepId | null =
		nextStep ?? (pullRequest ? "pr" : null);

	const syncLabel = "Sync";
	const syncTooltip =
		workflow?.kind === "sync"
			? `Merge the latest ${workflow.baseBranch} into this session`
			: "Session already includes the latest base branch";
	const commitTooltip =
		pendingStep === "commit"
			? "Drafting and committing…"
			: commitDisabled
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
				: pullRequest
					? "View PR"
					: "Open PR";
	const prTooltip =
		pendingStep === "pr"
			? "Drafting and opening pull request…"
			: workflow?.kind === "merged-pr"
				? "View merged pull request on GitHub"
				: workflow?.kind === "closed-pr"
					? "View closed pull request on GitHub"
					: pullRequest
						? `View pull request #${pullRequest.number} on GitHub`
						: openPrDisabled
							? workflow?.kind === "idle"
								? "No session changes to open as a pull request"
								: workflow?.kind === "unavailable"
									? workflow.reason === "worktree"
										? "Session worktree is not ready."
										: "GitHub status is currently unavailable"
									: dirty
										? "Commit changes before opening a PR"
										: "Working…"
							: workflow?.kind === "push"
								? "Push branch and open a pull request"
								: "Open a pull request for this branch";

	function handlePrAction(): void {
		if (pullRequest) {
			window.open(pullRequest.url, "_blank", "noopener");
			return;
		}
		onOpenPullRequest();
	}

	const actions: Array<{
		id: WorkflowStepId;
		label: string;
		icon: ReactNode;
		disabled: boolean;
		tooltip: string;
		onSelect: () => void;
	}> = [
		{
			id: "sync",
			label: syncLabel,
			icon: <RefreshCwIcon />,
			disabled: syncDisabled,
			tooltip: syncTooltip,
			onSelect: onSync,
		},
		{
			id: "commit",
			label: "Commit",
			icon: <GitCommitHorizontalIcon />,
			disabled: commitDisabled,
			tooltip: commitTooltip,
			onSelect: onCommit,
		},
		{
			id: "push",
			label: "Push",
			icon: <UploadIcon />,
			disabled: pushDisabled,
			tooltip: pushTooltip,
			onSelect: onPush,
		},
		{
			id: "pr",
			label: prLabel,
			icon: <GitPullRequestIcon />,
			disabled: prDisabled,
			tooltip: prTooltip,
			onSelect: handlePrAction,
		},
	];

	const primary = primaryStep
		? (actions.find((action) => action.id === primaryStep) ?? null)
		: null;
	const primaryDisabled =
		statusLoading || !primary || primary.disabled || isPending;
	const primaryPending = primaryStep !== null && pendingStep === primaryStep;
	const primaryLabel = statusLoading
		? "Loading Git status"
		: pendingStep === "commit"
			? "Drafting and committing…"
			: pendingStep === "pr"
				? "Drafting and opening pull request…"
				: (primary?.label ?? "Up to date");
	const primaryTooltip = statusLoading
		? "Loading Git status"
		: pendingStep === "commit"
			? "Drafting and committing…"
			: pendingStep === "pr"
				? "Drafting and opening pull request…"
				: (primary?.tooltip ?? "No git action needed");
	const hasActivePrimary =
		!statusLoading && Boolean(primary && !primary.disabled);

	return (
		<TooltipProvider delay={200}>
			<div className="flex w-full min-w-0 items-center gap-2">
				<div className="min-w-0 flex-1">{children}</div>

				<div className="flex shrink-0 items-center gap-1.5">
					{status ? (
						<>
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
						</>
					) : null}

					<fieldset
						aria-label="Session git workflow"
						className="m-0 inline-flex h-6 shrink-0 items-stretch divide-x divide-border overflow-hidden rounded-md border border-border bg-secondary p-0 text-secondary-foreground shadow-xs"
					>
						<Tooltip>
							<TooltipTrigger
								render={
									<button
										type="button"
										disabled={isPending || primaryDisabled || primaryPending}
										aria-busy={isPending || primaryPending || undefined}
										aria-label={primaryLabel}
										aria-current={hasActivePrimary ? "step" : undefined}
										title={primaryTooltip}
										onClick={() => primary?.onSelect()}
										className={cn(
											"inline-flex cursor-pointer items-center gap-1 px-2.5 font-medium text-xs whitespace-nowrap",
											"focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
											"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
											hasActivePrimary
												? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
												: "bg-transparent text-muted-foreground hover:bg-muted/80",
										)}
									>
										<span className="shrink-0 [&_svg]:size-3" aria-hidden>
											{isPending || statusLoading || primaryPending ? (
												<LoaderCircleIcon className="animate-spin" />
											) : (
												(primary?.icon ?? <GitCommitHorizontalIcon />)
											)}
										</span>
										<span>
											{isPending || primaryPending
												? primaryLabel
												: primaryLabel}
										</span>
									</button>
								}
							/>
							<TooltipContent side="bottom">{primaryTooltip}</TooltipContent>
						</Tooltip>

						<DropdownMenu>
							<DropdownMenuTrigger
								disabled={isPending || statusLoading}
								aria-label="Choose git action"
								className={cn(
									"inline-flex w-6 cursor-pointer items-center justify-center",
									"focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
									"disabled:pointer-events-none disabled:opacity-40",
									hasActivePrimary
										? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
										: "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							>
								<ChevronDownIcon className="size-3" aria-hidden />
							</DropdownMenuTrigger>
							<DropdownMenuContent
								sideOffset={10}
								align="end"
								className="min-w-40"
							>
								<DropdownMenuGroup>
									{actions.map((action) => (
										<DropdownMenuItem
											key={action.id}
											disabled={action.disabled || isPending || statusLoading}
											onClick={action.onSelect}
											className="cursor-pointer"
										>
											<span className="shrink-0 [&_svg]:size-3.5" aria-hidden>
												{pendingStep === action.id ? (
													<LoaderCircleIcon className="animate-spin" />
												) : (
													action.icon
												)}
											</span>
											<span className="min-w-0 flex-1 truncate">
												{action.label}
											</span>
											{action.id === primaryStep ? (
												<span className="text-muted-foreground text-xs">
													Next
												</span>
											) : null}
										</DropdownMenuItem>
									))}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</fieldset>
				</div>
			</div>
		</TooltipProvider>
	);
}

export function SessionGitActions({
	projectId,
	sessionId,
	disabled = false,
	children,
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
					const message =
						"message" in result && typeof result.message === "string"
							? result.message
							: undefined;
					toast.success(
						message ? `Changes committed: ${message}` : "Changes committed.",
					);
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
	const isPending =
		syncMutation.isPending ||
		commitMutation.isPending ||
		pushMutation.isPending ||
		openPrMutation.isPending;

	if (!hasIds) {
		return null;
	}

	if (statusError && !status) {
		return (
			<div className="flex w-full min-w-0 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-1.5">{children}</div>
				<span className="shrink-0 text-xs text-muted-foreground">
					Git unavailable
				</span>
			</div>
		);
	}

	if (!status && !statusLoading) {
		return (
			<div className="flex w-full min-w-0 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-1.5">{children}</div>
				<span className="shrink-0 text-xs text-muted-foreground">
					Nothing found
				</span>
			</div>
		);
	}

	return (
		<>
			<span className="sr-only" aria-live="polite">
				{isPending ? "Git action in progress" : ""}
			</span>
			<button
				type="button"
				className="sr-only"
				tabIndex={-1}
				disabled={isPending}
				aria-busy={isPending || undefined}
			>
				{isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
				{isPending ? "Working…" : "Ready"}
			</button>
			<SessionGitActionsView
				status={status}
				statusLoading={statusLoading}
				canRun={canRun}
				isPending={isPending}
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
				onOpenPullRequest={() =>
					openPrMutation.mutate({ projectId, sessionId })
				}
			>
				{children}
			</SessionGitActionsView>
		</>
	);
}
