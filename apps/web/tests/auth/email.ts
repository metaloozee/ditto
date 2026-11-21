import { randomUUID } from "node:crypto";

import type { Page } from "playwright";
import { inject } from "vite-plus/test";

import type { SentEmail } from "./fake-upstream.ts";
import { open } from "./visitor.ts";

const upstreamUrl = inject("upstreamUrl");

/** An address no other test uses. */
export const newAddress = () => `ada+${randomUUID()}@example.com`;

/** Every email Ditto handed to Resend for `to`, oldest first. */
export async function inbox(to: string) {
	const response = await fetch(`${upstreamUrl}/__emails?to=${encodeURIComponent(to)}`);
	return (await response.json()) as SentEmail[];
}

/** The code in the newest email to `to`. */
export async function latestCode(to: string) {
	const newest = (await inbox(to)).at(-1);
	const code = newest?.text.match(/\b(\d{6})\b/)?.[1];
	if (!code) throw new Error(`No code was emailed to ${to}`);
	return code;
}

/** Makes Resend reject the next email. */
export async function failNextEmail() {
	await fetch(`${upstreamUrl}/__resend/fail-next`, { method: "POST" });
}

export type SignUpDetails = { firstName: string; lastName: string; email: string };

/** Fills in and submits the /sign-up form. */
export async function submitSignUpForm(page: Page, details: SignUpDetails) {
	await open(page, "/sign-up");
	await page.getByLabel("First name").fill(details.firstName);
	await page.getByLabel("Last name").fill(details.lastName);
	await page.getByLabel("Email address").fill(details.email);
	await page.getByRole("button", { name: "Continue with email" }).click();
}

/** Asks for a sign-up code and waits for the code step. */
export async function requestSignUpCode(page: Page, details: SignUpDetails) {
	await submitSignUpForm(page, details);
	await page.getByRole("heading", { name: "Check your email" }).waitFor();
}

/** Types a code into the code step; a full code submits itself. */
export async function enterCode(page: Page, code: string) {
	await page.getByLabel("Code").fill(code);
}

/** Registers `details` by email from start to the signed-in home. */
export async function signUpByEmail(page: Page, details: SignUpDetails) {
	await requestSignUpCode(page, details);
	await enterCode(page, await latestCode(details.email));
	await page.getByRole("heading", { name: /^Welcome back/ }).waitFor();
}

export async function requestSignIn(page: Page, email: string) {
	await open(page, "/sign-in");
	await page.getByLabel("Email address").fill(email);
	await page.getByRole("button", { name: "Continue with email" }).click();
	await page.getByRole("heading", { name: "Check your email" }).waitFor();
}
