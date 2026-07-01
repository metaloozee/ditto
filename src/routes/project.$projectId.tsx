import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Chat } from "#/components/ai-chat";
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
	const projectQuery = useQuery(
		trpc.projects.get.queryOptions({ id: projectId }, { retry: false }),
	);
	const project = projectQuery.data;
	const isWorkspaceReady =
		project?.status === "ready" && Boolean(project.sandboxId);
	const workspaceQuery = useQuery(
		trpc.workspace.get.queryOptions(
			{ projectId, sessionId },
			{
				enabled: isWorkspaceReady,
				refetchInterval: (query) =>
					query.state.data?.activeRun ? 1000 : false,
				retry: false,
			},
		),
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

	if (workspaceQuery.error && isWorkspaceReady) {
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
	let disabledReason: string | undefined;

	if (!isWorkspaceReady) {
		disabledReason = "Project sandbox is not ready yet.";
	} else if (workspaceQuery.isPending) {
		disabledReason = "Checking project sandbox...";
	} else if (selectedSession?.status === "archived") {
		disabledReason = "This conversation is archived.";
	}

	return (
		<main className="h-dvh overflow-hidden bg-background">
			<div className="mx-auto h-full">
				<Chat
					projectId={projectId}
					sessionId={selectedSession?.id ?? sessionId ?? null}
					activeRunId={activeRun?.id ?? null}
					disabledReason={disabledReason}
					events={workspace?.events ?? []}
				/>
			</div>
		</main>
	);
}
