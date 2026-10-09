import { DurableObject } from "cloudflare:workers";
import {
	type ModelTransportDescriptorV1,
	parseModelTransportDescriptorV1,
	SYNTHETIC_MODEL_LIMITS,
	type SyntheticModelOutcomeV1,
} from "../../../../packages/runtime-contracts/src/model.js";
import {
	type CodexTokens,
	type CredentialKeyring,
	openCredentials,
	sealCredentials,
} from "./codex-credential-crypto";
import {
	awaitSynthetic,
	readSyntheticStream,
	reconstructSyntheticRequest,
	syntheticRequestDigest,
} from "./codex-request-contract";
import {
	type ModelClaimRpc,
	ModelProductAuthority,
} from "./model-product-authority";

export type ConnectionStatus =
	| "disconnected"
	| "connected"
	| "renewing"
	| "reconnect_required"
	| "unavailable";
export interface ConnectionView {
	status: ConnectionStatus;
	generation: number;
}
export interface CodexCredentialEnv {
	DB: D1Database;
	CodexCredential: Pick<DurableObjectNamespace, "idFromName">;
	CODEX_CREDENTIAL_CURRENT_KEY_VERSION: string;
	CODEX_CREDENTIAL_KEYS: string;
}
interface State extends Record<string, SqlStorageValue> {
	owner: string;
	generation: number;
	renewal: number;
	// Also the expected token-record revision while connected.
	version: number;
	status: ConnectionStatus;
	sealed: string | null;
}

