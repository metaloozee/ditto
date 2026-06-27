"use client";

import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
	FileTextIcon,
	FolderIcon,
	FolderOpenIcon,
	Layers2Icon,
	PlusIcon,
	SearchIcon,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { NavUser } from "#/components/nav-user";
import { NewProjectDialog } from "#/components/new-project-dialog";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/ui/collapsible";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "#/components/ui/command";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarRail,
	SidebarTrigger,
	useSidebar,
} from "#/components/ui/sidebar";
import { useTRPC } from "#/integrations/trpc/react";
import { authClient } from "#/lib/auth.client";
import { cn } from "#/lib/utils";
import { Button } from "./ui/button";

type SidebarSession = {
	id: string;
	projectId: string;
	title?: string | null;
	status: "active" | "archived";
	createdAt?: Date | string | number | null;
	updatedAt?: Date | string | number | null;
};

type SidebarProject = {
	id: string;
	name: string;
	description?: string | null;
	status: "provisioning" | "ready" | "failed";
	createdAt?: Date | string | number | null;
	updatedAt?: Date | string | number | null;
	sessions?: SidebarSession[];
};

function BrandingWithTrigger() {
	const { state } = useSidebar();
	const isCollapsed = state === "collapsed";

	return (
		<div className="group/branding flex min-h-12 items-center gap-2 rounded-md px-2 text-sidebar-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
			<Link
				to="/"
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground transition-opacity duration-150 ease-out",
					isCollapsed && "group-hover/branding:hidden",
				)}
			>
				<span className="sr-only">Ditto</span>
				<span className="text-sm font-semibold leading-none">
					<Layers2Icon className="size-4" />
				</span>
			</Link>

			{isCollapsed && (
				<SidebarTrigger className="hidden size-8 shrink-0 cursor-pointer group-hover/branding:flex" />
			)}

			<div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
				<span className="truncate font-semibold">Ditto</span>
			</div>

			{!isCollapsed && <SidebarTrigger className="cursor-pointer" />}
		</div>
	);
}

function SearchCommandDialog({
	open,
	onOpenChange,
	projects,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projects: SidebarProject[];
}) {
	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Search"
			description="Search for projects."
			className="sm:max-w-xl"
		>
			<Command>
				<CommandInput placeholder="Search projects..." />
				<CommandList>
					<CommandEmpty>No projects found.</CommandEmpty>
					<CommandGroup heading="Projects">
						{projects.map((project, index) => (
							<CommandItem
								key={project.id}
								value={`${project.name} ${project.description ?? ""}`}
								onSelect={() => onOpenChange(false)}
								className="cursor-pointer py-2"
							>
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-sm font-medium">
										{project.name}
									</span>
									{project.description ? (
										<span className="truncate text-muted-foreground">
											{project.description}
										</span>
									) : null}
								</div>
								<CommandShortcut>P{index + 1}</CommandShortcut>
							</CommandItem>
						))}
					</CommandGroup>
					<CommandSeparator />
					<CommandGroup heading="Quick actions">
						<CommandItem
							value="Open docs documentation"
							onSelect={() => onOpenChange(false)}
							className="cursor-pointer py-2"
						>
							<FileTextIcon aria-hidden="true" />
							<span className="text-sm font-medium">Open documentation</span>
						</CommandItem>
					</CommandGroup>
				</CommandList>
			</Command>
		</CommandDialog>
	);
}

function ProjectSidebarItem({
	project,
	isActive,
	activeSessionId,
}: {
	project: SidebarProject;
	isActive: boolean;
	activeSessionId?: string;
}) {
	const [open, setOpen] = useState(isActive);
	const sessions = project.sessions ?? [];
	const isOpen = open || isActive;

	return (
		<Collapsible className="w-full" open={isOpen} onOpenChange={setOpen}>
			<SidebarMenuItem>
				<CollapsibleTrigger
					render={
						<SidebarMenuButton
							tooltip={project.name}
							isActive={isActive}
							size="sm"
							className="text-xs"
						/>
					}
				>
					{isOpen ? (
						<FolderOpenIcon className="!size-3" />
					) : (
						<FolderIcon className="!size-3" />
					)}
					<span className="min-w-0 flex-1 truncate">{project.name}</span>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<SidebarMenuSub className="w-full">
						{sessions.length > 0 ? (
							sessions.map((session) => (
								<SidebarMenuSubItem key={session.id}>
									<SidebarMenuSubButton
										isActive={activeSessionId === session.id}
										render={
											<Link
												to="/project/$projectId/session/$sessionId"
												params={{
													projectId: project.id,
													sessionId: session.id,
												}}
											/>
										}
									>
										<span>{session.title || "Untitled chat"}</span>
									</SidebarMenuSubButton>
								</SidebarMenuSubItem>
							))
						) : (
							<SidebarMenuSubItem>
								<SidebarMenuSubButton
									aria-disabled="true"
									className="text-sidebar-foreground/60"
								>
									<span>No chats yet</span>
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
						)}
					</SidebarMenuSub>
				</CollapsibleContent>
			</SidebarMenuItem>
		</Collapsible>
	);
}

