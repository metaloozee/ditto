// A simulated Workers AI binding (#35): AI Gateway's Workers AI passthrough on the binding's
// `fetch`, and the gateway's request log. Web APIs only, so it serves the Node tests and the
// simulated AI Worker in the paid stage's test stage.
import type { GatewayLog } from "./workers-ai-trial.ts";

const BINDING_ORIGIN = "https://workers-binding.ai";
/** Neurons Cloudflare bills per simulated request, reported by the gateway log as a cost. */
export const SIMULATED_COST = 0.000_011;

function chunks(delta: Record<string, unknown>, finish: string) {
	const events = [
		{ id: "chatcmpl-sim", choices: [{ index: 0, delta }] },
		{
			id: "chatcmpl-sim",
			choices: [{ index: 0, delta: {}, finish_reason: finish }],
			usage: { prompt_tokens: 40, completion_tokens: 6, total_tokens: 46 },
		},
	];
	return `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
}

type ChatMessage = { role: string; content?: unknown; tool_call_id?: string };

/**
 * `toolCalls: false` simulates a model that answers in text instead of calling the tool it was
 * offered, the failure #35 records against a model.
 */
export function simulatedWorkersAi(options: { gatewayId: string; toolCalls?: boolean }) {
	const logs = new Map<string, GatewayLog>();
	const fetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const route = `/ai-gateway/gateways/${options.gatewayId}/workers-ai/v1/chat/completions`;
		if (url.origin !== BINDING_ORIGIN || url.pathname !== route || request.method !== "POST") {
			return new Response("unknown binding route", { status: 404 });
		}
		// A request-supplied Authorization header is a BYOK key that overrides the gateway's own.
		if (request.headers.has("authorization")) {
			return Response.json({ error: "unexpected provider key" }, { status: 401 });
		}
		let metadata: Record<string, unknown> = {};
		try {
			metadata = JSON.parse(request.headers.get("cf-aig-metadata") ?? "{}");
		} catch {
			return Response.json({ error: "cf-aig-metadata is not JSON" }, { status: 400 });
		}
		const body = (await request.json()) as {
			model: string;
			messages: ChatMessage[];
			tools?: { function: { name: string } }[];
		};
		const logId = `log-${logs.size + 1}`;
		logs.set(logId, {
			id: logId,
			provider: "workers-ai",
			model: body.model,
			success: true,
			tokens_in: 40,
			tokens_out: 6,
			cost: SIMULATED_COST,
			metadata: metadata as GatewayLog["metadata"],
		});
		const toolResult = body.messages.find((m) => m.role === "tool");
		const tool = body.tools?.[0]?.function.name;
		const stream =
			toolResult !== undefined
				? chunks({ role: "assistant", content: String(toolResult.content) }, "stop")
				: tool && options.toolCalls !== false
					? chunks(
							{
								role: "assistant",
								tool_calls: [
									{
										index: 0,
										id: "call_sim",
										type: "function",
										function: { name: tool, arguments: "{}" },
									},
								],
							},
							"tool_calls",
						)
					: chunks({ role: "assistant", content: tool ? "I cannot call tools" : "pong" }, "stop");
		return new Response(stream, {
			headers: { "content-type": "text/event-stream", "cf-aig-log-id": logId },
		});
	};
	return {
		aiGatewayLogId: null,
		fetch,
		gateway: (id: string) => ({
			async getLog(logId: string): Promise<GatewayLog> {
				const log = id === options.gatewayId ? logs.get(logId) : undefined;
				if (!log) throw new Error(`AiGatewayLogNotFound: ${logId}`);
				return log;
			},
		}),
	};
}
