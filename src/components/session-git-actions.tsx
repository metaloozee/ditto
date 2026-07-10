import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequestIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";

type SessionGitActionsProps = {
	projectId: string;
	sessionId: string;
	disabled?: boolean;
	onAfterAction?: () => void;
};

export function SessionGitActions({
	projectId,
	sessionId,
	disabled = false,
	onAfterAction,
}: SessionGitActionsProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const canRun = Boolean(projectId && sessionId && !disabled);

	const statusQuery = useQuery(
		trpc.sessionGit.gitStatus.queryOptions(
			{ projectId, sessionId },
			{
				enabled: canRun,
				retry: false,
				refetchOnWindowFocus: false,
			},
		),
	);

	const invalidateStatus = () => {
		void queryClient.invalidateQueries(
			trpc.sessionGit.gitStatus.queryFilter({ projectId, sessionId }),
		);
		onAfterAction?.();
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

	const status = statusQuery.data;
	const busy =
		commitMutation.isPending ||
		pushMutation.isPending ||
		openPrMutation.isPending;

	const commitDisabled =
		!canRun || busy || !status?.dirty || statusQuery.isLoading;
	const pushDisabled =
		!canRun ||
		busy ||
		statusQuery.isLoading ||
		!status ||
		status.dirty ||
		status.ahead <= 0;
	const openPrDisabled =
		!canRun || busy || statusQuery.isLoading || !status || status.dirty;

	if (!canRun) {
		return null;
	}

	if (statusQuery.isError) {
		return (
			<output className="text-muted-foreground text-xs">
				Git export unavailable for this project.
			</output>
		);
	}

	return (
		<div className="flex flex-wrap items-center gap-2">
			{status ? (
				<output className="text-muted-foreground text-xs">
					{status.summary}
					{status.changedFiles.length > 0
						? ` (${status.changedFiles.length})`
						: ""}
				</output>
			) : null}
			<Button
				type="button"
				size="sm"
				variant="outline"
				className="h-7 text-xs"
				disabled={commitDisabled}
				aria-label="Commit session changes"
				onClick={() => commitMutation.mutate({ projectId, sessionId })}
			>
				Commit
			</Button>
			<Button
				type="button"
				size="sm"
				variant="outline"
				className="h-7 text-xs"
				disabled={pushDisabled}
				aria-label="Push session branch"
				onClick={() => pushMutation.mutate({ projectId, sessionId })}
			>
				<UploadIcon className="size-3" aria-hidden />
				Push
			</Button>
			<Button
				type="button"
				size="sm"
				variant="outline"
				className="h-7 text-xs"
				disabled={openPrDisabled}
				aria-label="Open pull request"
				onClick={() => openPrMutation.mutate({ projectId, sessionId })}
			>
				<GitPullRequestIcon className="size-3" aria-hidden />
				Open PR
			</Button>
		</div>
	);
}
