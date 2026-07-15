import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { createAuth } from "@/lib/auth";

export const getSession = createServerFn({ method: "GET" }).handler(
	async () => {
		const auth = await createAuth(env);
		const headers = getRequestHeaders();
		const session = await auth.api.getSession({ headers });

		return session;
	},
);
