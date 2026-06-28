import type { JSX, ReactNode } from "react";
import { AppSidebar } from "#/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar";
import { Toaster } from "#/components/ui/sonner";
import { TooltipProvider } from "#/components/ui/tooltip";

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
	return (
		<TooltipProvider delay={300}>
			<SidebarProvider>
				<AppSidebar />
				<Toaster richColors />
				<SidebarInset>{children}</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
