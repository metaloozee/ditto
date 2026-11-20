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

// Dark is the default; follow the OS setting before first paint and when it changes.
const themeScript = `(() => {
	const query = matchMedia("(prefers-color-scheme: light)");
	const apply = () => document.documentElement.classList.toggle("dark", !query.matches);
	apply();
	query.addEventListener("change", apply);
})();`;

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className="dark" suppressHydrationWarning>
			<head>
				{/* oxlint-disable-next-line react/no-danger -- static, first-party theme script */}
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}
