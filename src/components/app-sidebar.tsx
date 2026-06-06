"use client";

import { HomeIcon, PanelLeftIcon } from "lucide-react";
import type * as React from "react";
import { NavMain } from "#/components/nav-main";
import { NavUser } from "#/components/nav-user";
import { Button } from "#/components/ui/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarRail,
	useSidebar,
} from "#/components/ui/sidebar";

const navItems = [
	{
		title: "Home",
		to: "/" as const,
		icon: <HomeIcon />,
	},
];

function SidebarFooterToggle() {
	const { isMobile, state, toggleSidebar } = useSidebar();
	const label = isMobile || state === "expanded" ? "Collapse" : "Expand";

	return (
		<Button
			type="button"
			variant="outline"
			size={"lg"}
			aria-label={label}
			title={label}
			onClick={toggleSidebar}
		>
			<PanelLeftIcon
				className="size-4 transition-transform duration-300 ease-out group-data-[collapsible=icon]:rotate-180"
				aria-hidden="true"
			/>
			<span className="truncate text-xs group-data-[collapsible=icon]:hidden">
				{label}
			</span>
		</Button>
	);
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<div className="flex min-h-12 items-center gap-2 rounded-md px-2 text-sidebar-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
					<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground ring-1 ring-sidebar-ring/30 transition-[transform,box-shadow] duration-150 ease-out group-data-[collapsible=icon]:shadow-sm">
						<span className="sr-only">Ditto</span>
						<span className="text-sm font-semibold leading-none">D</span>
					</div>
					<div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
						<span className="truncate font-semibold">Ditto</span>
						<span className="truncate text-xs text-sidebar-foreground/70">
							AI workspace
						</span>
					</div>
				</div>
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={navItems} />
			</SidebarContent>
			<SidebarFooter>
				<SidebarFooterToggle />
				<NavUser />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
