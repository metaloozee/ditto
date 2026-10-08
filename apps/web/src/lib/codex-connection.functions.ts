import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { createAuth } from "./auth";
import { handleCodexConnection } from "./codex-connection";
import { createCodexConnectionOperations } from "./codex-connection-product";

export const codexConnection = createServerFn({ method: "POST" })
	.inputValidator((input: unknown) => input)
	.handler(async ({ data }) => {
		const session = await createAuth(env).api.getSession({
			headers: getRequestHeaders(),
		});
		return handleCodexConnection({
			authenticatedUserId: session?.user.id ?? null,
			body: data,
			operations: createCodexConnectionOperations(env),
		});
	});
