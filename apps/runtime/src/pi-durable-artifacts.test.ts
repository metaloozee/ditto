import { env, runInDurableObject } from "cloudflare:test";
import type { DurableObject } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
	ARCHIVE_COMPATIBILITY_KEY,
	type ArchiveArtifactV1,
	DEFAULT_ARCHIVE_LIMITS,
	parseArchiveArtifactV1,
} from "../../../packages/runtime-contracts/src/artifacts.js";
import {
	type ArtifactExecution,
	type ArtifactPermit,
	ArtifactStepRejected,
	type ArtifactStore,
	type BranchSyncAuthority,
	createRecoveryLedger,
	createWorkspaceRecovery,
	type RecoveryAuthority,
	type RecoveryStorage,
	r2ArtifactStore,
	sandboxArtifactExecution,
} from "./pi-durable-artifacts.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_FIXTURE_STORAGE: DurableObjectNamespace<DurableObject>;
		RECOVERY_ARTIFACTS: R2Bucket;
	}
}

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function sha256(bytes: Uint8Array) {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
	);
	return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function collect(stream: ReadableStream<Uint8Array>) {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}
function streamOf(bytes: Uint8Array, chunk = 7) {
	let offset = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset >= bytes.byteLength) return controller.close();
			controller.enqueue(bytes.slice(offset, offset + chunk));
			offset += chunk;
		},
	});
}

type Fault = (permit: ArtifactPermit) => void | Promise<void>;

/** In-memory execution sandbox: the archive is the JSON of its files and HEAD. */
function fakeExecution(files: Record<string, string>, head = HEAD) {
	const state = {
		files: { ...files },
		head,
		temp: undefined as Uint8Array | undefined,
		calls: [] as { method: string; args: unknown[] }[],
		faults: {} as Partial<Record<keyof ArtifactExecution, Fault>>,
		tamper: undefined as Uint8Array | undefined,
		extractDigest: undefined as string | undefined,
		fetched: [] as { window: string; ref: string }[],
	};
	const enter = async (method: keyof ArtifactExecution, args: unknown[]) => {
		state.calls.push({ method, args });
		await state.faults[method]?.(args[0] as ArtifactPermit);
	};
	const measure = async (bytes: Uint8Array) => ({
		compressedBytes: bytes.byteLength,
		extractedBytes: Object.values(state.files).join("").length,
		digest: await sha256(bytes),
	});
	const execution: ArtifactExecution = {
		async inspect(permit) {
			await enter("inspect", [permit]);
			return { head: state.head };
		},
		async pack(permit, limits) {
			await enter("pack", [permit, limits]);
			state.temp = encoder.encode(
				JSON.stringify({ files: state.files, head: state.head }),
			);
			return measure(state.temp);
		},
		async readArchive(permit) {
			await enter("readArchive", [permit]);
			return streamOf(state.tamper ?? state.temp!);
		},
		async discardArchive(permit) {
			await enter("discardArchive", [permit]);
			state.temp = undefined;
		},
		async writeArchive(permit, body) {
			await enter("writeArchive", [permit]);
			state.temp = await collect(body);
		},
		async extract(permit, limits, expectedDigest) {
			await enter("extract", [permit, limits, expectedDigest]);
			const bytes = state.temp!;
			if ((await sha256(bytes)) !== expectedDigest)
				throw new ArtifactStepRejected(
					"integrity_failed",
					"digest_mismatch",
					true,
				);
			const parsed = JSON.parse(decoder.decode(bytes)) as {
				files: Record<string, string>;
				head: string;
			};
			state.files = parsed.files;
			state.head = parsed.head;
			state.temp = undefined;
			return {
				compressedBytes: bytes.byteLength,
				extractedBytes: Object.values(parsed.files).join("").length,
				digest: state.extractDigest ?? (await sha256(bytes)),
			};
		},
		async fetchBranch(permit, request) {
			await enter("fetchBranch", [permit, request]);
			state.fetched.push(request);
			state.head = OTHER_HEAD;
			return { head: state.head };
		},
	};
	return { execution, state };
}

