import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useState } from "react";

import { previewAccount, SettingsView } from "#/components/account.tsx";
import { DittoMark } from "#/components/ditto-mark.tsx";
import {
	BotSettings,
	type ComposerMode,
	InterruptionCard,
	ModelAccessSection,
	QueuedBubble,
} from "#/components/model-access.tsx";
import { ConversationBubble, ConversationContent } from "#/components/ui/conversation.tsx";
import { WorkspaceView } from "#/components/workspace.tsx";
import {
	canMessage,
	type Connection,
	type ConnectionState,
	INCLUDED,
	type Interruption,
	type ModelAccess,
	type Pair,
} from "#/lib/model-access.ts";
import type { Workspace } from "#/lib/workspace.ts";

const SETTINGS = [
	"none",
	"included",
	"connect",
	"connected",
	"refreshing",
	"throttled",
	"throttled-time",
	"unavailable",
	"reconnect",
	"reconnect-key",
	"not-offered",
	"select",
	"disconnect",
] as const;
const BOT = ["bot-default", "bot-override"] as const;
const CHAT = [
	"no-model",
	"running",
	"limit",
	"limit-same",
	"unavailable-card",
	"reconnect-card",
	"settled",
] as const;
const STATES = [...SETTINGS, ...BOT, ...CHAT] as const;
type State = (typeof STATES)[number];

const OPENCODE_MODELS = ["Model A", "Model B"];
const INCLUDED_MODEL = "Model C";
const PAIR_A: Pair = { connectionId: "oc", model: "Model A" };
const PAIR_B: Pair = { connectionId: "oc", model: "Model B" };
const RESETS_AT = new Date(new Date().setHours(15, 40, 0, 0));

const opencode = (state: ConnectionState, resetsAt?: Date): Connection => ({
	id: "oc",
	provider: "opencode",
	state,
	resetsAt,
	models: OPENCODE_MODELS,
});
const chatgpt = (state: ConnectionState): Connection => ({
	id: "gpt",
	provider: "chatgpt",
	state,
	models: ["Model D"],
});

/** Where each Settings state starts. */
function settingsStart(state: (typeof SETTINGS)[number]): {
	access: ModelAccess;
	chatgptOffered: boolean;
	defaultPair?: Pair;
} {
	switch (state) {
		case "none":
		case "connect":
			return { access: { connections: [] }, chatgptOffered: true };
		case "included":
			return {
				access: { connections: [], included: INCLUDED_MODEL },
				chatgptOffered: true,
				defaultPair: { connectionId: INCLUDED, model: INCLUDED_MODEL },
			};
		case "connected":
		case "disconnect":
			return {
				access: { connections: [opencode("Connected")], included: INCLUDED_MODEL },
				chatgptOffered: true,
				defaultPair: PAIR_A,
			};
		case "refreshing":
			return {
				access: { connections: [opencode("Refreshing")] },
				chatgptOffered: true,
				defaultPair: PAIR_A,
			};
		case "throttled":
			return {
				access: { connections: [opencode("Throttled")] },
				chatgptOffered: true,
				defaultPair: PAIR_A,
			};
		case "throttled-time":
			return {
				access: { connections: [opencode("Throttled", RESETS_AT)] },
				chatgptOffered: true,
				defaultPair: PAIR_A,
			};
		case "unavailable":
			return {
				access: { connections: [opencode("Unavailable")] },
				chatgptOffered: true,
				defaultPair: PAIR_A,
			};
		case "reconnect":
		case "select":
			return {
				access: {
					connections: [opencode("Connected"), chatgpt("ReconnectNeeded")],
					included: INCLUDED_MODEL,
				},
				chatgptOffered: true,
				defaultPair: PAIR_A,
			};
		case "reconnect-key":
			return {
				access: { connections: [opencode("ReconnectNeeded")], included: INCLUDED_MODEL },
				chatgptOffered: true,
				defaultPair: PAIR_A,
			};
		case "not-offered":
			return {
				access: { connections: [opencode("Connected")] },
				chatgptOffered: false,
				defaultPair: PAIR_A,
			};
	}
}

const workspace: Workspace = {
	workspaceId: "ws-preview",
	chiefOfStaff: { id: "bot-preview", name: "Ditto" },
	computer: "stopped",
};
const noop = () => {};
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const Route = createFileRoute("/design_/models")({
	head: () => ({ meta: [{ title: "Model access prototype · Ditto" }] }),
	validateSearch: (search): { state: State } => ({
		state: STATES.find((state) => state === search.state) ?? "connected",
	}),
	component: ModelDesigns,
});

/** Every surface of model access (#18), on local state only. */
function ModelDesigns() {
	const { state } = Route.useSearch();
	return (
		<>
			<nav
				aria-label="Model access states"
				className="fixed end-3 bottom-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-xl bg-popover p-1 shadow-md ring-1 ring-foreground/10 sm:max-w-xl"
			>
				{/* Collapses so it never hides the state it shows. */}
				<details open className="group">
					<summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2.5 py-1 text-caption text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
						<span>
							State: <span className="text-foreground">{state}</span>
						</span>
						<span className="group-open:hidden">Show</span>
						<span className="hidden group-open:inline">Hide</span>
					</summary>
					<div className="flex max-h-[40dvh] flex-col gap-1 overflow-y-auto pt-1">
						<Switcher items={SETTINGS} current={state} label="Settings" />
						<Switcher items={BOT} current={state} label="Bot" />
						<Switcher items={CHAT} current={state} label="Chat" />
					</div>
				</details>
			</nav>
			{(SETTINGS as readonly string[]).includes(state) ? (
				<SettingsPrototype key={state} state={state as (typeof SETTINGS)[number]} />
			) : (
				<WorkspacePrototype key={state} state={state} />
			)}
		</>
	);
}

