import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	archiveOwnedActiveSession,
	loadOwnedActiveSession,
	resolveSessionForMessageWrite,
	workspaceSessionRecencyUpdate,
} from "#/lib/workspace-session";

type LimitResult = unknown[];

function createDbMock(options: {
	selectResult?: LimitResult;
	updateResult?: unknown;
}) {
	const limit = vi.fn().mockResolvedValue(options.selectResult ?? []);
	const where = vi.fn().mockReturnValue({ limit });
	const from = vi.fn().mockReturnValue({ where });
	const select = vi.fn().mockReturnValue({ from });

	const updateWhere = vi.fn().mockResolvedValue(options.updateResult ?? []);
	const set = vi.fn().mockReturnValue({ where: updateWhere });
	const update = vi.fn().mockReturnValue({ set });

	return {
		db: { select, update } as never,
		select,
		from,
		where,
		limit,
		update,
		set,
		updateWhere,
	};
}

const activeSession = {
	id: "sess-1",
	projectId: "proj-1",
	userId: "user-1",
	status: "active" as const,
	title: "Chat",
};

describe("loadOwnedActiveSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the owned active session", async () => {
		const mock = createDbMock({ selectResult: [activeSession] });
		const session = await loadOwnedActiveSession({
			db: mock.db,
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
		});
		expect(session).toEqual(activeSession);
		expect(mock.select).toHaveBeenCalled();
		expect(mock.limit).toHaveBeenCalledWith(1);
	});

	it("returns null when no row matches (archived / missing / other user)", async () => {
		const mock = createDbMock({ selectResult: [] });
		const session = await loadOwnedActiveSession({
			db: mock.db,
			projectId: "proj-1",
			sessionId: "sess-archived",
			userId: "user-1",
		});
		expect(session).toBeNull();
	});
});

describe("resolveSessionForMessageWrite", () => {
	it("returns create when no explicit session id", async () => {
		const mock = createDbMock({ selectResult: [activeSession] });
		const result = await resolveSessionForMessageWrite({
			db: mock.db,
			projectId: "proj-1",
			userId: "user-1",
			sessionId: undefined,
		});
		expect(result).toEqual({ kind: "create" });
		expect(mock.select).not.toHaveBeenCalled();
	});

	it("returns existing for owned active session", async () => {
		const mock = createDbMock({ selectResult: [activeSession] });
		const result = await resolveSessionForMessageWrite({
			db: mock.db,
			projectId: "proj-1",
			userId: "user-1",
			sessionId: "sess-1",
		});
		expect(result).toEqual({ kind: "existing", session: activeSession });
	});

	it("returns not_found for archived / missing / cross-user id and never implies create", async () => {
		const mock = createDbMock({ selectResult: [] });
		const result = await resolveSessionForMessageWrite({
			db: mock.db,
			projectId: "proj-1",
			userId: "user-1",
			sessionId: "sess-archived",
		});
		expect(result).toEqual({ kind: "not_found" });
		expect(result.kind).not.toBe("create");
	});
});

describe("archiveOwnedActiveSession", () => {
	it("archives an owned active session", async () => {
		const mock = createDbMock({ selectResult: [activeSession] });
		const result = await archiveOwnedActiveSession({
			db: mock.db,
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
		});
		expect(result).toEqual({ id: "sess-1" });
		expect(mock.update).toHaveBeenCalled();
		expect(mock.set).toHaveBeenCalledWith({ status: "archived" });
	});

	it("returns null without updating when session is not an owned active row", async () => {
		const mock = createDbMock({ selectResult: [] });
		const result = await archiveOwnedActiveSession({
			db: mock.db,
			projectId: "proj-1",
			sessionId: "sess-missing",
			userId: "user-1",
		});
		expect(result).toBeNull();
		expect(mock.update).not.toHaveBeenCalled();
	});
});

describe("workspaceSessionRecencyUpdate", () => {
	it("builds an update of updatedAt for the session id", () => {
		const mock = createDbMock({});
		const statement = workspaceSessionRecencyUpdate(mock.db, "sess-1");
		expect(mock.update).toHaveBeenCalled();
		expect(mock.set).toHaveBeenCalledWith(
			expect.objectContaining({
				updatedAt: expect.anything(),
			}),
		);
		expect(statement).toBeDefined();
	});
});
