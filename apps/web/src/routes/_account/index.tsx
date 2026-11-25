import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { WorkspaceFailed, WorkspacePending, WorkspaceView } from "#/components/workspace.tsx";
import { useSignOut } from "#/lib/auth-client.ts";
import { getSidebarPinned, openWorkspace } from "#/lib/workspace.ts";

type HomeSearch = { panel?: "computer" };

export const Route = createFileRoute("/_account/")({
	validateSearch: (search): HomeSearch =>
		search.panel === "computer" ? { panel: "computer" } : {},
	// The open runs when the owner arrives; toggling the panel only changes the search.
	shouldReload: false,
	loader: async () => ({ workspace: await openWorkspace(), sidebarPinned: getSidebarPinned() }),
	pendingComponent: WorkspacePending,
	errorComponent: Failed,
	component: Home,
});

function Home() {
	const { account } = Route.useRouteContext();
	const { workspace, sidebarPinned } = Route.useLoaderData();
	const { panel } = Route.useSearch();
	const navigate = useNavigate();
	const signOut = useSignOut();
	return (
		<WorkspaceView
			account={account}
			workspace={workspace}
			sidebarPinned={sidebarPinned}
			panelOpen={panel === "computer"}
			// The panel rides in the URL so a refresh keeps it, without filling history.
			onPanelOpenChange={(open) =>
				void navigate({ to: "/", search: open ? { panel: "computer" } : {}, replace: true })
			}
			onSignOut={() => void signOut()}
		/>
	);
}

function Failed() {
	const router = useRouter();
	const [retrying, setRetrying] = useState(false);
	return (
		<WorkspaceFailed
			retrying={retrying}
			onRetry={() => {
				setRetrying(true);
				void router.invalidate().finally(() => setRetrying(false));
			}}
		/>
	);
}
