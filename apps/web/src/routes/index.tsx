import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { HomeView, previewAccount, signedOutToast } from "#/components/account.tsx";
import { toast } from "#/components/ui/toast.tsx";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const navigate = useNavigate();
	return (
		<HomeView
			account={previewAccount}
			onSignOut={() => {
				void navigate({ to: "/sign-in" });
				toast(signedOutToast);
			}}
		/>
	);
}
