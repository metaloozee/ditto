import { useMutation } from "@tanstack/react-query";
import {
	LoaderCircleIcon,
	MonitorPlayIcon,
	RotateCcwIcon,
	SquareIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";
import { cn } from "#/lib/utils";

type PaneState =
	| { kind: "idle" }
	| { kind: "starting" }
	| { kind: "ready"; url: string; error?: string }
	| { kind: "stopping"; url: string }
	| { kind: "failed"; message: string };

const PUBLIC_WARNING =
	"Preview links are public to anyone with the URL until you stop them.";

export type SessionPreviewPaneProps = {
	projectId: string;
	sessionId: string;
	className?: string;
};

export function SessionPreviewPane({
	projectId,
	sessionId,
	className,
}: SessionPreviewPaneProps) {
	const trpc = useTRPC();
	const [pane, setPane] = useState<{ sessionId: string; state: PaneState }>({
		sessionId,
		state: { kind: "idle" },
	});

	// Session change → idle without a prop-sync Effect.
	if (pane.sessionId !== sessionId) {
		setPane({ sessionId, state: { kind: "idle" } });
	}
	const activeState =
		pane.sessionId === sessionId ? pane.state : ({ kind: "idle" } as const);
	const setState = (next: PaneState | ((prev: PaneState) => PaneState)) => {
		setPane((current) => ({
			sessionId:
				current.sessionId === sessionId ? current.sessionId : sessionId,
			state:
				typeof next === "function"
					? next(
							current.sessionId === sessionId
								? current.state
								: { kind: "idle" },
						)
					: next,
		}));
	};

	const startMutation = useMutation(
		trpc.sessionPreview.start.mutationOptions({
			onMutate: () => {
				setState({ kind: "starting" });
			},
			onSuccess: (result) => {
				setState({ kind: "ready", url: result.url });
			},
			onError: (error) => {
				setState({
					kind: "failed",
					message: error.message || "Failed to start preview.",
				});
			},
		}),
	);

	const stopMutation = useMutation(
		trpc.sessionPreview.stop.mutationOptions({
			onSuccess: () => {
				setState({ kind: "idle" });
			},
			onError: (error) => {
				// Keep ready iframe URL and surface a client-safe inline alert.
				setState((prev) =>
					prev.kind === "stopping"
						? {
								kind: "ready",
								url: prev.url,
								error: error.message || "Failed to stop preview.",
							}
						: prev,
				);
			},
		}),
	);

	function start() {
		startMutation.mutate({ projectId, sessionId });
	}

	function restart() {
		setState({ kind: "starting" });
		startMutation.mutate({ projectId, sessionId });
	}

	function stop(currentUrl: string) {
		setState({ kind: "stopping", url: currentUrl });
		stopMutation.mutate({ projectId, sessionId });
	}

	const busy =
		activeState.kind === "starting" || activeState.kind === "stopping";

	return (
		<section
			aria-label="Session website preview"
			className={cn(
				"flex h-full min-h-0 min-w-0 flex-col border-border border-l bg-background",
				className,
			)}
		>
			<div className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-2">
				<MonitorPlayIcon
					className="size-4 shrink-0 text-muted-foreground"
					aria-hidden
				/>
				<span className="min-w-0 flex-1 truncate font-medium text-sm">
					Preview
				</span>
				{activeState.kind === "ready" || activeState.kind === "stopping" ? (
					<>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="min-h-11 min-w-11 gap-1.5 sm:min-h-8 sm:min-w-0"
							disabled={busy}
							onClick={() => restart()}
							aria-label="Restart preview"
						>
							<RotateCcwIcon className="size-3.5" aria-hidden />
							<span className="hidden sm:inline">Restart</span>
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="min-h-11 min-w-11 gap-1.5 sm:min-h-8 sm:min-w-0"
							disabled={busy}
							onClick={() => {
								if (
									activeState.kind === "ready" ||
									activeState.kind === "stopping"
								) {
									stop(activeState.url);
								}
							}}
							aria-label="Stop preview"
						>
							{activeState.kind === "stopping" ? (
								<LoaderCircleIcon
									className="size-3.5 animate-spin"
									aria-hidden
								/>
							) : (
								<SquareIcon className="size-3.5" aria-hidden />
							)}
							<span className="hidden sm:inline">Stop</span>
						</Button>
					</>
				) : (
					<Button
						type="button"
						size="sm"
						className="min-h-11 min-w-11 gap-1.5 sm:min-h-8 sm:min-w-0"
						disabled={busy}
						onClick={() => start()}
						aria-label={
							activeState.kind === "failed" ? "Retry preview" : "Start preview"
						}
					>
						{activeState.kind === "starting" ? (
							<LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
						) : (
							<MonitorPlayIcon className="size-3.5" aria-hidden />
						)}
						<span className="hidden sm:inline">
							{activeState.kind === "starting" ? "Starting…" : "Start"}
						</span>
					</Button>
				)}
			</div>

			<div className="flex min-h-0 flex-1 flex-col">
				{activeState.kind === "idle" ? (
					<div className="flex flex-1 flex-col items-start justify-center gap-3 p-4">
						<p className="text-muted-foreground text-sm">{PUBLIC_WARNING}</p>
						<Button
							type="button"
							onClick={() => start()}
							className="min-h-11"
							aria-label="Start preview now"
						>
							Start preview
						</Button>
					</div>
				) : null}

				{activeState.kind === "starting" || activeState.kind === "stopping" ? (
					<output className="block p-4 text-muted-foreground text-sm">
						{activeState.kind === "starting"
							? "Starting preview…"
							: "Stopping preview…"}
					</output>
				) : null}

				{activeState.kind === "failed" ? (
					<div className="flex flex-col gap-3 p-4" role="alert">
						<p className="text-destructive text-sm">{activeState.message}</p>
						<Button
							type="button"
							variant="outline"
							className="min-h-11 w-fit"
							onClick={() => start()}
						>
							Retry
						</Button>
					</div>
				) : null}

				{activeState.kind === "ready" ? (
					<>
						{activeState.error ? (
							<p
								className="shrink-0 px-3 py-2 text-destructive text-sm"
								role="alert"
							>
								{activeState.error}
							</p>
						) : null}
						<iframe
							title="Session website preview"
							src={activeState.url}
							referrerPolicy="no-referrer"
							sandbox="allow-forms allow-same-origin allow-scripts"
							className="min-h-0 w-full flex-1 border-0 bg-white"
						/>
					</>
				) : null}
			</div>
		</section>
	);
}

export const SESSION_PREVIEW_PUBLIC_WARNING = PUBLIC_WARNING;
