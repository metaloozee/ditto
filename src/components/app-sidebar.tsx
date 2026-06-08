"use client";

import {
	FileTextIcon,
	HomeIcon,
	Layers2Icon,
	PlusIcon,
	SearchIcon,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { NavMain } from "#/components/nav-main";
import { NavUser } from "#/components/nav-user";
import { NewProjectDialog } from "#/components/new-project-dialog";
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
	SidebarRail,
	SidebarTrigger,
	useSidebar,
} from "#/components/ui/sidebar";
import { Button } from "./ui/button";

const navItems = [
	{
		title: "Home",
		to: "/" as const,
		icon: <HomeIcon />,
	},
];

const projectResults = [
	{
		name: "Marketing Site",
		description: "Next.js landing pages and analytics",
		shortcut: "P1",
	},
	{
		name: "Dashboard App",
		description: "Customer metrics and admin workflows",
		shortcut: "P2",
	},
	{
		name: "Component Library",
		description: "Shared React primitives and design tokens",
		shortcut: "P3",
	},
] as const;

const chatResults = [
	{
		name: "Auth integration notes",
		description: "Better Auth setup and session handling",
		shortcut: "C1",
	},
	{
		name: "Sidebar navigation polish",
		description: "Collapsed states, tooltips, and layout fixes",
		shortcut: "C2",
	},
	{
		name: "Deploy checklist",
		description: "Worker bindings, database migrations, and preview URLs",
		shortcut: "C3",
	},
] as const;

function BrandingWithTrigger() {
	const { state } = useSidebar();
	const isCollapsed = state === "collapsed";

	return (
		<div className="group/branding flex min-h-12 items-center gap-2 rounded-md px-2 text-sidebar-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
			<div
				className={
					"flex size-8 shrink-0 items-center justify-center rounded-md bg-linear-to-tr from-(--bg-base) to-(--sea-ink) ring-1 ring-sidebar-ring/30 transition-[transform,box-shadow,opacity] duration-150 ease-out group-data-[collapsible=icon]:shadow-sm" +
					(isCollapsed ? " group-hover/branding:hidden" : "")
				}
			>
				<span className="sr-only">Ditto</span>
				<span className="text-sm font-semibold leading-none">
					<Layers2Icon className="size-4" />
				</span>
			</div>

			{isCollapsed && (
				<SidebarTrigger className="cursor-pointer hidden ease-in-out duration-300 size-8 shrink-0 group-hover/branding:flex" />
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
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Search"
			description="Search for projects and chats."
			className="sm:max-w-xl"
		>
			<Command>
				<CommandInput placeholder="Search projects and chats..." />
				<CommandList>
					<CommandEmpty>No projects or chats found.</CommandEmpty>
					<CommandGroup heading="Projects">
						{projectResults.map((project) => (
							<CommandItem
								key={project.name}
								value={`${project.name} ${project.description}`}
								onSelect={() => onOpenChange(false)}
								className="cursor-pointer py-2"
							>
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-sm font-medium">
										{project.name}
									</span>
									<span className="truncate text-muted-foreground">
										{project.description}
									</span>
								</div>
								<CommandShortcut>{project.shortcut}</CommandShortcut>
							</CommandItem>
						))}
					</CommandGroup>
					<CommandSeparator />
					<CommandGroup heading="Chats">
						{chatResults.map((chat) => (
							<CommandItem
								key={chat.name}
								value={`${chat.name} ${chat.description}`}
								onSelect={() => onOpenChange(false)}
								className="cursor-pointer py-2"
							>
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-sm font-medium">
										{chat.name}
									</span>
									<span className="truncate text-muted-foreground">
										{chat.description}
									</span>
								</div>
								<CommandShortcut>{chat.shortcut}</CommandShortcut>
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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const { state } = useSidebar();
	const [newProjectOpen, setNewProjectOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);

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
								<SidebarMenuButton tooltip="New Project" asChild>
									<Button
										className="cursor-pointer"
										variant="outline"
										onClick={() => setNewProjectOpen(true)}
									>
										<PlusIcon />
										{state === "expanded" && <span>New Project</span>}
									</Button>
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton tooltip="Search" asChild>
									<Button
										className="cursor-pointer"
										variant="outline"
										onClick={() => setSearchOpen(true)}
									>
										<SearchIcon />
										{state === "expanded" && <span>Search</span>}
									</Button>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroup>

					<NavMain items={navItems} />
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
			<SearchCommandDialog open={searchOpen} onOpenChange={setSearchOpen} />
		</>
	);
}
