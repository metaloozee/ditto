import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ name: "color-scheme", content: "dark light" },
			{ title: "Ditto" },
			{
				name: "description",
				content: "Ditto is an AI coding workspace with sandboxed agents for your projects.",
			},
		],
		links: [
			{ rel: "icon", href: "/favicon.ico" },
			{ rel: "stylesheet", href: appCss },
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}