export class CodexCredential extends DurableObject<CodexCredentialEnv> {
	constructor(ctx: DurableObjectState, env: CodexCredentialEnv) {
		super(ctx, env);
		ctx.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS credential (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, generation INTEGER NOT NULL, renewal INTEGER NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, sealed TEXT)",
		);
		// A retained dispatch intent may have spent a rotating refresh token.
		ctx.storage.sql.exec(
			"UPDATE credential SET status='reconnect_required', sealed=NULL, version=version+1 WHERE status='renewing'",
		);
	}
	#read(): State | undefined {
		return this.ctx.storage.sql
			.exec<State>(
				"SELECT owner,generation,renewal,version,status,sealed FROM credential WHERE id=1",
			)
			.toArray()[0];
	}
	#owned(owner: string): boolean {
		return (
			typeof owner === "string" &&
			owner.length > 0 &&
			owner.length <= 256 &&
			this.env.CodexCredential.idFromName(owner).equals(this.ctx.id)
		);
	}
	#keyring(): CredentialKeyring {
		const keys: unknown = JSON.parse(this.env.CODEX_CREDENTIAL_KEYS);
		if (
			!keys ||
			typeof keys !== "object" ||
			Array.isArray(keys) ||
			Object.values(keys).some((value) => typeof value !== "string")
		)
			throw new Error("credential_integrity");
		return {
			current: this.env.CODEX_CREDENTIAL_CURRENT_KEY_VERSION,
			keys: keys as Record<string, string>,
		};
	}
	async #authority(owner: string, generation: number): Promise<boolean> {
		const row = await this.env.DB.prepare(
			"SELECT generation,revoked FROM codex_connections WHERE user_id=? AND EXISTS(SELECT 1 FROM user WHERE id=?)",
		)
			.bind(owner, owner)
			.first<{ generation: number; revoked: number }>();
		return !!row && row.generation === generation && row.revoked === 0;
	}
	#same(state: State): boolean {
		const current = this.#read();
		return (
			!!current &&
			current.owner === state.owner &&
			current.generation === state.generation &&
			current.renewal === state.renewal &&
			current.version === state.version &&
			current.status === state.status
		);
	}
	async #project(state: State): Promise<void> {
		await this.env.DB.prepare(
			"UPDATE codex_connections SET status=?, projection_version=?, updated_at=? WHERE user_id=? AND generation=? AND revoked=0 AND projection_version<?",
		)
			.bind(
				state.status,
				state.version,
				Date.now(),
				state.owner,
				state.generation,
				state.version,
			)
			.run();
	}
	protected fixtureAvailable(): boolean {
		return false;
	}
	protected async installFixture(
		owner: string,
		generation: number,
		tokens: CodexTokens,
	): Promise<ConnectionView> {
		if (
			!this.fixtureAvailable() ||
			!this.#owned(owner) ||
			!Number.isSafeInteger(generation) ||
			generation < 1 ||
			!(await this.#authority(owner, generation))
		)
			return { status: "disconnected", generation: 0 };
		const sealed = await sealCredentials(
			tokens,
			owner,
			generation,
			this.#keyring(),
			1,
		);
		if (!(await this.#authority(owner, generation)))
			return { status: "disconnected", generation: 0 };
		const installed = this.ctx.storage.transactionSync(() => {
			const prior = this.#read();
			if (prior && prior.generation >= generation) return false;
			this.ctx.storage.sql.exec(
				"INSERT INTO credential VALUES(1,?,?,0,1,'connected',?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,generation=excluded.generation,renewal=0,version=1,status='connected',sealed=excluded.sealed",
				owner,
				generation,
				sealed,
			);
			return true;
		});
		if (!installed) return { status: "disconnected", generation: 0 };
		await this.ctx.storage.sync();
		return this.status(owner);
	}
	async status(owner: string): Promise<ConnectionView> {
		if (!this.#owned(owner)) return { status: "disconnected", generation: 0 };
		const state = this.#read();
		if (!state || !(await this.#authority(owner, state.generation)))
			return { status: "disconnected", generation: state?.generation ?? 0 };
		if (!this.#same(state))
			return { status: "unavailable", generation: state.generation };
		await this.#project(state);
		if (!(await this.#authority(owner, state.generation)))
			return { status: "disconnected", generation: state.generation };
		if (!this.#same(state))
			return { status: "unavailable", generation: state.generation };
		return { status: state.status, generation: state.generation };
	}
	async revoke(owner: string, generation: number): Promise<void> {
		if (
			!this.#owned(owner) ||
			!Number.isSafeInteger(generation) ||
			generation < 1
		)
			return;
		const state = this.#read();
		if (state && generation <= state.generation) return;
		this.ctx.storage.sql.exec(
			"INSERT INTO credential VALUES(1,?,?,0,1,'disconnected',NULL) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,status='disconnected',sealed=NULL,version=version+1",
			owner,
			generation,
		);
		await this.ctx.storage.sync();
	}
	protected requestAvailable(): boolean {
		return false;
	}
	protected async modelPhase(
		_phase: "authority" | "credentials" | "claim",
	): Promise<void> {}

	async requestModel(
		input: unknown,
		capability: ModelClaimRpc,
	): Promise<SyntheticModelOutcomeV1> {
		if (!this.requestAvailable()) return { version: 1, status: "unavailable" };
		const policy = new ModelProductAuthority(this.env.DB);
		const overall = AbortSignal.timeout(SYNTHETIC_MODEL_LIMITS.deadlineMs);
		let descriptor: ModelTransportDescriptorV1;
		try {
			descriptor = parseModelTransportDescriptorV1(
				await awaitSynthetic(capability.describe(), overall),
			);
			if (!this.#owned(descriptor.subject.userId))
				return { version: 1, status: "denied" };
		} catch {
			return { version: 1, status: "denied" };
		}
		let reconstructed: ReturnType<typeof reconstructSyntheticRequest>;
		try {
			reconstructed = reconstructSyntheticRequest(input);
			if (
				(await awaitSynthetic(
					syntheticRequestDigest(reconstructed.request),
					overall,
				)) !== descriptor.requestDigest
			)
				throw new Error("request_association");
		} catch {
			try {
				if (await awaitSynthetic(policy.denial(descriptor), overall))
					await awaitSynthetic(capability.halt(descriptor.attempt), overall);
			} catch {
				/* A failed denial acknowledgment never admits model work. */
			}
			return { version: 1, status: "denied" };
		}
		const { request, body } = reconstructed,
			owner = descriptor.subject.userId;
		let reserved = false,
			dispatched = false;
		const controller = new AbortController();
		const duration = Math.min(
			SYNTHETIC_MODEL_LIMITS.deadlineMs,
			descriptor.attempt.deadlineAt - Date.now(),
		);
		if (duration <= 0) return { version: 1, status: "denied" };
		const timeout = setTimeout(() => controller.abort(), duration);
		const signal = AbortSignal.any([overall, controller.signal]);
		const wait = <T>(pending: Promise<T>) => awaitSynthetic(pending, signal);
		let fetching: Promise<Response> | undefined;
		try {
			await wait(this.modelPhase("authority"));
			controller.signal.throwIfAborted();
			if (!(await wait(policy.current(descriptor, body))))
				return { version: 1, status: "denied" };
			const fresh = await wait(this.ensureFresh(owner));
			if (
				fresh.status !== "connected" ||
				fresh.generation !== descriptor.subject.connectionGeneration
			)
				return { version: 1, status: "denied" };
			const state = this.#read();
			if (
				!state ||
				!state.sealed ||
				state.status !== "connected" ||
				state.generation !== descriptor.subject.connectionGeneration
			)
				return { version: 1, status: "denied" };
			if (!(await wait(policy.reserve(descriptor, body))))
				return { version: 1, status: "denied" };
			reserved = true;
			if (!this.#same(state)) throw new Error("connection_changed");
			const tokens = await wait(
				openCredentials(
					state.sealed,
					owner,
					state.generation,
					this.#keyring(),
					state.version,
				),
			);
			if (!this.#same(state) || tokens.expiresAt <= Date.now() + 60000)
				throw new Error("connection_changed");
			await wait(this.modelPhase("credentials"));
			if (!(await wait(policy.permit(descriptor, body))) || !this.#same(state))
				throw new Error("authority_changed");
			await wait(this.modelPhase("claim"));
			signal.throwIfAborted();
			if (!(await wait(policy.permit(descriptor, body))) || !this.#same(state))
				throw new Error("authority_changed");
			const admitted = await wait(
				capability.claim(descriptor.attempt, {
					userId: descriptor.subject.userId,
					projectId: descriptor.subject.projectId,
					workspaceSessionId: descriptor.subject.workspaceSessionId,
					requestDigest: descriptor.requestDigest,
				}),
			);
			signal.throwIfAborted();
			if (admitted.status !== "admitted" || !this.#same(state))
				throw new Error("claim_denied");
			// The host rereads its authority after the bound product check. Recheck
			// product policy here so that host-authority I/O cannot extend a product permit.
			if (!(await wait(policy.permit(descriptor, body))) || !this.#same(state))
				throw new Error("authority_changed");
			signal.throwIfAborted();
			dispatched = true;
			fetching = fetch(request.url, {
				method: "POST",
				redirect: "manual",
				signal,
				headers: {
					"content-type": "application/json",
					accept: "application/x-ndjson",
					authorization: `Bearer ${tokens.access}`,
				},
				body: request.body,
			});
			void fetching.catch(() => {});
			await wait(policy.record(descriptor, "admitted"));
			const response = await wait(fetching);
			if (
				[400, 401, 403, 429, 503].includes(response.status) &&
				!response.headers.has("location")
			) {
				if (response.body) await wait(response.body.cancel());
				await wait(policy.record(descriptor, "failed_known"));
				return { version: 1, status: "failed_known" };
			}
			const frames = await wait(
				readSyntheticStream(response, signal, [
					tokens.access,
					tokens.refresh,
					tokens.identity ?? "",
				]),
			);
			await wait(policy.record(descriptor, "complete"));
			return { version: 1, status: "complete", frames };
		} catch {
			const status = dispatched ? "outcome_unknown" : "denied";
			if (reserved)
				await awaitSynthetic(
					policy.record(
						descriptor,
						dispatched ? "outcome_unknown" : "failed_known",
					),
					AbortSignal.timeout(1000),
				).catch(() => {});
			return { version: 1, status };
		} finally {
			clearTimeout(timeout);
			controller.abort();
			if (fetching)
				await awaitSynthetic(fetching, AbortSignal.timeout(1000)).catch(
					() => {},
				);
		}
	}

	protected renewalAvailable(): boolean {
		return false;
	}
	protected async renewUpstream(_tokens: CodexTokens): Promise<CodexTokens> {
		throw new Error("connection_unavailable");
	}
	protected async afterRotation(): Promise<void> {}
	async ensureFresh(owner: string): Promise<ConnectionView> {
		if (!this.#owned(owner)) return { status: "disconnected", generation: 0 };
		const state = this.#read();
		if (!state || !(await this.#authority(owner, state.generation)))
			return { status: "disconnected", generation: state?.generation ?? 0 };
		if (!this.#same(state))
			return { status: "unavailable", generation: state.generation };
		if (state.status !== "connected" || !state.sealed)
			return { status: state.status, generation: state.generation };
		try {
			const tokens = await openCredentials(
				state.sealed,
				owner,
				state.generation,
				this.#keyring(),
				state.version,
			);
			if (!this.#same(state))
				return { status: "unavailable", generation: state.generation };
			if (tokens.expiresAt > Date.now() + 60000) return this.status(owner);
			if (!this.renewalAvailable())
				return { status: "unavailable", generation: state.generation };
			const intent = {
				...state,
				status: "renewing" as const,
				renewal: state.renewal + 1,
				version: state.version + 1,
			};
			this.ctx.storage.sql.exec(
				"UPDATE credential SET status='renewing',renewal=?,version=? WHERE id=1",
				intent.renewal,
				intent.version,
			);
			await this.ctx.storage.sync();
			if (
				!(await this.#authority(owner, state.generation)) ||
				!this.#same(intent)
			)
				return { status: "disconnected", generation: state.generation };
			const rotated = await this.renewUpstream(tokens);
			await this.afterRotation();
			const sealed = await sealCredentials(
				rotated,
				owner,
				state.generation,
				this.#keyring(),
				intent.version + 1,
			);
			if (
				!(await this.#authority(owner, state.generation)) ||
				!this.#same(intent)
			)
				return { status: "disconnected", generation: state.generation };
			const replacement = {
				...intent,
				status: "connected" as const,
				sealed,
				version: intent.version + 1,
			};
			this.ctx.storage.transactionSync(() => {
				if (!this.#same(intent)) throw new Error("connection_changed");
				this.ctx.storage.sql.exec(
					"UPDATE credential SET status='connected',sealed=?,version=? WHERE id=1",
					sealed,
					replacement.version,
				);
			});
			await this.ctx.storage.sync();
			await this.#project(replacement);
			return this.status(owner);
		} catch {
			const current = this.#read();
			if (
				current &&
				current.generation === state.generation &&
				((current.status === "renewing" &&
					current.renewal === state.renewal + 1 &&
					current.version === state.version + 1) ||
					this.#same(state))
			) {
				this.ctx.storage.sql.exec(
					"UPDATE credential SET status='reconnect_required',sealed=NULL,version=version+1 WHERE id=1",
				);
				await this.ctx.storage.sync();
				const failed = this.#read();
				if (failed) await this.#project(failed);
			}
			return { status: "reconnect_required", generation: state.generation };
		}
	}
}