function SettingsPrototype({ state }: { state: (typeof SETTINGS)[number] }) {
	const start = settingsStart(state);
	const [access, setAccess] = useState(start.access);
	const [defaultPair, setDefaultPair] = useState(start.defaultPair);
	const setConnection = (id: string, next: Partial<Connection> | null) =>
		setAccess((current) => ({
			...current,
			connections: next
				? current.connections.map((each) => (each.id === id ? { ...each, ...next } : each))
				: current.connections.filter((each) => each.id !== id),
		}));
	return (
		<div className="pb-40">
			<SettingsView
				account={previewAccount}
				onLink={noop}
				onSignOut={noop}
				modelAccess={
					<ModelAccessSection
						access={access}
						chatgptOffered={start.chatgptOffered}
						opencodeModels={OPENCODE_MODELS}
						defaultPair={defaultPair}
						onDefaultPairChange={setDefaultPair}
						onConnectKey={async (_key, model) => {
							await wait(900);
							setAccess((current) => ({
								...current,
								// A reconnect replaces the key the provider stopped accepting.
								connections: [
									opencode("Connected"),
									...current.connections.filter((each) => each.provider !== "opencode"),
								],
							}));
							setDefaultPair((current) => current ?? { connectionId: "oc", model });
						}}
						onConnectChatGPT={() =>
							setAccess((current) => ({
								...current,
								connections: [...current.connections, chatgpt("Connected")],
							}))
						}
						onDisconnect={(id) => {
							setConnection(id, null);
							setDefaultPair((current) => (current?.connectionId === id ? undefined : current));
						}}
						onCheck={async (id) => {
							await wait(1200);
							setConnection(id, { state: "Connected" });
						}}
						onReconnect={(id) => setConnection(id, { state: "Connected" })}
						initialConnecting={state === "connect"}
						initialDisconnecting={state === "disconnect" ? "oc" : undefined}
						pairSelectOpen={state === "select"}
					/>
				}
			/>
		</div>
	);
}

const INTERRUPTIONS: Partial<Record<State, Interruption>> = {
	limit: "Throttled",
	"limit-same": "Throttled",
	"unavailable-card": "Unavailable",
	"reconnect-card": "ReconnectNeeded",
	settled: "Settled",
};

function WorkspacePrototype({ state }: { state: State }) {
	const [panelOpen, setPanelOpen] = useState(state === "bot-default" || state === "bot-override");
	const [settingsOpen, setSettingsOpen] = useState(panelOpen);
	const [override, setOverride] = useState<Pair | undefined>(
		state === "bot-override" ? PAIR_B : undefined,
	);
	const interruption = INTERRUPTIONS[state];
	const turnState: ConnectionState =
		interruption && interruption !== "Settled" ? interruption : "Connected";
	const access: ModelAccess =
		state === "no-model"
			? { connections: [chatgpt("ReconnectNeeded")] }
			: {
					connections: [
						opencode(turnState, state === "limit" ? RESETS_AT : undefined),
						chatgpt("ReconnectNeeded"),
					],
					included: INCLUDED_MODEL,
				};
	// The owner changed the default after the turn started, so the card can offer it.
	const defaultPair = state === "limit-same" ? PAIR_A : PAIR_B;
	const composer: ComposerMode = !canMessage(access)
		? "no-model"
		: state === "running"
			? "running"
			: "ready";

	return (
		<WorkspaceView
			account={previewAccount}
			workspace={workspace}
			sidebarPinned
			panelOpen={panelOpen}
			onPanelOpenChange={setPanelOpen}
			onSignOut={noop}
			composer={composer}
			onOpenBotSettings={() => setSettingsOpen(true)}
			botSettings={
				<BotSettings
					name="Ditto"
					role="Chief of Staff"
					face={<DittoMark still />}
					access={access}
					defaultPair={PAIR_A}
					override={override}
					onOverrideChange={setOverride}
					open={settingsOpen}
					onOpenChange={setSettingsOpen}
				/>
			}
			messages={
				<>
					<ConversationBubble variant="sent">
						<ConversationContent>
							Draft the weekly update from this week’s notes.
						</ConversationContent>
					</ConversationBubble>
					{state === "no-model" ? (
						<ConversationBubble>
							<ConversationContent>
								Hi, I’m Ditto. Connect a model in Settings and I’ll get started.
							</ConversationContent>
						</ConversationBubble>
					) : (
						<ConversationBubble>
							<ConversationContent>
								{state === "running"
									? "Reading the notes now. Three files so far."
									: "I got through the first two sections, then the model stopped answering."}
							</ConversationContent>
						</ConversationBubble>
					)}
					{interruption && (
						<InterruptionCard
							access={access}
							interruption={interruption}
							turnPair={PAIR_A}
							defaultPair={defaultPair}
							settledPair={PAIR_B}
							onCheck={() => wait(1200)}
						/>
					)}
					{interruption && interruption !== "Settled" && (
						<QueuedBubble>Also add the hiring numbers.</QueuedBubble>
					)}
				</>
			}
		/>
	);
}

function Switcher<T extends State>({
	items,
	current,
	label,
}: {
	items: readonly T[];
	current: State;
	label: string;
}) {
	return (
		<div className="flex flex-wrap items-center gap-1">
			<span className="w-14 ps-1.5 text-caption text-muted-foreground">{label}</span>
			{items.map((name) => (
				<Link
					key={name}
					to="/design/models"
					search={{ state: name }}
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
