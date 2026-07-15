import { createFileRoute } from "@tanstack/react-router";
import { ProjectWorkspacePage } from "./project.$projectId";

export const Route = createFileRoute("/project/$projectId/session/$sessionId")({
	component: ProjectSessionRoute,
});

function ProjectSessionRoute() {
	const { projectId, sessionId } = Route.useParams();

	return <ProjectWorkspacePage projectId={projectId} sessionId={sessionId} />;
}
