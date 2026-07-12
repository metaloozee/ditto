import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type * as React from "react";
import { useEffect, useState } from "react";
import { AppShell } from "#/components/app-shell";
import type { TRPCRouter } from "#/integrations/trpc/router";
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

/** Loads TanStack Devtools only in development; production never imports them. */
function DevTools() {
	const [tools, setTools] = useState<React.ReactNode>(null);

	useEffect(() => {
		if (!import.meta.env.DEV) return;
		void import("#/integrations/tanstack-query/devtools-bundle").then((mod) =>
			setTools(mod.default()),
		);
	}, []);

	return tools;
}

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
				{isAuthRoute ? children : <AppShell>{children}</AppShell>}
				<DevTools />
				<Scripts />
			</body>
		</html>
	);
}
