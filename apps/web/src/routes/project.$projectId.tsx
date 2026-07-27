import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AlertCircleIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "#/components/ai-chat";
import { Button } from "#/components/ui/button";
import { useSidebar } from "#/components/ui/sidebar";
import { toast } from "#/components/ui/toast";
import { useTRPC } from "#/integrations/trpc/react";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/project/$projectId")({
	component: ProjectDetailRoute,
});

function ProjectDetailRoute() {
	return <Outlet />;
}

const SUCCESS_SANDBOX_STATES = new Set([
	"connected",
	"restored_from_backup",
	"recreated_from_github",
]);

type WorkspacePayload = {
	project: { id: string; status?: string };
	selectedSession?: {
		id: string;
		status?: string;
		branchName?: string | null;
	} | null;
	sandbox?: { state?: string };
	restoreFailed?: boolean;
};

function workspaceMatches(
	payload: WorkspacePayload | undefined,
	projectId: string,
	sessionId: string | undefined,
): payload is WorkspacePayload {
	if (!payload || payload.project.id !== projectId) return false;
	if (!sessionId) return true;
	// Accept payload for sandbox state even when selectedSession is null/missing.
	return (
		payload.selectedSession?.id === sessionId || payload.selectedSession == null
	);
}

function WorkspaceStatusBar(props: {
	mode: "restore-failed" | "check-error";
	message?: string;
	pending?: boolean;
	onRetryRestore?: () => void;
	onRetryCheck?: () => void;
	retryError?: string | null;
}) {
	const { state, isMobile } = useSidebar();
	// Match floating sidebar p-2 inset when open on desktop.
	const alignSidebar = !isMobile && state === "expanded";
	const message =
		props.mode === "restore-failed"
			? "Workspace restore failed"
			: (props.message ?? "Project sandbox is not ready yet.");
	const onRetry =
		props.mode === "restore-failed" ? props.onRetryRestore : props.onRetryCheck;
	const label = props.pending
		? "Retrying…"
		: props.mode === "restore-failed"
			? "Retry restore"
			: "Retry";

	return (
		<div
			role="alert"
			className={cn(
				"flex shrink-0 flex-wrap items-center justify-between gap-2 border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-xs text-destructive transition-[margin,border-radius,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
				alignSidebar
					? "mt-2 mr-2 rounded-t-lg"
					: "mt-0 mr-0 rounded-none border-x-transparent border-t-transparent",
			)}
		>
			<div className="flex min-w-0 items-center gap-2">
				<AlertCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
				<p className="min-w-0 font-medium">{message}</p>
			</div>
			<Button
				type="button"
				size="sm"
				variant="outline"
				className="border-destructive/30 bg-background/80 hover:bg-background"
				disabled={props.pending}
				aria-busy={props.pending || undefined}
				onClick={onRetry}
			>
				{label}
			</Button>
			{props.retryError ? (
				<p className="w-full text-destructive/90">{props.retryError}</p>
			) : null}
		</div>
	);
}

