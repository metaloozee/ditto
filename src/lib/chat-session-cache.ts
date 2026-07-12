import type {
	AssistantMessagePart,
	StreamToolCall,
} from "#/lib/agent-stream-client";

export type CachedChatMessage = {
	id: string | number;
	role: "user" | "assistant";
	content: string;
	createdAt?: Date | string | number | null;
	model?: string | null;
	tools?: StreamToolCall[];
	parts?: AssistantMessagePart[];
};

/** Conservative per-session bound for optimistic/cached messages. */
export const MAX_CACHED_MESSAGES_PER_SESSION = 100;

const sessionMessages = new Map<string, CachedChatMessage[]>();

function mergeById(
	existing: CachedChatMessage[],
	incoming: CachedChatMessage[],
): CachedChatMessage[] {
	const byId = new Map(
		existing.map((message) => [String(message.id), message]),
	);
	for (const message of incoming) {
		byId.set(String(message.id), message);
	}
	return [...byId.values()];
}

function applyCap(messages: CachedChatMessage[]): CachedChatMessage[] {
	if (messages.length <= MAX_CACHED_MESSAGES_PER_SESSION) {
		return messages;
	}
	// Keep the most recently seeded/merged tail when over cap.
	return messages.slice(-MAX_CACHED_MESSAGES_PER_SESSION);
}

export function seedSessionMessages(
	sessionId: string,
	messages: CachedChatMessage[],
): void {
	const current = sessionMessages.get(sessionId) ?? [];
	sessionMessages.set(sessionId, applyCap(mergeById(current, messages)));
}

export function readSessionMessages(sessionId: string): CachedChatMessage[] {
	return sessionMessages.get(sessionId) ?? [];
}

export function listPendingSessionMessages(
	sessionId: string,
	serverMessages: Array<{ id: string | number }>,
): CachedChatMessage[] {
	const cached = readSessionMessages(sessionId);
	if (cached.length === 0) {
		return [];
	}

	const serverIds = new Set(
		serverMessages.map((message) => String(message.id)),
	);
	return cached.filter((message) => !serverIds.has(String(message.id)));
}

/**
 * Drop cache entries that the server has confirmed (by id). Call after
 * refreshed server messages arrive, not during the optimistic window.
 * Returns true when any cached entry was removed.
 */
export function acknowledgeSessionMessages(
	sessionId: string,
	serverIds: Array<string | number>,
): boolean {
	const cached = sessionMessages.get(sessionId);
	if (!cached || cached.length === 0) {
		return false;
	}

	const ids = new Set(serverIds.map((id) => String(id)));
	const remaining = cached.filter((message) => !ids.has(String(message.id)));

	if (remaining.length === cached.length) {
		return false;
	}

	if (remaining.length === 0) {
		sessionMessages.delete(sessionId);
		return true;
	}

	sessionMessages.set(sessionId, remaining);
	return true;
}

/** Clear optimistic/cached messages for one session (e.g. after archive). */
export function clearSessionMessages(sessionId: string): void {
	sessionMessages.delete(sessionId);
}

/** Clear all cached chat messages (logout / project boundary). */
export function clearAllSessionMessages(): void {
	sessionMessages.clear();
}
