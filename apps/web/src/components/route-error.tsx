import type { ErrorComponentProps } from "@tanstack/react-router";
import { AlertCircleIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#/components/ui/button";

export function RouteError({ error, reset }: ErrorComponentProps): JSX.Element {
	const message =
		error instanceof Error ? error.message : "An unexpected error occurred.";

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
					<p className="text-sm text-pretty text-muted-foreground">{message}</p>
				</div>
				<Button type="button" onClick={reset} className="cursor-pointer">
					Try again
				</Button>
			</div>
		</main>
	);
}
