import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { HomeView, previewAccount } from "#/components/account.tsx";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const navigate = useNavigate();
	return <HomeView account={previewAccount} onSignOut={() => void navigate({ to: "/sign-in" })} />;
}
