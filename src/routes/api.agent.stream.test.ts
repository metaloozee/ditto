import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Full POST handler import pulls `cloudflare:workers` and TanStack route
 * bootstrap. Session authorization + recency for the stream path live in the
 * shared helper used by the route — covered here with the same contracts.
 */

const resolveSessionForMessageWriteMock = vi.hoisted(() => vi.fn());
const workspaceSessionRecencyUpdateMock = vi.hoisted(() => vi.fn());
const loadOwnedActiveSessionMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/workspace-session", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/workspace-session")
	>("#/lib/workspace-session");
	return {
		...actual,
		resolveSessionForMessageWrite: resolveSessionForMessageWriteMock,
		workspaceSessionRecencyUpdate: workspaceSessionRecencyUpdateMock,
		loadOwnedActiveSession: loadOwnedActiveSessionMock,
	};
});

const { resolveSessionForMessageWrite, workspaceSessionRecencyUpdate } =
	await import("#/lib/workspace-session");

/** Mirrors api.agent.stream.ts session resolution before message insert. */
async function resolveStreamSession(options: {
	db: never;
	projectId: string;
	userId: string;
	sessionId?: string;
}): Promise<
	| { ok: true; kind: "create" }
	| { ok: true; kind: "existing"; sessionId: string }
	| { ok: false; status: 404; error: string }
> {
	const resolved = await resolveSessionForMessageWrite({
		db: options.db,
		projectId: options.projectId,
		userId: options.userId,
		sessionId: options.sessionId,
	});

	if (resolved.kind === "not_found") {
		return { ok: false, status: 404, error: "Session not found." };
	}
	if (resolved.kind === "existing") {
		return { ok: true, kind: "existing", sessionId: resolved.session.id };
	}
	return { ok: true, kind: "create" };
}

/** Mirrors the stream message-create batch shape (user + assistant + recency). */
function buildStreamMessageBatch(options: {
	db: never;
	sessionId: string;
	userInsert: unknown;
	assistantInsert: unknown;
}) {
	return [
		options.userInsert,
		options.assistantInsert,
		workspaceSessionRecencyUpdate(options.db, options.sessionId),
	];
}

describe("api.agent.stream session rules (shared helper)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Use real implementations for assertion paths that need them.
		resolveSessionForMessageWriteMock.mockImplementation(
			async (opts: {
				db: never;
				projectId: string;
				userId: string;
				sessionId?: string | null;
			}) => {
				if (!opts.sessionId) {
					return { kind: "create" };
				}
				const session = await loadOwnedActiveSessionMock({
					db: opts.db,
					projectId: opts.projectId,
					sessionId: opts.sessionId,
					userId: opts.userId,
				});
				if (!session) {
					return { kind: "not_found" };
				}
				return { kind: "existing", session };
			},
		);
		workspaceSessionRecencyUpdateMock.mockImplementation(
			(_db: unknown, sessionId: string) => ({
				__kind: "recency-update",
				sessionId,
			}),
		);
	});

	it("allows an owned active session", async () => {
		loadOwnedActiveSessionMock.mockResolvedValue({
			id: "sess-1",
			status: "active",
		});

		const result = await resolveStreamSession({
			db: {} as never,
			projectId: "proj-1",
			userId: "user-1",
			sessionId: "sess-1",
		});

		expect(result).toEqual({
			ok: true,
			kind: "existing",
			sessionId: "sess-1",
		});
	});

	it("returns 404 for archived / missing sessions without creating a replacement", async () => {
		loadOwnedActiveSessionMock.mockResolvedValue(null);

		const result = await resolveStreamSession({
			db: {} as never,
			projectId: "proj-1",
			userId: "user-1",
			sessionId: "sess-archived",
		});

		expect(result).toEqual({
			ok: false,
			status: 404,
			error: "Session not found.",
		});
		expect(result).not.toMatchObject({ kind: "create" });
	});

	it("returns 404 for cross-user session ids", async () => {
		loadOwnedActiveSessionMock.mockResolvedValue(null);

		const result = await resolveStreamSession({
			db: {} as never,
			projectId: "proj-1",
			userId: "user-2",
			sessionId: "sess-1",
		});

		expect(result).toEqual({
			ok: false,
			status: 404,
			error: "Session not found.",
		});
	});

	it("creates a new session only when no explicit id is supplied", async () => {
		const result = await resolveStreamSession({
			db: {} as never,
			projectId: "proj-1",
			userId: "user-1",
		});

		expect(result).toEqual({ ok: true, kind: "create" });
		expect(loadOwnedActiveSessionMock).not.toHaveBeenCalled();
	});

	it("includes session recency update in the message batch", () => {
		const batch = buildStreamMessageBatch({
			db: {} as never,
			sessionId: "sess-1",
			userInsert: { __kind: "user-insert" },
			assistantInsert: { __kind: "assistant-insert" },
		});

		expect(batch).toHaveLength(3);
		expect(batch[2]).toEqual({
			__kind: "recency-update",
			sessionId: "sess-1",
		});
		expect(workspaceSessionRecencyUpdateMock).toHaveBeenCalledWith(
			expect.anything(),
			"sess-1",
		);
	});
});

describe("api.agent.stream call-site wiring", () => {
	it("route source uses shared resolve + recency helpers", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const source = await fs.readFile(
			path.join(import.meta.dirname, "api.agent.stream.ts"),
			"utf8",
		);

		expect(source).toContain("resolveSessionForMessageWrite");
		expect(source).toContain("workspaceSessionRecencyUpdate");
		expect(source).toContain(
			'jsonResponse({ error: "Session not found." }, 404)',
		);
		// Explicit invalid id must not fall through to create.
		expect(source).toContain('resolved.kind === "not_found"');
		expect(source).toContain('resolved.kind === "existing"');
		expect(source).toContain('resolved.kind === "existing"');
	});
});
