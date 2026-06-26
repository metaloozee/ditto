import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Chat } from "#/components/ai-chat";
import { useTRPC } from "#/integrations/trpc/react";

export const Route = createFileRoute("/project/$projectId")({
	component: ProjectDetailRoute,
});

function ProjectDetailRoute() {
	const { projectId } = Route.useParams();

	return <ProjectWorkspacePage projectId={projectId} />;
}

type ProjectWorkspacePageProps = {
	projectId: string;
	sessionId?: string;
};

export function ProjectWorkspacePage({
	projectId,
	sessionId,
}: ProjectWorkspacePageProps) {
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
			{ enabled: isWorkspaceReady, retry: false },
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
	const disabledReason = !isWorkspaceReady
		? "Project sandbox is not ready yet."
		: selectedSession?.status === "archived"
			? "This conversation is archived."
			: undefined;

	return (
		<main className="h-dvh overflow-hidden bg-background">
			<div className="mx-auto h-full max-w-3xl">
				<Chat
					projectId={projectId}
					sessionId={selectedSession?.id ?? null}
					activeRunId={activeRun?.id ?? null}
					disabledReason={disabledReason}
				/>
			</div>
		</main>
	);
}
