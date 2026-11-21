import type { AuthEnv } from "./auth.ts";
import type { CodeEmail } from "./email-code.ts";

const lifetime = (seconds: number) =>
	seconds % 60 === 0
		? `${seconds / 60} minute${seconds === 60 ? "" : "s"}`
		: `${seconds} second${seconds === 1 ? "" : "s"}`;

/** Sends a sign-in code through Resend. Throws when Resend doesn't accept it. */
export async function sendCodeEmail(env: AuthEnv, { to, code, expiresIn }: CodeEmail) {
	const response = await fetch(`${env.RESEND_BASE_URL ?? "https://api.resend.com"}/emails`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${env.RESEND_API_KEY}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			from: env.RESEND_FROM,
			to: [to],
			subject: "Your Ditto code",
			text: [
				`Your Ditto code is ${code}.`,
				`It expires in ${lifetime(expiresIn)}. Enter it on the page where you asked for it.`,
				"If you didn’t ask for this code, you can ignore this email.",
			].join("\n\n"),
		}),
	}).catch(() => {
		console.error("Email delivery failed before Resend returned an HTTP response");
		throw new Error("Resend connection failed");
	});
	if (!response.ok) {
		const failure = (await response.json().catch(() => ({}))) as {
			name?: unknown;
			message?: unknown;
		};
		// Resend's reason, minus any address it echoes back. Some errors carry no `name`.
		const reason = [failure.name, failure.message]
			.filter((part): part is string => typeof part === "string")
			.join(": ")
			.replace(/[^\s<>"]+@[^\s<>"]+/g, "<address>")
			.slice(0, 300);
		console.error(
			`Resend rejected email delivery (HTTP ${response.status}): ${reason || "no reason given"}`,
		);
		throw new Error("Resend rejected email delivery");
	}
}
