// The Credentials object's RPC surface, kept free of Worker imports like `workspace-rpc.ts`.

import type { Connection, ConnectionState, Interruption, Pair } from "./lib/model-access.ts";

/**
 * What an account's model access looks like to its owner. Never carries a key. A limit's
 * reset time travels as an ISO string; `accessOf` revives it.
 */
export interface ModelAccessView {
	connections: (Omit<Connection, "resetsAt"> & { resetsAt?: string })[];
	defaultPair: Pair | null;
	/** The included model's name, when the operator offers one. */
	included?: string;
}

/** What stopped a turn on its connection, and when a limit lifts if the provider said. */
export interface Fault {
	state: Exclude<Interruption, "Settled">;
	resetsAt?: string;
}

/**
 * The gates on the ChatGPT plan, as the operator recorded them. Self-deployed needs the
 * open-source license; hosted also needs OpenAI's approval. Empty means not recorded.
 */
export interface Deployment {
	mode: "self-deployed" | "hosted";
	license?: string;
	approval?: string;
}

/** Why a key wasn't stored: OpenCode refused it, didn't answer, or the model isn't offered. */
export type ConnectRefusal = "rejected" | "unavailable" | "unknown-model";

/**
 * What one inference call on `pair` needs, handed to the Bot for that call alone: the pair and
 * its credential, never the stored connection. Refused when the pair names no usable connection.
 */
export type Grant =
	| { pair: Pair; credential: { type: "api_key"; key: string } }
	/** The included model, by its Workers AI ID. No credential: requests go through `included()`. */
	| { pair: Pair; included: string }
	| { refused: "no-model" }
	/** The pair's connection is in trouble, so the turn waits for it instead of calling. */
	| { refused: "interrupted"; pair: Pair; fault: Fault };

export interface CredentialsRpc {
	view(): Promise<ModelAccessView>;
	/** Checks `key` with OpenCode on `model`, then stores it encrypted for `accountId`. */
	connectOpenCode(
		accountId: string,
		key: string,
		model: string,
	): Promise<{ connected: true } | { refused: ConnectRefusal }>;
	/**
	 * Stores a Sign in with ChatGPT credential made on the owner's machine, encrypted for
	 * `accountId`, replacing any earlier import. Refused while the deployment doesn't offer the
	 * plan, and unless it carries a client ID and the plan-usage scope.
	 */
	importChatGPT(
		accountId: string,
		credential: unknown,
	): Promise<"imported" | "malformed" | "not-offered">;
	/** Whether this deployment offers the ChatGPT plan, from its recorded gates alone. */
	offersChatGPT(): Promise<boolean>;
	/** Test stage only: answers this account as if the stage were configured as `deployment`. */
	deployAs(deployment: Deployment): Promise<void>;
	/** False when the pair names no connection of this account, or a model it doesn't offer. */
	chooseDefault(pair: Pair): Promise<boolean>;
	/**
	 * Forgets the connection and its stored access, and the default pair when it named it, so no
	 * later grant can use it. False when the account has no such connection.
	 */
	disconnect(connectionId: string): Promise<boolean>;
	/** The credential for one call on `pair`, or on the default pair when it is null. */
	grant(accountId: string, pair: Pair | null): Promise<Grant>;
	/**
	 * A ChatGPT access token for one more try after OpenAI `refused` one before it expired:
	 * rotated once, unless a rotation already replaced it, or the fault the rotation met. Null
	 * without a plan to use.
	 */
	replaceAccess(
		accountId: string,
		refused: string,
	): Promise<{ key: string } | { fault: Fault } | null>;
	/**
	 * Sends one Workers AI chat completion `body` for `accountId` to the included model, through
	 * AI Gateway with the account in its metadata. Refused with 403 when none is offered.
	 */
	included(accountId: string, body: string): Promise<Response>;
	/**
	 * Records that `botId` has work waiting on `pair`'s connection, and the `fault` it met if
	 * it met one. The object probes the provider with backoff and calls the bot's `recover`
	 * once it answers. Answers the connection's fault, or null when it's healthy.
	 */
	interrupted(accountId: string, botId: string, pair: Pair, fault?: Fault): Promise<Fault | null>;
	/**
	 * Probes a connection in trouble once, now, and answers its state afterwards; recovery
	 * wakes its bots as a scheduled probe would. A ReconnectNeeded key is never sent again, so
	 * that state answers without a probe. Null when the account has no such connection.
	 */
	check(accountId: string, connectionId: string): Promise<ConnectionState | null>;
	/**
	 * Test stage only: the next ChatGPT rotation saves its replacement, then drops the live
	 * instance before answering anyone, as an eviction at that moment would.
	 */
	evictAfterRotation(): Promise<void>;
	/** Test stage only: everything the object stores, exactly as stored. */
	stored(): Promise<Record<string, unknown>>;
	/** Test stage only: offers this account the included model, or not, whatever the stage says. */
	offerIncluded(offered: boolean): Promise<void>;
}
