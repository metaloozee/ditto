"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ClientOnly,
	Link,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import {
	AlertCircleIcon,
	FileTextIcon,
	FolderIcon,
	FolderOpenIcon,
	Layers2Icon,
	LoaderIcon,
	MoreHorizontalIcon,
	PlusIcon,
	SearchIcon,
	TrashIcon,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { NavUser } from "#/components/nav-user";
import { NewProjectDialog } from "#/components/new-project-dialog";
import { ProjectSettingsDialog } from "#/components/project-settings-dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleContent } from "#/components/ui/collapsible";
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
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
import { clearSessionMessages } from "#/lib/chat-session-cache";
import { cn } from "#/lib/utils";

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

function BrandingWithTrigger(): React.JSX.Element {
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

			{isCollapsed ? (
				<SidebarTrigger className="hidden size-8 shrink-0 cursor-pointer group-hover/branding:flex" />
			) : null}

			<div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
				<span className="truncate font-semibold">Ditto</span>
			</div>

			{!isCollapsed ? <SidebarTrigger className="cursor-pointer" /> : null}
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
}): React.JSX.Element {
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

function ProjectStatusIcon({
	status,
	isOpen,
}: {
	status: SidebarProject["status"];
	isOpen: boolean;
}): React.JSX.Element {
	if (status === "provisioning") {
		return (
			<LoaderIcon className="!size-4 animate-spin text-sidebar-foreground/50" />
		);
	}
	if (status === "failed") {
		return <AlertCircleIcon className="!size-4 text-destructive" />;
	}
	return isOpen ? (
		<FolderOpenIcon className="!size-4" />
	) : (
		<FolderIcon className="!size-4" />
	);
}

export function SessionSidebarItem({
	session,
	project,
	isActive,
}: {
	session: SidebarSession;
	project: SidebarProject;
	isActive: boolean;
}): React.JSX.Element {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [confirmOpen, setConfirmOpen] = useState(false);

	const deleteSessionMutation = useMutation(
		trpc.workspace.deleteSession.mutationOptions(),
	);

	async function handleArchiveSession(): Promise<void> {
		await deleteSessionMutation.mutateAsync({
			projectId: project.id,
			sessionId: session.id,
		});
		clearSessionMessages(session.id);
		await queryClient.invalidateQueries(trpc.projects.list.queryFilter());
		setConfirmOpen(false);

		if (isActive) {
			await navigate({
				to: "/project/$projectId",
				params: { projectId: project.id },
			});
		}
	}

	return (
		<SidebarMenuSubItem>
			<SidebarMenuSubButton
				size="sm"
				isActive={isActive}
				render={
					<Link
						to="/project/$projectId/session/$sessionId"
						params={{
							projectId: project.id,
							sessionId: session.id,
						}}
					/>
				}
				className="pr-7"
				title={session.title || "Untitled chat"}
			>
				<span className="truncate">{session.title || "Untitled chat"}</span>
			</SidebarMenuSubButton>

			<DropdownMenu>
				<DropdownMenuTrigger
					className={cn(
						"absolute top-0.5 right-0 flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 outline-hidden transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring cursor-pointer",
						"opacity-0 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 aria-expanded:opacity-100",
					)}
					aria-label={`Actions for ${session.title || "Untitled chat"}`}
				>
					<MoreHorizontalIcon className="size-3.5" />
				</DropdownMenuTrigger>
				<DropdownMenuContent
					side="right"
					align="start"
					sideOffset={4}
					className="min-w-36"
				>
					<DropdownMenuItem
						variant="destructive"
						className="cursor-pointer"
						onClick={() => setConfirmOpen(true)}
					>
						<TrashIcon />
						<span>Archive Session</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Archive session?</AlertDialogTitle>
						<AlertDialogDescription>
							This chat will disappear from the active list and cannot receive
							new messages.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => void handleArchiveSession()}
							disabled={deleteSessionMutation.isPending}
							className="cursor-pointer"
						>
							{deleteSessionMutation.isPending ? "Archiving…" : "Archive"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SidebarMenuSubItem>
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
}): React.JSX.Element {
	const navigate = useNavigate();
	const { state } = useSidebar();
	const isCollapsed = state === "collapsed";
	const [open, setOpen] = useState(isActive);
	const sessions = project.sessions ?? [];
	const isOpen = open || isActive;

	function navigateToProject(): void {
		navigate({
			to: "/project/$projectId",
			params: { projectId: project.id },
		});
	}

	function handleProjectClick(): void {
		if (isCollapsed) {
			navigateToProject();
			return;
		}

		setOpen((prev) => !prev);
	}

	return (
		<Collapsible
			className="group/collapsible"
			open={isOpen && !isCollapsed}
			onOpenChange={setOpen}
		>
			<SidebarMenuItem>
				<SidebarMenuButton
					tooltip={project.name}
					isActive={isActive}
					size="sm"
					onClick={handleProjectClick}
					className="cursor-pointer pr-14"
				>
					<ProjectStatusIcon status={project.status} isOpen={isOpen} />
					<span className="min-w-0 flex-1 truncate">{project.name}</span>
				</SidebarMenuButton>
				<ProjectSettingsDialog
					project={project}
					trigger={
						<SidebarMenuAction
							showOnHover
							aria-label={`Settings for ${project.name}`}
							className="right-7 cursor-pointer"
						/>
					}
				/>
				<SidebarMenuAction
					showOnHover
					aria-label={`New chat in ${project.name}`}
					onClick={navigateToProject}
					className="cursor-pointer"
				>
					<PlusIcon />
				</SidebarMenuAction>
				<CollapsibleContent>
					<SidebarMenuSub>
						{sessions.length > 0 ? (
							sessions.map((session) => (
								<SessionSidebarItem
									key={session.id}
									session={session}
									project={project}
									isActive={activeSessionId === session.id}
								/>
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
}): React.JSX.Element {
	const { projectId: activeProjectId, sessionId: activeSessionId } = useParams({
		strict: false,
	});

	if (isLoading) {
		return (
			<SidebarGroup>
				<SidebarMenu className="gap-1">
					{["loading-1", "loading-2", "loading-3"].map((id) => (
						<SidebarMenuItem key={id}>
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
						<ProjectSidebarItem
							key={project.id}
							project={project}
							isActive={isActive}
							activeSessionId={projectSessionId}
						/>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}

export function AppSidebar(
	props: React.ComponentProps<typeof Sidebar>,
): React.JSX.Element {
	return (
		<ClientOnly fallback={<AppSidebarFallback {...props} />}>
			<AppSidebarClient {...props} />
		</ClientOnly>
	);
}

function AppSidebarClient(
	props: React.ComponentProps<typeof Sidebar>,
): React.JSX.Element {
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
			<Sidebar collapsible="offcanvas" variant="floating" {...props}>
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
										/>
									}
								>
									<PlusIcon />
									{state === "expanded" && <span>New Project</span>}
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton
									tooltip="Search"
									render={
										<Button
											className="cursor-pointer"
											variant="outline"
											onClick={() => setSearchOpen(true)}
										/>
									}
								>
									<SearchIcon />
									{state === "expanded" && <span>Search</span>}
								</SidebarMenuButton>
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
					<ClientOnly fallback={<SidebarMenuSkeleton showIcon />}>
						<NavUser />
					</ClientOnly>
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

function AppSidebarFallback(
	props: React.ComponentProps<typeof Sidebar>,
): React.JSX.Element {
	return (
		<Sidebar collapsible="offcanvas" variant="floating" {...props}>
			<SidebarHeader className="border-b">
				<BrandingWithTrigger />
			</SidebarHeader>
			<SidebarContent className="my-2">
				<SidebarGroup>
					<SidebarMenu className="gap-2">
						<SidebarMenuItem>
							<SidebarMenuSkeleton showIcon />
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuSkeleton showIcon />
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
				<ProjectsNav projects={[]} isLoading />
			</SidebarContent>
			<SidebarFooter className="border-t">
				<SidebarMenuSkeleton showIcon />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
