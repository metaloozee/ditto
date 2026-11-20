import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { METHOD_KEYS, type Account } from "#/components/account.tsx";

/** The signed-in Ditto account, or `null` without a live session. */
export const getAccount = createServerFn({ method: "GET" }).handler(
	async (): Promise<Account | null> => {
		const { auth } = await import("./auth.server.ts");
		const headers = getRequestHeaders();
		const session = await auth.api.getSession({ headers });
		if (!session) return null;
		const linked = await auth.api.listUserAccounts({ headers });
		return {
			displayName: session.user.name,
			email: session.user.email,
			methods: METHOD_KEYS.filter((method) => linked.some((a) => a.providerId === method)),
		};
	},
);
