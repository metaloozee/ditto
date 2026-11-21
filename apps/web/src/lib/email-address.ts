import { regexes } from "zod/v4/core";

/**
 * Whether Ditto can deliver codes to an address. Better Auth's email OTP sender
 * checks addresses with zod's email pattern, so every form and endpoint uses
 * the same one: an address accepted at sign-up can always get a sign-in code.
 */
export const isEmailAddress = (email: string) => {
	const address = email.trim().toLowerCase();
	return address.length <= 254 && regexes.email.test(address);
};
