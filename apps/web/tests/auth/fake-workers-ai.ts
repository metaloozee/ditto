// Workers AI as the `AI` binding serves it through AI Gateway, ported from the feasibility
// simulator (`feasibility/simulated-workers-ai.ts`). The test stage's stand-in binding sends
// each request here as `/workers-binding.ai/<path>`.
import type { IncomingMessage, ServerResponse } from "node:http";

/** The test stage's AI Gateway, as `AI_GATEWAY_ID` names it. */
const ROUTE = "/workers-binding.ai/ai-gateway/gateways/test-gateway/workers-ai/v1/chat/completions";

/** A request the included model received: what it named, and who the gateway would bill it to. */
export type WorkersAiRequest = {
	model: unknown;
	/** The parsed `cf-aig-metadata` header. */
	metadata: unknown;
	/** Whether it carried a provider key, which the gateway would use instead of its own. */
	authorization: boolean;
	/** The tools it offered the model. */
	tools: string[];
};

/** What Workers AI answers the next request naming `model` (or any model) with. */
export type WorkersAiFault = { model?: string; status: number; body?: unknown };

type ChatMessage = { role: string; content?: unknown };

function chunks(delta: Record<string, unknown>, finish: string) {
	const events = [
		{ id: "chatcmpl-fake", choices: [{ index: 0, delta }] },
		{
			id: "chatcmpl-fake",
			choices: [{ index: 0, delta: {}, finish_reason: finish }],
			usage: { prompt_tokens: 40, completion_tokens: 6, total_tokens: 46 },
		},
	];
	return `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
}

async function text(req: IncomingMessage) {
	const parts: Buffer[] = [];
	for await (const part of req) parts.push(part as Buffer);
	return Buffer.concat(parts).toString();
}

/**
 * Serves Workers AI and its controls (`/__workers-ai/`). A model offered a tool calls the
 * first one, then answers with what it returned; otherwise it answers "pong".
 */
export function fakeWorkersAi() {
	const requests: WorkersAiRequest[] = [];
	const faults: WorkersAiFault[] = [];

	/** Answers the request if it is one of Workers AI's; false otherwise. */
	return async function serve(
		req: IncomingMessage,
		res: ServerResponse,
		url: URL,
	): Promise<boolean> {
		const json = (status: number, data: unknown) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(data));
			return true;
		};
		if (req.method === "POST" && url.pathname === "/__workers-ai/fail-next") {
			faults.push(JSON.parse(await text(req)) as WorkersAiFault);
			return json(204, null);
		}
		if (url.pathname === "/__workers-ai/requests") return json(200, requests);
		if (url.pathname.startsWith("/workers-binding.ai/")) {
			if (req.method !== "POST" || url.pathname !== ROUTE)
				return json(404, "unknown binding route");
			const body = JSON.parse(await text(req)) as {
				model: unknown;
				messages: ChatMessage[];
				tools?: { function: { name: string } }[];
			};
			let metadata: unknown;
			try {
				metadata = JSON.parse(String(req.headers["cf-aig-metadata"] ?? "null"));
			} catch {
				return json(400, { error: "cf-aig-metadata is not JSON" });
			}
			const tools = body.tools?.map((tool) => tool.function.name) ?? [];
			requests.push({
				model: body.model,
				metadata,
				authorization: req.headers.authorization !== undefined,
				tools,
			});
			const fault = faults.findIndex(
				(each) => each.model === undefined || each.model === body.model,
			);
			if (fault >= 0) {
				const [{ status, body: answer }] = faults.splice(fault, 1) as [WorkersAiFault];
				return json(status, answer ?? { errors: [{ message: "Simulated" }] });
			}
			const toolResult = body.messages.find((message) => message.role === "tool");
			const stream =
				toolResult !== undefined
					? chunks({ role: "assistant", content: String(toolResult.content) }, "stop")
					: tools[0]
						? chunks(
								{
									role: "assistant",
									tool_calls: [
										{
											index: 0,
											id: "call_fake",
											type: "function",
											function: { name: tools[0], arguments: "{}" },
										},
									],
								},
								"tool_calls",
							)
						: chunks({ role: "assistant", content: "pong" }, "stop");
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.end(stream);
			return true;
		}
		return false;
	};
}