export function ProjectWorkspacePage({
	projectId,
	sessionId,
}: {
	projectId: string;
	sessionId?: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const provisionStartedRef = useRef(false);
	const awaitingFenceRef = useRef(false);
	const provisionToastRef = useRef<{ id: string } | null>(null);
	const [awaitingFence, setAwaitingFence] = useState(false);

	const projectQuery = useQuery(
		trpc.projects.get.queryOptions(
			{ id: projectId },
			{
				retry: false,
				refetchInterval: (query) =>
					query.state.data?.status === "provisioning" ? 1_000 : false,
			},
		),
	);
	const project = projectQuery.data;
	const d1Status = project?.status;

	const checkQuery = useQuery(
		trpc.workspace.checkSandbox.queryOptions(
			{ projectId, sessionId },
			{
				enabled: d1Status === "ready",
				retry: false,
				refetchInterval: (query) => {
					const state = query.state.data?.sandbox?.state;
					if (
						d1Status === "provisioning" ||
						state === "provisioning" ||
						awaitingFenceRef.current
					) {
						return 1_000;
					}
					return false;
				},
			},
		),
	);

	const provisionMutation = useMutation(
		trpc.workspace.provisionSandbox.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(
					trpc.projects.get.queryFilter({ id: projectId }),
				);
				await queryClient.invalidateQueries(
					trpc.workspace.checkSandbox.queryFilter({ projectId, sessionId }),
				);
			},
		}),
	);

	const retryRestoreMutation = useMutation(
		trpc.workspace.retryRestore.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(
					trpc.projects.get.queryFilter({ id: projectId }),
				);
				await queryClient.invalidateQueries(
					trpc.workspace.checkSandbox.queryFilter({ projectId, sessionId }),
				);
			},
		}),
	);

	const checkState = checkQuery.data?.sandbox?.state;
	const matchingProvision = workspaceMatches(
		provisionMutation.data as WorkspacePayload | undefined,
		projectId,
		sessionId,
	)
		? (provisionMutation.data as WorkspacePayload)
		: undefined;
	const provisionState = matchingProvision?.sandbox?.state;
	const provisionPending = provisionMutation.isPending;
	const retryPending = retryRestoreMutation.isPending;

	const restoreFailed =
		Boolean(checkQuery.data?.restoreFailed) ||
		Boolean(matchingProvision?.restoreFailed) ||
		d1Status === "failed";

	const checkError =
		checkQuery.error && d1Status === "ready" ? checkQuery.error : null;

	const successReady =
		d1Status === "ready" &&
		!provisionPending &&
		!awaitingFence &&
		(checkState === "connected" ||
			(provisionState != null &&
				SUCCESS_SANDBOX_STATES.has(provisionState) &&
				checkState !== "needs_restore"));

	const isPreparing =
		!restoreFailed &&
		!checkError &&
		!successReady &&
		(d1Status === "provisioning" ||
			checkState === "provisioning" ||
			checkState === "needs_restore" ||
			provisionPending ||
			awaitingFence ||
			(d1Status === "ready" &&
				(checkQuery.isPending || checkQuery.isFetching) &&
				!checkQuery.data));

	// Reset provision/toast refs when project or session changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: cleanup must re-run on id change
	useEffect(() => {
		return () => {
			const pending = provisionToastRef.current;
			if (pending) {
				toast.close(pending.id);
			}
			provisionToastRef.current = null;
			provisionStartedRef.current = false;
			awaitingFenceRef.current = false;
			setAwaitingFence(false);
		};
	}, [projectId, sessionId]);

	const startProvisionWithToast = useCallback(async () => {
		const toastId = `sandbox-provision-${projectId}`;
		const id = toast.add({
			id: toastId,
			type: "loading",
			description: "Preparing project sandbox...",
		});
		provisionToastRef.current = { id };

		try {
			const result = (await provisionMutation.mutateAsync({
				projectId,
				sessionId,
			})) as WorkspacePayload;
			const state = result.sandbox?.state;

			if (state && SUCCESS_SANDBOX_STATES.has(state)) {
				toast.update(id, {
					type: "success",
					description: "Project sandbox ready",
				});
				provisionToastRef.current = null;
				awaitingFenceRef.current = false;
				setAwaitingFence(false);
				provisionStartedRef.current = false;
				return;
			}

			if (state === "failed" || result.restoreFailed) {
				toast.update(id, {
					type: "error",
					description: "Workspace restore failed",
				});
				provisionToastRef.current = null;
				awaitingFenceRef.current = false;
				setAwaitingFence(false);
				provisionStartedRef.current = false;
				return;
			}

			if (state === "provisioning") {
				// Keep loading; lost-fence settle effect finishes it.
				awaitingFenceRef.current = true;
				setAwaitingFence(true);
				return;
			}

			// Unexpected non-terminal result — keep loading and poll.
			awaitingFenceRef.current = true;
			setAwaitingFence(true);
		} catch (error) {
			toast.update(id, {
				type: "error",
				description:
					error instanceof Error
						? error.message
						: "Project sandbox is not ready yet.",
			});
			provisionToastRef.current = null;
			awaitingFenceRef.current = false;
			setAwaitingFence(false);
			provisionStartedRef.current = false;
		}
	}, [projectId, sessionId, provisionMutation.mutateAsync]);

	// Auto-provision only on needs_restore.
	useEffect(() => {
		if (checkState !== "needs_restore") {
			// Re-arm so a later needs_restore (after failed attempt) can fire again.
			if (!provisionPending) provisionStartedRef.current = false;
			return;
		}
		if (provisionPending || provisionStartedRef.current) return;
		provisionStartedRef.current = true;
		void startProvisionWithToast();
	}, [checkState, provisionPending, startProvisionWithToast]);

	// Lost-fence settle: finish toast when check reaches a terminal state.
	useEffect(() => {
		if (!awaitingFenceRef.current) return;
		const toastId = provisionToastRef.current?.id;
		if (checkState === "connected") {
			if (toastId) {
				toast.update(toastId, {
					type: "success",
					description: "Project sandbox ready",
				});
			}
			awaitingFenceRef.current = false;
			setAwaitingFence(false);
			provisionToastRef.current = null;
			provisionStartedRef.current = false;
			return;
		}
		if (checkState === "failed" || restoreFailed) {
			if (toastId) {
				toast.update(toastId, {
					type: "error",
					description: "Workspace restore failed",
				});
			}
			awaitingFenceRef.current = false;
			setAwaitingFence(false);
			provisionToastRef.current = null;
			provisionStartedRef.current = false;
		}
	}, [checkState, restoreFailed]);

	const selectedSession = checkQuery.data?.selectedSession ?? null;
	const selectedSessionId = sessionId ?? selectedSession?.id ?? null;

	const messagesQuery = useInfiniteQuery(
		trpc.workspace.messages.infiniteQueryOptions(
			{
				projectId,
				sessionId: selectedSessionId ?? "",
				limit: 50,
			},
			{
				// D1 history is independent of sandbox readiness.
				enabled: Boolean(sessionId),
				initialCursor: undefined as string | undefined,
				getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
			},
		),
	);

	const serverMessages = [...(messagesQuery.data?.pages ?? [])]
		.reverse()
		.flatMap((page) => page.items);

	const hasMoreHistory = Boolean(messagesQuery.hasNextPage);
	const isLoadingMoreHistory = messagesQuery.isFetchingNextPage;

	if (projectQuery.isPending) {
		return (
			<main className="flex h-dvh items-center justify-center p-6">
				<p className="text-sm text-muted-foreground">Loading project...</p>
			</main>
		);
	}

	if (projectQuery.error || !project) {
		return (
			<main className="flex h-dvh items-center justify-center p-6">
				<div className="text-center">
					<p className="text-sm font-medium">Nothing found</p>
					<p className="mt-1 text-sm text-destructive" role="alert">
						{projectQuery.error?.message ?? "Project not found."}
					</p>
				</div>
			</main>
		);
	}

	let bar: "restore-failed" | "check-error" | null = null;
	if (restoreFailed) {
		bar = "restore-failed";
	} else if (checkError && !provisionPending && !awaitingFence) {
		bar = "check-error";
	}

	const workspaceUsable = successReady;
	let disabledReason: string | undefined;
	if (!workspaceUsable) {
		if (isPreparing) {
			disabledReason = "Project sandbox is being provisioned.";
		} else {
			disabledReason = "Project sandbox is not ready yet.";
		}
	} else if (selectedSession?.status === "archived") {
		disabledReason = "This conversation is archived.";
	}

	return (
		<main className="flex h-dvh flex-col overflow-hidden bg-background">
			{bar ? (
				<WorkspaceStatusBar
					mode={bar}
					message={checkError?.message}
					pending={
						bar === "restore-failed"
							? retryPending || provisionPending
							: checkQuery.isFetching || checkQuery.isPending
					}
					onRetryRestore={() =>
						retryRestoreMutation.mutate({ projectId, sessionId })
					}
					onRetryCheck={() => {
						void checkQuery.refetch();
					}}
					retryError={retryRestoreMutation.error?.message ?? null}
				/>
			) : null}
			<div className="min-h-0 flex-1">
				<Chat
					projectId={projectId}
					sessionId={selectedSessionId}
					branchName={selectedSession?.branchName ?? null}
					gitExportEnabled={Boolean(
						project.githubRepo && project.githubInstallationId,
					)}
					disabledReason={disabledReason}
					messages={serverMessages}
					hasMoreHistory={hasMoreHistory}
					isLoadingMoreHistory={isLoadingMoreHistory}
					onLoadEarlier={() => {
						void messagesQuery.fetchNextPage();
					}}
					onWorkspaceRefresh={(activeSessionId) => {
						void queryClient.invalidateQueries(
							trpc.projects.list.queryFilter(),
						);
						if (activeSessionId) {
							void queryClient.invalidateQueries(
								trpc.sessionGit.gitStatus.queryFilter({
									projectId,
									sessionId: activeSessionId,
								}),
							);
							void queryClient.invalidateQueries(
								trpc.workspace.messages.infiniteQueryFilter({
									projectId,
									sessionId: activeSessionId,
								}),
							);
						}
					}}
				/>
			</div>
		</main>
	);
}
