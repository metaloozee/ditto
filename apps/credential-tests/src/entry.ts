import type { CodexTokens } from "../../web/src/lib/codex-credential-crypto";
import { CodexCredential } from "../../web/src/lib/codex-credential-do";

export { CodexCredential };

export class FixtureCredential extends CodexCredential {
	paused = false;
	crashAfterRotation = false;
	abortAfterRotation = false;
	abortFixture() {
		this.ctx.abort("fixture_interruption");
	}
	armAbort() {
		this.abortAfterRotation = true;
	}
	dispatched = 0;
	private resume: (() => void) | undefined;
	private observed: (() => void) | undefined;
	private rotation: Promise<void> | undefined;
	holdRotation() {
		this.paused = true;
		this.rotation = new Promise<void>((resolve) => {
			this.observed = resolve;
		});
	}
	waitForRotation() {
		return this.rotation;
	}
	private modelWait:
		| {
				phase: string;
				entered: Promise<void>;
				mark(): void;
				released: Promise<void>;
				release(): void;
		  }
		| undefined;
	holdModel(phase: "authority" | "credentials" | "claim") {
		let mark!: () => void, release!: () => void;
		this.modelWait = {
			phase,
			entered: new Promise<void>((r) => {
				mark = r;
			}),
			mark: () => mark(),
			released: new Promise<void>((r) => {
				release = r;
			}),
			release: () => release(),
		};
	}
	waitModel() {
		return this.modelWait?.entered;
	}
	releaseModel() {
		this.modelWait?.release();
	}
	protected requestAvailable() {
		return true;
	}
	protected async modelPhase(phase: "authority" | "credentials" | "claim") {
		const wait = this.modelWait;
		if (wait?.phase !== phase) return;
		wait.mark();
		await wait.released;
		this.modelWait = undefined;
	}
	protected fixtureAvailable() {
		return true;
	}
	install(owner: string, generation: number, tokens: CodexTokens) {
		return this.installFixture(owner, generation, tokens);
	}
	protected renewalAvailable() {
		return true;
	}
	protected async renewUpstream(tokens: CodexTokens): Promise<CodexTokens> {
		this.dispatched++;
		const response = await fetch("https://credential-fixture.invalid/rotate", {
			method: "POST",
			redirect: "manual",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ refresh: tokens.refresh }),
		});
		if (!response.ok) throw new Error("fixture_failure");
		return await response.json<CodexTokens>();
	}
	protected async afterRotation() {
		if (this.abortAfterRotation) this.ctx.abort("fixture_interruption");
		if (this.crashAfterRotation)
			throw new Error("fixture_crash_after_rotation");
		if (this.paused)
			await new Promise<void>((resolve) => {
				this.resume = resolve;
				this.observed?.();
			});
	}
	release() {
		this.resume?.();
	}
}
export default { fetch: () => new Response("Not found", { status: 404 }) };
