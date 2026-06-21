import { Link, useRouterState } from "@tanstack/react-router";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "#/components/ui/sidebar";
import { cn } from "#/lib/utils";

export function NavMain({
	items,
}: {
	items: {
		title: string;
		to: "/";
		icon: React.ReactNode;
	}[];
}) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});

	const { state } = useSidebar();

	return (
		<SidebarGroup>
			<SidebarGroupLabel className={cn(state === "collapsed" && "hidden")}>
				Workspace
			</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) => (
					<SidebarMenuItem key={item.title}>
						<SidebarMenuButton
							isActive={pathname === item.to}
							className="text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-active:text-sidebar-foreground"
							tooltip={item.title}
							render={
								<Link to={item.to}>
									{item.icon}
									<span>{item.title}</span>
								</Link>
							}
						/>
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