function fakeStore() {
	const objects = new Map<string, Uint8Array>();
	const state = {
		objects,
		puts: 0,
		failPut: false,
		deleted: [] as string[],
	};
	const store: ArtifactStore = {
		async put(key, body, length) {
			state.puts += 1;
			const bytes = await collect(body);
			if (state.failPut) throw new Error("R2 unavailable");
			if (bytes.byteLength !== length) throw new Error("length mismatch");
			objects.set(key, bytes);
		},
		async get(key) {
			const bytes = objects.get(key);
			return bytes ? { body: streamOf(bytes), size: bytes.byteLength } : null;
		},
		async delete(key) {
			state.deleted.push(key);
			objects.delete(key);
		},
	};
	return { store, state };
}

function fakeBranch(decision: "grant" | "deny" = "grant") {
	const state = { opened: [] as string[], closed: [] as string[], decision };
	const branch: BranchSyncAuthority = {
		async open(request) {
			state.opened.push(request.operation);
			return state.decision === "deny"
				? { denied: "revoked" }
				: { window: `window-${request.operation}`, ref: "refs/heads/feature" };
		},
		async close(window) {
			state.closed.push(window);
		},
	};
	return { branch, state };
}

async function withLedger(
	name: string,
	run: (context: {
		storage: RecoveryStorage;
		authority: RecoveryAuthority;
		ledger: ReturnType<typeof createRecoveryLedger>;
		reopen(): ReturnType<typeof createRecoveryLedger>;
		operations(): { step: string; state: string }[];
	}) => Promise<void>,
) {
	const stub = env.PI_FIXTURE_STORAGE.getByName(`artifacts-${name}`);
	await runInDurableObject(stub, async (_instance, state) => {
		const storage = state.storage as unknown as RecoveryStorage;
		const authority: RecoveryAuthority = {
			epoch: 1,
			generation: 1,
			quiescent: true,
			blocked: false,
		};
		let next = 0;
		const open = () =>
			createRecoveryLedger(storage, {
				authority: () => ({ ...authority }),
				now: () => 1_000_000,
				id: () => `id-${++next}`,
			});
		await run({
			storage,
			authority,
			ledger: open(),
			reopen: open,
			operations: () =>
				state.storage.sql
					.exec<{ step: string; state: string }>(
						"SELECT step, state FROM recovery_operations ORDER BY rowid",
					)
					.toArray(),
		});
	});
}

function recovery(
	ledger: ReturnType<typeof createRecoveryLedger>,
	execution: ArtifactExecution,
	store: ArtifactStore,
	branch?: BranchSyncAuthority,
) {
	return createWorkspaceRecovery({
		ledger,
		execution,
		store,
		branch,
		workspaceSessionId: "session-1",
	});
}

const SOURCE = {
	"README.md": "hello",
	"src/index.ts": "export {}",
	".env": "PUBLIC=1",
};

async function capturedArtifact(
	ledger: ReturnType<typeof createRecoveryLedger>,
	store: ArtifactStore,
) {
	const { execution } = fakeExecution(SOURCE);
	const scope = ledger.acquire("capture");
	const result = await recovery(ledger, execution, store).capture(scope);
	expect(ledger.release(scope)).toBe("released");
	if (result.status !== "verified") throw new Error(result.reason);
	return result.artifact;
}

