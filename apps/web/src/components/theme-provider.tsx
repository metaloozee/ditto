import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type { ComponentProps, JSX } from "react";
import { useEffect } from "react";

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function ThemeHotkey(): null {
	const { resolvedTheme, setTheme } = useTheme();

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (isEditableTarget(event.target)) return;

			const isLetterD =
				event.key === "d" || event.key === "D" || event.code === "KeyD";
			const isPlainD =
				isLetterD && !event.metaKey && !event.ctrlKey && !event.altKey;
			const isCmdShiftD =
				isLetterD &&
				event.shiftKey &&
				(event.metaKey || event.ctrlKey) &&
				!event.altKey;

			if (!isPlainD && !isCmdShiftD) return;

			event.preventDefault();
			setTheme(resolvedTheme === "dark" ? "light" : "dark");
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [resolvedTheme, setTheme]);

	return null;
}

export function ThemeProvider({
	children,
	...props
}: ComponentProps<typeof NextThemesProvider>): JSX.Element {
	return (
		<NextThemesProvider
			attribute="class"
			defaultTheme="dark"
			enableSystem
			disableTransitionOnChange
			{...props}
		>
			<ThemeHotkey />
			{children}
		</NextThemesProvider>
	);
}
