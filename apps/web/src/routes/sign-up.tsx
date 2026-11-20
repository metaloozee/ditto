import { createFileRoute, useHydrated, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
	noticeToast,
	CodeStep,
	oneOf,
	PROVIDERS,
	SignUpForm,
	type AuthNotice,
	type Provider,
	type SignUpDetails,
} from "#/components/auth.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { continueWith } from "#/lib/auth-client.ts";
import {
	resendAtFrom,
	sendSignUpCode,
	useEmailCode,
	verifySignUpCode,
	type CodeOutcome,
} from "#/lib/email-code-client.ts";

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

function SignUp() {
	const { step, notice, provider } = Route.useSearch();
	// History state isn't sent to the server, so read it only once hydrated.
	// Leaving the route clears it a render before unmount, so hold the last
	// value; a new tab without it falls back to the first step.
	const hydrated = useHydrated();
	const saved = useLocation({ select: (location) => location.state.signUp });
	const resendAt = useLocation({ select: (location) => location.state.resendAt }) ?? 0;
	const last = useRef(saved);
	if (saved) last.current = saved;
	const details = hydrated ? last.current : undefined;
	const navigate = useNavigate();
	const [sending, setSending] = useState(false);

	const requestCode = async (next: SignUpDetails) => {
		setSending(true);
		const result = await sendSignUpCode(next.email);
		setSending(false);
		// A code sent moments ago is still on its way: wait for it instead.
		if (result.ok || result.error.code === "CODE_RECENTLY_SENT")
			return void navigate({
				to: "/sign-up",
				search: { step: "verify" },
				state: { signUp: next, resendAt: resendAtFrom(result) },
			});
		toast(noticeToast("delivery-failed", { onSignUp: () => {} }));
	};

	const finish = (outcome: CodeOutcome) => {
		if (outcome === "signed-in") return void navigate({ to: "/" });
		// The address already has an account: no session, just a way to sign in.
		void navigate({
			to: "/sign-in",
			search: { notice: outcome },
			state: { email: details?.email },
		});
	};

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
					details={details}
					resendAt={resendAt}
					onOutcome={finish}
					onChangeEmail={() => void navigate({ to: "/sign-up", state: { signUp: details } })}
				/>
			) : (
				<SignUpForm
					key={details?.email}
					defaults={details}
					pending={sending}
					onEmail={(next) => void requestCode(next)}
					onProvider={continueWith}
				/>
			)}
		</main>
	);
}

function VerifyStep({
	details,
	resendAt,
	onOutcome,
	onChangeEmail,
}: {
	details: SignUpDetails;
	resendAt: number;
	onOutcome: (outcome: CodeOutcome) => void;
	onChangeEmail: () => void;
}) {
	const challenge = useEmailCode({
		resendAt,
		send: () => sendSignUpCode(details.email),
		verify: (code) => verifySignUpCode(details, code),
		onOutcome,
	});
	return (
		<CodeStep
			email={details.email}
			status={challenge.status}
			resendIn={challenge.resendIn}
			submitLabel="Create account"
			pending={challenge.pending}
			onSubmit={(code) => void challenge.verify(code)}
			onResend={() => void challenge.resend()}
			onChangeEmail={onChangeEmail}
		/>
	);
}
