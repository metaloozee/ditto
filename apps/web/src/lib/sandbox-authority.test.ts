import { beforeEach, describe, expect, it } from "vitest";
import { privilegedOperations, sandboxIdentities } from "#/db/schema";
import {
	createSandboxAuthority,
	SandboxAuthorityError,
} from "./sandbox-authority";

type IdentityRow = typeof sandboxIdentities.$inferSelect;
type OperationRow = typeof privilegedOperations.$inferSelect;

function collectParams(node: unknown): unknown[] {
	const params: unknown[] = [];
	const seen = new Set<unknown>();
	const walk = (value: unknown) => {
		if (value == null || typeof value !== "object") {
			return;
		}
		if (seen.has(value)) {
			return;
		}
		seen.add(value);
		const obj = value as {
			queryChunks?: unknown[];
			value?: unknown;
			encoder?: unknown;
			table?: unknown;
		};
		// Skip column/table objects to avoid walking circular schema graphs.
		if ("table" in obj && "name" in obj && "columnType" in obj) {
			return;
		}
		if (Array.isArray(obj.queryChunks)) {
			for (const chunk of obj.queryChunks) {
				walk(chunk);
			}
			return;
		}
		if ("value" in obj) {
			params.push(obj.value);
			if (Array.isArray(obj.value)) {
				for (const part of obj.value) {
					walk(part);
				}
			}
		}
	};
	walk(node);
	return params.flatMap((value) => (Array.isArray(value) ? value : [value]));
}

