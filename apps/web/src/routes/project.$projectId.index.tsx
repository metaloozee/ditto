import { createFileRoute } from "@tanstack/react-router";
import { ProjectWorkspacePage } from "./project.$projectId";

export const Route = createFileRoute("/project/$projectId/")({
	component: ProjectIndexRoute,
});

function ProjectIndexRoute() {
	const { projectId } = Route.useParams();

	return <ProjectWorkspacePage projectId={projectId} />;
}
