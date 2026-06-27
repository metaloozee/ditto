import { createTRPCRouter } from "#/integrations/trpc/init";
import { githubRouter } from "#/integrations/trpc/routers/github";
import { healthRouter } from "#/integrations/trpc/routers/health";
import { projectsRouter } from "#/integrations/trpc/routers/projects";
import { workspaceRouter } from "#/integrations/trpc/routers/workspace";

export const trpcRouter = createTRPCRouter({
	health: healthRouter,
	github: githubRouter,
	projects: projectsRouter,
	workspace: workspaceRouter,
});
export type TRPCRouter = typeof trpcRouter;
