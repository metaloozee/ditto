import { createFileRoute } from "@tanstack/react-router";
import { ProjectWorkspacePage } from "./project.$projectId";

export const Route = createFileRoute("/project/$projectId/")({
	head: () => ({
		meta: [
			{ title: "New Session · Ditto" },
			{
				name: "description",
				content: "Create a new session for your project in Ditto.",
			},
		],
	}),
	component: ProjectIndexRoute,
});

function ProjectIndexRoute() {
	const { projectId } = Route.useParams();

	return <ProjectWorkspacePage projectId={projectId} />;
}
