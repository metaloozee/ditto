import {
	CODEX_PROVIDER,
	FIXTURE_PROVIDER,
	type ModelFrameV2,
	type ModelRequestV2,
	type ModelTextBlockV2,
	type ModelToolDefinitionV2,
	modelProviderFor,
	validateModelFramesV2,
} from "../../../../packages/runtime-contracts/src/model.js";
import { awaitSynthetic } from "./codex-request-contract";

export const CODEX_BACKEND_URL = "https://chatgpt.com/backend-api";
// Raise when OpenAI raises models' minimal_client_version (S1: 0.167.0 unlocked every listed model).
export const CODEX_CLIENT_VERSION = "0.167.0";
export const CODEX_STREAM_LIMITS = {
	responseBytes: 8 * 1_048_576,
	eventBytes: 2 * 1_048_576,
	events: 20_000,
} as const;

const SIGNATURE_BYTES = 65_536;
const encoder = new TextEncoder();

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

export function codexAccountId(access: string): string | null {
	try {
		const parts = access.split(".");
		if (parts.length !== 3) return null;
		const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
		const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
		const payload = record(JSON.parse(new TextDecoder().decode(bytes)));
		const auth = record(payload?.["https://api.openai.com/auth"]);
		const id = auth?.chatgpt_account_id;
		return typeof id === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(id)
			? id
			: null;
	} catch {
		return null;
	}
}

export function selectUpstream(
	request: ModelRequestV2,
	fixtureAvailable: boolean,
): "codex" | "fixture" | null {
	if (modelProviderFor(request.model) !== request.provider) return null;
	if (request.provider === CODEX_PROVIDER) return "codex";
	if (request.provider === FIXTURE_PROVIDER && fixtureAvailable)
		return "fixture";
	return null;
}

function contentText(content: string | ModelTextBlockV2[]): string {
	return typeof content === "string"
		? content
		: content.map((block) => block.text).join("\n");
}

function textBlocks(content: string | ModelTextBlockV2[]): string[] {
	return typeof content === "string" ? [content] : content.map((b) => b.text);
}

function reasoningItem(signature: string | undefined): unknown | null {
	if (signature === undefined) return null;
	try {
		const parsed = record(JSON.parse(signature));
		if (!parsed || parsed.type !== "reasoning") return null;
		const item: Record<string, unknown> = {};
		for (const key of ["type", "id", "summary", "content", "encrypted_content"])
			if (key in parsed) item[key] = parsed[key];
		return item;
	} catch {
		return null;
	}
}

function messageId(signature: string | undefined): string | undefined {
	if (signature === undefined) return undefined;
	try {
		const parsed = record(JSON.parse(signature));
		const id = parsed?.id;
		return parsed?.v === 1 &&
			typeof id === "string" &&
			/^msg_[A-Za-z0-9_-]{1,60}$/.test(id)
			? id
			: undefined;
	} catch {
		return undefined;
	}
}

