import type { CodeEmail } from "./email-code.ts";
import markDataUrl from "./email-mark.png?inline";

const lifetime = (seconds: number) =>
	seconds % 60 === 0
		? `${seconds / 60} minute${seconds === 60 ? "" : "s"}`
		: `${seconds} second${seconds === 1 ? "" : "s"}`;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The mark travels as an inline attachment: Gmail renders neither SVG nor data URLs. */
const MARK_ID = "ditto-mark";
const SANS = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/**
 * Light card on the design system's light tokens, with the code shown in the
 * mark's dark screen. The code appears once, as one unbroken string, and leads
 * the subject so Gmail offers to copy it.
 */
function html({ to, code, expiresIn }: CodeEmail) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Your Ditto code</title>
</head>
<body style="margin:0;padding:0;background:#f7f8f9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${code} is your Ditto code. It expires in ${lifetime(expiresIn)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f9;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#fdfdfe;border:1px solid #dddee0;border-radius:16px;">
<tr><td align="center" style="padding:40px 32px 32px;font-family:${SANS};color:#161617;">
<img src="cid:${MARK_ID}" width="48" height="48" alt="Ditto" style="display:block;border:0;margin:0 auto 24px;">
<h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;font-weight:600;letter-spacing:-0.01em;color:#161617;">Your Ditto code</h1>
<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#626366;">Enter it on the page where you asked for it.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#19191a;border:1px solid #3e3e40;border-radius:16px;">
<tr><td align="center" style="padding:24px 16px;font-family:${MONO};font-size:36px;line-height:1;font-weight:600;letter-spacing:8px;color:#9fbdff;">${code}</td></tr>
</table>
<p style="margin:12px 0 0;font-size:13px;line-height:1.4;color:#626366;">Expires in ${lifetime(expiresIn)}</p>
<p style="margin:32px 0 0;padding-top:24px;border-top:1px solid #dddee0;font-size:13px;line-height:1.4;color:#626366;">If you didn’t ask for this code, you can ignore this email.</p>
</td></tr>
</table>
<p style="margin:16px 0 0;font-family:${SANS};font-size:12px;line-height:1.4;color:#858689;">Ditto · sent to ${escapeHtml(to)}</p>
</td></tr>
</table>
</body>
</html>`;
}

/** An inline image, referenced from `html` as `cid:<content_id>`. In Resend's attachment shape. */
export type InlineImage = {
	filename: string;
	content: string;
	content_type: string;
	content_id: string;
};

export type CodeMessage = {
	subject: string;
	text: string;
	html: string;
	attachments: InlineImage[];
};

/**
 * Everything in a code email except its sender and transport. The subject
 * leads with the code so Gmail offers to copy it; `text` is the fallback for
 * clients that don't render HTML.
 */
export function codeMessage(email: CodeEmail): CodeMessage {
	const { code, expiresIn } = email;
	return {
		subject: `${code} is your Ditto code`,
		text: [
			`Your Ditto code is ${code}.`,
			`It expires in ${lifetime(expiresIn)}. Enter it on the page where you asked for it.`,
			"If you didn’t ask for this code, you can ignore this email.",
		].join("\n\n"),
		html: html(email),
		attachments: [
			{
				filename: "ditto.png",
				content: markDataUrl.slice(markDataUrl.indexOf(",") + 1),
				content_type: "image/png",
				content_id: MARK_ID,
			},
		],
	};
}
