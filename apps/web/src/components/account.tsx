import {
	Alert02Icon,
	CheckmarkCircle02Icon,
	InformationCircleIcon,
	Mail01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { PROVIDERS, type Provider } from "#/components/auth.tsx";
import { BrandIcon } from "#/components/brand-icons.tsx";
import { DittoMark } from "#/components/ditto-mark.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/components/ui/button.tsx";
import { Card, CardPanel } from "#/components/ui/card.tsx";

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
		<header className="flex h-14 items-center justify-between gap-4 border-b px-4 sm:px-8">
			<Link to="/" className="flex items-center gap-2 rounded-md font-medium">
				<img src="/logo.svg" alt="" className="size-6" />
				Ditto
			</Link>
			<nav className="flex items-center gap-1">
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

export function HomeView({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
	return (
		<div className="flex min-h-dvh flex-col">
			<AppHeader onSignOut={onSignOut} />
			<main className="grid flex-1 place-items-center px-4 py-10 sm:px-8">
				<div className="flex max-w-sm flex-col items-center gap-5 text-center">
					<DittoMark className="size-20" />
					<div className="flex flex-col gap-1.5">
						<h1>Welcome back, {account.displayName}</h1>
						<p className="text-muted-foreground">
							You’re signed in. Your projects and agents will show up here.
						</p>
					</div>
				</div>
			</main>
		</div>
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
	notice,
	onLink,
	onSignOut,
}: {
	account: Account;
	notice?: ReactNode;
	onLink: (method: Method) => void;
	onSignOut: () => void;
}) {
	return (
		<div className="flex min-h-dvh flex-col">
			<AppHeader onSignOut={onSignOut} />
			<main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-10 sm:px-8">
				<h1>Settings</h1>
				{notice}
				<section className="flex flex-col gap-4">
					<h2>Profile</h2>
					<Card>
						<CardPanel className="px-4">
							<dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[8rem_1fr]">
								<dt className="text-muted-foreground">Display name</dt>
								<dd className="font-medium">{account.displayName}</dd>
								<dt className="text-muted-foreground">Email</dt>
								<dd className="font-medium break-all">{account.email}</dd>
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

export function LinkOutcomeAlert({
	outcome,
	method,
	email,
}: {
	outcome: LinkOutcome;
	method: Method;
	email: string;
}) {
	if (outcome === "linked") return <LinkedNotice method={method} />;
	if (outcome === "cancelled") return <LinkCancelledNotice method={method} />;
	return <LinkErrorNotice error={outcome} method={method} email={email} />;
}

function LinkedNotice({ method }: { method: Method }) {
	return (
		<Alert variant="success" role="status">
			<HugeiconsIcon icon={CheckmarkCircle02Icon} />
			<AlertTitle>{methodName(method)} is linked</AlertTitle>
			<AlertDescription>You can now use it to sign in to this account.</AlertDescription>
		</Alert>
	);
}

function LinkCancelledNotice({ method }: { method: Method }) {
	return (
		<Alert role="status">
			<HugeiconsIcon icon={InformationCircleIcon} />
			<AlertTitle>{methodName(method)} wasn’t linked</AlertTitle>
			<AlertDescription>You cancelled before it finished. Nothing changed.</AlertDescription>
		</Alert>
	);
}

type LinkError = Exclude<LinkOutcome, "linked" | "cancelled">;

function LinkErrorNotice({
	error,
	method,
	email,
}: {
	error: LinkError;
	method: Method;
	email: string;
}) {
	const name = methodName(method);
	const copy = {
		"email-mismatch": {
			title: `That ${name} account uses a different email`,
			body: `Link a ${name} account whose verified email is ${email}.`,
		},
		"linked-elsewhere": {
			title: `That ${name} account belongs to another Ditto account`,
			body: `Link a different ${name} account, or sign in to the one it belongs to.`,
		},
		interrupted: {
			title: `${name} wasn’t linked`,
			body: "Your session changed or the confirmation expired before linking finished. Try again.",
		},
	}[error];
	return (
		<Alert variant="destructive">
			<HugeiconsIcon icon={Alert02Icon} />
			<AlertTitle>{copy.title}</AlertTitle>
			<AlertDescription>{copy.body}</AlertDescription>
		</Alert>
	);
}

/** Stands in for the session until sign-in is wired up (#5). */
export const previewAccount: Account = {
	displayName: "Ada Lovelace",
	email: "ada@example.com",
	methods: ["github"],
};
