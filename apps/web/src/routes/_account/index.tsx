import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { TurnInterruption, TurnStatus } from "#/bot-rpc.ts";
import { type ComposerMode, InterruptionCard } from "#/components/model-access.tsx";
import { ConversationBubble, ConversationContent } from "#/components/ui/conversation.tsx";
import { WorkspaceFailed, WorkspacePending, WorkspaceView } from "#/components/workspace.tsx";
import type { ModelAccessView } from "#/credentials-rpc.ts";
import { useSignOut } from "#/lib/auth-client.ts";
import { checkConnection, getModelAccess, readModelAccess } from "#/lib/model-access-api.ts";
import { canMessage, type Interruption, type Pair } from "#/lib/model-access.ts";
import { readTurn, sendTurn, stopTurn } from "#/lib/turn.ts";
import { getSidebarPinned, openWorkspace } from "#/lib/workspace.ts";

type HomeSearch = { panel?: "computer" };

export const Route = createFileRoute("/_account/")({
	validateSearch: (search): HomeSearch =>
		search.panel === "computer" ? { panel: "computer" } : {},
	// The open runs when the owner arrives; toggling the panel only changes the search.
	shouldReload: false,
	loader: async () => {
		const [workspace, access] = await Promise.all([openWorkspace(), getModelAccess()]);
		return { workspace, access, sidebarPinned: getSidebarPinned() };
	},
	pendingComponent: WorkspacePending,
	errorComponent: Failed,
	component: Home,
});

/** One exchange this visit: the owner's message and the reply as far as it has streamed. */
interface Exchange {
	message: string;
	reply: string;
	status: TurnStatus | "refused";
	turnId?: string;
	pair?: Pair;
	interruption?: TurnInterruption;
	/** Set once an interrupted turn carried on. */
	resumed?: boolean;
}

/** How often an interrupted turn and its connection are reread while the owner waits. */
const WATCH_MS = 2000;

const ENDED: Partial<Record<Exchange["status"], string>> = {
	stopped: "Stopped",
	failed: "The model stopped answering",
	refused: "Not sent",
};

function Home() {
	const { account } = Route.useRouteContext();
	const loaded = Route.useLoaderData();
	const { workspace, sidebarPinned } = loaded;
	const { panel } = Route.useSearch();
	const navigate = useNavigate();
	const signOut = useSignOut();
	const [exchanges, setExchanges] = useState<Exchange[]>([]);
	// Reread while a turn waits on its connection, so the card and composer follow it.
	const [liveAccess, setLiveAccess] = useState<ModelAccessView>();
	const access = liveAccess ?? loaded.access;
	const { workspaceId } = workspace;
	const botId = workspace.chiefOfStaff.id;

	const running = exchanges.at(-1)?.status === "running";
	const composer: ComposerMode = !canMessage(access) ? "no-model" : running ? "running" : "ready";
	const updateLast = (change: (last: Exchange) => Exchange) =>
		setExchanges((all) => {
			const last = all.at(-1);
			return last ? [...all.slice(0, -1), change(last)] : all;
		});
	const rereadAccess = async () => {
		const view = await readModelAccess();
		if (view) setLiveAccess(view);
	};

	const send = async (message: string) => {
		setExchanges((all) => [...all, { message, reply: "", status: "running" }]);
		const end = await sendTurn(
			workspaceId,
			botId,
			message,
			(text) => updateLast((last) => ({ ...last, reply: last.reply + text })),
			({ turnId, pair }) => updateLast((last) => ({ ...last, turnId, pair })),
		);
		updateLast((last) => ({ ...last, ...end }));
		if (end.status === "interrupted") await rereadAccess();
	};

	// An interrupted turn resumes on its own once its connection answers again.
	const watched = exchanges.find(
		(each) => each.status === "interrupted" || (each.resumed && each.status === "running"),
	)?.turnId;
	useEffect(() => {
		if (!watched) return;
		const timer = setInterval(async () => {
			const [turn] = await Promise.all([readTurn(workspaceId, botId, watched), rereadAccess()]);
			if (!turn) return;
			setExchanges((all) =>
				all.map((each) =>
					each.turnId === watched
						? {
								...each,
								reply: turn.reply,
								status: turn.status,
								interruption: turn.interruption,
								resumed: each.resumed || turn.status !== "interrupted",
							}
						: each,
				),
			);
		}, WATCH_MS);
		return () => clearInterval(timer);
	}, [watched, workspaceId, botId]);

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
			composer={composer}
			onSend={(message) => void send(message)}
			onStop={() => void stopTurn(workspaceId, botId)}
			messages={
				exchanges.length > 0
					? exchanges.map((exchange, index) => (
							// Exchanges are only ever appended, so an index names one for the whole visit.
							<ExchangeBubbles
								key={index}
								exchange={exchange}
								access={access}
								onCheck={async (connectionId) => {
									await checkConnection(connectionId);
									await rereadAccess();
								}}
							/>
						))
					: undefined
			}
		/>
	);
}

function ExchangeBubbles({
	exchange,
	access,
	onCheck,
}: {
	exchange: Exchange;
	access: ModelAccessView;
	onCheck: (connectionId: string) => Promise<void>;
}) {
	const ended = ENDED[exchange.status];
	const { pair } = exchange;
	return (
		<>
			<ConversationBubble variant="sent">
				<ConversationContent>{exchange.message}</ConversationContent>
			</ConversationBubble>
			{(exchange.reply || ended) && (
				<ConversationBubble aria-busy={exchange.status === "running"}>
					{exchange.reply && <ConversationContent>{exchange.reply}</ConversationContent>}
					{ended && <span className="ps-1 text-caption text-muted-foreground">{ended}</span>}
				</ConversationBubble>
			)}
			{pair && (exchange.status === "interrupted" || exchange.resumed) && (
				<InterruptionCard
					access={access}
					interruption={exchange.resumed ? "Settled" : cardState(access, exchange)}
					turnPair={pair}
					defaultPair={access.defaultPair ?? undefined}
					onCheck={() => onCheck(pair.connectionId)}
				/>
			)}
		</>
	);
}

/** The card follows its connection as it is now, and what stopped the turn until it changes. */
function cardState(access: ModelAccessView, exchange: Exchange): Interruption {
	const state = access.connections.find((each) => each.id === exchange.pair?.connectionId)?.state;
	if (state === "Throttled" || state === "Unavailable" || state === "ReconnectNeeded") return state;
	return exchange.interruption ?? "Unavailable";
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