function makeAuthorityDb() {
	const identities = new Map<string, IdentityRow>();
	const operations = new Map<string, OperationRow>();

	function findIdentity(where: unknown): IdentityRow | undefined {
		const params = collectParams(where).filter(
			(value): value is string => typeof value === "string",
		);
		for (const id of params) {
			const row = identities.get(id);
			if (row) return row;
		}
		return undefined;
	}

	function findOperations(where: unknown): OperationRow[] {
		const params = collectParams(where);
		const strings = params.filter(
			(value): value is string => typeof value === "string",
		);
		return [...operations.values()].filter((row) => {
			if (strings.includes(row.id)) {
				return true;
			}
			const identityMatch = strings.includes(row.identityId);
			const familyMatch = strings.includes(row.family);
			if (identityMatch && familyMatch) {
				return row.closedAt == null;
			}
			if (identityMatch && !familyMatch) {
				// closeOpenOperationsForIdentity: all open ops for identity
				return row.closedAt == null;
			}
			return false;
		});
	}

	const db = {
		insert(table: unknown) {
			return {
				values(value: Record<string, unknown>) {
					return {
						async returning() {
							if (table === sandboxIdentities) {
								const row: IdentityRow = {
									id: String(value.id),
									kind: value.kind as IdentityRow["kind"],
									sandboxId: String(value.sandboxId),
									containerId: String(value.containerId),
									userId: String(value.userId),
									projectId: String(value.projectId),
									workspaceSessionId:
										(value.workspaceSessionId as string | null) ?? null,
									lifecycleGeneration: Number(value.lifecycleGeneration ?? 1),
									state: value.state as IdentityRow["state"],
									retiredAt: (value.retiredAt as Date | null) ?? null,
									createdAt: new Date(),
									updatedAt: new Date(),
								};
								identities.set(row.id, row);
								return [row];
							}
							if (table === privilegedOperations) {
								const openConflict = [...operations.values()].some(
									(existing) =>
										existing.identityId === value.identityId &&
										existing.family === value.family &&
										existing.openSlot === "open" &&
										existing.closedAt == null,
								);
								if (openConflict && value.openSlot === "open") {
									throw new Error(
										"UNIQUE constraint failed: privileged_operations.open_family",
									);
								}
								const row: OperationRow = {
									id: String(value.id),
									identityId: String(value.identityId),
									lifecycleGeneration: Number(value.lifecycleGeneration),
									family: value.family as OperationRow["family"],
									type: String(value.type),
									contractVersion: Number(value.contractVersion),
									repository: (value.repository as string | null) ?? null,
									allowedRefs: (value.allowedRefs as string | null) ?? null,
									maxRequests: (value.maxRequests as number | null) ?? null,
									consumedRequests: Number(value.consumedRequests ?? 0),
									openedAt: value.openedAt as Date,
									expiresAt: value.expiresAt as Date,
									closedAt: (value.closedAt as Date | null) ?? null,
									closeReason: (value.closeReason as string | null) ?? null,
									correlationId: String(value.correlationId),
									openSlot: String(value.openSlot ?? "open"),
									createdAt: new Date(),
									updatedAt: new Date(),
								};
								operations.set(row.id, row);
								return [row];
							}
							return [];
						},
					};
				},
			};
		},
		select() {
			return {
				from(table: unknown) {
					return {
						where(where: unknown) {
							const rows =
								table === sandboxIdentities
									? (() => {
											const row = findIdentity(where);
											return row ? [row] : [];
										})()
									: table === privilegedOperations
										? findOperations(where)
										: [];
							const result = {
								async limit(n: number) {
									return rows.slice(0, n);
								},
								// Drizzle query builders are thenable; tests mirror that.
								// biome-ignore lint/suspicious/noThenProperty: drizzle thenable mock
								then(
									resolve: (value: unknown) => unknown,
									reject?: (error: unknown) => unknown,
								) {
									return Promise.resolve(rows).then(resolve, reject);
								},
							};
							return result;
						},
					};
				},
			};
		},
		update(table: unknown) {
			return {
				set(patch: Record<string, unknown>) {
					return {
						where(where: unknown) {
							return {
								async returning() {
									if (table === sandboxIdentities) {
										const row = findIdentity(where);
										if (!row) return [];
										const next: IdentityRow = {
											...row,
											lifecycleGeneration:
												"lifecycleGeneration" in patch
													? Number(patch.lifecycleGeneration)
													: row.lifecycleGeneration,
											state:
												"state" in patch
													? (patch.state as IdentityRow["state"])
													: row.state,
											retiredAt:
												"retiredAt" in patch
													? patch.retiredAt == null
														? null
														: new Date()
													: row.retiredAt,
											updatedAt: new Date(),
										};
										identities.set(row.id, next);
										return [next];
									}
									if (table === privilegedOperations) {
										const candidates = findOperations(where);
										const row =
											candidates.find((item) => item.closedAt == null) ??
											candidates[0];
										if (!row) return [];
										const next: OperationRow = {
											...row,
											closedAt:
												"closedAt" in patch
													? patch.closedAt == null
														? null
														: new Date()
													: row.closedAt,
											closeReason:
												"closeReason" in patch
													? (patch.closeReason as string | null)
													: row.closeReason,
											openSlot:
												"openSlot" in patch
													? String(patch.openSlot)
													: row.openSlot,
											consumedRequests:
												"consumedRequests" in patch
													? Number(patch.consumedRequests)
													: row.consumedRequests,
											updatedAt: new Date(),
										};
										operations.set(row.id, next);
										return [next];
									}
									return [];
								},
							};
						},
					};
				},
			};
		},
	};

	return { db: db as never, identities, operations };
}

