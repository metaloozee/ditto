import { Alert02Icon, InformationCircleIcon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm, useStore, type AnyFieldApi } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import {
	useEffect,
	useId,
	useRef,
	useState,
	type ChangeEvent,
	type ComponentProps,
	type FormEvent,
	type ReactNode,
} from "react";

import { BrandIcon } from "#/components/brand-icons.tsx";
import { DittoMark } from "#/components/ditto-mark.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { InputOTP, InputOTPSlot } from "#/components/ui/input-otp.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";

export const PROVIDERS = {
	github: { name: "GitHub" },
	google: { name: "Google" },
} as const;

export type Provider = keyof typeof PROVIDERS;

/** Narrows an untrusted search param to one of `values`. */
export function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
	return values.find((v) => v === value);
}

export function AuthPanel({
	title,
	description,
	children,
}: {
	title: string;
	description: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex w-full max-w-sm flex-col gap-8 duration-300 ease-out motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1">
			<header className="flex flex-col items-start gap-5">
				<DittoMark className="size-12" />
				<div className="flex flex-col gap-1.5">
					<h1>{title}</h1>
					<p className="text-muted-foreground">{description}</p>
				</div>
			</header>
			{children}
		</div>
	);
}

function ProviderButtons({
	disabled,
	onProvider,
}: {
	disabled?: boolean;
	onProvider: (provider: Provider) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			{(Object.keys(PROVIDERS) as Provider[]).map((provider) => (
				<Button
					key={provider}
					variant="secondary"
					size="lg"
					disabled={disabled}
					onClick={() => onProvider(provider)}
				>
					<BrandIcon brand={provider} data-icon="inline-start" />
					Continue with {PROVIDERS[provider].name}
				</Button>
			))}
		</div>
	);
}

function Field({
	label,
	error,
	...props
}: { label: string; error?: string } & ComponentProps<"input">) {
	const id = useId();
	const errorId = `${id}-error`;
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? errorId : undefined}
				{...props}
			/>
			{error && (
				<p id={errorId} className="text-caption text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}

type Values = Record<string, string>;
type Errors<T extends Values> = Partial<Record<keyof T & string, string>>;

/** Keeps only the checks that failed, in field order. */
function failed<T extends Values>(checks: Record<keyof T & string, string | undefined>): Errors<T> {
	return Object.fromEntries(Object.entries(checks).filter(([, message]) => message)) as Errors<T>;
}

const trimmed = <T extends Values>(value: T) =>
	Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v.trim()])) as T;

// A short, decaying shake: the field itself says "not this".
const SHAKE = [0, -6, 5, -3, 2, 0].map((x) => ({ transform: `translateX(${x}px)` }));

