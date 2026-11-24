// The bot's hands: a minimal DevTools client for the desktop's one tab. It only navigates and
// evaluates expressions that return hosts, paths and booleans. It never reads cookies or storage.

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class Tab {
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private socket: WebSocket;

	private closed: Error | undefined;

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data)) as {
				id?: number;
				result?: unknown;
				error?: { message: string };
			};
			const waiting = message.id === undefined ? undefined : this.pending.get(message.id);
			if (!waiting || message.id === undefined) return;
			this.pending.delete(message.id);
			if (message.error) waiting.reject(new Error(message.error.message));
			else waiting.resolve(message.result);
		});
		// DevTools answers nothing once the page is gone, so fail what is waiting instead of hanging.
		socket.addEventListener("close", (event) => {
			this.closed = new Error(`DevTools closed: ${event.code} ${event.reason}`.trim());
			for (const waiting of this.pending.values()) waiting.reject(this.closed);
			this.pending.clear();
		});
	}

	/**
	 * Connect to the first tab, waiting up to `timeoutMs` for one that answers. A page can be gone
	 * by the time a client connects (#36 saw a fresh browser replace its first page within seconds),
	 * so the tab is checked with a command, and a lost page is listed again.
	 */
	static async open(devtools: string, timeoutMs = 30_000): Promise<Tab> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			let failure: unknown;
			try {
				const targets = (await (await fetch(`${devtools}/json/list`)).json()) as {
					type: string;
					webSocketDebuggerUrl: string;
				}[];
				const page = targets.find((target) => target.type === "page");
				if (!page) throw new Error("The desktop has no open tab");
				const socket = new WebSocket(page.webSocketDebuggerUrl);
				await new Promise((resolve, reject) => {
					socket.addEventListener("open", resolve, { once: true });
					socket.addEventListener("error", () => reject(new Error("DevTools refused")), {
						once: true,
					});
				});
				const tab = new Tab(socket);
				await tab.evaluate("1");
				return tab;
			} catch (error) {
				failure = error;
			}
			if (Date.now() > deadline) throw failure;
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	private send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
		if (this.closed) return Promise.reject(this.closed);
		const id = this.nextId++;
		this.socket.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
	}

	async evaluate<T>(expression: string): Promise<T> {
		const { result, exceptionDetails } = (await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		})) as { result: { value: T }; exceptionDetails?: { text: string } };
		if (exceptionDetails) throw new Error(exceptionDetails.text);
		return result.value;
	}

	/** Navigate, then wait until the document has loaded or the timeout passes. */
	async goto(url: string, timeoutMs = 30_000): Promise<void> {
		const { errorText } = (await this.send("Page.navigate", { url })) as { errorText?: string };
		if (errorText) throw new Error(`Navigation failed: ${errorText}`);
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			const ready = await this.evaluate<string>("document.readyState").catch(() => "loading");
			if (ready === "complete") return;
		}
	}

	/** Poll a boolean expression until it holds; resolve with its last value. */
	async waitFor(expression: string, timeoutMs = 20_000): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const holds = await this.evaluate<boolean>(expression).catch(() => false);
			if (holds || Date.now() > deadline) return holds;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	close(): void {
		this.socket.close();
	}
}
