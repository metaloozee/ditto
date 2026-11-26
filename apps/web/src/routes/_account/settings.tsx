import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import {
	LINK_OUTCOMES,
	linkOutcomeToast,
	METHOD_KEYS,
	SettingsView,
	type LinkOutcome,
	type Method,
} from "#/components/account.tsx";
import { oneOf, PROVIDERS, type Provider } from "#/components/auth.tsx";
import { ModelAccessSection } from "#/components/model-access.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { authClient, useSignOut } from "#/lib/auth-client.ts";
import { resendAtFrom, sendLinkEmailCode } from "#/lib/email-code-client.ts";
import {
	checkConnection,
	chooseDefaultPair,
	connectOpenCodeKey,
	getModelAccess,
} from "#/lib/model-access-api.ts";
import { OPENCODE_MODELS } from "#/lib/model-access.ts";

type SettingsSearch = { outcome?: LinkOutcome; method?: Method };

export const Route = createFileRoute("/_account/settings")({
	head: () => ({ meta: [{ title: "Settings · Ditto" }] }),
	validateSearch: (search): SettingsSearch => ({
		outcome: search.error ? oauthLinkOutcome(search.error) : oneOf(LINK_OUTCOMES, search.outcome),
		method: oneOf(METHOD_KEYS, search.method),
	}),
	loader: () => getModelAccess(),
	component: Settings,
});

const noop = () => {};

function oauthLinkOutcome(error: unknown): LinkOutcome {
	switch (error) {
		case "access_denied":
			return "cancelled";
		case "email_does_not_match":
		case "email_not_verified":
		case "email_not_found":
			return "email-mismatch";
		case "account_already_linked_to_different_user":
			return "linked-elsewhere";
		default:
			return "interrupted";
	}
}

function Settings() {
	const { account } = Route.useRouteContext();
	const { outcome, method } = Route.useSearch();
	const modelAccess = Route.useLoaderData();
	const navigate = useNavigate();
	const router = useRouter();
	const signOut = useSignOut();

	// A linking outcome shows once as a toast, then leaves the URL.
	useEffect(() => {
		if (!outcome || !method) return;
		if (outcome !== "linked" || account.methods.includes(method)) {
			toast(linkOutcomeToast(outcome, method, account.email));
		}
		void navigate({ to: "/settings", replace: true });
	}, [outcome, method, navigate, account.email, account.methods]);

	async function linkProvider(provider: Provider) {
		try {
			const { error } = await authClient.linkSocial({
				provider,
				callbackURL: `/settings?outcome=linked&method=${provider}`,
				errorCallbackURL: `/settings?method=${provider}`,
			});
			if (!error) return;
		} catch {
			// The request failed before the provider could open.
		}
		toast(linkOutcomeToast("interrupted", provider, account.email));
	}

	async function linkEmail() {
		const result = await sendLinkEmailCode();
		if (result.ok || result.error.code === "CODE_RECENTLY_SENT") {
			await navigate({ to: "/settings/verify-email", state: { resendAt: resendAtFrom(result) } });
			return;
		}
		if (result.error.code === "INVALID_EMAIL") {
			const linked = account.methods.flatMap((method) =>
				method === "email" ? [] : [PROVIDERS[method].name],
			);
			toast({
				id: "notice-email-unsupported",
				state: "error",
				message: "Email sign-in isn’t available",
				description: `Codes can’t be sent to ${account.email}. Keep signing in with ${linked.join(" or ")}.`,
			});
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
			account={account}
			onLink={(next) => void (next === "email" ? linkEmail() : linkProvider(next))}
			onSignOut={() => void signOut()}
			modelAccess={
				<ModelAccessSection
					access={{ connections: modelAccess.connections }}
					chatgptOffered={false}
					opencodeModels={OPENCODE_MODELS}
					defaultPair={modelAccess.defaultPair ?? undefined}
					onDefaultPairChange={async (pair) => {
						const refused = await chooseDefaultPair(pair);
						if (refused) {
							toast({
								id: "notice-default-model",
								state: "error",
								message: "The default model didn’t change",
								description: refused,
							});
						}
						await router.invalidate();
					}}
					onConnectKey={async (key, model) => {
						const refused = await connectOpenCodeKey(key, model);
						if (!refused) await router.invalidate();
						return refused;
					}}
					onCheck={async (connectionId) => {
						await checkConnection(connectionId);
						await router.invalidate();
					}}
					// Sign in with ChatGPT is a later ticket; an OpenCode key reconnects in its own form.
					onConnectChatGPT={noop}
					onReconnect={noop}
				/>
			}
		/>
	);
}
