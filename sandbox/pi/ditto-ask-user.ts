type UiContext = {
	ui: {
		input: (question: string, placeholder?: string) => Promise<string>;
	};
};

type AskUserParams = {
	question: string;
	placeholder?: string;
};

type ExtensionApi = {
	registerTool: (tool: {
		name: string;
		label: string;
		description: string;
		parameters: Record<string, unknown>;
		execute: (
			toolCallId: string,
			params: AskUserParams,
			signal: AbortSignal,
			onUpdate: (update: unknown) => void,
			ctx: UiContext,
		) => Promise<{
			content: Array<{ type: "text"; text: string }>;
			details: Record<string, unknown>;
		}>;
	}) => void;
};

export default function dittoAskUser(pi: ExtensionApi) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description: "Ask the Ditto user a concise clarification question.",
		parameters: {
			type: "object",
			properties: {
				question: {
					type: "string",
					description: "The question to show the user.",
				},
				placeholder: {
					type: "string",
					description: "Optional placeholder text for the answer field.",
				},
			},
			required: ["question"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const answer = await ctx.ui.input(params.question, params.placeholder);

			return {
				content: [{ type: "text", text: answer }],
				details: {
					question: params.question,
					answer,
				},
			};
		},
	});
}
