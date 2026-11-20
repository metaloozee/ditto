import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	LINK_OUTCOMES,
	linkOutcomeToast,
	METHOD_KEYS,
	SettingsView,
	type LinkOutcome,
	type Method,
} from "#/components/account.tsx";
import { oneOf } from "#/components/auth.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { useSignOut } from "#/lib/auth-client.ts";

type SettingsSearch = { outcome?: LinkOutcome; method?: Method };

export const Route = createFileRoute("/_account/settings")({
	head: () => ({ meta: [{ title: "Settings · Ditto" }] }),
	validateSearch: (search): SettingsSearch => ({
		outcome: oneOf(LINK_OUTCOMES, search.outcome),
		method: oneOf(METHOD_KEYS, search.method),
	}),
	component: Settings,
});

// Linking is still a clickable mock: every link succeeds and nothing is saved.
function Settings() {
	const { account } = Route.useRouteContext();
	const { outcome, method } = Route.useSearch();
	const navigate = useNavigate();
	const signOut = useSignOut();
	const [methods, setMethods] = useState<readonly Method[]>(account.methods);

	// A linking outcome shows once as a toast, then leaves the URL.
	useEffect(() => {
		if (!outcome || !method) return;
		toast(linkOutcomeToast(outcome, method, account.email));
		if (outcome === "linked") setMethods((m) => (m.includes(method) ? m : [...m, method]));
		void navigate({ to: "/settings", replace: true });
	}, [outcome, method, navigate, account.email]);

	return (
		<SettingsView
			account={{ ...account, methods }}
			onLink={(next) =>
				void (next === "email"
					? navigate({ to: "/settings/verify-email" })
					: navigate({ to: "/settings", search: { outcome: "linked", method: next } }))
			}
			onSignOut={() => void signOut()}
		/>
	);
}
