import { createFileRoute, redirect } from "@tanstack/react-router";

import { getAccount } from "#/lib/account.ts";

// Every page under here needs a live session; the check runs on the server.
export const Route = createFileRoute("/_account")({
	beforeLoad: async () => {
		const account = await getAccount();
		if (!account) throw redirect({ to: "/sign-in" });
		return { account };
	},
});
