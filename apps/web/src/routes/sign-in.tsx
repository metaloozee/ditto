import { createFileRoute, useHydrated, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import {
	AUTH_NOTICES,
	noticeToast,
	CodeStep,
	oauthErrorNotice,
	oneOf,
	PROVIDERS,
	SignInForm,
	useCodeChallenge,
	type Provider,
} from "#/components/auth.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { continueWith } from "#/lib/auth-client.ts";

type SignInSearch = {
	step?: "verify";
	notice?: (typeof AUTH_NOTICES)[number];
	provider?: Provider;
};

export const Route = createFileRoute("/sign-in")({
	head: () => ({ meta: [{ title: "Sign in · Ditto" }] }),
	validateSearch: (search): SignInSearch => ({
		step: oneOf(["verify"], search.step),
		notice: oneOf(AUTH_NOTICES, search.notice) ?? oauthErrorNotice(search.error),
		provider: oneOf(Object.keys(PROVIDERS) as Provider[], search.provider),
	}),
	component: SignIn,
});

// The email code is still a clickable mock (#7): nothing is sent, 000000 is wrong, any other code passes.
function SignIn() {
	const { step, notice, provider } = Route.useSearch();
	// History state isn't sent to the server, so read it only once hydrated.
	// Leaving the route clears it a render before unmount, so hold the last
	// value; a new tab without it falls back to the first step.
	const hydrated = useHydrated();
	const saved = useLocation({ select: (location) => location.state.email });
	const last = useRef(saved);
	if (saved) last.current = saved;
	const email = hydrated ? last.current : undefined;
	const navigate = useNavigate();
	const signedIn = () => void navigate({ to: "/" });

	// A redirect's message shows once, then leaves the URL so a refresh won't repeat it.
	useEffect(() => {
		if (!notice) return;
		toast(noticeToast(notice, { provider, onSignUp: () => void navigate({ to: "/sign-up" }) }));
		void navigate({ to: "/sign-in", search: { step }, replace: true });
	}, [notice, provider, step, navigate]);

	if (step === "verify" && !hydrated) return null;

	return (
		<main className="grid min-h-dvh place-items-center px-4 py-10 sm:px-8">
			{step === "verify" && email ? (
				<VerifyStep
					key={email}
					email={email}
					onVerified={signedIn}
					onChangeEmail={() => void navigate({ to: "/sign-in", state: { email } })}
				/>
			) : (
				<SignInForm
					key={email}
					defaultEmail={email}
					onEmail={(address) =>
						void navigate({ to: "/sign-in", search: { step: "verify" }, state: { email: address } })
					}
					onProvider={continueWith}
				/>
			)}
		</main>
	);
}

function VerifyStep({
	email,
	onVerified,
	onChangeEmail,
}: {
	email: string;
	onVerified: () => void;
	onChangeEmail: () => void;
}) {
	const challenge = useCodeChallenge();
	return (
		<CodeStep
			email={email}
			status={challenge.status}
			resendIn={challenge.resendIn}
			submitLabel="Sign in"
			pending={challenge.pending}
			onSubmit={(code) => challenge.verify(code, onVerified)}
			onResend={challenge.resend}
			onChangeEmail={onChangeEmail}
		/>
	);
}
