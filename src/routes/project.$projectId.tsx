import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Chat } from "#/components/ai-chat";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";

export const Route = createFileRoute("/project/$projectId")({
	component: ProjectDetailRoute,
});

function ProjectDetailRoute() {
	return <Outlet />;
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
	const canLoadWorkspace =
		project?.status === "ready" || project?.status === "failed";
	const workspaceQuery = useQuery(
		trpc.workspace.get.queryOptions(
			{ projectId, sessionId },
			{
				enabled: canLoadWorkspace,
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
	const disabledReason =
		project.status !== "ready"
			? "Project sandbox is not ready yet."
			: selectedSession?.status === "archived"
				? "This conversation is archived."
				: workspaceQuery.isPending
					? "Checking project sandbox..."
					: undefined;

	return (
		<main className="h-dvh overflow-hidden bg-background">
			<div className="relative mx-auto h-full">
				{workspace?.restoreFailed ? (
					<div className="absolute top-3 right-3 left-3 z-10 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm">
						<div className="min-w-0 text-muted-foreground">
							<span className="text-destructive" role="alert">
								Workspace restore failed
							</span>
						</div>
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={retryRestoreMutation.isPending}
							onClick={() => retryRestoreMutation.mutate({ projectId })}
						>
							Retry restore
						</Button>
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
					disabledReason={disabledReason}
					messages={workspace?.messages ?? []}
				/>
			</div>
		</main>
	);
}
