import { useMutation } from "@tanstack/react-query";
import {
	GlobeIcon,
	LoaderCircleIcon,
	LockIcon,
	MonitorPlayIcon,
	RotateCcwIcon,
	SquareIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip";
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

function hostFromUrl(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "preview";
	}
}

function addressLabel(state: PaneState): string {
	switch (state.kind) {
		case "ready":
		case "stopping":
			return hostFromUrl(state.url);
		case "starting":
			return "Starting preview…";
		case "failed":
			return "Preview failed";
		default:
			return "Preview not running";
	}
}

function statusDotClass(state: PaneState): string {
	switch (state.kind) {
		case "ready":
			return "bg-emerald-500";
		case "starting":
		case "stopping":
			return "bg-amber-500";
		case "failed":
			return "bg-destructive";
		default:
			return "bg-muted-foreground/35";
	}
}

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
	const running =
		activeState.kind === "ready" || activeState.kind === "stopping";
	const address = addressLabel(activeState);

	return (
		<section
			aria-label="Session website preview"
			className={cn(
				"flex h-full min-h-0 min-w-0 flex-col bg-background",
				className,
			)}
		>
			<TooltipProvider delay={300}>
				{/* Browser toolbar */}
				<div className="flex shrink-0 items-center gap-1.5 border-border/70 border-b bg-muted/40 px-2 py-1.5">
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									disabled={!running || busy}
									onClick={() => restart()}
									aria-label="Reload preview"
									className="text-muted-foreground"
								/>
							}
						>
							{busy && activeState.kind === "starting" ? (
								<LoaderCircleIcon className="animate-spin" aria-hidden />
							) : (
								<RotateCcwIcon aria-hidden />
							)}
						</TooltipTrigger>
						<TooltipContent side="bottom">Reload</TooltipContent>
					</Tooltip>

					{/* Address bar */}
					<div
						className={cn(
							"flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border/70 bg-background px-2.5 shadow-xs",
						)}
						title={
							running
								? activeState.kind === "ready" ||
									activeState.kind === "stopping"
									? activeState.url
									: address
								: undefined
						}
					>
						{running ? (
							<LockIcon
								className="size-3 shrink-0 text-muted-foreground"
								aria-hidden
							/>
						) : (
							<GlobeIcon
								className="size-3 shrink-0 text-muted-foreground"
								aria-hidden
							/>
						)}
						<span
							className={cn(
								"min-w-0 flex-1 truncate font-mono text-[11px] leading-none",
								running ? "text-foreground/80" : "text-muted-foreground",
							)}
						>
							{address}
						</span>
						<span
							className={cn(
								"size-1.5 shrink-0 rounded-full",
								statusDotClass(activeState),
							)}
							aria-hidden
						/>
						<span className="sr-only">
							Preview status:{" "}
							{activeState.kind === "ready"
								? "running"
								: activeState.kind === "starting"
									? "starting"
									: activeState.kind === "stopping"
										? "stopping"
										: activeState.kind === "failed"
											? "failed"
											: "idle"}
						</span>
					</div>

					{running ? (
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
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
										className="text-muted-foreground"
									/>
								}
							>
								{activeState.kind === "stopping" ? (
									<LoaderCircleIcon className="animate-spin" aria-hidden />
								) : (
									<SquareIcon aria-hidden />
								)}
							</TooltipTrigger>
							<TooltipContent side="bottom">Stop</TooltipContent>
						</Tooltip>
					) : (
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										disabled={busy}
										onClick={() => start()}
										aria-label={
											activeState.kind === "failed"
												? "Retry preview"
												: "Start preview"
										}
										className="text-muted-foreground"
									/>
								}
							>
								{activeState.kind === "starting" ? (
									<LoaderCircleIcon className="animate-spin" aria-hidden />
								) : (
									<MonitorPlayIcon aria-hidden />
								)}
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{activeState.kind === "failed" ? "Retry" : "Start"}
							</TooltipContent>
						</Tooltip>
					)}
				</div>
			</TooltipProvider>

			{/* Viewport */}
			<div className="relative flex min-h-0 flex-1 flex-col bg-background">
				{activeState.kind === "idle" ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
						<div className="flex size-12 items-center justify-center rounded-xl border border-border/70 bg-muted/40">
							<MonitorPlayIcon
								className="size-5 text-muted-foreground"
								aria-hidden
							/>
						</div>
						<div className="flex max-w-sm flex-col items-center gap-1.5 text-center">
							<p className="font-medium text-foreground text-sm text-balance">
								Run a live preview
							</p>
							<p className="text-pretty text-muted-foreground text-xs/relaxed">
								{PUBLIC_WARNING}
							</p>
						</div>
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
					<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
						<LoaderCircleIcon
							className="size-5 animate-spin text-muted-foreground"
							aria-hidden
						/>
						<output className="text-muted-foreground text-sm">
							{activeState.kind === "starting"
								? "Starting preview…"
								: "Stopping preview…"}
						</output>
					</div>
				) : null}

				{activeState.kind === "failed" ? (
					<div
						className="flex flex-1 flex-col items-center justify-center gap-3 p-6"
						role="alert"
					>
						<p className="max-w-sm text-pretty text-center text-destructive text-sm">
							{activeState.message}
						</p>
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
								className="shrink-0 border-border border-b px-3 py-2 text-destructive text-xs"
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
