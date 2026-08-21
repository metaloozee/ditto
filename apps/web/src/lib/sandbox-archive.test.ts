import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { archives, workspaceSessions } from "#/db/schema";

const acquireLeaseMock = vi.hoisted(() => vi.fn());
const releaseLeaseMock = vi.hoisted(() => vi.fn());
const withLockMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/session-preview", () => ({
	acquireProjectPreviewLease: acquireLeaseMock,
	releaseProjectPreviewLease: releaseLeaseMock,
}));

vi.mock("#/lib/session-workspace-lock", () => ({
	withSessionWorkspaceLock: withLockMock,
}));

const {
	ARCHIVE_CLI_PATH,
	ARCHIVE_COMPATIBILITY_KEY,
	ARCHIVE_FORMAT_VERSION,
	ARCHIVE_MAX_COMPRESSED_BYTES,
	ARCHIVE_MAX_DISK_PERCENT,
	ARCHIVE_MAX_EXTRACTED_BYTES,
	ARCHIVE_RPC_STREAM_THRESHOLD_BYTES,
	ARCHIVE_TEMP_PATH,
	createArchive,
	deleteArchive,
	restoreArchive,
	retryArchiveCleanup,
} = await import("./sandbox-archive");

const EMPTY_SHA256 =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

type ArchiveRecord = {
	id: string;
	ownerKind: string;
	ownerId: string;
	objectKey: string;
	formatVersion: number;
	compatibilityKey: string;
	byteCount: number;
	digest: string;
	generation: number;
	status: string;
	cleanupRetryAt: number | null;
	cleanupAttempts: number;
	createdAt: Date;
	updatedAt: Date;
};

function conditionText(condition: unknown): string {
	try {
		return JSON.stringify(condition);
	} catch {
		return String(condition);
	}
}

function makeDb(sessionIds: string[] = []) {
	const archiveRows = new Map<string, ArchiveRecord>();

	function findId(condition: unknown): string | undefined {
		const blob = conditionText(condition);
		return [...archiveRows.keys()].find((id) => blob.includes(id));
	}

	const db = {
		insert() {
			return {
				values: async (value: Record<string, unknown>) => {
					const id = String(value.id);
					archiveRows.set(id, {
						id,
						ownerKind: String(value.ownerKind),
						ownerId: String(value.ownerId),
						objectKey: String(value.objectKey),
						formatVersion: Number(value.formatVersion),
						compatibilityKey: String(value.compatibilityKey),
						byteCount: Number(value.byteCount ?? 0),
						digest: String(value.digest ?? ""),
						generation: Number(value.generation ?? 0),
						status: String(value.status),
						cleanupRetryAt: (value.cleanupRetryAt as number | null) ?? null,
						cleanupAttempts: Number(value.cleanupAttempts ?? 0),
						createdAt: new Date(),
						updatedAt: new Date(),
					});
				},
			};
		},
		select() {
			let fromSessions = false;
			const chain = {
				from(table: unknown) {
					fromSessions = table === workspaceSessions;
					return chain;
				},
				where(condition?: unknown) {
					const rows = fromSessions
						? sessionIds.map((id) => ({ id }))
						: (() => {
								const id = findId(condition);
								return id
									? [archiveRows.get(id)].filter(Boolean)
									: [...archiveRows.values()];
							})();
					const promise = Promise.resolve(rows);
					return Object.assign(promise, {
						limit: (n: number) => Promise.resolve(rows.slice(0, n)),
					});
				},
				limit(n: number) {
					const rows = fromSessions
						? sessionIds.map((id) => ({ id }))
						: [...archiveRows.values()];
					return Promise.resolve(rows.slice(0, n));
				},
			};
			return chain;
		},
		update() {
			let pending: Record<string, unknown> = {};
			return {
				set(values: Record<string, unknown>) {
					pending = values;
					return {
						where: (condition?: unknown) => {
							const updated: ArchiveRecord[] = [];
							const apply = (row: ArchiveRecord | undefined) => {
								if (!row) {
									return;
								}
								const next = {
									...row,
									...pending,
									updatedAt: new Date(),
								} as ArchiveRecord;
								archiveRows.set(row.id, next);
								updated.push(next);
							};
							if (pending.status === "ready") {
								apply(
									[...archiveRows.values()]
										.filter((row) => row.status === "uploading")
										.at(-1),
								);
							} else if (pending.status === "abandoned") {
								for (const row of archiveRows.values()) {
									if (row.status === "uploading") {
										apply(row);
									}
								}
							} else {
								const id = findId(condition);
								const targets = id
									? [archiveRows.get(id)]
									: [...archiveRows.values()];
								for (const row of targets) {
									apply(row);
								}
							}
							return {
								returning: async () => updated,
							};
						},
					};
				},
			};
		},
		delete() {
			return {
				where: async (condition?: unknown) => {
					const id = findId(condition);
					if (id) {
						archiveRows.delete(id);
						return;
					}
					archiveRows.clear();
				},
			};
		},
	};

	return {
		db: db as unknown as Parameters<typeof createArchive>[1],
		archiveRows,
	};
}

