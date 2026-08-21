export const DITTO_GIT_ACTION_URL = "http://ditto.internal/v1/git-action";

function gitActionFailedMessage(): string {
	return "Git action failed. Push and open PR are unavailable for this agent run.";
}

export async function postAgentGitAction(options: {
	body: Record<string, unknown>;
}): Promise<{ ok: boolean; text: string }> {
	let response: Response;
	try {
		response = await fetch(DITTO_GIT_ACTION_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(options.body),
		});
	} catch {
		return { ok: false, text: gitActionFailedMessage() };
	}

	const raw = await response.text();
	let message = raw;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			const record = parsed as Record<string, unknown>;
			if (typeof record.error === "string" && record.error.length > 0) {
				message = record.error;
			} else if (record.result !== undefined) {
				message = JSON.stringify(record.result, null, 2);
			} else if (record.ok) {
				message = "Success.";
			}
		}
	} catch {
		// keep raw body
	}

	if (!response.ok) {
		return {
			ok: false,
			text: message || gitActionFailedMessage(),
		};
	}

	return { ok: true, text: message || "Success." };
}
