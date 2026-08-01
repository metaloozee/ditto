import { useRouterState } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";
import { AppSidebar } from "#/components/app-sidebar";
import { SidebarModeTrigger } from "#/components/sidebar-mode-trigger";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar";
import { TooltipProvider } from "#/components/ui/tooltip";

/** Chat routes own ChatNavbar (includes the same trigger). */
function ShellNavbar() {
	const isChatRoute = useRouterState({
		select: (state) => state.location.pathname.startsWith("/project/"),
	});
	if (isChatRoute) return null;

	return (
		<nav
			aria-label="App controls"
			className="pointer-events-none fixed top-0 left-0 z-10 pt-[max(1rem,env(safe-area-inset-top))] pl-5 sm:pl-6"
		>
			<div className="pointer-events-auto flex h-8 items-center">
				<SidebarModeTrigger />
			</div>
		</nav>
	);
}

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
	return (
		<TooltipProvider delay={300}>
			<SidebarProvider>
				<AppSidebar />
				<SidebarInset>
					<ShellNavbar />
					{children}
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
