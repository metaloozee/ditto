import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { AuthPanel, CodeForm, CodeSentTo, useCodeChallenge } from "#/components/auth.tsx";

export const Route = createFileRoute("/_account/settings_/verify-email")({
	head: () => ({ meta: [{ title: "Add email sign-in · Ditto" }] }),
	component: VerifyEmail,
});

// A clickable mock: 000000 is wrong and any other code is accepted. The address is the account's own,
// so there is no "use a different email" here.
function VerifyEmail() {
	const { account } = Route.useRouteContext();
	const navigate = useNavigate();
	const challenge = useCodeChallenge();
	return (
		<main className="grid min-h-dvh place-items-center px-4 py-10 sm:px-8">
			<AuthPanel title="Add email sign-in" description={<CodeSentTo email={account.email} />}>
				<CodeForm
					status={challenge.status}
					resendIn={challenge.resendIn}
					submitLabel="Enable email sign-in"
					pending={challenge.pending}
					onSubmit={(code) =>
						challenge.verify(
							code,
							() =>
								void navigate({ to: "/settings", search: { outcome: "linked", method: "email" } }),
						)
					}
					onResend={challenge.resend}
				/>
				<Link
					to="/settings"
					search={{ outcome: "cancelled", method: "email" }}
					className="self-center font-medium text-link underline-offset-4 hover:underline"
				>
					Back to Settings
				</Link>
			</AuthPanel>
		</main>
	);
}
