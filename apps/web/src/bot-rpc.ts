// The Bot object's RPC surface, kept free of Worker imports like `workspace-rpc.ts`.

import type { Interruption, Pair } from "./lib/model-access.ts";

export type TurnStatus = "running" | "completed" | "stopped" | "failed" | "interrupted";

/** Why a turn waits on its connection instead of ending. */
export type TurnInterruption = Exclude<Interruption, "Settled">;

/** A turn as the Bot records it: one message in, one reply out, on the pair it started with. */
export interface Turn {
	id: string;
	pair: Pair;
	message: string;
	reply: string;
	status: TurnStatus;
	/** Set while the turn is interrupted, until its connection recovers and it resumes. */
	interruption?: TurnInterruption;
	startedAt: string;
	endedAt?: string;
}

/** One `data:` line of a turn's SSE stream. */
export type TurnEvent =
	| { type: "start"; turnId: string; pair: Pair }
	| { type: "delta"; text: string }
	| { type: "end"; status: Exclude<TurnStatus, "running">; interruption?: TurnInterruption };

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
	/** The turn as recorded, or null when this bot has none by that ID. */
	turn(turnId: string): Promise<Turn | null>;
	/**
	 * Carries on the interrupted turn on the pair it started with, once its connection
	 * answers again. Called by the account's Credentials object; does nothing without one.
	 */
	resume(accountId: string): Promise<void>;
	/** Test stage only: everything the object stores, exactly as stored. */
	stored(): Promise<Record<string, unknown>>;
}
