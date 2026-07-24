import { AlertCircleIcon } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "#/components/ui/button";

type ErrorBoundaryProps = {
	children: ReactNode;
};

type ErrorBoundaryState = {
	error: Error | null;
};

export class ErrorBoundary extends Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("App error boundary", error, info.componentStack);
	}

	reset = (): void => {
		this.setState({ error: null });
	};

	render(): ReactNode {
		const { error } = this.state;
		if (error) {
			const message =
				error instanceof Error
					? error.message
					: "An unexpected error occurred.";
			return (
				<main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 py-10">
					<div
						className="flex max-w-md flex-col items-center gap-3 text-center"
						role="alert"
					>
						<div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
							<AlertCircleIcon className="size-5" aria-hidden="true" />
						</div>
						<div className="flex flex-col gap-1">
							<h1 className="text-lg font-semibold text-balance">
								Something went wrong
							</h1>
							<p className="text-sm text-pretty text-muted-foreground">
								{message}
							</p>
						</div>
						<Button
							type="button"
							onClick={this.reset}
							className="cursor-pointer"
						>
							Try again
						</Button>
					</div>
				</main>
			);
		}
		return this.props.children;
	}
}
