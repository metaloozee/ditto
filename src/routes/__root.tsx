import { FlueProvider } from "@flue/react";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type * as React from "react";
import { AppShell } from "#/components/app-shell";
import { TooltipProvider } from "#/components/ui/tooltip";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { flueClient } from "#/lib/flue-client";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;

	trpc: TRPCOptionsProxy<TRPCRouter>;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				name: "color-scheme",
				content: "dark",
			},
			{
				title: "Ditto",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const isAuthRoute = pathname === "/sign-in";

	return (
		<html lang="en" className="dark" style={{ colorScheme: "dark" }}>
			<head>
				<HeadContent />
			</head>
			<body>
				<FlueProvider client={flueClient}>
					<TooltipProvider>
						{isAuthRoute ? children : <AppShell>{children}</AppShell>}
					</TooltipProvider>
				</FlueProvider>
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
						TanStackQueryDevtools,
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
