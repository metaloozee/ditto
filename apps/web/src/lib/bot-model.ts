import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { refusal } from "#/lib/model-access-api.ts";
import type { Pair } from "#/lib/model-access.ts";

/** The pair a bot of the owner's workspace uses in place of the default, read on the server. */
export const getBotOverride = createServerFn({ method: "GET" })
	.validator((data: { workspaceId: string; botId: string }) => data)
	.handler(async ({ data }): Promise<Pair | null> => {
		const { admit } = await import("./workspace-gateway.server.ts");
		const { memberBot } = await import("./bot-gateway.server.ts");
		const admitted = await admit(getRequestHeaders(), data.workspaceId);
		if (admitted instanceof Response) {
			if (admitted.status === 401) throw redirect({ to: "/sign-in" });
			throw notFound();
		}
		const bot = await memberBot(admitted, data.botId);
		if (!bot) throw notFound();
		const override: Pair | null = await bot.override();
		return override;
	});

/** Gives the bot its own pair, or `null` to inherit the default. Answers why it couldn't. */
export async function chooseBotOverride(
	workspaceId: string,
	botId: string,
	override: Pair | null,
): Promise<string | undefined> {
	const response = await fetch(`/api/workspaces/${workspaceId}/bots/${botId}/model`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ override }),
	}).catch(() => null);
	return refusal(response);
}
