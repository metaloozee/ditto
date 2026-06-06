import { Link, useRouterState } from "@tanstack/react-router";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "#/components/ui/sidebar";

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

	return (
		<SidebarGroup>
			<SidebarGroupLabel>Workspace</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) => (
					<SidebarMenuItem key={item.title}>
						<SidebarMenuButton
							asChild
							isActive={pathname === item.to}
							className="text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-active:text-sidebar-foreground"
							tooltip={item.title}
						>
							<Link to={item.to}>
								{item.icon}
								<span>{item.title}</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
