import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/auth/github-link-complete")({
	component: GitHubLinkComplete,
});

function GitHubLinkComplete() {
	useEffect(() => {
		window.opener?.postMessage(
			{ type: "github-link-complete" },
			window.location.origin,
		);
		window.close();
	}, []);

	return (
		<main className="flex min-h-dvh items-center justify-center bg-background px-6 text-sm text-muted-foreground">
			GitHub authorization complete. You can close this window.
		</main>
	);
}