function shake(el: Element) {
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	el.animate(SHAKE, { duration: 320, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
}

/**
 * A TanStack form that validates in the page instead of with the browser's
 * bubbles. Errors appear after the first submit, then update as the user
 * types. A failed submit shakes every invalid field and focuses the first.
 */
function useAuthForm<T extends Values>({
	defaultValues,
	check,
	onValid,
}: {
	defaultValues: T;
	check: (value: T) => Errors<T>;
	onValid: (value: T) => void;
}) {
	const ref = useRef<HTMLFormElement>(null);
	const validate = ({ value }: { value: T }) => {
		const fields = check(trimmed(value));
		return Object.keys(fields).length > 0 ? { fields } : undefined;
	};
	const form = useForm({
		defaultValues,
		validators: { onChange: validate, onSubmit: validate },
		onSubmit: ({ value }) => onValid(trimmed(value)),
		onSubmitInvalid: ({ value }) => {
			const fields = Object.keys(check(trimmed(value)))
				.map((name) => ref.current?.elements.namedItem(name))
				.filter((el) => el instanceof HTMLElement);
			fields.forEach(shake);
			fields[0]?.focus();
		},
	});
	const attempted = useStore(form.store, (state) => state.submissionAttempts > 0);
	const bind = (field: AnyFieldApi) => {
		const [error] = field.state.meta.errors;
		return {
			name: field.name,
			value: String(field.state.value),
			onChange: (e: ChangeEvent<HTMLInputElement>) => field.handleChange(e.target.value),
			onBlur: field.handleBlur,
			error: attempted && typeof error === "string" ? error : undefined,
		};
	};
	const formProps = {
		ref,
		noValidate: true,
		// If someone submits before hydration, keep what they typed out of the URL.
		method: "post",
		onSubmit: (e: FormEvent<HTMLFormElement>) => {
			e.preventDefault();
			void form.handleSubmit();
		},
	};
	return { form, bind, formProps };
}

const checkEmail = (email: string) =>
	!email
		? "Enter your email address."
		: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
			? undefined
			: "Enter an email address like name@example.com.";

const onlyDigits = (code: string) => code.replace(/\D/g, "");

const checkCode = (code: string) =>
	!code
		? "Enter the 6-digit code."
		: /^\d{6}$/.test(onlyDigits(code))
			? undefined
			: "The code is 6 digits.";

const inlineLink = "font-medium text-link underline-offset-4 hover:underline";

function SwitchFlow({ children }: { children: ReactNode }) {
	return <p className="text-center text-muted-foreground">{children}</p>;
}

export function SignInForm({
	notice,
	defaultEmail,
	pending,
	onEmail,
	onProvider,
}: {
	notice?: ReactNode;
	defaultEmail?: string;
	pending?: boolean;
	onEmail: (email: string) => void;
	onProvider: (provider: Provider) => void;
}) {
	const { form, bind, formProps } = useAuthForm({
		defaultValues: { email: defaultEmail ?? "" },
		check: (value) => failed({ email: checkEmail(value.email) }),
		onValid: (value) => onEmail(value.email),
	});
	return (
		<AuthPanel title="Sign in to Ditto" description="Welcome back. Choose how to sign in.">
			{notice}
			<form {...formProps} className="flex flex-col gap-4">
				<form.Field name="email">
					{(field) => (
						<Field
							label="Email address"
							{...bind(field)}
							type="email"
							autoComplete="email"
							placeholder="you@example.com"
						/>
					)}
				</form.Field>
				<Button type="submit" size="lg" loading={pending}>
					Continue with email
				</Button>
			</form>
			<ProviderButtons disabled={pending} onProvider={onProvider} />
			<SwitchFlow>
				Don’t have an account?{" "}
				<Link to="/sign-up" className={inlineLink}>
					Sign up
				</Link>
			</SwitchFlow>
		</AuthPanel>
	);
}

export type SignUpDetails = { firstName: string; lastName: string; email: string };

// What a visitor typed rides in history state, not the URL, so their address
// stays out of logs and shared links. A refresh keeps it; a new tab doesn't.
declare module "@tanstack/react-router" {
	interface HistoryState {
		email?: string;
		signUp?: SignUpDetails;
	}
}

export function SignUpForm({
	notice,
	defaults,
	pending,
	onEmail,
	onProvider,
}: {
	notice?: ReactNode;
	defaults?: SignUpDetails;
	pending?: boolean;
	onEmail: (details: SignUpDetails) => void;
	onProvider: (provider: Provider) => void;
}) {
	const { form, bind, formProps } = useAuthForm<SignUpDetails>({
		defaultValues: defaults ?? { firstName: "", lastName: "", email: "" },
		check: (value) =>
			failed({
				firstName: value.firstName ? undefined : "Enter your first name.",
				lastName: value.lastName ? undefined : "Enter your last name.",
				email: checkEmail(value.email),
			}),
		onValid: onEmail,
	});
	return (
		<AuthPanel
			title="Create your Ditto account"
			description="Use GitHub, Google, or your email address."
		>
			{notice}
			<form {...formProps} className="flex flex-col gap-4">
				<div className="grid grid-cols-2 items-start gap-3">
					<form.Field name="firstName">
						{(field) => <Field label="First name" {...bind(field)} autoComplete="given-name" />}
					</form.Field>
					<form.Field name="lastName">
						{(field) => <Field label="Last name" {...bind(field)} autoComplete="family-name" />}
					</form.Field>
				</div>
				<form.Field name="email">
					{(field) => (
						<Field
							label="Email address"
							{...bind(field)}
							type="email"
							autoComplete="email"
							placeholder="you@example.com"
						/>
					)}
				</form.Field>
				<Button type="submit" size="lg" loading={pending}>
					Continue with email
				</Button>
			</form>
			<ProviderButtons disabled={pending} onProvider={onProvider} />
			<SwitchFlow>
				Already have an account?{" "}
				<Link to="/sign-in" className={inlineLink}>
					Sign in
				</Link>
			</SwitchFlow>
		</AuthPanel>
	);
}

export type CodeStatus =
	| { kind: "sent" }
	| { kind: "resent" }
	| { kind: "invalid"; attemptsLeft: number }
	| { kind: "expired" }
	| { kind: "locked" }
	| { kind: "delivery-failed" }
	| { kind: "verified" };

function codeError(status: CodeStatus) {
	switch (status.kind) {
		case "invalid":
			return `That code isn’t right. ${status.attemptsLeft} ${status.attemptsLeft === 1 ? "try" : "tries"} left.`;
		case "expired":
			return "This code has expired. Send a new one to continue.";
		case "locked":
			return "Too many incorrect codes. Send a new one to continue.";
		default:
			return undefined;
	}
}

const formatWait = (seconds: number) => `0:${String(seconds).padStart(2, "0")}`;

export function CodeForm({
	status,
	submitLabel,
	resendIn = 0,
	pending,
	onSubmit,
	onResend,
	onChangeEmail,
}: {
	status: CodeStatus;
	submitLabel: string;
	/** Seconds until another code can be requested. */
	resendIn?: number;
	pending?: boolean;
	onSubmit: (code: string) => void;
	onResend: () => void;
	/** Omit when the address is fixed, as when linking the account's own email. */
	onChangeEmail?: () => void;
}) {
	const { form, bind, formProps } = useAuthForm({
		defaultValues: { code: "" },
		check: (value) => failed({ code: checkCode(value.code) }),
		onValid: (value) => onSubmit(onlyDigits(value.code)),
	});
	const row = useRef<HTMLDivElement>(null);
	const id = useId();
	const needsNewCode = status.kind === "expired" || status.kind === "locked";
	// A rejected code shakes the row and clears it, ready for the next try.
	// Focus returns only if it was in this form, so a drawn state can't steal it.
	useEffect(() => {
		if (status.kind !== "invalid") return;
		form.reset();
		if (row.current) shake(row.current);
		const owner = row.current?.closest("form");
		if (owner?.contains(document.activeElement)) row.current?.querySelector("input")?.focus();
	}, [status, form]);
	return (
		<div className="flex flex-col gap-6">
			{status.kind === "resent" && (
				<Alert variant="success" role="status">
					<HugeiconsIcon icon={Mail01Icon} />
					<AlertTitle>New code sent</AlertTitle>
					<AlertDescription>
						Use the code in the newest email. Earlier codes no longer work.
					</AlertDescription>
				</Alert>
			)}
			{status.kind === "delivery-failed" && (
				<DeliveryFailedNotice>Wait a moment, then send a new code.</DeliveryFailedNotice>
			)}
			<form {...formProps} className="flex flex-col gap-4">
				<form.Field name="code">
					{(field) => {
						const { name, value, onBlur, error: missing } = bind(field);
						const error = codeError(status) ?? missing;
						return (
							<div className="flex flex-col gap-2">
								<Label htmlFor={id}>Code</Label>
								<div ref={row}>
									<InputOTP
										id={id}
										name={name}
										value={value}
										onChange={(next) => field.handleChange(next)}
										onBlur={onBlur}
										onComplete={() => void form.handleSubmit()}
										maxLength={6}
										autoComplete="one-time-code"
										disabled={needsNewCode || status.kind === "verified"}
										success={status.kind === "verified"}
										aria-invalid={error ? true : undefined}
										aria-describedby={error ? `${id}-error` : undefined}
									>
										{Array.from({ length: 6 }, (_, index) => (
											<InputOTPSlot key={index} index={index} />
										))}
									</InputOTP>
								</div>
								{error && (
									<p id={`${id}-error`} className="text-caption text-destructive">
										{error}
									</p>
								)}
							</div>
						);
					}}
				</form.Field>
				<Button
					type="submit"
					size="lg"
					loading={pending}
					disabled={needsNewCode || status.kind === "verified"}
				>
					{submitLabel}
				</Button>
			</form>
			<div className="flex flex-col items-center gap-1 text-muted-foreground">
				<p>
					{needsNewCode ? "Need a new code? " : "Didn’t get it? "}
					{resendIn > 0 ? (
						<span className="tabular-nums">Send another in {formatWait(resendIn)}</span>
					) : (
						<button type="button" className={inlineLink} onClick={onResend}>
							Send a new code
						</button>
					)}
				</p>
				{onChangeEmail && (
					<button type="button" className={inlineLink} onClick={onChangeEmail}>
						Use a different email
					</button>
				)}
			</div>
		</div>
	);
}

export function CodeSentTo({ email }: { email: string }) {
	return (
		<>
			Enter the 6-digit code we sent to <span className="font-medium text-foreground">{email}</span>
			. It expires in 5 minutes.
		</>
	);
}

export function CodeStep({ email, ...form }: { email: string } & ComponentProps<typeof CodeForm>) {
	return (
		<AuthPanel title="Check your email" description={<CodeSentTo email={email} />}>
			<CodeForm {...form} />
		</AuthPanel>
	);
}

/** Messages a redirect can land on, named by the `notice` search param. */
export const AUTH_NOTICES = [
	"wrong-method",
	"no-account",
	"account-exists",
	"delivery-failed",
	"cancelled",
] as const;

export type AuthNotice = (typeof AUTH_NOTICES)[number];

export function AuthNoticeAlert({ notice, provider }: { notice: AuthNotice; provider?: Provider }) {
	switch (notice) {
		case "wrong-method":
			return (
				<Alert>
					<HugeiconsIcon icon={InformationCircleIcon} />
					<AlertTitle>This account uses another sign-in method</AlertTitle>
					<AlertDescription>
						Sign in the way you did before, then link this method from Settings.
					</AlertDescription>
				</Alert>
			);
		case "no-account":
			return (
				<Alert>
					<HugeiconsIcon icon={InformationCircleIcon} />
					<AlertTitle>No Ditto account uses this email</AlertTitle>
					<AlertDescription>
						<Link to="/sign-up">Create an account</Link> to start using Ditto.
					</AlertDescription>
				</Alert>
			);
		case "account-exists":
			return (
				<Alert role="status">
					<HugeiconsIcon icon={InformationCircleIcon} />
					<AlertTitle>You already have a Ditto account</AlertTitle>
					<AlertDescription>Sign in to it below. Your profile hasn’t changed.</AlertDescription>
				</Alert>
			);
		case "delivery-failed":
			return (
				<DeliveryFailedNotice>Check the address, then try again in a moment.</DeliveryFailedNotice>
			);
		case "cancelled":
			return (
				<Alert role="status">
					<HugeiconsIcon icon={InformationCircleIcon} />
					<AlertTitle>
						{provider ? `${PROVIDERS[provider].name} sign-in` : "Sign-in"} was cancelled
					</AlertTitle>
					<AlertDescription>Try again, or choose another way to continue.</AlertDescription>
				</Alert>
			);
	}
}

function DeliveryFailedNotice({ children }: { children: ReactNode }) {
	return (
		<Alert variant="destructive">
			<HugeiconsIcon icon={Alert02Icon} />
			<AlertTitle>We couldn’t send your code</AlertTitle>
			<AlertDescription>{children}</AlertDescription>
		</Alert>
	);
}

// Provisional: the real wait comes from the server's shared limits (#3).
const RESEND_WAIT_SECONDS = 30;
const ATTEMPTS = 3;

/**
 * A mock code challenge: 000000 is wrong, any other code passes. Three wrong
 * codes lock it until a new one is sent. Swapped for Better Auth in #5.
 */
export function useCodeChallenge() {
	const [status, setStatus] = useState<CodeStatus>({ kind: "sent" });
	const [pending, setPending] = useState(false);
	const [resendIn, setResendIn] = useState(RESEND_WAIT_SECONDS);
	useEffect(() => {
		if (resendIn <= 0) return;
		const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
		return () => clearTimeout(timer);
	}, [resendIn]);
	return {
		status,
		pending,
		resendIn,
		resend: () => {
			setStatus({ kind: "resent" });
			setResendIn(RESEND_WAIT_SECONDS);
		},
		verify: (code: string, onVerified: () => void) => {
			setPending(true);
			setTimeout(() => {
				setPending(false);
				if (code !== "000000") {
					setStatus({ kind: "verified" });
					setTimeout(onVerified, 700);
					return;
				}
				setStatus((s) => {
					const left = (s.kind === "invalid" ? s.attemptsLeft : ATTEMPTS) - 1;
					return left > 0 ? { kind: "invalid", attemptsLeft: left } : { kind: "locked" };
				});
			}, 900);
		},
	};
}
