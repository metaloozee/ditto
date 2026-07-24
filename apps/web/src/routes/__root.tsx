import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type * as React from "react";
import { lazy, Suspense } from "react";
import { RouteError } from "#/components/route-error";
import { Spinner } from "#/components/ui/spinner";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { App } from "../App";
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
				content: "dark light",
			},
			{
				title: "Ditto",
			},
			{
				name: "description",
				content:
					"Ditto is an AI coding workspace with sandboxed agents for your projects.",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	errorComponent: RouteError,
	component: RootComponent,
	shellComponent: RootDocument,
});

/** Loads TanStack Devtools only in development; production never imports them. */
const DevToolsBundle = import.meta.env.DEV
	? lazy(async () => {
			const mod = await import("#/integrations/tanstack-query/devtools-bundle");
			function LoadedDevTools() {
				return <>{mod.default()}</>;
			}
			return { default: LoadedDevTools };
		})
	: null;

function DevTools() {
	if (!DevToolsBundle) return null;
	return (
		<Suspense
			fallback={
				<div className="sr-only" aria-live="polite">
					Loading developer tools
				</div>
			}
		>
			<DevToolsBundle />
		</Suspense>
	);
}

function RootComponent() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const isAuthRoute = pathname === "/sign-in";
	const content = (
		<Suspense
			fallback={
				<div
					className="flex min-h-dvh items-center justify-center"
					aria-live="polite"
				>
					<Spinner size="md" />
					<span className="sr-only">Loading</span>
				</div>
			}
		>
			<Outlet />
		</Suspense>
	);

	return isAuthRoute ? content : <App>{content}</App>;
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<DevTools />
				<Scripts />
			</body>
		</html>
	);
}
