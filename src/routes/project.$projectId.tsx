import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type JSX, useMemo } from "react";
import { Chat } from "#/components/ai-chat";
import { useTRPC } from "#/integrations/trpc/react";

export const Route = createFileRoute("/project/$projectId")({
	component: ProjectDetailRoute,
});

function ProjectDetailRoute(): JSX.Element {
	const { projectId } = Route.useParams();

	const conversationId = useMemo(() => crypto.randomUUID(), []);

	const trpc = useTRPC();
	const projectQuery = useQuery(
		trpc.projects.get.queryOptions({ id: projectId }, { retry: false }),
	);

	if (projectQuery.isPending) {
		return (
			<main className="flex h-dvh items-center justify-center p-6">
				<p className="text-sm text-muted-foreground">Loading project...</p>
			</main>
		);
	}

	if (projectQuery.error) {
		return (
			<main className="flex h-dvh items-center justify-center p-6">
				<p className="text-sm text-destructive" role="alert">
					{projectQuery.error.message}
				</p>
			</main>
		);
	}

	return (
		<main className="relative h-dvh overflow-hidden">
			<Chat conversationId={conversationId} />
		</main>
	);
}
