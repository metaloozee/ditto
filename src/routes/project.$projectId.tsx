import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTRPC } from "#/integrations/trpc/react";

export const Route = createFileRoute("/project/$projectId")({
	component: ProjectDetailRoute,
});

function ProjectDetailRoute() {
	const { projectId } = Route.useParams();
	const trpc = useTRPC();
	const projectQuery = useQuery(
		trpc.projects.get.queryOptions({ id: projectId }, { retry: false }),
	);

	if (projectQuery.isPending) {
		return (
			<main className="flex min-h-svh items-center justify-center p-6">
				<p className="text-sm text-muted-foreground">Loading project...</p>
			</main>
		);
	}

	if (projectQuery.error) {
		return (
			<main className="flex min-h-svh items-center justify-center p-6">
				<p className="text-sm text-destructive" role="alert">
					{projectQuery.error.message}
				</p>
			</main>
		);
	}

	const project = projectQuery.data;

	return (
		<main className="mx-auto flex min-h-svh w-full max-w-2xl px-6 py-12">
			<section className="flex w-full flex-col gap-6 rounded-xl border border-border bg-card p-6">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold text-foreground">
						{project.name}
					</h1>
					{project.description ? (
						<p className="text-sm text-muted-foreground">
							{project.description}
						</p>
					) : null}
				</div>

				<dl className="grid gap-4 text-sm sm:grid-cols-2">
					<div className="rounded-lg border border-border bg-muted/30 p-4">
						<dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Status
						</dt>
						<dd className="mt-2 text-foreground">{project.status}</dd>
					</div>

					<div className="rounded-lg border border-border bg-muted/30 p-4">
						<dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Sandbox ID
						</dt>
						<dd className="mt-2 break-all font-mono text-foreground">
							{project.sandboxId ?? "Not provisioned"}
						</dd>
					</div>

					<div className="rounded-lg border border-border bg-muted/30 p-4 sm:col-span-2">
						<dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							GitHub Repository
						</dt>
						<dd className="mt-2 break-all text-foreground">
							{project.githubRepo ?? "Scratch project"}
						</dd>
					</div>
				</dl>
			</section>
		</main>
	);
}