export function buildCodexUpstream(
	request: ModelRequestV2,
	context: { accountId: string; promptCacheKey: string },
): { url: string; headers: Record<string, string>; body: string } {
	if (request.provider !== CODEX_PROVIDER)
		throw new Error("codex_request_contract");
	const contents: string[] = [];
	const sections = new Map<string, string>();
	const tools = new Map<string, ModelToolDefinitionV2>();
	for (const message of request.transcript.messages) {
		if (message.role !== "system") continue;
		const content = contentText(message.content);
		if (content) contents.push(content);
		for (const [name, value] of Object.entries(message.sections ?? {})) {
			if (value === null) sections.delete(name);
			else sections.set(name, value);
		}
		for (const removed of message.toolsRemoved ?? [])
			tools.delete(removed.name);
		for (const added of message.toolsAdded ?? []) tools.set(added.name, added);
	}
	const instructions =
		[...contents, ...sections.values()]
			.filter((v) => v.length > 0)
			.join("\n\n") || "You are a helpful assistant.";
	const input: unknown[] = [];
	for (const message of request.transcript.messages) {
		if (message.role === "system") continue;
		if (message.role === "user") {
			const blocks = textBlocks(message.content);
			if (blocks.length === 0) continue;
			input.push({
				role: "user",
				content: blocks.map((t) => ({ type: "input_text", text: t })),
			});
		} else if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type === "thinking") {
					const item = reasoningItem(block.thinkingSignature);
					if (item) input.push(item);
				} else if (block.type === "text") {
					const id = messageId(block.textSignature);
					input.push({
						type: "message",
						role: "assistant",
						status: "completed",
						content: [
							{ type: "output_text", text: block.text, annotations: [] },
						],
						...(id === undefined ? {} : { id }),
					});
				} else {
					input.push({
						type: "function_call",
						call_id: block.id.split("|")[0],
						name: block.name,
						arguments: JSON.stringify(block.arguments),
					});
				}
			}
		} else {
			input.push({
				type: "function_call_output",
				call_id: message.toolCallId.split("|")[0],
				output:
					message.content.map((b) => b.text).join("\n") || "(no tool output)",
			});
		}
	}
	const toolList = [...tools.values()];
	return {
		url: `${CODEX_BACKEND_URL}/codex/responses`,
		headers: {
			"content-type": "application/json",
			accept: "text/event-stream",
			"openai-beta": "responses=experimental",
			originator: "codex_cli_rs",
			"chatgpt-account-id": context.accountId,
		},
		body: JSON.stringify({
			model: request.model,
			instructions,
			input,
			...(toolList.length
				? {
						tools: toolList.map((t) => ({
							type: "function",
							name: t.name,
							description: t.description,
							parameters: t.parameters,
							strict: false,
						})),
					}
				: {}),
			tool_choice: "auto",
			parallel_tool_calls: true,
			...(request.thinking !== "off"
				? { reasoning: { effort: request.thinking, summary: "auto" } }
				: {}),
			store: false,
			stream: true,
			include: ["reasoning.encrypted_content"],
			prompt_cache_key: context.promptCacheKey,
		}),
	};
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: 0;
}

function joined(entries: unknown, type: string): string {
	if (!Array.isArray(entries)) return "";
	return entries
		.map((entry) => {
			const e = record(entry);
			return e && e.type === type ? text(e.text) : null;
		})
		.filter((t): t is string => t !== null)
		.join("\n\n");
}

export async function readCodexFrames(
	response: Response,
	signal: AbortSignal,
	privateValues: readonly string[],
): Promise<
	{ status: "complete"; frames: ModelFrameV2[] } | { status: "failed" }
