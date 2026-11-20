import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
	HomeView,
	LINK_OUTCOMES,
	LinkOutcomeAlert,
	previewAccount,
	SettingsView,
} from "#/components/account.tsx";
import {
	AUTH_NOTICES,
	AuthNoticeAlert,
	CodeStep,
	SignInForm,
	SignUpForm,
	type CodeStatus,
} from "#/components/auth.tsx";

export const Route = createFileRoute("/design_/auth")({
	head: () => ({ meta: [{ title: "Authentication designs · Ditto" }] }),
	component: AuthDesigns,
});

const noop = () => {};
const email = previewAccount.email;

// These come back from the server mid-step, so no URL reaches them.
const codeStates: [string, CodeStatus, number][] = [
	["Code sent, resend on cooldown", { kind: "sent" }, 24],
	["Code resent", { kind: "resent" }, 30],
	["Wrong code", { kind: "invalid", attemptsLeft: 2 }, 0],
	["Expired code", { kind: "expired" }, 0],
	["Too many wrong codes", { kind: "locked" }, 0],
	["Resend failed to deliver", { kind: "delivery-failed" }, 0],
];

const link = "font-medium text-link underline-offset-4 hover:underline";

function AuthDesigns() {
	return (
		<main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-10 sm:px-8">
			<header className="flex flex-col gap-2">
				<h1>Authentication</h1>
				<p className="max-w-prose text-muted-foreground">
					Every screen and state for sign-in, sign-up, the signed-in home, and Settings. Steps and
					redirect messages live in the URL, so each link below opens that state in the clickable
					mock. Nothing is sent; enter 000000 to see a wrong code, any other code to see success.
					Submit an empty form to see validation.
				</p>
			</header>

			<Group title="Live states">
				<ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
					<li>
						<Link to="/sign-in" className={link}>
							/sign-in
						</Link>
					</li>
					<li>
						<Link to="/sign-up" className={link}>
							/sign-up
						</Link>
					</li>
					{AUTH_NOTICES.map((notice) => (
						<li key={notice}>
							<Link
								to="/sign-in"
								search={{ notice, provider: notice === "cancelled" ? "github" : undefined }}
								className={link}
							>
								/sign-in?notice={notice}
							</Link>
						</li>
					))}
					<li>
						<Link to="/" className={link}>
							/ (signed-in home)
						</Link>
					</li>
					<li>
						<Link to="/settings/verify-email" className={link}>
							/settings/verify-email
						</Link>
					</li>
					{LINK_OUTCOMES.map((outcome) => (
						<li key={outcome}>
							<Link to="/settings" search={{ outcome, method: "google" }} className={link}>
								/settings?outcome={outcome}
							</Link>
						</li>
					))}
				</ul>
			</Group>

			<Group title="Sign in and sign up">
				<div className="grid gap-6 lg:grid-cols-2">
					<Frame label="Sign in">
						<SignInForm onEmail={noop} onProvider={noop} />
					</Frame>
					<Frame label="Sign up">
						<SignUpForm onEmail={noop} onProvider={noop} />
					</Frame>
					<Frame label="Sending the code">
						<SignInForm defaultEmail={email} pending onEmail={noop} onProvider={noop} />
					</Frame>
				</div>
			</Group>

			<Group title="Redirect messages">
				<div className="flex flex-col gap-3">
					{AUTH_NOTICES.map((notice) => (
						<Frame key={notice} label={`notice=${notice}`}>
							<Notice>
								<AuthNoticeAlert notice={notice} provider="github" />
							</Notice>
						</Frame>
					))}
				</div>
			</Group>

			<Group title="Enter the code">
				<div className="grid gap-6 lg:grid-cols-2">
					{codeStates.map(([label, status, resendIn]) => (
						<Frame key={label} label={label}>
							<CodeStep
								email={email}
								status={status}
								resendIn={resendIn}
								submitLabel="Sign in"
								onSubmit={noop}
								onResend={noop}
								onChangeEmail={noop}
							/>
						</Frame>
					))}
				</div>
			</Group>

			<Group title="Signed in">
				<Frame label="Home" flush>
					<HomeView account={previewAccount} onSignOut={noop} />
				</Frame>
				<Frame label="Settings" flush>
					<SettingsView account={previewAccount} onLink={noop} onSignOut={noop} />
				</Frame>
			</Group>

			<Group title="Linking outcomes">
				<div className="flex flex-col gap-3">
					{LINK_OUTCOMES.flatMap((outcome) =>
						(["google", "email"] as const)
							// Email links only the account's own address, so it can't mismatch.
							.filter(
								(method) =>
									method === "google" ||
									(!outcome.startsWith("email-") && outcome !== "linked-elsewhere"),
							)
							.map((method) => (
								<Frame key={`${outcome}-${method}`} label={`outcome=${outcome}&method=${method}`}>
									<Notice>
										<LinkOutcomeAlert outcome={outcome} method={method} email={email} />
									</Notice>
								</Frame>
							)),
					)}
				</div>
			</Group>
		</main>
	);
}

function Group({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-4">
			<h2>{title}</h2>
			{children}
		</section>
	);
}

function Frame({
	label,
	flush,
	children,
}: {
	label: string;
	flush?: boolean;
	children: ReactNode;
}) {
	return (
		<figure className="flex min-w-0 flex-col gap-2">
			<figcaption className="font-mono text-caption text-muted-foreground">{label}</figcaption>
			<div
				className={
					flush
						? "overflow-hidden rounded-2xl border bg-background"
						: "grid place-items-center rounded-2xl border bg-background px-4 py-10"
				}
			>
				{children}
			</div>
		</figure>
	);
}

function Notice({ children }: { children: ReactNode }) {
	return <div className="w-full max-w-lg">{children}</div>;
}
