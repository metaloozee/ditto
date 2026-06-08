import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export const RADIAL_BG =
	"[background:radial-gradient(1100px_620px_at_-8%_-10%,var(--hero-a),transparent_58%),radial-gradient(1050px_620px_at_112%_-12%,var(--hero-b),transparent_62%),radial-gradient(720px_380px_at_50%_115%,rgba(79,184,178,0.1),transparent_68%),linear-gradient(180deg,color-mix(in_oklab,var(--sand)_68%,white)_0%,var(--foam)_44%,var(--bg-base)_100%)]";