> {
	if (
		response.status !== 200 ||
		response.headers.get("location") !== null ||
		!(response.headers.get("content-type") ?? "").startsWith(
			"text/event-stream",
		) ||
		!response.body
	)
		throw new Error("codex_upstream_contract");
	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const items: ModelFrameV2[] = [];
	const state: { terminal: ModelFrameV2 | null; failed: boolean } = {
		terminal: null,
		failed: false,
	};
	let pending = "";
	let total = 0;
	let events = 0;
	const abort = () => {
		void reader.cancel().catch(() => {});
	};

	const handle = (raw: string): void => {
		events += 1;
		if (events > CODEX_STREAM_LIMITS.events)
			throw new Error("codex_stream_bound");
		const data: string[] = [];
		for (const line of raw.split("\n")) {
			if (line.startsWith("data:"))
				data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
		}
		if (data.length === 0) return;
		const payload = data.join("\n");
		if (payload === "[DONE]") return;
		const event = record(JSON.parse(payload));
		const type = event ? text(event.type) : null;
		if (!event || type === null) throw new Error("codex_upstream_contract");
		if (type === "response.failed" || type === "error") {
			state.failed = true;
			return;
		}
		if (type === "response.output_item.done") {
			const item = record(event.item);
			if (!item) throw new Error("codex_upstream_contract");
			if (item.type === "reasoning") {
				let thinking = joined(item.summary, "summary_text");
				if (!thinking) thinking = joined(item.content, "reasoning_text");
				const serialized = JSON.stringify(item);
				const signature =
					encoder.encode(serialized).byteLength <= SIGNATURE_BYTES
						? serialized
						: undefined;
				items.push({
					version: 2,
					type: "thinking",
					thinking,
					...(signature === undefined ? {} : { signature }),
				});
			} else if (item.type === "message") {
				const content = Array.isArray(item.content) ? item.content : [];
				const body = content
					.map((entry) => {
						const e = record(entry);
						if (!e) return "";
						if (e.type === "output_text") return text(e.text) ?? "";
						if (e.type === "refusal") return text(e.refusal) ?? "";
						return "";
					})
					.join("");
				const signature =
					typeof item.id === "string"
						? JSON.stringify({
								v: 1,
								id: item.id,
								...(typeof item.phase === "string"
									? { phase: item.phase }
									: {}),
							})
						: undefined;
				items.push({
					version: 2,
					type: "text",
					text: body,
					...(signature === undefined ? {} : { signature }),
				});
			} else if (item.type === "function_call") {
				const callId = text(item.call_id);
				const id = text(item.id);
				const name = text(item.name);
				if (!callId || !id || !name) throw new Error("codex_upstream_contract");
				const args = record(JSON.parse(text(item.arguments) ?? ""));
				if (!args) throw new Error("codex_upstream_contract");
				items.push({
					version: 2,
					type: "toolCall",
					id: `${callId}|${id}`,
					name,
					arguments: args,
				});
			} else throw new Error("codex_unsupported_item");
			return;
		}
		if (type === "response.completed" || type === "response.incomplete") {
			if (state.terminal) throw new Error("codex_upstream_contract");
			const res = record(event.response);
			const usage = record(res?.usage);
			const cached = count(record(usage?.input_tokens_details)?.cached_tokens);
			const reasoningTokens = record(
				usage?.output_tokens_details,
			)?.reasoning_tokens;
			const stopReason =
				type === "response.completed"
					? items.some((f) => f.type === "toolCall")
						? "toolUse"
						: "stop"
					: record(res?.incomplete_details)?.reason === "max_output_tokens"
						? "length"
						: "error";
			state.terminal = {
				version: 2,
				type: "done",
				stopReason,
				usage: {
					input: Math.max(0, count(usage?.input_tokens) - cached),
					output: count(usage?.output_tokens),
					cacheRead: cached,
					...(typeof reasoningTokens === "number"
						? { reasoning: count(reasoningTokens) }
						: {}),
				},
			};
		}
	};

	signal.addEventListener("abort", abort, { once: true });
	try {
		for (;;) {
			signal.throwIfAborted();
			const chunk = await awaitSynthetic(reader.read(), signal);
			signal.throwIfAborted();
			if (chunk.done) break;
			total += chunk.value.byteLength;
			if (total > CODEX_STREAM_LIMITS.responseBytes)
				throw new Error("codex_stream_bound");
			pending = (
				pending + decoder.decode(chunk.value, { stream: true })
			).replace(/\r\n/g, "\n");
			for (;;) {
				const index = pending.indexOf("\n\n");
				if (index === -1) break;
				const raw = pending.slice(0, index);
				pending = pending.slice(index + 2);
				handle(raw);
				if (state.failed) return { status: "failed" };
			}
			if (encoder.encode(pending).byteLength > CODEX_STREAM_LIMITS.eventBytes)
				throw new Error("codex_stream_bound");
		}
		pending = (pending + decoder.decode()).replace(/\r\n/g, "\n");
		if (pending.trim() !== "") {
			handle(pending);
			if (state.failed) return { status: "failed" };
		}
		if (!state.terminal) throw new Error("codex_truncated_stream");
		const frames = validateModelFramesV2([...items, state.terminal]);
		const serialized = JSON.stringify(frames);
		if (
			privateValues.some(
				(value) => value.length > 0 && serialized.includes(value),
			)
		)
			throw new Error("codex_output_bound");
		return { status: "complete", frames };
	} finally {
		signal.removeEventListener("abort", abort);
		await awaitSynthetic(reader.cancel(), AbortSignal.timeout(1000)).catch(
			() => {},
		);
		reader.releaseLock();
	}
}
