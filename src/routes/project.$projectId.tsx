import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { Chat } from "#/components/ai-chat";
import { Button } from "#/components/ui/button";
import { useWorkspaceSessionSocket } from "#/hooks/use-workspace-session-socket";
import { useTRPC } from "#/integrations/trpc/react";

export const Route = createFileRoute("/project/$projectId")({
	component: ProjectDetailRoute,
});

function ProjectDetailRoute() {
	return <Outlet />;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
	numeric: "auto",
	style: "short",
});

function formatRelativeTime(
	value: Date | string | number | null,
): string | null {
	if (!value) {
		return null;
	}

	const date = value instanceof Date ? value : new Date(value);
	const diffMs = date.getTime() - Date.now();
	if (Number.isNaN(diffMs)) {
		return null;
	}

	const absMs = Math.abs(diffMs);
	if (absMs < 60_000) {
		return "just now";
	}

	if (absMs < 3_600_000) {
		return relativeTimeFormatter.format(Math.round(diffMs / 60_000), "minute");
	}

	if (absMs < 86_400_000) {
		return relativeTimeFormatter.format(Math.round(diffMs / 3_600_000), "hour");
	}

	return relativeTimeFormatter.format(Math.round(diffMs / 86_400_000), "day");
}

export function ProjectWorkspacePage({
	projectId,
	sessionId,
}: {
	projectId: string;
	sessionId?: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const projectQuery = useQuery(
		trpc.projects.get.queryOptions({ id: projectId }, { retry: false }),
	);
	const project = projectQuery.data;
	const isWorkspaceReady =
		project?.status === "ready" && Boolean(project.sandboxId);
	const canLoadWorkspace = isWorkspaceReady || project?.status === "failed";
	const socketState = useWorkspaceSessionSocket(sessionId);
	const workspaceQuery = useQuery(
		trpc.workspace.get.queryOptions(
			{ projectId, sessionId },
			{
				enabled: canLoadWorkspace,
				refetchInterval: (query) =>
					query.state.data?.activeRun && !socketState.connected ? 1000 : false,
				retry: false,
			},
		),
	);
	const retryRestoreMutation = useMutation(
		trpc.workspace.retryRestore.mutationOptions({
			onSuccess: () => {
				void Promise.all([
					queryClient.invalidateQueries(
						trpc.workspace.get.queryFilter({ projectId, sessionId }),
					),
					queryClient.invalidateQueries(
						trpc.projects.get.queryFilter({ id: projectId }),
					),
					queryClient.invalidateQueries(trpc.projects.list.queryFilter()),
				]);
			},
		}),
	);

	useEffect(() => {
		if (!socketState.lastDoneRunId || !isWorkspaceReady) {
			return;
		}

		void Promise.all([
			queryClient.invalidateQueries(
				trpc.workspace.get.queryFilter({ projectId, sessionId }),
			),
			queryClient.invalidateQueries(trpc.projects.list.queryFilter()),
		]);
	}, [
		isWorkspaceReady,
		projectId,
		queryClient,
		sessionId,
		socketState.lastDoneRunId,
		trpc,
	]);

	if (projectQuery.isPending) {
		return (
			<main className="flex h-dvh items-center justify-center p-6">
				<p className="text-sm text-muted-foreground">Loading project...</p>
			</main>
		);
	}

	if (projectQuery.error || !project) {
		return (
			<main className="flex h-dvh items-center justify-center p-6">
				<p className="text-sm text-destructive" role="alert">
					{projectQuery.error?.message ?? "Project not found."}
				</p>
			</main>
		);
	}

	if (workspaceQuery.error && canLoadWorkspace) {
		return (
			<main className="flex h-dvh items-center justify-center p-6">
				<p className="text-sm text-destructive" role="alert">
					{workspaceQuery.error.message}
				</p>
			</main>
		);
	}

	const workspace = workspaceQuery.data;
	const selectedSession = workspace?.selectedSession ?? null;
	const activeRun = workspace?.activeRun ?? null;
	const lastCheckpoint = formatRelativeTime(
		workspace?.lastCheckpointAt ?? null,
	);
	const restoreFailed = workspace?.restoreFailed === true;
	const retryingRestore = retryRestoreMutation.isPending;
	let disabledReason: string | undefined;

	if (!isWorkspaceReady) {
		disabledReason = "Project sandbox is not ready yet.";
	} else if (retryingRestore || workspace?.restoring) {
		disabledReason = "Restoring workspace...";
	} else if (workspaceQuery.isPending) {
		disabledReason = "Checking project sandbox...";
	} else if (selectedSession?.status === "archived") {
		disabledReason = "This conversation is archived.";
	}

	return (
		<main className="h-dvh overflow-hidden bg-background">
			<div className="relative mx-auto h-full">
				{lastCheckpoint || restoreFailed || retryingRestore ? (
					<div className="absolute top-3 right-3 left-3 z-10 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm">
						<div className="min-w-0 text-muted-foreground">
							{retryingRestore || workspace?.restoring ? (
								<output>Restoring workspace...</output>
							) : restoreFailed ? (
								<span className="text-destructive" role="alert">
									Workspace restore failed
								</span>
							) : null}
							{lastCheckpoint ? (
								<span className="ml-0 sm:ml-3">
									Last checkpoint:{" "}
									<span className="tabular-nums">{lastCheckpoint}</span>
								</span>
							) : null}
						</div>
						{restoreFailed ? (
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={retryingRestore}
								onClick={() => retryRestoreMutation.mutate({ projectId })}
							>
								Retry restore
							</Button>
						) : null}
						{retryRestoreMutation.error ? (
							<p className="w-full text-destructive" role="alert">
								{retryRestoreMutation.error.message}
							</p>
						) : null}
					</div>
				) : null}
				<Chat
					projectId={projectId}
					sessionId={selectedSession?.id ?? sessionId ?? null}
					activeRunId={activeRun?.id ?? null}
					disabledReason={disabledReason}
					events={workspace?.events ?? []}
					socketState={socketState}
				/>
			</div>
		</main>
	);
}
