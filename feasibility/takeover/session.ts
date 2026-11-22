// Who controls the screen, per ADR-0007. Every bot operation that can observe or change the
// screen goes through `inspect` or `act`, so take-over can refuse it.
export class TakeOver {
	controller: "bot" | "owner" = "bot";
	private inspected = true;
	private inFlight = new Set<Promise<unknown>>();

	/** Resolves once no bot work is running; from then on, bot work is refused. */
	async takeOver(): Promise<void> {
		this.controller = "owner";
		await Promise.allSettled(this.inFlight);
	}

	/** A dropped view never returns control: only `handBack` does. */
	disconnect(): void {}

	handBack(): void {
		this.controller = "bot";
		this.inspected = false;
	}

	/** Read the current screen. Required first after a hand-back. */
	inspect<T>(look: () => Promise<T>): Promise<T> {
		return this.run(look).then((seen) => {
			this.inspected = true;
			return seen;
		});
	}

	act<T>(step: () => Promise<T>): Promise<T> {
		if (this.controller === "bot" && !this.inspected) {
			return Promise.reject(new Error("Bot must inspect the screen after hand-back before acting"));
		}
		return this.run(step);
	}

	private run<T>(work: () => Promise<T>): Promise<T> {
		if (this.controller === "owner") {
			return Promise.reject(new Error("The owner has control until they hand back"));
		}
		const running = work();
		this.inFlight.add(running);
		void running.finally(() => this.inFlight.delete(running)).catch(() => {});
		return running;
	}
}
