import { createFileRoute } from "@tanstack/react-router";

import { HomeView } from "#/components/account.tsx";
import { useSignOut } from "#/lib/auth-client.ts";

export const Route = createFileRoute("/_account/")({ component: Home });

function Home() {
	const { account } = Route.useRouteContext();
	const signOut = useSignOut();
	return <HomeView account={account} onSignOut={() => void signOut()} />;
}
