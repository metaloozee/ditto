// The Bot object's RPC surface, kept free of Worker imports like `workspace-rpc.ts`.

import type { Pair } from "./lib/model-access.ts";

export type TurnStatus = "running" | "completed" | "stopped" | "failed";

/** A turn as the Bot records it: one message in, one reply out, on the pair it started with. */
export interface Turn {
	id: string;
	pair: Pair;
	message: string;
	reply: string;
	status: TurnStatus;
	startedAt: string;
	endedAt?: string;
}

/** One `data:` line of a turn's SSE stream. */
export type TurnEvent =
	| { type: "start"; turnId: string; pair: Pair }
	| { type: "delta"; text: string }
	| { type: "end"; status: Exclude<TurnStatus, "running"> };

/** Why a turn didn't start: no usable model for the account, or a turn already running. */
export type TurnRefusal = "no-model" | "busy";

export interface BotRpc {
	/**
	 * Starts a turn on `accountId`'s default pair and answers its SSE stream of `TurnEvent`s.
	 * Refuses before any upstream call when the account has no usable connection.
	 */
	send(
		accountId: string,
		message: string,
	): Promise<{ stream: ReadableStream<Uint8Array> } | { refused: TurnRefusal }>;
	/** Stops the running turn and aborts its upstream request. False when none runs. */
	stop(): boolean;
	/** Test stage only: everything the object stores, exactly as stored. */
	stored(): Promise<Record<string, unknown>>;
}
