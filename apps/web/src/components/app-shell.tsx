import type { JSX, ReactNode } from "react";
import { AppSidebar } from "#/components/app-sidebar";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "#/components/ui/sidebar";
import { TooltipProvider } from "#/components/ui/tooltip";

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
	return (
		<TooltipProvider delay={300}>
			<SidebarProvider>
				<AppSidebar />
				<SidebarInset>
					<header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3 md:hidden">
						<SidebarTrigger className="cursor-pointer" />
						<span className="text-sm font-semibold">Ditto</span>
					</header>
					{children}
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
