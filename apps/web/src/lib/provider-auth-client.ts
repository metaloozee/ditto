export type ProviderAuthClientEvent =
	| { event: "meta"; data: { attemptId: string; providerId: string } }
	| {
			event: "prompt";
			data: {
				promptId: string;
				type: "text" | "secret" | "select" | "manual_code";
				message: string;
				placeholder?: string;
				options?: Array<{ id: string; label: string; description?: string }>;
			};
	  }
	| {
			event: "auth_url";
			data: { url: string; clickable: boolean; instructions?: string };
	  }
	| {
			event: "device_code";
			data: {
				userCode: string;
				verificationUri: string;
				intervalSeconds?: number;
				expiresInSeconds?: number;
			};
	  }
	| { event: "info"; data: { message: string } }
	| { event: "progress"; data: { message: string } }
	| { event: "credential_ready"; data: Record<string, never> }
	| { event: "done"; data: { ok: boolean } }
	| { event: "error"; data: { code: string; message: string } };

function parseSseChunk(buffer: string): {
	events: Array<{ event: string; data: string }>;
	rest: string;
} {
	const parts = buffer.split("\n\n");
	const rest = parts.pop() ?? "";
	const events: Array<{ event: string; data: string }> = [];
	for (const part of parts) {
		let event = "message";
		const dataLines: string[] = [];
		for (const line of part.split("\n")) {
			if (line.startsWith("event:")) event = line.slice(6).trim();
			else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
		}
		if (dataLines.length) events.push({ event, data: dataLines.join("\n") });
	}
	return { events, rest };
}

export async function streamProviderAuthLogin(options: {
	providerId: string;
	authType: "api_key" | "oauth";
	onEvent: (event: ProviderAuthClientEvent) => void;
	signal?: AbortSignal;
}): Promise<void> {
	const response = await fetch("/api/provider-auth/stream", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			providerId: options.providerId,
			authType: options.authType,
		}),
		signal: options.signal,
		credentials: "same-origin",
	});
	if (!response.ok || !response.body) {
		throw new Error("Failed to start provider connection.");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const parsed = parseSseChunk(buffer);
		buffer = parsed.rest;
		for (const item of parsed.events) {
			try {
				const data = JSON.parse(item.data) as unknown;
				options.onEvent({
					event: item.event,
					data,
				} as ProviderAuthClientEvent);
			} catch {
				// ignore malformed
			}
		}
	}
}

export async function answerProviderAuthPrompt(options: {
	attemptId: string;
	promptId: string;
	value: string;
}): Promise<{ accepted: boolean }> {
	const response = await fetch("/api/provider-auth/control", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({
			action: "answer",
			attemptId: options.attemptId,
			promptId: options.promptId,
			value: options.value,
		}),
	});
	const body = (await response.json()) as { accepted?: boolean };
	return { accepted: !!body.accepted };
}

export async function cancelProviderAuth(options: {
	attemptId: string;
}): Promise<void> {
	await fetch("/api/provider-auth/control", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({
			action: "cancel",
			attemptId: options.attemptId,
		}),
	});
}
