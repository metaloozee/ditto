import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { TurnStatus } from "#/bot-rpc.ts";
import { DittoMark } from "#/components/ditto-mark.tsx";
import { BotSettings, type ComposerMode } from "#/components/model-access.tsx";
import { ConversationBubble, ConversationContent } from "#/components/ui/conversation.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { WorkspaceFailed, WorkspacePending, WorkspaceView } from "#/components/workspace.tsx";
import { useSignOut } from "#/lib/auth-client.ts";
import { chooseBotOverride, getBotOverride } from "#/lib/bot-model.ts";
import { getModelAccess } from "#/lib/model-access-api.ts";
import { canMessage, type Pair } from "#/lib/model-access.ts";
import { sendTurn, stopTurn } from "#/lib/turn.ts";
import { getSidebarPinned, openWorkspace } from "#/lib/workspace.ts";

type HomeSearch = { panel?: "computer" };

export const Route = createFileRoute("/_account/")({
	validateSearch: (search): HomeSearch =>
		search.panel === "computer" ? { panel: "computer" } : {},
	// The open runs when the owner arrives; toggling the panel only changes the search.
	shouldReload: false,
	loader: async () => {
		const [workspace, access] = await Promise.all([openWorkspace(), getModelAccess()]);
		const override = await getBotOverride({
			data: { workspaceId: workspace.workspaceId, botId: workspace.chiefOfStaff.id },
		});
		return { workspace, access, override, sidebarPinned: getSidebarPinned() };
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
}

const ENDED: Partial<Record<Exchange["status"], string>> = {
	stopped: "Stopped",
	failed: "The model stopped answering",
	refused: "Not sent",
};

function Home() {
	const { account } = Route.useRouteContext();
	const { workspace, access, override: savedOverride, sidebarPinned } = Route.useLoaderData();
	const { panel } = Route.useSearch();
	const navigate = useNavigate();
	const signOut = useSignOut();
	const [exchanges, setExchanges] = useState<Exchange[]>([]);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [override, setOverride] = useState(savedOverride ?? undefined);
	const { workspaceId } = workspace;
	const botId = workspace.chiefOfStaff.id;

	const changeOverride = async (pair: Pair | undefined) => {
		const before = override;
		setOverride(pair);
		const refused = await chooseBotOverride(workspaceId, botId, pair ?? null);
		if (!refused) return;
		setOverride(before);
		toast({
			id: "notice-bot-model",
			state: "error",
			message: "Ditto’s model didn’t change",
			description: refused,
		});
	};

	const running = exchanges.at(-1)?.status === "running";
	const composer: ComposerMode = !canMessage(access) ? "no-model" : running ? "running" : "ready";
	const updateLast = (change: (last: Exchange) => Exchange) =>
		setExchanges((all) => {
			const last = all.at(-1);
			return last ? [...all.slice(0, -1), change(last)] : all;
		});

	const send = async (message: string) => {
		setExchanges((all) => [...all, { message, reply: "", status: "running" }]);
		const status = await sendTurn(workspaceId, botId, message, (text) =>
			updateLast((last) => ({ ...last, reply: last.reply + text })),
		);
		updateLast((last) => ({ ...last, status }));
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
			onOpenBotSettings={() => setSettingsOpen(true)}
			botSettings={
				<BotSettings
					name={workspace.chiefOfStaff.name}
					role="Chief of Staff"
					face={<DittoMark still />}
					access={{ connections: access.connections }}
					defaultPair={access.defaultPair ?? undefined}
					override={override}
					onOverrideChange={(pair) => void changeOverride(pair)}
					open={settingsOpen}
					onOpenChange={setSettingsOpen}
				/>
			}
			messages={
				exchanges.length > 0
					? exchanges.map((exchange, index) => (
							// Exchanges are only ever appended, so an index names one for the whole visit.
							<ExchangeBubbles key={index} exchange={exchange} />
						))
					: undefined
			}
		/>
	);
}

function ExchangeBubbles({ exchange }: { exchange: Exchange }) {
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
