import { z } from "zod";

const sseEventSchema = z.discriminatedUnion("event", [
	z
		.object({
			event: z.literal("meta"),
			data: z
				.object({
					attemptId: z.string().min(1).max(128),
					providerId: z.string().min(1).max(64),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			event: z.literal("prompt"),
			data: z
				.object({
					v: z.literal(1).optional(),
					kind: z.literal("prompt").optional(),
					promptId: z.string().min(1).max(128),
					type: z.enum(["text", "secret", "select", "manual_code"]),
					message: z.string().min(1).max(500),
					placeholder: z.string().max(200).optional(),
					options: z
						.array(
							z
								.object({
									id: z.string().min(1).max(128),
									label: z.string().min(1).max(200),
									description: z.string().max(200).optional(),
								})
								.strict(),
						)
						.max(32)
						.optional(),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			event: z.literal("auth_url"),
			data: z
				.object({
					url: z.string().min(1).max(2048),
					clickable: z.boolean(),
					instructions: z.string().max(500).optional(),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			event: z.literal("device_code"),
			data: z
				.object({
					userCode: z.string().min(1).max(64),
					verificationUri: z.string().min(1).max(2048),
					clickable: z.boolean().optional(),
					intervalSeconds: z.number().positive().finite().optional(),
					expiresInSeconds: z.number().positive().finite().optional(),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			event: z.literal("info"),
			data: z.object({ message: z.string().min(1).max(500) }).strict(),
		})
		.strict(),
	z
		.object({
			event: z.literal("progress"),
			data: z.object({ message: z.string().min(1).max(500) }).strict(),
		})
		.strict(),
	// Reject credential-bearing extras; empty object only.
	z
		.object({
			event: z.literal("credential_ready"),
			data: z.object({}).strict(),
		})
		.strict(),
	z
		.object({
			event: z.literal("done"),
			data: z.object({ ok: z.boolean() }).strict(),
		})
		.strict(),
	z
		.object({
			event: z.literal("error"),
			data: z
				.object({
					code: z.string().min(1).max(64),
					message: z.string().min(1).max(500),
				})
				.strict(),
		})
		.strict(),
]);

export type ProviderAuthClientEvent = z.infer<typeof sseEventSchema>;

/** Only open HTTPS URLs the server marked clickable. */
export function isOpenableAuthUrl(url: string, clickable: boolean): boolean {
	if (!clickable) return false;
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:";
	} catch {
		return false;
	}
}

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

export function parseProviderAuthClientEvent(
	event: string,
	data: unknown,
): ProviderAuthClientEvent | null {
	const parsed = sseEventSchema.safeParse({ event, data });
	return parsed.success ? parsed.data : null;
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
				const event = parseProviderAuthClientEvent(item.event, data);
				if (event) options.onEvent(event);
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
