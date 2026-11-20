import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	LINK_OUTCOMES,
	linkOutcomeToast,
	METHOD_KEYS,
	previewAccount,
	SettingsView,
	signedOutToast,
	type LinkOutcome,
	type Method,
} from "#/components/account.tsx";
import { oneOf } from "#/components/auth.tsx";
import { toast } from "#/components/ui/toast.tsx";

type SettingsSearch = { outcome?: LinkOutcome; method?: Method };

export const Route = createFileRoute("/settings")({
	head: () => ({ meta: [{ title: "Settings · Ditto" }] }),
	validateSearch: (search): SettingsSearch => ({
		outcome: oneOf(LINK_OUTCOMES, search.outcome),
		method: oneOf(METHOD_KEYS, search.method),
	}),
	component: Settings,
});

// A clickable mock: every link succeeds and nothing is saved.
function Settings() {
	const { outcome, method } = Route.useSearch();
	const navigate = useNavigate();
	const [methods, setMethods] = useState<readonly Method[]>(previewAccount.methods);

	// A linking outcome shows once as a toast, then leaves the URL.
	useEffect(() => {
		if (!outcome || !method) return;
		toast(linkOutcomeToast(outcome, method, previewAccount.email));
		if (outcome === "linked") setMethods((m) => (m.includes(method) ? m : [...m, method]));
		void navigate({ to: "/settings", replace: true });
	}, [outcome, method, navigate]);

	return (
		<SettingsView
			account={{ ...previewAccount, methods }}
			onLink={(next) =>
				void (next === "email"
					? navigate({ to: "/settings/verify-email" })
					: navigate({ to: "/settings", search: { outcome: "linked", method: next } }))
			}
			onSignOut={() => {
				void navigate({ to: "/sign-in" });
				toast(signedOutToast);
			}}
		/>
	);
}
