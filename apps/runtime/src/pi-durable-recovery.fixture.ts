import {
	type ArtifactExecution,
	type ArtifactPermit,
	ArtifactStepRejected,
	type ArtifactStore,
	type BranchSyncAuthority,
} from "./pi-durable-artifacts.ts";

/** Shared in-memory recovery adapters for runtime tests. */
export const HEAD = "a".repeat(40);
export const OTHER_HEAD = "b".repeat(40);
export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

export async function sha256(bytes: Uint8Array) {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
	);
	return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function collect(stream: ReadableStream<Uint8Array>) {
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
export function streamOf(bytes: Uint8Array, chunk = 7) {
	let offset = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset >= bytes.byteLength) return controller.close();
			controller.enqueue(bytes.slice(offset, offset + chunk));
			offset += chunk;
		},
	});
}

export type Fault = (permit: ArtifactPermit) => void | Promise<void>;

/** In-memory execution sandbox: the archive is the JSON of its files and HEAD. */
export function fakeExecution(files: Record<string, string>, head = HEAD) {
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

export function fakeStore() {
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

export function fakeBranch(decision: "grant" | "deny" = "grant") {
	const state = { opened: [] as string[], closed: [] as string[], decision };
	const branch: BranchSyncAuthority = {
		async open(request) {
			state.opened.push(request.operation);
			return state.decision === "deny"
				? { denied: "revoked" }
				: {
						window: `window-${request.operation}`,
						ref: "refs/heads/feature",
						repository: "owner/repo",
					};
		},
		async close(window) {
			state.closed.push(window);
		},
	};
	return { branch, state };
}
