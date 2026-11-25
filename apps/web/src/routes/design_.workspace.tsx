import { createFileRoute, Link } from "@tanstack/react-router";

import { previewAccount } from "#/components/account.tsx";
import { WorkspaceFailed, WorkspacePending, WorkspaceView } from "#/components/workspace.tsx";
import type { Workspace } from "#/lib/workspace.ts";

const STATES = ["opened", "panel", "unpinned", "running", "opening", "failed"] as const;
type State = (typeof STATES)[number];

const workspace: Workspace = {
	workspaceId: "ws-preview",
	chiefOfStaff: { id: "bot-preview", name: "Ditto" },
	computer: "stopped",
};
const noop = () => {};

export const Route = createFileRoute("/design_/workspace")({
	head: () => ({ meta: [{ title: "Workspace designs · Ditto" }] }),
	validateSearch: (search): { state: State } => ({
		state: STATES.find((state) => state === search.state) ?? "opened",
	}),
	component: WorkspaceDesigns,
});

/** Every state of the signed-in home, full screen, one at a time. */
function WorkspaceDesigns() {
	const { state } = Route.useSearch();
	return (
		<>
			<nav
				aria-label="Workspace states"
				className="fixed end-3 bottom-3 z-40 flex flex-wrap gap-1 rounded-xl bg-popover p-1 shadow-md ring-1 ring-foreground/10"
			>
				{STATES.map((name) => (
					<Link
						key={name}
						to="/design/workspace"
						search={{ state: name }}
						className="rounded-lg px-2.5 py-1 text-caption text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
						aria-current={name === state ? "page" : undefined}
						activeOptions={{ includeSearch: true }}
					>
						{name}
					</Link>
				))}
			</nav>
			{state === "opening" ? (
				<WorkspacePending />
			) : state === "failed" ? (
				<WorkspaceFailed retrying={false} onRetry={noop} />
			) : (
				<WorkspaceView
					key={state}
					account={previewAccount}
					workspace={state === "running" ? { ...workspace, computer: "running" } : workspace}
					sidebarPinned={state !== "unpinned"}
					panelOpen={state === "panel" || state === "running"}
					onPanelOpenChange={noop}
					onSignOut={noop}
				/>
			)}
		</>
	);
}
