import { CheckmarkCircle02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { PROVIDERS, type Provider } from "#/components/auth.tsx";
import { BrandIcon } from "#/components/brand-icons.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/components/ui/button.tsx";
import { Card, CardPanel } from "#/components/ui/card.tsx";
import type { ToastInput } from "#/components/ui/toast.tsx";

export type Method = Provider | "email";

export type Account = {
	displayName: string;
	email: string;
	methods: readonly Method[];
};

const METHODS = { ...PROVIDERS, email: { name: "Email" } } as const;

function MethodIcon({ method }: { method: Method }) {
	return method === "email" ? (
		<HugeiconsIcon icon={Mail01Icon} className="size-4" />
	) : (
		<BrandIcon brand={method} className="size-4" />
	);
}

const methodName = (method: Method) => METHODS[method].name;

function AppHeader({ onSignOut }: { onSignOut: () => void }) {
	return (
		<header className="flex min-h-14 items-center justify-between gap-4 border-b px-4 sm:px-8">
			<Link to="/" className="flex items-center gap-2 rounded-md font-medium">
				<img src="/logo.svg" alt="" className="size-6" />
				Ditto
			</Link>
			<nav className="flex items-center gap-2">
				<Link to="/settings" className={buttonVariants({ variant: "ghost" })}>
					Settings
				</Link>
				<Button variant="outline" onClick={onSignOut}>
					Sign out
				</Button>
			</nav>
		</header>
	);
}

function MethodRow({
	method,
	account,
	onLink,
}: {
	method: Method;
	account: Account;
	onLink: (method: Method) => void;
}) {
	const enabled = account.methods.includes(method);
	const name = methodName(method);
	const detail =
		method === "email"
			? `A one-time code sent to ${account.email}.`
			: enabled
				? `Sign in with your ${name} account.`
				: `Its verified email must be ${account.email}.`;
	return (
		<CardPanel className="flex-row items-center gap-3 px-4 py-3">
			<span className="grid size-8 shrink-0 place-items-center rounded-lg border border-panel-border bg-card text-muted-foreground">
				<MethodIcon method={method} />
			</span>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="font-medium">{name}</span>
				<span className="text-caption break-words text-muted-foreground">{detail}</span>
			</div>
			{enabled ? (
				<Badge variant="secondary">
					<HugeiconsIcon icon={CheckmarkCircle02Icon} data-icon="inline-start" />
					Enabled
				</Badge>
			) : (
				<Button variant="outline" size="sm" onClick={() => onLink(method)}>
					Link<span className="sr-only"> {name}</span>
				</Button>
			)}
		</CardPanel>
	);
}

export function SettingsView({
	account,
	onLink,
	onSignOut,
	modelAccess,
}: {
	account: Account;
	onLink: (method: Method) => void;
	onSignOut: () => void;
	/** The model access section, below sign-in methods. */
	modelAccess?: React.ReactNode;
}) {
	return (
		<div className="flex min-h-dvh flex-col">
			<AppHeader onSignOut={onSignOut} />
			<main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-10 sm:px-8">
				<h1>Settings</h1>
				<section className="flex flex-col gap-4">
					<h2>Profile</h2>
					<Card>
						<CardPanel className="px-4">
							{/* Each pair holds together; the space between pairs is wider. */}
							<dl className="flex flex-col gap-4 sm:gap-3">
								<div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6">
									<dt className="text-muted-foreground">Display name</dt>
									<dd className="font-medium wrap-anywhere">{account.displayName}</dd>
								</div>
								<div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6">
									<dt className="text-muted-foreground">Email</dt>
									<dd className="font-medium wrap-anywhere">{account.email}</dd>
								</div>
							</dl>
						</CardPanel>
					</Card>
				</section>
				<section className="flex flex-col gap-4">
					<div className="flex flex-col gap-1">
						<h2>Sign-in methods</h2>
						<p className="text-muted-foreground">
							Any enabled method opens this account. Link another so you have a way back in.
						</p>
					</div>
					<Card>
						{METHOD_KEYS.map((method) => (
							<MethodRow key={method} method={method} account={account} onLink={onLink} />
						))}
					</Card>
				</section>
				{modelAccess}
			</main>
		</div>
	);
}

export const METHOD_KEYS = Object.keys(METHODS) as Method[];

/** What a linking attempt came back with, named by the `outcome` search param. */
export const LINK_OUTCOMES = [
	"linked",
	"cancelled",
	"email-mismatch",
	"linked-elsewhere",
	"interrupted",
] as const;

export type LinkOutcome = (typeof LINK_OUTCOMES)[number];

/** The toast for a linking attempt's `outcome`. Nothing but `linked` enables the method. */
export function linkOutcomeToast(outcome: LinkOutcome, method: Method, email: string): ToastInput {
	const name = methodName(method);
	const id = `link-${outcome}-${method}`;
	switch (outcome) {
		case "linked":
			return {
				id,
				state: "success",
				message: `${name} is linked`,
				description: "You can now use it to sign in to this account.",
			};
		case "cancelled":
			return {
				id,
				state: "info",
				message: `${name} wasn’t linked`,
				description: "You cancelled before it finished. Nothing changed.",
			};
		case "email-mismatch":
			return {
				id,
				state: "error",
				message: `That ${name} account uses a different email`,
				description: `Link a ${name} account whose verified email is ${email}.`,
			};
		case "linked-elsewhere":
			return {
				id,
				state: "error",
				message: `That ${name} account belongs to another Ditto account`,
				description: `Link a different ${name} account, or sign in to the one it belongs to.`,
			};
		case "interrupted":
			return {
				id,
				state: "error",
				message: `${name} wasn’t linked`,
				description:
					"Your session changed or the confirmation expired before linking finished. Try again.",
			};
	}
}

export const signedOutToast: ToastInput = {
	id: "signed-out",
	state: "success",
	message: "Signed out",
};

export const signOutFailedToast: ToastInput = {
	id: "signed-out",
	state: "error",
	message: "Couldn’t sign out",
	description: "Try signing out again.",
};

/** Example account for the design gallery. */
export const previewAccount: Account = {
	displayName: "Ada Lovelace",
	email: "ada@example.com",
	methods: ["github"],
};
