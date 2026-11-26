// The Bot object's RPC surface, kept free of Worker imports like `workspace-rpc.ts`.

import type { Fault } from "./credentials-rpc.ts";
import type { Pair } from "./lib/model-access.ts";

/** `interrupted`: the connection failed mid-turn, and the turn waits to resume on its pair. */
export type TurnStatus = "running" | "completed" | "stopped" | "failed" | "interrupted";

/** A turn as the Bot records it: one message in, one reply out, on the pair it started with. */
export interface Turn {
	id: string;
	pair: Pair;
	message: string;
	reply: string;
	status: TurnStatus;
	/** Why an interrupted turn stopped. Kept once it resumes, so its card can settle. */
	interruption?: Fault["state"];
	startedAt: string;
	endedAt?: string;
}

/** An owner's message waiting behind an interrupted turn. Its turn takes the same ID. */
export interface Queued {
	id: string;
	message: string;
	queuedAt: string;
}

/** The turns a page asked after, with what still waits: the unfinished turn and the queue. */
export interface Pending {
	turns: Turn[];
	unfinished: string | null;
	queue: Queued[];
}

/** One `data:` line of a turn's SSE stream. */
export type TurnEvent =
	| { type: "start"; turnId: string; pair: Pair }
	| { type: "delta"; text: string }
	| { type: "end"; status: Exclude<TurnStatus, "running"> };

/** Why a turn didn't start: no usable model for the account, or a turn already running. */
export type TurnRefusal = "no-model" | "busy";

/**
 * How a Resume on a new pair went: `resumed` once the turn is on its way, a repeat included;
 * `refused` when that pair can't take it now; `unknown` when the bot has no such turn.
 */
export type ResumeAnswer = "resumed" | "refused" | "unknown";

export interface BotRpc {
	/**
	 * Starts a turn on the bot's override, or else `accountId`'s default pair, and answers its
	 * SSE stream of `TurnEvent`s.
	 * Refuses before any upstream call when the bot's pair names no usable connection, even
	 * behind waiting work. Otherwise queues the message while a turn waits on its connection, or
	 * its connection has a fault.
	 */
	send(
		accountId: string,
		message: string,
	): Promise<
		{ stream: ReadableStream<Uint8Array> } | { queued: string } | { refused: TurnRefusal }
	>;
	/**
	 * Resumes the unfinished turn on its own pair, then runs the queue in order. Credentials
	 * calls it once the connection the bot waits on answers again.
	 */
	recover(accountId: string): Promise<void>;
	/**
	 * Moves the interrupted turn `turnId` onto `pair` and resumes it there with its reply so far,
	 * then runs the queue. Only the owner's explicit Resume calls it: nothing else moves a turn.
	 */
	resumeOn(accountId: string, turnId: string, pair: Pair): Promise<ResumeAnswer>;
	/** The turns named by `ids`, the unfinished turn and the queue. */
	pending(ids: string[]): Promise<Pending>;
	/** Stops the running turn and aborts its upstream request. False when none runs. */
	stop(): boolean;
	/** The pair this bot uses in place of the account default, or null when it inherits it. */
	override(): Promise<Pair | null>;
	/**
	 * Sets the bot's own pair from its next turn on, or null to inherit the default. False when
	 * the pair names no connection of `accountId`, or a model it doesn't offer.
	 */
	chooseOverride(accountId: string, pair: Pair | null): Promise<boolean>;
	/** Test stage only: everything the object stores, exactly as stored. */
	stored(): Promise<Record<string, unknown>>;
	/** Test stage only: drops the live instance, as an eviction would. */
	evict(): void;
}
