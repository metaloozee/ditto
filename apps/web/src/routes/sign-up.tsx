import { createFileRoute, useHydrated, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import {
	noticeToast,
	CodeStep,
	oneOf,
	PROVIDERS,
	SignUpForm,
	useCodeChallenge,
	type AuthNotice,
	type Provider,
} from "#/components/auth.tsx";
import { toast } from "#/components/ui/toast.tsx";

const SIGN_UP_NOTICES = ["cancelled", "delivery-failed"] as const satisfies AuthNotice[];

type SignUpSearch = {
	step?: "verify";
	notice?: (typeof SIGN_UP_NOTICES)[number];
	provider?: Provider;
};

export const Route = createFileRoute("/sign-up")({
	head: () => ({ meta: [{ title: "Sign up · Ditto" }] }),
	validateSearch: (search): SignUpSearch => ({
		step: oneOf(["verify"], search.step),
		notice: oneOf(SIGN_UP_NOTICES, search.notice),
		provider: oneOf(Object.keys(PROVIDERS) as Provider[], search.provider),
	}),
	component: SignUp,
});

// A clickable mock of the flow: nothing is sent, 000000 is wrong, any other code passes.
function SignUp() {
	const { step, notice, provider } = Route.useSearch();
	// History state isn't sent to the server, so read it only once hydrated.
	// Leaving the route clears it a render before unmount, so hold the last
	// value; a new tab without it falls back to the first step.
	const hydrated = useHydrated();
	const saved = useLocation({ select: (location) => location.state.signUp });
	const last = useRef(saved);
	if (saved) last.current = saved;
	const details = hydrated ? last.current : undefined;
	const navigate = useNavigate();
	const signedIn = () => void navigate({ to: "/" });

	// A redirect's message shows once, then leaves the URL so a refresh won't repeat it.
	useEffect(() => {
		if (!notice) return;
		toast(noticeToast(notice, { provider, onSignUp: () => void navigate({ to: "/sign-up" }) }));
		void navigate({ to: "/sign-up", search: { step }, replace: true });
	}, [notice, provider, step, navigate]);

	if (step === "verify" && !hydrated) return null;

	return (
		<main className="grid min-h-dvh place-items-center px-4 py-10 sm:px-8">
			{step === "verify" && details ? (
				<VerifyStep
					email={details.email}
					onVerified={signedIn}
					onChangeEmail={() => void navigate({ to: "/sign-up", state: { signUp: details } })}
				/>
			) : (
				<SignUpForm
					key={details?.email}
					defaults={details}
					onEmail={(next) =>
						void navigate({ to: "/sign-up", search: { step: "verify" }, state: { signUp: next } })
					}
					onProvider={signedIn}
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
			submitLabel="Create account"
			pending={challenge.pending}
			onSubmit={(code) => challenge.verify(code, onVerified)}
			onResend={challenge.resend}
			onChangeEmail={onChangeEmail}
		/>
	);
}
