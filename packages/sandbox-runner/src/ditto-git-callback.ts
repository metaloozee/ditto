export type DittoGitCallbackEnv = {
	callbackUrl?: string;
	callbackToken?: string;
};

export function readDittoGitCallbackEnv(
	env: NodeJS.ProcessEnv = process.env,
): DittoGitCallbackEnv {
	return {
		callbackUrl: env.DITTO_GIT_CALLBACK_URL,
		callbackToken: env.DITTO_GIT_CALLBACK_TOKEN,
	};
}

function gitCallbackNotConfiguredMessage(): string {
	return "Git callback not configured. Push and open PR are unavailable for this agent run.";
}

function redactCallbackToken(text: string, token: string | undefined): string {
	if (!token || token.length === 0) {
		return text;
	}
	return text.split(token).join("[redacted]");
}

export async function postAgentGitAction(options: {
	env: DittoGitCallbackEnv;
	body: Record<string, unknown>;
}): Promise<{ ok: boolean; text: string }> {
	const url = options.env.callbackUrl?.trim();
	const token = options.env.callbackToken?.trim();
	if (!url || !token) {
		return { ok: false, text: gitCallbackNotConfiguredMessage() };
	}

	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(options.body),
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Git callback request failed.";
		return { ok: false, text: message };
	}

	const raw = await response.text();
	let message = raw;
	try {
		const parsed = JSON.parse(raw) as {
			ok?: boolean;
			error?: string;
			result?: unknown;
		};
		if (parsed.error) {
			message = parsed.error;
		} else if (parsed.result !== undefined) {
			message = JSON.stringify(parsed.result, null, 2);
		} else if (parsed.ok) {
			message = "Success.";
		}
	} catch {
		// keep raw body
	}

	message = redactCallbackToken(message, token);

	if (!response.ok) {
		return {
			ok: false,
			text: message || `Git callback failed (${response.status}).`,
		};
	}

	return { ok: true, text: message || "Success." };
}
