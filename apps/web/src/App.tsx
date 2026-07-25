import type { JSX, ReactNode } from "react";
import { AppShell } from "./components/app-shell";
import { CommandMenu } from "./components/command-menu";
import { ErrorBoundary } from "./components/error-boundary";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/toast";

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
				<Toaster />
			</ThemeProvider>
		</ErrorBoundary>
	);
}

export default App;
