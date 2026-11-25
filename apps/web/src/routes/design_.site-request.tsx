import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useState } from "react";

import { previewAccount } from "#/components/account.tsx";
import { SITE_SETS, SiteRequest } from "#/components/site-request.tsx";
import { ConversationBubble, ConversationContent } from "#/components/ui/conversation.tsx";
import { WorkspaceView } from "#/components/workspace.tsx";
import type { Workspace } from "#/lib/workspace.ts";

const STATES = ["waiting", "set", "list", "all", "allowed"] as const;
type State = (typeof STATES)[number];

const workspace: Workspace = {
	workspaceId: "ws-preview",
	chiefOfStaff: { id: "bot-preview", name: "Ditto" },
	computer: "running",
};
const noop = () => {};

export const Route = createFileRoute("/design_/site-request")({
	head: () => ({ meta: [{ title: "Site request prototype · Ditto" }] }),
	validateSearch: (search): { state: State } => ({
		state: STATES.find((state) => state === search.state) ?? "waiting",
	}),
	component: SiteRequestDesigns,
});

/** The prompt Ditto posts when the filter blocks a site, inside the real workspace. */
function SiteRequestDesigns() {
	const { state } = Route.useSearch();
	const [panelOpen, setPanelOpen] = useState(false);
	return (
		<>
			<nav
				aria-label="Site request states"
				className="fixed end-3 bottom-3 z-40 flex flex-col gap-1 rounded-xl bg-popover p-1 shadow-md ring-1 ring-foreground/10"
			>
				<Switcher items={STATES} current={state} to={(name) => ({ state: name })} label="State" />
			</nav>
			<WorkspaceView
				key={state}
				account={previewAccount}
				workspace={workspace}
				sidebarPinned
				panelOpen={panelOpen}
				onPanelOpenChange={setPanelOpen}
				onSignOut={noop}
				messages={
					<>
						<ConversationBubble>
							<ConversationContent>
								Morning. Anything you want me to look at first?
							</ConversationContent>
						</ConversationBubble>
						<ConversationBubble variant="sent">
							<ConversationContent>Summarise today’s Hacker News front page.</ConversationContent>
						</ConversationBubble>
						<ConversationBubble>
							<ConversationContent>On it. Opening it on our computer.</ConversationContent>
						</ConversationBubble>
						<SiteRequest
							host="news.ycombinator.com"
							task="Summarise today’s Hacker News front page"
							initialChoice={
								state === "set" || state === "list" || state === "all" ? state : undefined
							}
							initialDecision={state === "allowed" ? { kind: "set", set: SITE_SETS[0] } : undefined}
						/>
					</>
				}
			/>
		</>
	);
}

function Switcher<T extends string>({
	items,
	current,
	to,
	label,
}: {
	items: readonly T[];
	current: T;
	to: (name: T) => { state: State };
	label: string;
}) {
	return (
		<div className="flex flex-wrap items-center gap-1">
			<span className="w-10 ps-1.5 text-caption text-muted-foreground">{label}</span>
			{items.map((name) => (
				<Link
					key={name}
					to="/design/site-request"
					search={to(name)}
					className={cn(
						"rounded-lg px-2.5 py-1 text-caption text-muted-foreground",
						name === current && "bg-muted text-foreground",
					)}
					aria-current={name === current ? "page" : undefined}
				>
					{name}
				</Link>
			))}
		</div>
	);
}
