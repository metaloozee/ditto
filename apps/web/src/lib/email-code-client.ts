import { useEffect, useRef, useState } from "react";

import {
	codeResentToast,
	resendFailedToast,
	type CodeStatus,
	type SignUpDetails,
} from "#/components/auth.tsx";
import { toast, type ToastInput } from "#/components/ui/toast.tsx";
import { authClient } from "#/lib/auth-client.ts";

declare module "@tanstack/react-router" {
	interface HistoryState {
		/** When another code may be sent (epoch ms), as the server set it. */
		resendAt?: number;
	}
}

/** Why the server refused a code request. `retryAfter` is in seconds. */
export type CodeFailure = { code?: string; attemptsLeft?: number; retryAfter?: number };

export type CodeResult<T> = { ok: true; data: T } | { ok: false; error: CodeFailure };

async function post<T>(path: string, body: unknown): Promise<CodeResult<T>> {
	const response = await fetch(`/api/auth${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	}).catch(() => undefined);
	if (!response) return { ok: false, error: {} };
	const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	if (response.ok) return { ok: true, data: json as T };
	const retryAfter = Number(response.headers.get("x-retry-after"));
	return {
		ok: false,
		error: {
			code: typeof json.code === "string" ? json.code : undefined,
			attemptsLeft: typeof json.attemptsLeft === "number" ? json.attemptsLeft : undefined,
			retryAfter: retryAfter > 0 ? retryAfter : undefined,
		},
	};
}

/** Where a verified code leads. */
export type CodeOutcome = "signed-in" | "account-exists" | "wrong-method";

export const sendSignUpCode = (email: string) =>
	post<{ resendIn: number }>("/email-code/sign-up/send", { email });

export const verifySignUpCode = ({ firstName, lastName, email }: SignUpDetails, code: string) =>
	post<{ outcome: CodeOutcome }>("/email-code/sign-up/verify", {
		firstName,
		lastName,
		email,
		code,
	});

export const sendLinkEmailCode = () =>
	post<{ resendIn: number }>("/email-code/link-email/send", {});

export const cancelLinkEmailCode = () =>
	post<{ cancelled: true }>("/email-code/link-email/cancel", {});

export const verifyLinkEmailCode = (code: string) =>
	post<{ outcome: "linked" }>("/email-code/link-email/verify", { code });

export async function sendSignInCode(email: string): Promise<CodeResult<{ resendIn: number }>> {
	let resendIn = 0;
	let retryAfter = 0;
	const result = await authClient.emailOtp
		.sendVerificationOtp({
			email,
			type: "sign-in",
			fetchOptions: {
				onResponse: ({ response }) => {
					resendIn = Number(response.headers.get("x-resend-in"));
					retryAfter = Number(response.headers.get("x-retry-after"));
				},
			},
		})
		.catch(() => undefined);
	return result?.data?.success
		? { ok: true, data: { resendIn } }
		: { ok: false, error: { code: result?.error?.code, retryAfter } };
}

export async function verifySignInCode(
	email: string,
	otp: string,
): Promise<CodeResult<{ outcome: "signed-in" }>> {
	const result = await authClient.signIn.emailOtp({ email, otp }).catch(() => undefined);
	return result?.data
		? { ok: true, data: { outcome: "signed-in" } }
		: { ok: false, error: { code: result?.error?.code } };
}

/** When the next code may be sent, given a send's result. */
export function resendAtFrom(result: CodeResult<{ resendIn: number }>) {
	const wait = result.ok ? result.data.resendIn : (result.error.retryAfter ?? 0);
	return Date.now() + wait * 1000;
}

const codeThrottledToast: ToastInput = {
	id: "code-throttled",
	state: "error",
	message: "Too many tries",
	description: "Wait a moment, then enter the code again.",
};

const secondsUntil = (at: number) => Math.max(0, Math.ceil((at - Date.now()) / 1000));

/**
 * A live email code challenge: verifying, resending and the wait before
 * another code, all as the server reports them.
 */
export function useEmailCode<Outcome extends CodeOutcome | "linked">({
	resendAt: initialResendAt,
	send,
	verify,
	onOutcome,
	onInterrupted,
	resentToast = codeResentToast,
}: {
	resendAt: number;
	send: () => Promise<CodeResult<{ resendIn: number }>>;
	verify: (code: string) => Promise<CodeResult<{ outcome: Outcome }>>;
	onOutcome: (outcome: Outcome) => void;
	onInterrupted?: () => void;
	resentToast?: ToastInput;
}) {
	const [status, setStatus] = useState<CodeStatus>({ kind: "sent" });
	const [pending, setPending] = useState(false);
	const [resendAt, setResendAt] = useState(initialResendAt);
	const [resendIn, setResendIn] = useState(() => secondsUntil(initialResendAt));
	const busy = useRef(false);
	useEffect(() => {
		setResendIn(secondsUntil(resendAt));
		const timer = setInterval(() => {
			const left = secondsUntil(resendAt);
			setResendIn(left);
			if (left === 0) clearInterval(timer);
		}, 250);
		return () => clearInterval(timer);
	}, [resendAt]);

	return {
		status,
		pending,
		resendIn,
		resend: async () => {
			if (busy.current) return;
			busy.current = true;
			const result = await send();
			busy.current = false;
			setResendAt(resendAtFrom(result));
			if (!result.ok && result.error.code === "UNAUTHORIZED" && onInterrupted)
				return onInterrupted();
			if (!result.ok) return toast(resendFailedToast);
			setStatus({ kind: "sent" });
			toast(resentToast);
		},
		verify: async (code: string) => {
			if (busy.current) return;
			busy.current = true;
			setPending(true);
			const result = await verify(code);
			setPending(false);
			if (!result.ok || (result.data.outcome !== "signed-in" && result.data.outcome !== "linked"))
				busy.current = false;
			if (result.ok) {
				const { outcome } = result.data;
				if (outcome !== "signed-in" && outcome !== "linked") return onOutcome(outcome);
				setStatus({ kind: "verified" });
				setTimeout(() => onOutcome(outcome), 700);
				return;
			}
			const { code: reason, attemptsLeft } = result.error;
			if ((reason === "UNAUTHORIZED" || reason === "LINK_INTERRUPTED") && onInterrupted)
				return onInterrupted();
			if (reason === "INVALID_OTP") setStatus({ kind: "invalid" });
			else if (reason === "INVALID_CODE" && attemptsLeft)
				setStatus({ kind: "invalid", attemptsLeft });
			else if (reason === "TOO_MANY_ATTEMPTS") setStatus({ kind: "locked" });
			else if (reason === "CODE_EXPIRED") setStatus({ kind: "expired" });
			else toast(codeThrottledToast);
		},
	};
}
