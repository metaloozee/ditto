/**
 * Contiguous assistant-text delta batcher.
 *
 * Merges token-sized deltas into a single flush per schedule interval so
 * server SSE / client React work stays bounded, while callers can force a
 * synchronous flush before non-text events (tools, errors, done) so ordering
 * stays exact.
 */

export type ScheduleFn = (cb: () => void) => () => void;

export type DeltaBatcher = {
	/** Accumulate a text delta; schedules a flush if none is pending. */
	push: (delta: string) => void;
	/** Synchronously flush any pending text and cancel a scheduled flush. */
	flush: () => void;
	/** Flush remaining text then cancel schedule; never drops a tail. */
	dispose: () => void;
};

const DEFAULT_INTERVAL_MS = 16;

function defaultSchedule(cb: () => void): () => void {
	const id = setTimeout(cb, DEFAULT_INTERVAL_MS);
	return () => {
		clearTimeout(id);
	};
}

export function createDeltaBatcher(options: {
	onFlush: (delta: string) => void;
	/** Injectable scheduler; default is setTimeout(16) (Worker-safe). */
	schedule?: ScheduleFn;
}): DeltaBatcher {
	const schedule = options.schedule ?? defaultSchedule;
	let pending = "";
	let cancelScheduled: (() => void) | null = null;
	let disposed = false;

	function flush(): void {
		if (cancelScheduled) {
			cancelScheduled();
			cancelScheduled = null;
		}
		if (pending.length === 0) {
			return;
		}
		const delta = pending;
		pending = "";
		options.onFlush(delta);
	}

	function push(delta: string): void {
		if (disposed || delta.length === 0) {
			return;
		}
		pending += delta;
		if (!cancelScheduled) {
			cancelScheduled = schedule(() => {
				cancelScheduled = null;
				flush();
			});
		}
	}

	function dispose(): void {
		flush();
		disposed = true;
	}

	return { push, flush, dispose };
}