describe("workspace recovery capture", () => {
	it("captures verified source evidence without giving execution the object key", async () => {
		await withLedger("capture", async ({ ledger, operations }) => {
			const { execution, state } = fakeExecution(SOURCE);
			const { store, state: stored } = fakeStore();
			const scope = ledger.acquire("capture");
			const result = await recovery(ledger, execution, store).capture(scope);
			expect(result.status).toBe("verified");
			if (result.status !== "verified") return;
			const artifact = parseArchiveArtifactV1(result.artifact);
			const bytes = stored.objects.get(artifact.objectKey)!;
			expect(artifact).toMatchObject({
				compatibilityKey: ARCHIVE_COMPATIBILITY_KEY,
				byteCount: bytes.byteLength,
				digest: await sha256(bytes),
				sourceCommit: HEAD,
			});
			expect(operations()).toEqual(
				["inspect", "pack", "upload", "discard"].map((step) => ({
					step,
					state: "completed",
				})),
			);
			const seen = JSON.stringify(state.calls);
			expect(seen).not.toContain(artifact.objectKey);
			expect(seen).not.toMatch(/workspace\/session-1|bucket|r2|X-Amz/i);
			expect(state.temp).toBeUndefined();
			expect(ledger.release(scope)).toBe("released");
		});
	});

	it("classifies loss during pack as a retryable failure with no upload", async () => {
		await withLedger("pack-loss", async ({ ledger, operations }) => {
			const { execution, state } = fakeExecution(SOURCE);
			state.faults.pack = () => {
				throw new Error("connection reset");
			};
			const { store, state: stored } = fakeStore();
			const scope = ledger.acquire("capture");
			expect(await recovery(ledger, execution, store).capture(scope)).toEqual({
				status: "failed",
				reason: "execution_failed",
				step: "pack",
				workspace: "unchanged",
			});
			expect(stored.puts).toBe(0);
			expect(operations().at(-1)).toEqual({ step: "pack", state: "failed" });
			expect(ledger.release(scope)).toBe("released");
		});
	});

	it("records a failed upload as an orphan and cleans it", async () => {
		await withLedger("upload-loss", async ({ ledger }) => {
			const { execution } = fakeExecution(SOURCE);
			const { store, state: stored } = fakeStore();
			stored.failPut = true;
			const scope = ledger.acquire("capture");
			const work = recovery(ledger, execution, store);
			expect(await work.capture(scope)).toMatchObject({
				reason: "store_failed",
				step: "upload",
				workspace: "unchanged",
			});
			expect(ledger.release(scope)).toBe("released");
			const [orphan] = ledger.orphans();
			expect(orphan).toMatch(/^workspace\/session-1\//);
			expect(await work.cleanup()).toEqual({ cleaned: 1 });
			expect(stored.deleted).toEqual([orphan]);
			expect(ledger.orphans()).toEqual([]);
		});
	});

	it("rejects uploaded bytes that differ from the packed archive and cleans them", async () => {
		await withLedger("upload-tamper", async ({ ledger }) => {
			const { execution, state } = fakeExecution(SOURCE);
			const { store, state: stored } = fakeStore();
			state.faults.readArchive = () => {
				const copy = state.temp!.slice();
				copy[0] = (copy[0]! + 1) % 256;
				state.tamper = copy;
			};
			const scope = ledger.acquire("capture");
			const work = recovery(ledger, execution, store);
			expect(await work.capture(scope)).toMatchObject({
				reason: "integrity_failed",
				step: "upload",
			});
			expect(stored.objects.size).toBe(1);
			ledger.release(scope);
			await work.cleanup();
			expect(stored.objects.size).toBe(0);
		});
	});

	it("denies the next suboperation after authority changes between steps", async () => {
		await withLedger("revoke-between", async ({ ledger, authority }) => {
			const { execution, state } = fakeExecution(SOURCE);
			const { store, state: stored } = fakeStore();
			const scope = ledger.acquire("capture");
			state.faults.pack = () => {
				authority.epoch = 2;
			};
			expect(await recovery(ledger, execution, store).capture(scope)).toEqual({
				status: "failed",
				reason: "authority_revoked",
				step: "upload",
				workspace: "unchanged",
			});
			expect(state.calls.map((c) => c.method)).toEqual(["inspect", "pack"]);
			expect(stored.puts).toBe(0);
		});
	});

	it("rechecks authority after asynchronous preparation and before transfer", async () => {
		await withLedger("revoke-prepare", async ({ ledger, authority }) => {
			const { execution, state } = fakeExecution(SOURCE);
			const { store, state: stored } = fakeStore();
			state.faults.readArchive = () => {
				authority.blocked = true;
			};
			const scope = ledger.acquire("capture");
			expect(
				await recovery(ledger, execution, store).capture(scope),
			).toMatchObject({ reason: "authority_revoked", step: "upload" });
			expect(stored.puts).toBe(0);
		});
	});
});

describe("workspace recovery authority at the end of a capture", () => {
	it("returns no evidence after authority changes mid-capture and orphans the upload", async () => {
		await withLedger("capture-stale", async ({ ledger, authority }) => {
			const { execution, state } = fakeExecution(SOURCE);
			const { store, state: stored } = fakeStore();
			state.faults.discardArchive = () => {
				authority.generation = 2;
			};
			const scope = ledger.acquire("capture");
			const work = recovery(ledger, execution, store);
			expect(await work.capture(scope)).toMatchObject({
				status: "failed",
				reason: "authority_revoked",
				workspace: "unchanged",
			});
			expect(ledger.orphans()).toHaveLength(1);
			await work.cleanup();
			expect(stored.objects.size).toBe(0);
		});
	});

	it("denies steps once the workspace stops being quiescent", async () => {
		await withLedger("capture-busy", async ({ ledger, authority }) => {
			const { execution, state } = fakeExecution(SOURCE);
			state.faults.inspect = () => {
				authority.quiescent = false;
			};
			const scope = ledger.acquire("capture");
			expect(
				await recovery(ledger, execution, fakeStore().store).capture(scope),
			).toMatchObject({ reason: "authority_revoked", step: "pack" });
		});
	});
});

describe("workspace recovery restore", () => {
	it("restores matching files and HEAD from verified evidence", async () => {
		await withLedger("restore", async ({ ledger, operations }) => {
			const { store } = fakeStore();
			const artifact = await capturedArtifact(ledger, store);
			const { execution, state } = fakeExecution(
				{ "stale.txt": "x" },
				OTHER_HEAD,
			);
			const scope = ledger.acquire("restore");
			expect(
				await recovery(ledger, execution, store).restore(scope, artifact),
			).toEqual({ status: "verified", artifact, head: HEAD });
			expect(state.files).toEqual(SOURCE);
			expect(state.head).toBe(HEAD);
			expect(operations().slice(-3)).toEqual(
				["download", "extract", "inspect"].map((step) => ({
					step,
					state: "completed",
				})),
			);
			expect(JSON.stringify(state.calls)).not.toContain(artifact.objectKey);
			expect(ledger.release(scope)).toBe("released");
		});
	});

	it("refuses incompatible or oversized evidence before any suboperation", async () => {
		await withLedger("restore-incompatible", async ({ ledger, operations }) => {
			const { store } = fakeStore();
			const artifact = await capturedArtifact(ledger, store);
			const before = operations().length;
			const { execution, state } = fakeExecution({});
			const scope = ledger.acquire("restore");
			const work = recovery(ledger, execution, store);
			expect(
				await work.restore(scope, {
					...artifact,
					compatibilityKey: "ditto-workspace-archive-v0",
				}),
			).toMatchObject({ reason: "incompatible", step: null });
			expect(
				await work.restore(scope, {
					...artifact,
					extractedBytes: DEFAULT_ARCHIVE_LIMITS.maxExtractedBytes + 1,
				}),
			).toMatchObject({ reason: "limit_exceeded", step: null });
			expect(operations().length).toBe(before);
			expect(state.calls).toEqual([]);
		});
	});

	it("rejects a corrupt or missing object before extraction", async () => {
		await withLedger("restore-corrupt", async ({ ledger }) => {
			const { store, state: stored } = fakeStore();
			const artifact = await capturedArtifact(ledger, store);
			const bytes = stored.objects.get(artifact.objectKey)!;
			bytes[bytes.byteLength - 1] = (bytes[bytes.byteLength - 1]! + 1) % 256;
			const { execution, state } = fakeExecution({ "keep.txt": "1" });
			const scope = ledger.acquire("restore");
			const work = recovery(ledger, execution, store);
			expect(await work.restore(scope, artifact)).toEqual({
				status: "failed",
				reason: "integrity_failed",
				step: "download",
				workspace: "unchanged",
			});
			stored.objects.clear();
			expect(await work.restore(scope, artifact)).toMatchObject({
				reason: "artifact_missing",
				step: "download",
			});
			expect(state.calls.map((c) => c.method)).toEqual(["writeArchive"]);
			expect(state.files).toEqual({ "keep.txt": "1" });
			expect(ledger.release(scope)).toBe("released");
		});
	});

	it("leaves the workspace untouched when the temp file changes before extraction", async () => {
		await withLedger("restore-swap", async ({ ledger }) => {
			const { store } = fakeStore();
			const artifact = await capturedArtifact(ledger, store);
			const { execution, state } = fakeExecution({ "keep.txt": "1" });
			state.faults.extract = () => {
				state.temp = encoder.encode(JSON.stringify({ files: {}, head: HEAD }));
			};
			const scope = ledger.acquire("restore");
			expect(
				await recovery(ledger, execution, store).restore(scope, artifact),
			).toEqual({
				status: "failed",
				reason: "integrity_failed",
				step: "extract",
				workspace: "unchanged",
			});
			expect(state.files).toEqual({ "keep.txt": "1" });
			expect(ledger.release(scope)).toBe("released");
		});
	});

	it("reports every failure after extraction as unusable", async () => {
		await withLedger("restore-after-extract", async ({ ledger, authority }) => {
			const { store } = fakeStore();
			const artifact = await capturedArtifact(ledger, store);
			const { execution, state } = fakeExecution({ "keep.txt": "1" });
			state.extractDigest = "d".repeat(64);
			let scope = ledger.acquire("restore");
			const work = recovery(ledger, execution, store);
			expect(await work.restore(scope, artifact)).toEqual({
				status: "failed",
				reason: "verification_failed",
				step: "extract",
				workspace: "unusable",
			});
			ledger.release(scope);
			state.extractDigest = undefined;
			state.faults.extract = () => {
				authority.epoch = 9;
			};
			scope = ledger.acquire("restore");
			authority.epoch = scope.epoch;
			expect(await work.restore(scope, artifact)).toEqual({
				status: "failed",
				reason: "authority_revoked",
				step: "inspect",
				workspace: "unusable",
			});
		});
	});

	it("denies inspection after extraction and rechecks before returning", async () => {
		await withLedger("restore-final", async ({ ledger, authority }) => {
			const { store } = fakeStore();
			const artifact = await capturedArtifact(ledger, store);
			const { execution, state } = fakeExecution({});
			state.faults.inspect = () => {
				authority.generation = 5;
			};
			let scope = ledger.acquire("restore");
			const work = recovery(ledger, execution, store);
			expect(await work.restore(scope, artifact)).toEqual({
				status: "failed",
				reason: "authority_revoked",
				step: null,
				workspace: "unusable",
			});
			ledger.release(scope);
			delete state.faults.inspect;
			state.faults.extract = () => {
				authority.blocked = true;
			};
			authority.generation = 6;
			scope = ledger.acquire("restore");
			authority.blocked = false;
			const admit = ledger.admit.bind(ledger);
			ledger.admit = (s, step, key) => {
				if (step === "inspect") authority.quiescent = false;
				return admit(s, step, key);
			};
			expect(await work.restore(scope, artifact)).toEqual({
				status: "failed",
				reason: "authority_revoked",
				step: "inspect",
				workspace: "unusable",
			});
		});
	});

	it("rechecks authority after the download opens and before writing", async () => {
		await withLedger(
			"restore-revoke-download",
			async ({ ledger, authority }) => {
				const { store } = fakeStore();
				const artifact = await capturedArtifact(ledger, store);
				const get = store.get.bind(store);
				store.get = async (key) => {
					const object = await get(key);
					authority.blocked = true;
					return object;
				};
				const { execution, state } = fakeExecution({ "keep.txt": "1" });
				const scope = ledger.acquire("restore");
				expect(
					await recovery(ledger, execution, store).restore(scope, artifact),
				).toMatchObject({
					reason: "authority_revoked",
					step: "download",
					workspace: "unchanged",
				});
				expect(state.calls).toEqual([]);
			},
		);
	});

	it("blocks the workspace when extraction is lost, across a restart", async () => {
		await withLedger("restore-extract-loss", async ({ ledger, reopen }) => {
			const { store } = fakeStore();
			const artifact = await capturedArtifact(ledger, store);
			const { execution, state } = fakeExecution({});
			state.faults.extract = () => {
				throw new Error("executor vanished");
			};
			const scope = ledger.acquire("restore");
			expect(
				await recovery(ledger, execution, store).restore(scope, artifact),
			).toEqual({
				status: "failed",
				reason: "outcome_unknown",
				step: "extract",
				workspace: "unknown",
			});
			expect(ledger.release(scope)).toBe("blocked");
			const restarted = reopen();
			restarted.recover();
			expect(() => restarted.acquire("restore")).toThrow(
				"Another mutation scope is held or unresolved",
			);
			expect(() => restarted.admit(scope, "inspect")).toThrow(
				"An unknown recovery outcome blocks admission",
			);
		});
	});

	it("marks the workspace unusable when extraction is rejected or HEAD differs", async () => {
		await withLedger("restore-unusable", async ({ ledger }) => {
			const { store } = fakeStore();
			const artifact = await capturedArtifact(ledger, store);
			const { execution, state } = fakeExecution({});
			state.faults.extract = () => {
				throw new ArtifactStepRejected("limit_exceeded", "limit_disk");
			};
			let scope = ledger.acquire("restore");
			const work = recovery(ledger, execution, store);
			expect(await work.restore(scope, artifact)).toEqual({
				status: "failed",
				reason: "limit_exceeded",
				step: "extract",
				workspace: "unusable",
			});
			expect(ledger.release(scope)).toBe("released");
			delete state.faults.extract;
			const wrongHead: ArchiveArtifactV1 = {
				...artifact,
				sourceCommit: OTHER_HEAD,
			};
			scope = ledger.acquire("restore");
			expect(await work.restore(scope, wrongHead)).toMatchObject({
				reason: "verification_failed",
				step: "inspect",
				workspace: "unusable",
			});
		});
	});

	it("turns a restart during a mutation into an unknown outcome and an interrupted upload into an orphan", async () => {
		await withLedger("restart", async ({ ledger, reopen, operations }) => {
			let scope = ledger.acquire("capture");
			ledger.admit(scope, "upload", "workspace/session-1/x/partial.tar.gz");
			let restarted = reopen();
			restarted.recover();
			expect(operations()).toEqual([{ step: "upload", state: "failed" }]);
			expect(restarted.orphans()).toEqual([
				"workspace/session-1/x/partial.tar.gz",
			]);
			scope = restarted.acquire("restore");
			restarted.admit(scope, "extract");
			restarted = reopen();
			restarted.recover();
			expect(operations().at(-1)).toEqual({
				step: "extract",
				state: "unknown",
			});
			expect(() => restarted.acquire("capture")).toThrow();
		});
	});
});

describe("R2 artifact store", () => {
	it("streams a capture into the bucket and restores it with a fixed length", async () => {
		await withLedger("r2", async ({ ledger }) => {
			const store = r2ArtifactStore(env.RECOVERY_ARTIFACTS);
			const artifact = await capturedArtifact(ledger, store);
			const object = await env.RECOVERY_ARTIFACTS.head(artifact.objectKey);
			expect(object?.size).toBe(artifact.byteCount);
			const { execution, state } = fakeExecution({}, OTHER_HEAD);
			const scope = ledger.acquire("restore");
			expect(
				await recovery(ledger, execution, store).restore(scope, artifact),
			).toMatchObject({ status: "verified", head: HEAD });
			expect(state.files).toEqual(SOURCE);
			await expect(
				store.put("short", streamOf(new Uint8Array(3)), 4),
			).rejects.toThrow();
			expect(await env.RECOVERY_ARTIFACTS.head("short")).toBeNull();
		});
	});
});

describe("workspace mutation scope and branch sync", () => {
	it("grants one exclusive scope only while the workspace is quiescent", async () => {
		await withLedger("scope", async ({ ledger, authority }) => {
			authority.quiescent = false;
			expect(() => ledger.acquire("capture")).toThrow("not quiescent");
			authority.quiescent = true;
			const scope = ledger.acquire("capture");
			expect(() => ledger.acquire("restore")).toThrow("held or unresolved");
			const permit = ledger.admit(scope, "inspect");
			expect(() => ledger.admit(scope, "pack")).toThrow("one at a time");
			expect(ledger.release(scope)).toBe("blocked");
			ledger.settle(permit, "completed");
			expect(ledger.release(scope)).toBe("released");
			expect(() => ledger.admit(scope, "pack")).toThrow("not held");
		});
	});

	it("needs runtime admission and product authority before any fetch", async () => {
		await withLedger("sync", async ({ ledger, authority }) => {
			const { execution, state } = fakeExecution(SOURCE);
			const denied = fakeBranch("deny");
			let scope = ledger.acquire("sync");
			expect(
				await recovery(
					ledger,
					execution,
					fakeStore().store,
					denied.branch,
				).syncBranch(scope, "feature"),
			).toMatchObject({ reason: "authority_denied", step: "fetch" });
			expect(state.fetched).toEqual([]);
			ledger.release(scope);

			const revoked = fakeBranch();
			const open = revoked.branch.open.bind(revoked.branch);
			revoked.branch.open = async (request) => {
				const grant = await open(request);
				authority.generation = 2;
				return grant;
			};
			scope = ledger.acquire("sync");
			expect(
				await recovery(
					ledger,
					execution,
					fakeStore().store,
					revoked.branch,
				).syncBranch(scope, "feature"),
			).toMatchObject({ reason: "authority_revoked", step: "fetch" });
			expect(state.fetched).toEqual([]);
			expect(revoked.state.closed).toHaveLength(1);
			ledger.release(scope);

			authority.generation = 3;
			const granted = fakeBranch();
			scope = ledger.acquire("sync");
			expect(
				await recovery(
					ledger,
					execution,
					fakeStore().store,
					granted.branch,
				).syncBranch(scope, "feature"),
			).toEqual({ status: "verified", head: OTHER_HEAD });
			expect(state.fetched).toEqual([
				{
					window: `window-${granted.state.opened[0]}`,
					ref: "refs/heads/feature",
				},
			]);
			expect(granted.state.closed).toHaveLength(1);
			expect(ledger.release(scope)).toBe("released");
		});
	});

	it("blocks after a lost fetch", async () => {
		await withLedger("sync-loss", async ({ ledger }) => {
			const { execution, state } = fakeExecution(SOURCE);
			state.faults.fetchBranch = () => {
				throw new Error("lost");
			};
			const { branch, state: product } = fakeBranch();
			const scope = ledger.acquire("sync");
			expect(
				await recovery(ledger, execution, fakeStore().store, branch).syncBranch(
					scope,
					"feature",
				),
			).toMatchObject({ reason: "outcome_unknown", workspace: "unknown" });
			expect(product.closed).toHaveLength(1);
			expect(ledger.release(scope)).toBe("blocked");
		});
	});
});

describe("sandbox artifact execution", () => {
	it("runs fixed paths with numeric limits and no storage values", async () => {
		const commands: string[] = [];
		const written: string[] = [];
		const sandbox = {
			async exec(command: string) {
				commands.push(command);
				if (command.includes("rev-parse"))
					return { exitCode: 0, stdout: `${HEAD}\n` };
				const action = command.includes(" create ") ? "create" : "restore";
				return {
					exitCode: 0,
					stdout: `${JSON.stringify({ ok: true, action, compressedBytes: 3, extractedBytes: 4, digest: "c".repeat(64) })}\n`,
				};
			},
			async readStream(path: string) {
				written.push(path);
				return streamOf(new Uint8Array(3));
			},
			async writeStream(path: string, body: ReadableStream<Uint8Array>) {
				written.push(path);
				await collect(body);
			},
		};
		const execution = sandboxArtifactExecution(sandbox, () => 0);
		const permit: ArtifactPermit = {
			operation: "op",
			scope: "scope",
			step: "pack",
			epoch: 1,
			generation: 1,
			deadlineAt: 60_000,
		};
		await execution.inspect(permit);
		await execution.pack(permit, DEFAULT_ARCHIVE_LIMITS);
		await execution.readArchive(permit);
		await execution.writeArchive(permit, streamOf(new Uint8Array(3)));
		await execution.extract(permit, DEFAULT_ARCHIVE_LIMITS, "c".repeat(64));
		await expect(
			execution.fetchBranch(permit, { window: "w", ref: "refs/heads/x" }),
		).rejects.toMatchObject({ reason: "authority_denied" });
		for (const command of commands) {
			expect(command).not.toMatch(/R2_|BUCKET|X-Amz|objectKey|https?:|token/i);
			expect(command.replace(/--max-[a-z-]+ \d+|c{64}/g, "")).not.toMatch(
				/\d{4,}|c{8}/,
			);
		}
		expect(commands[0]).toContain("env -i");
		expect(commands[0]).toContain("core.hooksPath=/dev/null");
		expect(new Set(written)).toEqual(
			new Set(["/tmp/ditto-workspace-archive.tar.gz"]),
		);
	});

	it("treats only the precheck digest mismatch as an untouched workspace", async () => {
		const permit = {
			operation: "op",
			scope: "s",
			step: "extract" as const,
			epoch: 1,
			generation: 1,
			deadlineAt: 1,
		};
		const reported = (error: string) =>
			sandboxArtifactExecution(
				{
					exec: async () => ({
						exitCode: 1,
						stdout: `${JSON.stringify({ ok: false, error })}\n`,
					}),
					readStream: async () => streamOf(new Uint8Array()),
					writeStream: async () => undefined,
				},
				() => 0,
			).extract(permit, DEFAULT_ARCHIVE_LIMITS, "c".repeat(64));
		await expect(reported("precheck_digest_mismatch")).rejects.toMatchObject({
			untouched: true,
		});
		await expect(reported("digest_mismatch")).rejects.toMatchObject({
			untouched: false,
		});
	});

	it("maps a reported archive failure to a known rejection", async () => {
		const execution = sandboxArtifactExecution(
			{
				exec: async () => ({
					exitCode: 1,
					stdout: `${JSON.stringify({ ok: false, error: "symlink_escape", message: "x" })}\n`,
				}),
				readStream: async () => streamOf(new Uint8Array()),
				writeStream: async () => undefined,
			},
			() => 0,
		);
		const permit = {
			operation: "op",
			scope: "s",
			step: "extract" as const,
			epoch: 1,
			generation: 1,
			deadlineAt: 1,
		};
		await expect(
			execution.extract(permit, DEFAULT_ARCHIVE_LIMITS, "c".repeat(64)),
		).rejects.toBeInstanceOf(ArtifactStepRejected);
		await expect(
			sandboxArtifactExecution(
				{
					exec: async () => ({ exitCode: 137, stdout: "" }),
					readStream: async () => streamOf(new Uint8Array()),
					writeStream: async () => undefined,
				},
				() => 0,
			).extract(permit, DEFAULT_ARCHIVE_LIMITS, "c".repeat(64)),
		).rejects.not.toBeInstanceOf(ArtifactStepRejected);
	});
});
