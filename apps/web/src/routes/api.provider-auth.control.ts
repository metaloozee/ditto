import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "#/db";
import { createCredentialRepository } from "#/lib/account-provider-credentials";
import { createAuth } from "#/lib/auth";
import {
	controlProviderAuth,
	providerAuthControlBodySchema,
} from "#/lib/provider-auth-service";

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const Route = createFileRoute("/api/provider-auth/control")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const session = await createAuth(env).api.getSession({
					headers: request.headers,
				});
				if (!session?.user) {
					return jsonResponse({ error: "Unauthorized" }, 401);
				}

				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return jsonResponse({ error: "Invalid JSON body." }, 400);
				}
				const parsed = providerAuthControlBodySchema.safeParse(body);
				if (!parsed.success) {
					return jsonResponse(
						{ error: "Invalid request.", issues: parsed.error.issues },
						400,
					);
				}

				const result = await controlProviderAuth({
					db: createCredentialRepository(createDb(env)),
					env,
					userId: session.user.id,
					input: parsed.data,
				});
				return jsonResponse(result.body, result.status);
			},
		},
	},
});
