// The Credentials object's RPC surface, kept free of Worker imports like `workspace-rpc.ts`.

import type { Connection, Pair } from "./lib/model-access.ts";

/** What an account's model access looks like to its owner. Never carries a key. */
export interface ModelAccessView {
	connections: Omit<Connection, "resetsAt">[];
	defaultPair: Pair | null;
}

/** Why a key wasn't stored: OpenCode refused it, didn't answer, or the model isn't offered. */
export type ConnectRefusal = "rejected" | "unavailable" | "unknown-model";

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
	/** Test stage only: everything the object stores, exactly as stored. */
	stored(): Promise<Record<string, unknown>>;
}
