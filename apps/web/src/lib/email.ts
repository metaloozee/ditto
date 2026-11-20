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
	});
	if (!response.ok) throw new Error(`Resend answered ${response.status}`);
}
