import { describe, expect, it } from "vitest";
import { deliverCandidateProjectValues } from "./candidate-project-values";
import { encryptText } from "./crypto";

const secret = "synthetic-project-value-secret";
const values = [
	{ key: "API_TOKEN", value: "synthetic-token-015" },
	{ key: "MODE", value: "test" },
];
const request = {
	version: 1,
	role: "repository_command",
	workspaceSessionId: "session",
	operationId: "op",
	executorGeneration: 1,
	epoch: 1,
	deadlineAt: 60_000,
};

async function deliver(
	overrides: {
		request?: unknown;
		authority?: () => Promise<{ current: boolean; generation: number }>;
		ciphertext?: () => Promise<string | null>;
		now?: () => number;
	} = {},
) {
	const ciphertext = await encryptText(JSON.stringify(values), secret);
	return deliverCandidateProjectValues({
		workspaceSessionId: "session",
		request: overrides.request ?? request,
		authority:
			overrides.authority ?? (async () => ({ current: true, generation: 1 })),
		ciphertext: overrides.ciphertext ?? (async () => ciphertext),
		secret,
		now: overrides.now ?? (() => 1_000),
	});
}

describe("candidate project value delivery", () => {
	it("decrypts values only for a current repository command of the session", async () => {
		expect(await deliver()).toEqual({
			version: 1,
			operationId: "op",
			status: "granted",
			values,
		});
		expect(await deliver({ ciphertext: async () => null })).toMatchObject({
			status: "granted",
			values: [],
		});
	});

	it("denies builders, preview, Git and archive before reading any ciphertext", async () => {
		for (const role of ["builder", "preview", "git", "archive"]) {
			let read = false;
			expect(
				await deliver({
					request: { ...request, role },
					ciphertext: async () => {
						read = true;
						return null;
					},
				}),
			).toEqual({
				version: 1,
				operationId: "op",
				status: "denied",
				reason: "role",
			});
			expect(read).toBe(false);
		}
	});

	it("denies stale, foreign, expired and malformed operations", async () => {
		const cases: [Parameters<typeof deliver>[0], string][] = [
			[{ request: { ...request, workspaceSessionId: "other" } }, "scope"],
			[{ request: { ...request, executorGeneration: 2 } }, "authority"],
			[
				{ authority: async () => ({ current: false, generation: 1 }) },
				"authority",
			],
			[
				{
					authority: async () => ({
						current: true,
						generation: 1,
						liveExecutors: 2,
					}),
				},
				"authority",
			],
			[
				{ authority: async () => Promise.reject(new Error("down")) },
				"authority",
			],
			[{ now: () => 60_000 }, "expired"],
			[{ request: { ...request, deadlineAt: 1_000 + 16 * 60_000 } }, "expired"],
			[{ request: { ...request, values: [] } }, "invalid"],
			[{ ciphertext: async () => "v1:not-valid" }, "unavailable"],
			[
				{
					ciphertext: async () =>
						encryptText(JSON.stringify([{ key: "A-B", value: "x" }]), secret),
				},
				"unavailable",
			],
		];
		for (const [overrides, reason] of cases)
			expect(await deliver(overrides)).toMatchObject({
				status: "denied",
				reason,
			});
	});

	it("rechecks authority and the deadline after decryption", async () => {
		let reads = 0;
		expect(
			await deliver({
				authority: async () => ({ current: reads++ === 0, generation: 1 }),
			}),
		).toMatchObject({ status: "denied", reason: "authority" });
		expect(reads).toBe(2);
		let clock = 1_000;
		expect(
			await deliver({
				now: () => clock,
				ciphertext: async () => {
					clock = 60_000;
					return null;
				},
			}),
		).toMatchObject({ status: "denied", reason: "expired" });
	});
});
