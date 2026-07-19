import { createFileRoute, redirect } from "@tanstack/react-router";
import { ProviderSettingsPage } from "#/components/provider-settings-page";
import { getSession } from "#/lib/auth.functions";

export const Route = createFileRoute("/settings")({
	beforeLoad: async () => {
		const session = await getSession();
		if (!session) throw redirect({ to: "/sign-in" });
		return { user: session.user };
	},
	head: () => ({
		meta: [
			{ title: "Settings · Ditto" },
			{
				name: "description",
				content: "Connect and manage AI providers for your Ditto account.",
			},
		],
	}),
	component: ProviderSettingsPage,
});
