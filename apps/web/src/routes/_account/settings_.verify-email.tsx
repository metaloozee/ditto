import { createFileRoute, useLocation, useNavigate, useRouter } from "@tanstack/react-router";

import { AuthPanel, CodeForm, CodeSentTo } from "#/components/auth.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	cancelLinkEmailCode,
	sendLinkEmailCode,
	useEmailCode,
	verifyLinkEmailCode,
} from "#/lib/email-code-client.ts";

export const Route = createFileRoute("/_account/settings_/verify-email")({
	head: () => ({ meta: [{ title: "Add email sign-in · Ditto" }] }),
	component: VerifyEmail,
});

function VerifyEmail() {
	const { account } = Route.useRouteContext();
	const navigate = useNavigate();
	const router = useRouter();
	const resendAt = useLocation({ select: (location) => location.state.resendAt }) ?? 0;
	const challenge = useEmailCode({
		resendAt,
		send: sendLinkEmailCode,
		verify: verifyLinkEmailCode,
		onOutcome: () => {
			void router
				.invalidate()
				.then(() => navigate({ to: "/settings", search: { outcome: "linked", method: "email" } }));
		},
		onInterrupted: () => {
			void navigate({ to: "/settings", search: { outcome: "interrupted", method: "email" } });
		},
	});
	return (
		<main className="grid min-h-dvh place-items-center px-4 py-10 sm:px-8">
			<AuthPanel title="Add email sign-in" description={<CodeSentTo email={account.email} />}>
				<CodeForm
					status={challenge.status}
					resendIn={challenge.resendIn}
					submitLabel="Enable email sign-in"
					pending={challenge.pending}
					resending={challenge.resending}
					onSubmit={(code) => void challenge.verify(code)}
					onResend={() => void challenge.resend()}
				/>
				<Button
					variant="link"
					className="self-center"
					disabled={challenge.pending || challenge.status.kind === "verified"}
					onClick={async () => {
						const result = await cancelLinkEmailCode();
						await navigate({
							to: "/settings",
							search: { outcome: result.ok ? "cancelled" : "interrupted", method: "email" },
						});
					}}
				>
					Back to Settings
				</Button>
			</AuthPanel>
		</main>
	);
}