describe("SandboxAuthority", () => {
	let store: ReturnType<typeof makeAuthorityDb>;
	let authority: ReturnType<typeof createSandboxAuthority>;

	beforeEach(() => {
		store = makeAuthorityDb();
		authority = createSandboxAuthority(store.db);
	});

	async function register() {
		return authority.registerIdentity({
			kind: "project_seed",
			sandboxId: "sbx-1",
			containerId: "container-1",
			userId: "user-1",
			projectId: "proj-1",
		});
	}

	it("unknown identity fails resolve before any token mint would run", async () => {
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: "missing",
					lifecycleGeneration: 1,
					containerId: "container-1",
				},
				"git_transport",
			),
		).rejects.toMatchObject({ code: "identity_not_found" });
	});

	it("stale generation fails", async () => {
		const identity = await register();
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity.id,
					lifecycleGeneration: 99,
					containerId: identity.containerId,
				},
				"git_transport",
			),
		).rejects.toMatchObject({ code: "generation_mismatch" });
	});

	it("containerId mismatch fails", async () => {
		const identity = await register();
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity.id,
					lifecycleGeneration: 1,
					containerId: "other-container",
				},
				"git_transport",
			),
		).rejects.toMatchObject({ code: "container_mismatch" });
	});

	it("retired identity fails", async () => {
		const identity = await register();
		await authority.retireIdentity(identity.id);
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity.id,
					lifecycleGeneration: 1,
					containerId: identity.containerId,
				},
				"git_transport",
			),
		).rejects.toMatchObject({ code: "identity_retired" });
		const tombstone = await authority.getIdentity(identity.id);
		expect(tombstone?.retiredAt).toBeInstanceOf(Date);
		expect(tombstone?.state).toBe("destroyed");
	});

	it("one identity cannot open two git_transport operations", async () => {
		const identity = await register();
		await authority.openOperation({
			identityId: identity.id,
			family: "git_transport",
			type: "project_seed_fetch",
			contractVersion: 1,
			repository: "acme/app",
			allowedRefs: ["refs/heads/main"],
			expiresAt: new Date(Date.now() + 60_000),
		});
		await expect(
			authority.openOperation({
				identityId: identity.id,
				family: "git_transport",
				type: "project_seed_fetch",
				contractVersion: 1,
				repository: "acme/app",
				allowedRefs: ["refs/heads/main"],
				expiresAt: new Date(Date.now() + 60_000),
			}),
		).rejects.toMatchObject({ code: "operation_already_open" });
	});

	it("withOperation closes on throw", async () => {
		const identity = await register();
		await expect(
			authority.withOperation(
				{
					identityId: identity.id,
					family: "git_transport",
					type: "project_seed_fetch",
					contractVersion: 1,
					expiresAt: new Date(Date.now() + 60_000),
				},
				async () => {
					throw new Error("boom");
				},
			),
		).rejects.toThrow("boom");

		const open = [...store.operations.values()].filter(
			(row) => row.closedAt == null,
		);
		expect(open).toHaveLength(0);
		const closed = [...store.operations.values()];
		expect(closed).toHaveLength(1);
		expect(closed[0]?.closeReason).toBe("with_operation_settled");
		expect(closed[0]?.openSlot).toBe(closed[0]?.id);
	});

	it("missing open operation carries no authority", async () => {
		const identity = await register();
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity.id,
					lifecycleGeneration: 1,
					containerId: identity.containerId,
				},
				"git_transport",
			),
		).rejects.toBeInstanceOf(SandboxAuthorityError);
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity.id,
					lifecycleGeneration: 1,
					containerId: identity.containerId,
				},
				"git_transport",
			),
		).rejects.toMatchObject({ code: "operation_not_open" });
	});

	it("resolve succeeds only with matching open operation", async () => {
		const identity = await register();
		await authority.openOperation({
			identityId: identity.id,
			family: "git_transport",
			type: "project_seed_fetch",
			contractVersion: 1,
			repository: "acme/app",
			allowedRefs: ["refs/heads/main"],
			expiresAt: new Date(Date.now() + 60_000),
		});
		const resolved = await authority.resolveOutboundRequest(
			{
				identityId: identity.id,
				lifecycleGeneration: 1,
				containerId: identity.containerId,
			},
			"git_transport",
		);
		expect(resolved.operation.repository).toBe("acme/app");
		expect(resolved.operation.allowedRefs).toEqual(["refs/heads/main"]);
	});
});
