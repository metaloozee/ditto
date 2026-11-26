import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { Pending, Turn, TurnStatus } from "#/bot-rpc.ts";
import { InterruptionCard, QueuedBubble, type ComposerMode } from "#/components/model-access.tsx";
import { ConversationBubble, ConversationContent } from "#/components/ui/conversation.tsx";
import { WorkspaceFailed, WorkspacePending, WorkspaceView } from "#/components/workspace.tsx";
import { useSignOut } from "#/lib/auth-client.ts";
import { accessOf, getModelAccess, readModelAccess } from "#/lib/model-access-api.ts";
import { canMessage, type ModelAccess } from "#/lib/model-access.ts";
import { pendingTurns, sendTurn, stopTurn } from "#/lib/turn.ts";
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

/** How often the page reads an interrupted turn and the queue while they wait. */
const FOLLOW_MS = 1000;

/**
 * One exchange this visit: the owner's message and the reply as far as it has streamed. `live`
 * while this page streams it; an interrupted turn and the queue are followed by reading them.
 */
interface Exchange {
	key: string;
	/** The bot's turn ID, once it answered with one. */
	id?: string;
	message: string;
	reply: string;
	status: TurnStatus | "refused" | "queued";
	live?: boolean;
	pair?: Turn["pair"];
	interruption?: Turn["interruption"];
}

const ENDED: Partial<Record<Exchange["status"], string>> = {
	stopped: "Stopped",
	failed: "The model stopped answering",
	refused: "Not sent",
};

const waits = (exchange: Exchange) =>
	exchange.status === "interrupted" ||
	exchange.status === "queued" ||
	(exchange.status === "running" && !exchange.live);

/** An exchange as the bot stored it. */
const fromTurn = (turn: Turn): Exchange => ({
	key: turn.id,
	id: turn.id,
	message: turn.message,
	reply: turn.reply,
	status: turn.status,
	pair: turn.pair,
	interruption: turn.interruption,
});

/** Brings each followed exchange up to what the bot stored. */
function follow(exchanges: Exchange[], pending: Pending): Exchange[] {
	return exchanges.map((exchange) => {
		if (!exchange.id || exchange.live) return exchange;
		const turn = pending.turns.find((each) => each.id === exchange.id);
		if (turn) return { ...fromTurn(turn), key: exchange.key };
		return pending.queue.some((queued) => queued.id === exchange.id)
			? { ...exchange, status: "queued" }
			: exchange;
	});
}

function Home() {
	const { account } = Route.useRouteContext();
	const { workspace, access: loaded, sidebarPinned } = Route.useLoaderData();
	const { panel } = Route.useSearch();
	const navigate = useNavigate();
	const signOut = useSignOut();
	const [view, setView] = useState(loaded);
	const [exchanges, setExchanges] = useState<Exchange[]>([]);
	const { workspaceId } = workspace;
	const botId = workspace.chiefOfStaff.id;
	const access = accessOf(view);

	const running = exchanges.some((exchange) => exchange.live && exchange.status === "running");
	// While a connection is limited, what the owner sends waits in the bot's queue.
	const queueing =
		exchanges.some(waits) || access.connections.some((each) => each.state === "Throttled");
	const composer: ComposerMode = running
		? "running"
		: canMessage(access) || queueing
			? "ready"
			: "no-model";
	const update = (key: string, change: (exchange: Exchange) => Exchange) =>
		setExchanges((all) =>
			all.map((exchange) => (exchange.key === key ? change(exchange) : exchange)),
		);

	// Work left waiting from an earlier visit: the unfinished turn and the queue.
	useEffect(() => {
		void pendingTurns(workspaceId, botId, []).then((pending) => {
			if (!pending) return;
			const unfinished = pending.turns.find((turn) => turn.id === pending.unfinished);
			const waiting = [
				...(unfinished ? [fromTurn(unfinished)] : []),
				...pending.queue.map((queued): Exchange => ({
					key: queued.id,
					id: queued.id,
					message: queued.message,
					reply: "",
					status: "queued",
				})),
			];
			if (waiting.length) setExchanges((all) => (all.length ? all : waiting));
		});
	}, [workspaceId, botId]);

	const following = exchanges.filter(waits).flatMap((exchange) => exchange.id ?? []);
	const followed = following.join(",");
	useEffect(() => {
		if (!followed) return;
		const ids = followed.split(",");
		const read = async () => {
			const [pending, latest] = await Promise.all([
				pendingTurns(workspaceId, botId, ids),
				readModelAccess(),
			]);
			if (pending) setExchanges((all) => follow(all, pending));
			if (latest) setView(latest);
		};
		void read();
		const timer = setInterval(() => void read(), FOLLOW_MS);
		return () => clearInterval(timer);
	}, [followed, workspaceId, botId]);

	const send = async (message: string) => {
		const key = crypto.randomUUID();
		setExchanges((all) => [...all, { key, message, reply: "", status: "running", live: true }]);
		const status = await sendTurn(
			workspaceId,
			botId,
			message,
			(text) => update(key, (exchange) => ({ ...exchange, reply: exchange.reply + text })),
			(id) => update(key, (exchange) => ({ ...exchange, id })),
		);
		update(key, (exchange) => ({ ...exchange, status, live: false }));
	};

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
					? exchanges.map((exchange) => (
							<ExchangeBubbles key={exchange.key} exchange={exchange} access={access} />
						))
					: undefined
			}
		/>
	);
}

function ExchangeBubbles({ exchange, access }: { exchange: Exchange; access: ModelAccess }) {
	if (exchange.status === "queued") return <QueuedBubble>{exchange.message}</QueuedBubble>;
	const ended = ENDED[exchange.status];
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
			{exchange.interruption && exchange.pair && (
				<InterruptionCard
					access={access}
					// Carried on once it runs again on its pair.
					interruption={exchange.status === "interrupted" ? exchange.interruption : "Settled"}
					turnPair={exchange.pair}
					// Resuming on another pair is a later ticket, so the card offers none yet.
					defaultPair={exchange.pair}
				/>
			)}
		</>
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
