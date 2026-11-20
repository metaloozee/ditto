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
import { resendAtFrom, sendLinkEmailCode } from "#/lib/email-code-client.ts";

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

	async function linkEmail() {
		const result = await sendLinkEmailCode();
		if (result.ok || result.error.code === "CODE_RECENTLY_SENT") {
			await navigate({ to: "/settings/verify-email", state: { resendAt: resendAtFrom(result) } });
			return;
		}
		toast({
			id: "notice-delivery-failed",
			state: "error",
			message: "We couldn’t send your code",
			description: "Wait a moment, then try again.",
		});
	}

	return (
		<SettingsView
			account={{ ...account, methods }}
			onLink={(next) =>
				void (next === "email"
					? linkEmail()
					: navigate({ to: "/settings", search: { outcome: "linked", method: next } }))
			}
			onSignOut={() => void signOut()}
		/>
	);
}
