import type { JSX, ReactNode } from "react";
import { Toaster } from "sonner";
import { AppShell } from "./components/app-shell";
import { CommandMenu } from "./components/command-menu";
import { ErrorBoundary } from "./components/error-boundary";
import { ThemeProvider } from "./components/theme-provider";

/**
 * Recognizable application shell entry for Vite/tooling and the live app tree.
 */
export function App({ children }: { children: ReactNode }): JSX.Element {
	return (
		<ErrorBoundary>
			<ThemeProvider>
				<AppShell>
					{children}
					<CommandMenu />
				</AppShell>
				<Toaster richColors closeButton />
			</ThemeProvider>
		</ErrorBoundary>
	);
}

export default App;
