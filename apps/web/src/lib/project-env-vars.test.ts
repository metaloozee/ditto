import { describe, expect, it } from "vitest";
import type { createDb } from "#/db";
import {
	compareAndSetProjectEnvVars,
	sanitizeEnvVars,
} from "#/lib/project-env-vars";

type ProjectRow = {
	id: string;
	userId: string;
	envVars: string | null;
};

/** Walk drizzle SQL chunks into a flat token list for CAS predicate checks. */
function sqlTokens(node: unknown): unknown[] {
	if (node == null || typeof node !== "object") return [node];
	const obj = node as {
		queryChunks?: unknown[];
		name?: string;
		columnType?: string;
		value?: unknown;
	};
	if (Array.isArray(obj.queryChunks)) {
		return obj.queryChunks.flatMap(sqlTokens);
	}
	if (typeof obj.name === "string" && obj.columnType != null) {
		return [{ col: obj.name }];
	}
	if ("value" in obj) {
		if (
			Array.isArray(obj.value) &&
			obj.value.every((part) => typeof part === "string")
		) {
			return [obj.value.join("")];
		}
		return [{ param: obj.value }];
	}
	return [];
}

function rowMatchesWhere(row: ProjectRow, where: unknown): boolean {
	const tokens = sqlTokens(where);
	const expected: Partial<
		Record<keyof ProjectRow, unknown | { isNull: true }>
	> = {};

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (
			token == null ||
			typeof token !== "object" ||
			!("col" in token) ||
			typeof (token as { col: unknown }).col !== "string"
		) {
			continue;
		}
		const col = (token as { col: string }).col as keyof ProjectRow;
		const next = tokens[i + 1];
		if (next === " is null") {
			expected[col] = { isNull: true };
			i += 1;
			continue;
		}
		if (next === " = ") {
			const valueToken = tokens[i + 2];
			if (
				valueToken != null &&
				typeof valueToken === "object" &&
				"param" in valueToken
			) {
				expected[col] = (valueToken as { param: unknown }).param;
			}
			i += 2;
		}
	}

	for (const [col, want] of Object.entries(expected) as Array<
		[keyof ProjectRow, unknown | { isNull: true }]
	>) {
		const got = row[col];
		if (
			want != null &&
			typeof want === "object" &&
			"isNull" in (want as object)
		) {
			if (got != null) return false;
			continue;
		}
		if (got !== want) return false;
	}
	return Object.keys(expected).length > 0;
}

function createCasDb(row: ProjectRow): {
	db: ReturnType<typeof createDb>;
	row: ProjectRow;
} {
	const state = { ...row };
	const db = {
		update() {
			return {
				set(values: { envVars?: string | null }) {
					return {
						where(where: unknown) {
							return {
								async returning() {
									if (!rowMatchesWhere(state, where)) return [];
									if ("envVars" in values) {
										state.envVars = values.envVars ?? null;
									}
									return [{ id: state.id }];
								},
							};
						},
					};
				},
			};
		},
	};

	return { db: db as unknown as ReturnType<typeof createDb>, row: state };
}

describe("sanitizeEnvVars", () => {
	it("preserves value whitespace byte-for-byte", () => {
		const value = " leading\ntrailing ";
		expect(sanitizeEnvVars([{ key: " SECRET_KEY ", value }])).toEqual([
			{ key: "SECRET_KEY", value },
		]);
	});
});

describe("compareAndSetProjectEnvVars", () => {
	it("succeeds when expected null and row envVars is null", async () => {
		const { db, row } = createCasDb({
			id: "proj-1",
			userId: "user-1",
			envVars: null,
		});
		const wrote = await compareAndSetProjectEnvVars({
			db,
			projectId: "proj-1",
			userId: "user-1",
			expectedCiphertext: null,
			nextCiphertext: "cipher-next",
		});
		expect(wrote).toBe(true);
		expect(row.envVars).toBe("cipher-next");
	});

	it("succeeds when expected ciphertext matches", async () => {
		const { db, row } = createCasDb({
			id: "proj-1",
			userId: "user-1",
			envVars: "cipher-a",
		});
		const wrote = await compareAndSetProjectEnvVars({
			db,
			projectId: "proj-1",
			userId: "user-1",
			expectedCiphertext: "cipher-a",
			nextCiphertext: "cipher-b",
		});
		expect(wrote).toBe(true);
		expect(row.envVars).toBe("cipher-b");
	});

	it("fails when expected ciphertext mismatches", async () => {
		const { db, row } = createCasDb({
			id: "proj-1",
			userId: "user-1",
			envVars: "cipher-b",
		});
		const wrote = await compareAndSetProjectEnvVars({
			db,
			projectId: "proj-1",
			userId: "user-1",
			expectedCiphertext: "cipher-a",
			nextCiphertext: "cipher-c",
		});
		expect(wrote).toBe(false);
		expect(row.envVars).toBe("cipher-b");
	});

	it("fails when expected null but row is non-null", async () => {
		const { db, row } = createCasDb({
			id: "proj-1",
			userId: "user-1",
			envVars: "cipher-a",
		});
		const wrote = await compareAndSetProjectEnvVars({
			db,
			projectId: "proj-1",
			userId: "user-1",
			expectedCiphertext: null,
			nextCiphertext: "cipher-b",
		});
		expect(wrote).toBe(false);
		expect(row.envVars).toBe("cipher-a");
	});

	it("fails on wrong userId or id", async () => {
		const { db, row } = createCasDb({
			id: "proj-1",
			userId: "user-1",
			envVars: "cipher-a",
		});
		expect(
			await compareAndSetProjectEnvVars({
				db,
				projectId: "proj-1",
				userId: "other-user",
				expectedCiphertext: "cipher-a",
				nextCiphertext: "cipher-b",
			}),
		).toBe(false);
		expect(
			await compareAndSetProjectEnvVars({
				db,
				projectId: "other-proj",
				userId: "user-1",
				expectedCiphertext: "cipher-a",
				nextCiphertext: "cipher-b",
			}),
		).toBe(false);
		expect(row.envVars).toBe("cipher-a");
	});
});
