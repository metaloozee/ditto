"use client";

import { HomeIcon, Layers2Icon, PlusIcon } from "lucide-react";
import type * as React from "react";
import { NavMain } from "#/components/nav-main";
import { NavUser } from "#/components/nav-user";
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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const { state } = useSidebar();

	return (
		<Sidebar collapsible="icon" variant="floating" {...props}>
			<SidebarHeader className="border-b">
				<BrandingWithTrigger />
			</SidebarHeader>
			<SidebarContent className="my-2">
				<SidebarGroup>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton tooltip="New Project" asChild>
								<Button className="cursor-pointer" variant="outline">
									<PlusIcon />
									{state === "expanded" && <span>New Project</span>}
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
	);
}
