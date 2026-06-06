import { TanStackDevtools } from "@tanstack/react-devtools";
import { HeadContent, Scripts, useRouterState } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type * as React from "react";
import { AppShell } from "#/components/app-shell";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";

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

export { RootDocument };
