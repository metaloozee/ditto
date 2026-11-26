// The Credentials object's RPC surface, kept free of Worker imports like `workspace-rpc.ts`.

import type { Connection, Pair } from "./lib/model-access.ts";

/** What an account's model access looks like to its owner. Never carries a key. */
export interface ModelAccessView {
	connections: Omit<Connection, "resetsAt">[];
	defaultPair: Pair | null;
}

/** Why a key wasn't stored: OpenCode refused it, didn't answer, or the model isn't offered. */
export type ConnectRefusal = "rejected" | "unavailable" | "unknown-model";

/**
 * What one inference call on `pair` needs, handed to the Bot for that call alone: the pair and
 * its credential, never the stored connection. Refused when the pair names no usable connection.
 */
export type Grant =
	| { pair: Pair; credential: { type: "api_key"; key: string } }
	| { refused: "no-model" };

export interface CredentialsRpc {
	view(): Promise<ModelAccessView>;
	/** Checks `key` with OpenCode on `model`, then stores it encrypted for `accountId`. */
	connectOpenCode(
		accountId: string,
		key: string,
		model: string,
	): Promise<{ connected: true } | { refused: ConnectRefusal }>;
	/** False when the pair names no connection of this account, or a model it doesn't offer. */
	chooseDefault(pair: Pair): Promise<boolean>;
	/**
	 * Forgets the connection and its stored access, and the default pair when it named it, so no
	 * later grant can use it. False when the account has no such connection.
	 */
	disconnect(connectionId: string): Promise<boolean>;
	/** The credential for one call on `pair`, or on the default pair when it is null. */
	grant(accountId: string, pair: Pair | null): Promise<Grant>;
	/** Test stage only: everything the object stores, exactly as stored. */
	stored(): Promise<Record<string, unknown>>;
}
