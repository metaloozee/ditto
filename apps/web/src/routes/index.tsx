import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertCircleIcon,
	ArrowRightIcon,
	FolderIcon,
	LoaderIcon,
	PlusIcon,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import { NewProjectDialog } from "#/components/new-project-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import Grainient from "#/components/ui/grainient";
import { Skeleton } from "#/components/ui/skeleton";
import { useTRPC } from "#/integrations/trpc/react";
import { cn } from "#/lib/utils";
import { getSession } from "@/lib/auth.functions";

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const session = await getSession();

		if (!session) {
			return { user: null };
		}

		return { user: session.user };
	},
	component: Home,
});

function getGreeting(): string {
	const hour = new Date().getHours();
	if (hour < 12) return "Good morning";
	if (hour < 17) return "Good afternoon";
	return "Good evening";
}

function getFirstName(name: string): string {
	return name.split(" ")[0];
}

function formatStatusLabel(status: string): string {
	if (status === "provisioning") return "Setting up";
	if (status === "failed") return "Failed";
	return "Active";
}

function Home() {
	const { user } = Route.useRouteContext();
	const trpc = useTRPC();
	const projectsQuery = useQuery(
		trpc.projects.list.queryOptions(undefined, {
			enabled: Boolean(user),
		}),
	);

	const [newProjectOpen, setNewProjectOpen] = useState(false);
	const projects = projectsQuery.data ?? [];
	const greeting = getGreeting();
	const displayName = user?.name ? getFirstName(user.name) : "guest";

	return (
		<section className="px-6 py-10 sm:px-10">
			<div className="mx-auto flex max-w-3xl flex-col gap-8">
				<div className="mt-20 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
							{greeting}, {displayName}
						</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							{user
								? "Pick up where you left off, or start something new."
								: "Sign in to access your projects and continue where you left off."}
						</p>
					</div>
					<Button
						onClick={() => setNewProjectOpen(true)}
						className="cursor-pointer leading-none"
						disabled={!user}
					>
						<PlusIcon className="size-4" />
						New Project
					</Button>
				</div>

				<div className="relative overflow-hidden rounded-xl w-full">
					<Grainient
						className="absolute! rounded-xl"
						color1="#2563eb"
						color2="#2d9cd4"
						color3="#0369a1"
						timeSpeed={0.25}
						colorBalance={0}
						warpStrength={1}
						warpFrequency={5}
						warpSpeed={2}
						warpAmplitude={50}
						blendAngle={0}
						blendSoftness={0.05}
						rotationAmount={500}
						noiseScale={2}
						grainAmount={0.1}
						grainScale={2}
						grainAnimated={false}
						contrast={1.5}
						gamma={1}
						saturation={1}
						centerX={0}
						centerY={0}
						zoom={0.9}
					/>
					<div className="relative z-10 p-4">
						<ProjectsList
							projects={projects}
							isPending={projectsQuery.isPending}
							isError={projectsQuery.isError}
							error={projectsQuery.error?.message}
							user={user}
						/>
					</div>
				</div>
			</div>
			<NewProjectDialog
				open={newProjectOpen}
				onOpenChange={setNewProjectOpen}
			/>
		</section>
	);
}

function ProjectCardSkeleton() {
	return (
		<div className="flex items-center gap-4 rounded-lg bg-card px-4 py-3 ring-1 ring-foreground/10">
			<Skeleton className="size-4 shrink-0 rounded" />
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<Skeleton className="h-3.5 w-36" />
				<Skeleton className="h-3 w-24" />
			</div>
			<Skeleton className="h-5 w-14 shrink-0 rounded-full" />
		</div>
	);
}

function ProjectsList({
	projects,
	isPending,
	isError,
	error,
	user,
}: {
	projects: Array<{
		id: string;
		name: string;
		description?: string | null;
		status: "provisioning" | "ready" | "failed";
		githubRepo?: string | null;
		sessions: Array<{ id: string }>;
		createdAt?: Date | null;
	}>;
	isPending: boolean;
	isError: boolean;
	error: string | undefined;
	user: { id: string; name?: string | null; email?: string | null } | null;
}) {
	if (!user) {
		return (
			<div className="flex flex-col items-center gap-2 rounded-lg bg-card px-4 py-8 text-center ring-1 ring-foreground/10">
				<UserRound className="size-8 text-muted-foreground/50" />
				<div>
					<p className="text-sm font-medium text-foreground">
						Sign in to see your projects
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						You need to be signed in to view and manage your projects.
					</p>
				</div>
			</div>
		);
	}

	if (isPending) {
		return (
			<section
				className="flex flex-col gap-2"
				aria-busy="true"
				aria-label="Loading projects"
			>
				<ProjectCardSkeleton />
				<ProjectCardSkeleton />
				<ProjectCardSkeleton />
			</section>
		);
	}

	if (isError) {
		return (
			<div
				className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-card px-4 py-3 text-sm"
				role="alert"
			>
				<AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
				<div>
					<p className="font-medium text-destructive">
						Failed to load projects
					</p>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{error ?? "Something went wrong. Please try again."}
					</p>
				</div>
			</div>
		);
	}

	if (projects.length === 0) {
		return (
			<div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
				<p className="text-sm font-medium text-foreground">No projects yet</p>
				<p className="mt-1 text-xs text-muted-foreground">
					Create a project from the sidebar to get started.
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			{projects.map((project) => {
				const sessionCount = project.sessions.length;

				return (
					<Link
						key={project.id}
						to="/project/$projectId"
						params={{ projectId: project.id }}
						className={cn(
							"group/row flex items-center gap-4 rounded-lg bg-card px-4 py-3 ring-1 ring-foreground/10",
							"transition-colors duration-100",
							"hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						)}
					>
						{project.status === "provisioning" ? (
							<LoaderIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
						) : (
							<FolderIcon className="size-4 shrink-0 text-muted-foreground" />
						)}

						<div className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-sm font-medium">
								{project.name}
							</span>
							<span className="truncate text-xs text-muted-foreground">
								{project.description
									? project.description
									: `${sessionCount} ${sessionCount === 1 ? "conversation" : "conversations"}`}
							</span>
						</div>

						<Badge
							variant={project.status === "failed" ? "destructive" : "outline"}
							className="shrink-0"
						>
							{formatStatusLabel(project.status)}
						</Badge>

						<ArrowRightIcon
							className={cn(
								"size-3.5 shrink-0 text-muted-foreground",
								"opacity-0 transition-opacity duration-100",
								"group-hover/row:opacity-100",
							)}
						/>
					</Link>
				);
			})}
		</div>
	);
}
