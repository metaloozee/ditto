// The bot's hands: a minimal DevTools client for the desktop's one tab. It only navigates and
// evaluates expressions that return hosts, paths and booleans, and can listen to a domain's
// events for a request log. It never reads cookies or storage.

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class Tab {
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private listeners = new Set<(method: string, params: unknown) => void>();
	private socket: WebSocket;

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data)) as {
				id?: number;
				method?: string;
				params?: unknown;
				result?: unknown;
				error?: { message: string };
			};
			if (message.method) {
				for (const listener of this.listeners) listener(message.method, message.params);
			}
			const waiting = message.id === undefined ? undefined : this.pending.get(message.id);
			if (!waiting || message.id === undefined) return;
			this.pending.delete(message.id);
			if (message.error) waiting.reject(new Error(message.error.message));
			else waiting.resolve(message.result);
		});
	}

	/** Connect to the first tab, waiting up to `timeoutMs` for Chrome to open DevTools. */
	static async open(devtools: string, timeoutMs = 30_000): Promise<Tab> {
		const deadline = Date.now() + timeoutMs;
		let page: { type: string; webSocketDebuggerUrl: string } | undefined;
		while (!page) {
			try {
				const targets = (await (await fetch(`${devtools}/json/list`)).json()) as {
					type: string;
					webSocketDebuggerUrl: string;
				}[];
				page = targets.find((target) => target.type === "page");
			} catch (error) {
				if (Date.now() > deadline) throw error;
			}
			if (!page && Date.now() > deadline) throw new Error("The desktop has no open tab");
			if (!page) await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		const socket = new WebSocket(page.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => {
			socket.addEventListener("open", resolve, { once: true });
			socket.addEventListener("error", () => reject(new Error("DevTools refused")), {
				once: true,
			});
		});
		return new Tab(socket);
	}

	private send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
		const id = this.nextId++;
		this.socket.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
	}

	/** Enable a CDP domain, such as `Network`, and receive its events. */
	async listen(domain: string, listener: (method: string, params: unknown) => void): Promise<void> {
		this.listeners.add(listener);
		await this.send(`${domain}.enable`);
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
