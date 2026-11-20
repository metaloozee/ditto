import { createFileRoute, useNavigate } from "@tanstack/react-router";

import {
	LINK_OUTCOMES,
	LinkOutcomeAlert,
	METHOD_KEYS,
	previewAccount,
	SettingsView,
	type LinkOutcome,
	type Method,
} from "#/components/account.tsx";
import { oneOf } from "#/components/auth.tsx";

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
	const account = {
		...previewAccount,
		methods:
			outcome === "linked" && method ? [...previewAccount.methods, method] : previewAccount.methods,
	};

	return (
		<SettingsView
			account={account}
			notice={
				outcome &&
				method && <LinkOutcomeAlert outcome={outcome} method={method} email={account.email} />
			}
			onLink={(next) =>
				void (next === "email"
					? navigate({ to: "/settings/verify-email" })
					: navigate({ to: "/settings", search: { outcome: "linked", method: next } }))
			}
			onSignOut={() => void navigate({ to: "/sign-in" })}
		/>
	);
}
