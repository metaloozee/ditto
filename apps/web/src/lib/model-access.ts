// What the owner sees of their model access. Pure, so the Settings section, the pair select,
// bot settings and the interruption card all read a connection the same way.

export type ConnectionState =
	| "Connected"
	| "Refreshing"
	| "Throttled"
	| "Unavailable"
	| "ReconnectNeeded";

export type ConnectionProvider = "opencode" | "chatgpt";

export interface Connection {
	id: string;
	provider: ConnectionProvider;
	state: ConnectionState;
	/** When a limit lifts, only if the provider said. */
	resetsAt?: Date;
	models: readonly string[];
}

/**
 * The models an OpenCode key is offered with, as the owner chose them; the first is the one a
 * connect form starts on. Pi's catalogue says which OpenCode endpoint serves each: chat
 * completions for all but `gpt-6-luna`, which is on Responses.
 */
export const OPENCODE_MODELS: readonly string[] = [
	"deepseek-v4.1-flash",
	"glm-5.3",
	"glm-5.3-flash",
	"gpt-6-luna",
];

/**
 * The models a ChatGPT plan is offered with, on the plan-usage Responses endpoint. The first is
 * the one the feasibility study proved. Each is a reasoning model in Pi's catalogue, so Pi sends a
 * bot's instructions as a `developer` item, never the `system` item the flow rejects.
 */
export const CHATGPT_MODELS: readonly string[] = [
	"gpt-5.6-luna",
	"gpt-5.5",
	"gpt-5.4",
	"gpt-5.4-mini",
];

export const PROVIDER_NAMES: Record<ConnectionProvider, string> = {
	opencode: "OpenCode",
	chatgpt: "ChatGPT plan",
};

/** How a connection signs in, named the way its provider names it. */
const CREDENTIAL: Record<ConnectionProvider, { issuer: string; noun: string }> = {
	opencode: { issuer: "OpenCode", noun: "key" },
	chatgpt: { issuer: "OpenAI", noun: "sign-in" },
};

export type StateTone = "success" | "busy" | "muted" | "destructive";
export type StateActionKind = "disconnect" | "check" | "reconnect";

export interface StateView {
	label: string;
	tone: StateTone;
	detail?: string;
	action?: { kind: StateActionKind; label: string; primary: boolean };
}

export function stateView(
	connection: Pick<Connection, "state" | "resetsAt"> & { provider?: ConnectionProvider },
	format: { locale?: string; timeZone?: string } = {},
): StateView {
	const { issuer, noun } = connection.provider
		? CREDENTIAL[connection.provider]
		: { issuer: "The model provider", noun: "credential" };
	switch (connection.state) {
		case "Connected":
			return {
				label: "Connected",
				tone: "success",
				action: { kind: "disconnect", label: "Disconnect", primary: false },
			};
		case "Refreshing":
			return { label: "Refreshing", tone: "busy" };
		case "Throttled":
			return {
				label: "Limit reached",
				tone: "muted",
				detail: connection.resetsAt
					? `Resets at ${connection.resetsAt.toLocaleTimeString(format.locale ?? "en-US", {
							hour: "numeric",
							minute: "2-digit",
							timeZone: format.timeZone,
						})}`
					: "Your bots carry on when it lifts.",
			};
		case "Unavailable":
			return {
				label: "Unavailable",
				tone: "muted",
				detail: `${issuer} isn’t responding. Ditto keeps checking.`,
				action: { kind: "check", label: "Check again", primary: false },
			};
		case "ReconnectNeeded":
			return {
				label: "Reconnect needed",
				tone: "destructive",
				detail: `${issuer} no longer accepts this ${noun}.`,
				action: { kind: "reconnect", label: "Reconnect", primary: true },
			};
	}
}

/** A connection and one of its models, chosen together. The included model has no connection. */
export interface Pair {
	connectionId: string;
	model: string;
}

export const INCLUDED = "included";

export interface ModelAccess {
	connections: readonly Connection[];
	/** The included model's name, when the operator enabled it. */
	included?: string;
}

/** A refresh finishes on its own, so turns can still start on a refreshing connection. */
export function isUsable(state: ConnectionState): boolean {
	return state === "Connected" || state === "Refreshing";
}

export interface PairGroup {
	key: string;
	label: string;
	/** Why the group can't be picked. */
	status?: string;
	disabled: boolean;
	pairs: Pair[];
}

export function pairGroups(access: ModelAccess): PairGroup[] {
	const groups: PairGroup[] = access.connections.map((connection) => {
		const usable = isUsable(connection.state);
		return {
			key: connection.id,
			label: PROVIDER_NAMES[connection.provider],
			...(usable ? {} : { status: stateView(connection).label }),
			disabled: !usable,
			pairs: connection.models.map((model) => ({ connectionId: connection.id, model })),
		};
	});
	if (access.included) {
		groups.push({
			key: INCLUDED,
			label: "Included",
			disabled: false,
			pairs: [{ connectionId: INCLUDED, model: access.included }],
		});
	}
	return groups;
}

/** Where a pair's model runs: its connection's provider, or the included model. */
export function pairSource(access: ModelAccess, pair: Pair): string {
	const connection = access.connections.find((each) => each.id === pair.connectionId);
	if (connection) return PROVIDER_NAMES[connection.provider];
	if (pair.connectionId === INCLUDED) return "Included";
	if (pair.connectionId === "opencode" || pair.connectionId === "chatgpt") {
		return PROVIDER_NAMES[pair.connectionId];
	}
	return "Disconnected";
}

export function pairLabel(access: ModelAccess, pair: Pair): string {
	return `${pair.model} · ${pairSource(access, pair)}`;
}

export function samePair(a: Pair | undefined, b: Pair | undefined): boolean {
	return a?.connectionId === b?.connectionId && a?.model === b?.model;
}

export function canMessage(access: ModelAccess): boolean {
	return (
		Boolean(access.included) || access.connections.some((connection) => isUsable(connection.state))
	);
}

/** Why a turn stopped, or `Settled` once it carried on. */
export type Interruption = "Throttled" | "Unavailable" | "ReconnectNeeded" | "Settled";

export type InterruptionAction =
	| { kind: "resume"; pair: Pair; primary: true }
	| { kind: "settings" | "check" | "reconnect"; primary: boolean };

/**
 * A limit never moves a turn by itself: the owner resumes it on the default pair, offered
 * only when the default differs from the pair the turn started on. A settled card has no
 * Undo, since a resumed turn can't be taken back.
 */
export function interruptionActions(
	interruption: Interruption,
	turnPair: Pair,
	defaultPair: Pair | undefined,
): InterruptionAction[] {
	switch (interruption) {
		case "Throttled":
			return defaultPair && !samePair(turnPair, defaultPair)
				? [
						{ kind: "resume", pair: defaultPair, primary: true },
						{ kind: "settings", primary: false },
					]
				: [{ kind: "settings", primary: false }];
		case "Unavailable":
			return [{ kind: "check", primary: false }];
		case "ReconnectNeeded":
			return [{ kind: "reconnect", primary: true }];
		case "Settled":
			return [];
	}
}