function ProjectsNav({
	projects,
	isLoading,
}: {
	projects: SidebarProject[];
	isLoading: boolean;
}) {
	const navigate = useNavigate();
	const { projectId: activeProjectId, sessionId: activeSessionId } = useParams({
		strict: false,
	});

	if (isLoading) {
		const loadingProjectIds = [
			"loading-project-1",
			"loading-project-2",
			"loading-project-3",
		];

		return (
			<SidebarGroup>
				<SidebarMenu className="gap-1">
					{loadingProjectIds.map((loadingProjectId) => (
						<SidebarMenuItem key={loadingProjectId}>
							<SidebarMenuSkeleton showIcon />
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroup>
		);
	}

	if (projects.length === 0) {
		return (
			<SidebarGroup className="group-data-[collapsible=icon]:hidden">
				<div className="rounded-lg border border-dashed border-sidebar-border p-3 text-sm">
					<p className="text-pretty text-muted-foreground font-medium">
						No projects yet
					</p>
					<p className="mt-1 text-pretty text-xs text-muted-foreground">
						Create a project to see it here.
					</p>
				</div>
			</SidebarGroup>
		);
	}

	return (
		<SidebarGroup>
			<SidebarMenu className="gap-1 mt-2">
				{projects.map((project) => {
					const isActive = activeProjectId === project.id;
					const projectSessionId =
						activeProjectId === project.id ? activeSessionId : undefined;

					return (
						<div
							key={project.id}
							className="w-full flex items-start justify-between"
						>
							<ProjectSidebarItem
								project={project}
								isActive={isActive}
								activeSessionId={projectSessionId}
							/>
							<Button
								aria-label={`Start chat in ${project.name}`}
								variant="ghost"
								size="icon"
								onClick={() =>
									navigate({
										to: "/project/$projectId",
										params: { projectId: project.id },
									})
								}
							>
								<PlusIcon />
							</Button>
						</div>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const { state } = useSidebar();
	const [newProjectOpen, setNewProjectOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const { data: session, isPending } = authClient.useSession();

	const trpc = useTRPC();
	const projectsQuery = useQuery(
		trpc.projects.list.queryOptions(undefined, {
			enabled: Boolean(session),
		}),
	);
	const projects = projectsQuery.data ?? [];

	return (
		<>
			<Sidebar collapsible="icon" variant="floating" {...props}>
				<SidebarHeader className="border-b">
					<BrandingWithTrigger />
				</SidebarHeader>
				<SidebarContent className="my-2">
					<SidebarGroup>
						<SidebarMenu className="gap-2">
							<SidebarMenuItem>
								<SidebarMenuButton
									tooltip="New Project"
									render={
										<Button
											className="cursor-pointer"
											variant="outline"
											disabled={isPending || !session}
											onClick={() => setNewProjectOpen(true)}
										>
											<PlusIcon />
											{state === "expanded" && <span>New Project</span>}
										</Button>
									}
								/>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton
									tooltip="Search"
									render={
										<Button
											className="cursor-pointer"
											variant="outline"
											onClick={() => setSearchOpen(true)}
										>
											<SearchIcon />
											{state === "expanded" && <span>Search</span>}
										</Button>
									}
								/>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroup>

					<ProjectsNav
						projects={projects}
						isLoading={
							isPending || (projectsQuery.isPending && Boolean(session))
						}
					/>
				</SidebarContent>
				<SidebarFooter className="border-t">
					<NavUser />
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>

			<NewProjectDialog
				open={newProjectOpen}
				onOpenChange={setNewProjectOpen}
			/>
			<SearchCommandDialog
				open={searchOpen}
				onOpenChange={setSearchOpen}
				projects={projects}
			/>
		</>
	);
}