function countedStream(
	totalBytes: number,
	chunkSize = 65_536,
): ReadableStream<Uint8Array> {
	let sent = 0;
	return new ReadableStream({
		pull(controller) {
			if (sent >= totalBytes) {
				controller.close();
				return;
			}
			const size = Math.min(chunkSize, totalBytes - sent);
			controller.enqueue(new Uint8Array(size));
			sent += size;
		},
	});
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			if (bytes.byteLength > 0) {
				controller.enqueue(bytes);
			}
			controller.close();
		},
	});
}

async function readAll(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		chunks.push(value);
		total += value.byteLength;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function makeSandbox(
	options: {
		createResult?: Record<string, unknown>;
		restoreResult?: Record<string, unknown>;
		createSuccess?: boolean;
		restoreSuccess?: boolean;
		read?: unknown;
		gitExists?: boolean;
		runnerHealthy?: boolean;
	} = {},
) {
	const exec = vi.fn(async (command: string) => {
		if (command.includes(ARCHIVE_CLI_PATH) && command.includes(" create ")) {
			return {
				success: options.createSuccess ?? true,
				stdout: `${JSON.stringify(
					options.createResult ?? {
						ok: true,
						action: "create",
						compressedBytes: 0,
						extractedBytes: 0,
						digest: EMPTY_SHA256,
					},
				)}\n`,
				stderr: "",
				exitCode: options.createSuccess === false ? 1 : 0,
			};
		}
		if (command.includes(ARCHIVE_CLI_PATH) && command.includes(" restore ")) {
			return {
				success: options.restoreSuccess ?? true,
				stdout: `${JSON.stringify(
					options.restoreResult ?? {
						ok: true,
						action: "restore",
						compressedBytes: 0,
						extractedBytes: 0,
						digest: EMPTY_SHA256,
					},
				)}\n`,
				stderr: "",
				exitCode: options.restoreSuccess === false ? 1 : 0,
			};
		}
		if (command.includes("/opt/ditto-runner/package.json")) {
			return {
				success: options.runnerHealthy ?? true,
				stdout: "",
				stderr: "",
				exitCode: options.runnerHealthy === false ? 1 : 0,
			};
		}
		return {
			success: true,
			stdout: "",
			stderr: "",
			exitCode: 0,
		};
	});

	const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
	const text = vi.fn(async () => "");
	const json = vi.fn(async () => ({}));
	const readFile = vi.fn(async () => {
		if (options.read) {
			return options.read;
		}
		return {
			content: countedStream(0),
			arrayBuffer,
			text,
			json,
		};
	});
	const writeFile = vi.fn(async (_path: string, content: unknown) => {
		if (content instanceof ReadableStream) {
			await readAll(content);
		}
	});
	const exists = vi.fn(async (target: string) => ({
		exists: options.gitExists ?? target.endsWith(".git"),
	}));

	return { exec, readFile, writeFile, exists, arrayBuffer, text, json };
}

function makeBucket(options?: { putError?: Error; deleteError?: Error }) {
	const objects = new Map<string, Uint8Array>();
	return {
		objects,
		put: vi.fn(async (key: string, value: unknown) => {
			if (options?.putError) {
				throw options.putError;
			}
			if (
				typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
			) {
				throw new Error("BACKUP_BUCKET.put received a buffered body.");
			}
			if (!(value instanceof ReadableStream)) {
				throw new Error("BACKUP_BUCKET.put must receive a stream.");
			}
			objects.set(key, await readAll(value));
		}),
		get: vi.fn(async (key: string) => {
			const body = objects.get(key);
			if (!body) {
				return null;
			}
			return { body: bytesStream(body) };
		}),
		delete: vi.fn(async (key: string) => {
			if (options?.deleteError) {
				throw options.deleteError;
			}
			objects.delete(key);
		}),
	};
}

function makeEnv(bucket: ReturnType<typeof makeBucket>) {
	return {
		BACKUP_BUCKET: bucket,
		Sandbox: {},
	} as unknown as Env;
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const createInput = {
	sandboxId: "sandbox-1",
	ownerKind: "legacy_project" as const,
	ownerId: "project-1",
	userId: "user-1",
	generation: 1,
};

describe("sandbox-archive", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		acquireLeaseMock.mockResolvedValue({ token: "lease-1", project: {} });
		releaseLeaseMock.mockResolvedValue(undefined);
		withLockMock.mockImplementation(
			async ({ run }: { run: () => Promise<unknown> }) => run(),
		);
	});

	it("streams an archive larger than 32 MiB into R2 without buffering", async () => {
		const size = ARCHIVE_RPC_STREAM_THRESHOLD_BYTES + 1;
		const sandbox = makeSandbox({
			createResult: {
				ok: true,
				action: "create",
				compressedBytes: size,
				extractedBytes: 12,
				digest: "sandbox-digest-must-not-be-trusted",
			},
		});
		sandbox.readFile.mockResolvedValue({
			content: countedStream(size),
			arrayBuffer: sandbox.arrayBuffer,
			text: sandbox.text,
			json: sandbox.json,
		});
		const bucket = makeBucket();
		const { db, archiveRows } = makeDb(["session-1"]);

		const ref = await createArchive(makeEnv(bucket), db, {
			...createInput,
			sandbox,
		});

		expect(ref.byteCount).toBe(size);
		expect(ref.digest).toMatch(/^[0-9a-f]{64}$/);
		expect(ref.digest).not.toBe("sandbox-digest-must-not-be-trusted");
		expect(sandbox.arrayBuffer).not.toHaveBeenCalled();
		expect(sandbox.text).not.toHaveBeenCalled();
		expect(sandbox.json).not.toHaveBeenCalled();
		expect(bucket.put).toHaveBeenCalledTimes(1);
		expect(bucket.put.mock.calls[0]?.[1]).toBeInstanceOf(ReadableStream);
		const stored = [...archiveRows.values()][0];
		expect(stored?.status).toBe("ready");
		expect(stored?.byteCount).toBe(size);
		expect(JSON.stringify(ref)).not.toContain(stored?.objectKey);
	});

	it("keeps R2 configuration, object keys, signed URLs, and bearer values out of sandbox commands", async () => {
		const sandbox = makeSandbox();
		const bucket = makeBucket();
		const { db, archiveRows } = makeDb();

		await createArchive(makeEnv(bucket), db, {
			...createInput,
			sandbox,
		});

		const objectKey = [...archiveRows.values()][0]?.objectKey ?? "";
		expect(objectKey.length).toBeGreaterThan(0);
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).includes(ARCHIVE_CLI_PATH),
			),
		).toBe(true);
		for (const call of sandbox.exec.mock.calls) {
			const command = String(call[0]);
			const execOptions = (
				call as unknown as [
					string,
					{ env?: Record<string, string> } | undefined,
				]
			)[1];
			expect(command).not.toMatch(
				/R2_|BACKUP_BUCKET|X-Amz-|pre-?sign|objectKey|AKIA/i,
			);
			expect(command).not.toContain(objectKey);
			expect(execOptions?.env).toBeUndefined();
		}
	});

	it("fails closed when compressed, extracted, or peak-disk limits fire", async () => {
		for (const error of ["limit_compressed", "limit_extracted", "limit_disk"]) {
			const sandbox = makeSandbox({
				createSuccess: false,
				createResult: { ok: false, error },
			});
			const bucket = makeBucket();
			const { db, archiveRows } = makeDb();
			await expect(
				createArchive(makeEnv(bucket), db, { ...createInput, sandbox }),
			).rejects.toThrow(/Archive command failed/);
			expect(bucket.put).not.toHaveBeenCalled();
			expect([...archiveRows.values()][0]?.status).toBe("abandoned");
			expect(
				sandbox.exec.mock.calls.some((call) =>
					String(call[0]).includes(`rm -f -- '${ARCHIVE_TEMP_PATH}'`),
				),
			).toBe(true);
		}
	});

	it("fails closed on a failed R2 write and does not persist a ready archive", async () => {
		const sandbox = makeSandbox();
		const bucket = makeBucket({ putError: new Error("put failed") });
		const { db, archiveRows } = makeDb();
		const storedGeneration = { value: 0 };

		await expect(
			createArchive(makeEnv(bucket), db, { ...createInput, sandbox }),
		).rejects.toThrow(/put failed/);
		expect([...archiveRows.values()][0]?.status).toBe("abandoned");
		expect(
			[...archiveRows.values()].some((row) => row.status === "ready"),
		).toBe(false);
		expect(storedGeneration.value).toBe(0);
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).includes(`rm -f -- '${ARCHIVE_TEMP_PATH}'`),
			),
		).toBe(true);
	});

	it("fails closed when the upload length does not match", async () => {
		const sandbox = makeSandbox({
			createResult: {
				ok: true,
				action: "create",
				compressedBytes: 8,
				extractedBytes: 8,
				digest: "x",
			},
		});
		sandbox.readFile.mockResolvedValue({
			content: countedStream(3),
			arrayBuffer: sandbox.arrayBuffer,
			text: sandbox.text,
			json: sandbox.json,
		});
		const { db, archiveRows } = makeDb();
		await expect(
			createArchive(makeEnv(makeBucket()), db, { ...createInput, sandbox }),
		).rejects.toThrow(/length/);
		expect([...archiveRows.values()][0]?.status).toBe("abandoned");
	});

	it("stores the empty-payload streaming digest and deletes the temp file", async () => {
		const sandbox = makeSandbox();
		const { db, archiveRows } = makeDb(["session-1"]);
		const ref = await createArchive(makeEnv(makeBucket()), db, {
			...createInput,
			sandbox,
		});
		expect(ref.digest).toBe(EMPTY_SHA256);
		expect([...archiveRows.values()][0]?.status).toBe("ready");
		expect(acquireLeaseMock).toHaveBeenCalled();
		expect(releaseLeaseMock).toHaveBeenCalled();
		expect(withLockMock).toHaveBeenCalled();
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).includes(`rm -f -- '${ARCHIVE_TEMP_PATH}'`),
			),
		).toBe(true);
	});

	it("does not let a stale generation replace a newer stored archive", async () => {
		const bucket = makeBucket();
		const { db } = makeDb();
		const sandbox = makeSandbox();
		let storedGeneration = 0;
		let storedId: string | null = null;
		let putCount = 0;
		const firstPut = deferred<void>();
		const firstPutReady = deferred<void>();
		bucket.put.mockImplementation(async (key: string, value: unknown) => {
			if (!(value instanceof ReadableStream)) {
				throw new Error("BACKUP_BUCKET.put must receive a stream.");
			}
			const bytes = await readAll(value);
			putCount += 1;
			if (putCount === 1) {
				firstPutReady.resolve();
				await firstPut.promise;
			}
			bucket.objects.set(key, bytes);
		});

		const persist = async (generation: number) => {
			const ref = await createArchive(makeEnv(bucket), db, {
				...createInput,
				sandbox,
				generation,
			});
			if (storedGeneration < generation) {
				storedGeneration = generation;
				storedId = ref.id;
				return { stored: true, ref };
			}
			await deleteArchive(makeEnv(bucket), db, ref.id);
			return { stored: false, ref };
		};

		const first = persist(1);
		await firstPutReady.promise;
		const second = await persist(2);
		firstPut.resolve();
		const stale = await first;
		expect(second.stored).toBe(true);
		expect(stale.stored).toBe(false);
		expect(storedId).toBe(second.ref.id);
		expect(storedGeneration).toBe(2);
	});

	it("rejects a corrupt restore, wrong length, and wrong digest", async () => {
		const payload = new Uint8Array([1, 2, 3, 4]);
		const digest = createHash("sha256").update(payload).digest("hex");
		const sandbox = makeSandbox({
			createResult: {
				ok: true,
				action: "create",
				compressedBytes: payload.byteLength,
				extractedBytes: 4,
				digest: "ignored",
			},
			restoreResult: {
				ok: true,
				action: "restore",
				compressedBytes: payload.byteLength,
				extractedBytes: 4,
				digest: "ignored",
			},
		});
		sandbox.readFile.mockResolvedValue({
			content: bytesStream(payload),
			arrayBuffer: sandbox.arrayBuffer,
			text: sandbox.text,
			json: sandbox.json,
		});
		const bucket = makeBucket();
		const { db, archiveRows } = makeDb();
		const ref = await createArchive(makeEnv(bucket), db, {
			...createInput,
			sandbox,
		});
		expect(ref.digest).toBe(digest);

		const ready = [...archiveRows.values()][0];
		if (!ready) {
			throw new Error("missing archive row");
		}

		bucket.objects.set(ready.objectKey, new Uint8Array([9, 9, 9, 9]));
		await expect(
			restoreArchive(makeEnv(bucket), db, {
				sandbox,
				sandboxId: "sandbox-1",
				archiveId: ref.id,
			}),
		).rejects.toThrow(/checksum or length/);

		bucket.objects.set(ready.objectKey, new Uint8Array([1, 2]));
		await expect(
			restoreArchive(makeEnv(bucket), db, {
				sandbox,
				sandboxId: "sandbox-1",
				archiveId: ref.id,
			}),
		).rejects.toThrow(/checksum or length/);
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).includes(`rm -f -- '${ARCHIVE_TEMP_PATH}'`),
			),
		).toBe(true);
	});

	it("retries cleanup idempotently when the R2 object is already gone", async () => {
		const sandbox = makeSandbox();
		const bucket = makeBucket({ deleteError: new Error("delete failed") });
		const { db, archiveRows } = makeDb();
		const ref = await createArchive(makeEnv(bucket), db, {
			...createInput,
			sandbox,
		});

		await deleteArchive(makeEnv(bucket), db, ref.id);
		expect([...archiveRows.values()][0]?.status).toBe("deleting");
		expect([...archiveRows.values()][0]?.cleanupAttempts).toBe(1);

		bucket.delete.mockReset();
		bucket.delete.mockResolvedValue(undefined);
		bucket.objects.clear();

		const first = await retryArchiveCleanup({
			env: makeEnv(bucket),
			db,
			nowSeconds: Math.floor(Date.now() / 1000) + 3600,
		});
		expect(first.cleaned).toBe(1);
		expect(archiveRows.size).toBe(0);

		const second = await retryArchiveCleanup({
			env: makeEnv(bucket),
			db,
			nowSeconds: Math.floor(Date.now() / 1000) + 3600,
		});
		expect(second.cleaned).toBe(0);
	});

	it("passes only numeric limits to the image-owned CLI", async () => {
		const sandbox = makeSandbox();
		const { db } = makeDb();
		await createArchive(makeEnv(makeBucket()), db, {
			...createInput,
			sandbox,
		});
		const createCommand = sandbox.exec.mock.calls
			.map((call) => String(call[0]))
			.find((command) => command.includes(" create "));
		expect(createCommand).toContain(
			`--max-compressed-bytes ${ARCHIVE_MAX_COMPRESSED_BYTES}`,
		);
		expect(createCommand).toContain(
			`--max-extracted-bytes ${ARCHIVE_MAX_EXTRACTED_BYTES}`,
		);
		expect(createCommand).toContain(
			`--max-disk-percent ${ARCHIVE_MAX_DISK_PERCENT}`,
		);
	});

	it("does not reference stock createBackup, restoreBackup, or R2 presign secrets", () => {
		const source = fs.readFileSync(
			path.join(
				path.dirname(fileURLToPath(import.meta.url)),
				"sandbox-archive.ts",
			),
			"utf8",
		);
		expect(source).not.toMatch(
			/createBackup|restoreBackup|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|BACKUP_BUCKET_NAME/,
		);
		expect(ARCHIVE_FORMAT_VERSION).toBe(1);
		expect(ARCHIVE_COMPATIBILITY_KEY).toContain("ditto-workspace-archive");
		expect(archives).toBeDefined();
	});
});
