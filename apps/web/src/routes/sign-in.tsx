import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	AUTH_NOTICES,
	noticeToast,
	CodeStep,
	oauthErrorNotice,
	oneOf,
	PROVIDERS,
	SignInForm,
	type Provider,
} from "#/components/auth.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { continueWith } from "#/lib/auth-client.ts";
import {
	resendAtFrom,
	sendSignInCode,
	useEmailCode,
	useEmailCodeHistory,
	verifySignInCode,
} from "#/lib/email-code-client.ts";

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

function SignIn() {
	const { step, notice, provider } = Route.useSearch();
	const { hydrated, value: email, resendAt } = useEmailCodeHistory("email");
	const navigate = useNavigate();
	const [sending, setSending] = useState(false);
	const requestCode = async (address: string) => {
		if (sending) return;
		setSending(true);
		const result = await sendSignInCode(address);
		setSending(false);
		if (!result.ok) return toast(noticeToast("delivery-failed", { onSignUp: () => {} }));
		void navigate({
			to: "/sign-in",
			search: { step: "verify" },
			state: { email: address, resendAt: resendAtFrom(result) },
		});
	};

	// A redirect's message shows once, then leaves the URL so a refresh won't repeat it.
	useEffect(() => {
		if (!notice) return;
		toast(noticeToast(notice, { provider, onSignUp: () => void navigate({ to: "/sign-up" }) }));
		void navigate({ to: "/sign-in", search: { step }, state: true, replace: true });
	}, [notice, provider, step, navigate]);

	if (step === "verify" && !hydrated) return null;

	return (
		<main className="grid min-h-dvh place-items-center px-4 py-10 sm:px-8">
			{step === "verify" && email ? (
				<VerifyStep
					key={email}
					email={email}
					resendAt={resendAt}
					onVerified={() => void navigate({ to: "/" })}
					onChangeEmail={() => void navigate({ to: "/sign-in", state: { email } })}
				/>
			) : (
				<SignInForm
					key={email}
					defaultEmail={email}
					pending={sending}
					onEmail={(address) => void requestCode(address)}
					onProvider={continueWith}
				/>
			)}
		</main>
	);
}

function VerifyStep({
	email,
	resendAt,
	onVerified,
	onChangeEmail,
}: {
	email: string;
	resendAt: number;
	onVerified: () => void;
	onChangeEmail: () => void;
}) {
	const challenge = useEmailCode({
		resendAt,
		send: () => sendSignInCode(email),
		verify: (code) => verifySignInCode(email, code),
		onOutcome: onVerified,
		resentToast: { id: "code-resent", state: "info", message: "Code requested" },
	});
	return (
		<CodeStep
			email={email}
			conditional
			status={challenge.status}
			resendIn={challenge.resendIn}
			submitLabel="Sign in"
			pending={challenge.pending}
			onSubmit={(code) => void challenge.verify(code)}
			onResend={() => void challenge.resend()}
			onChangeEmail={onChangeEmail}
		/>
	);
}
