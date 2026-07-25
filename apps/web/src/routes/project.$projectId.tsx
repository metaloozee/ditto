import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Chat } from "#/components/ai-chat";
import { Button } from "#/components/ui/button";
import { toast } from "#/components/ui/toast";
import { useTRPC } from "#/integrations/trpc/react";

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
	if (props.mode === "restore-failed") {
		return (
			<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-4 py-2 text-xs">
				<div className="min-w-0 text-muted-foreground">
					<span className="text-destructive" role="alert">
						Workspace restore failed
					</span>
				</div>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={props.pending}
					aria-busy={props.pending || undefined}
					onClick={props.onRetryRestore}
				>
					{props.pending ? "Retrying…" : "Retry restore"}
				</Button>
				{props.retryError ? (
					<p className="w-full text-destructive" role="alert">
						{props.retryError}
					</p>
				) : null}
			</div>
		);
	}

	return (
		<div
			role="alert"
			className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-4 py-2 text-xs"
		>
			<p className="min-w-0 text-destructive">
				{props.message ?? "Project sandbox is not ready yet."}
			</p>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={props.pending}
				aria-busy={props.pending || undefined}
				onClick={props.onRetryCheck}
			>
				{props.pending ? "Retrying…" : "Retry"}
			</Button>
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
	const reensureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const latestWorkspaceSourceRef = useRef<"ensure" | "retry" | null>(null);
	const readinessToastRef = useRef<{ id: string } | null>(null);

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

	const { mutate: ensureWorkspace, ...ensureWorkspaceMutation } = useMutation(
		trpc.workspace.ensureWorkspace.mutationOptions({
			onSuccess: () => {
				latestWorkspaceSourceRef.current = "ensure";
				void queryClient.invalidateQueries(
					trpc.projects.get.queryFilter({ id: projectId }),
				);
			},
		}),
	);

	const retryRestoreMutation = useMutation(
		trpc.workspace.retryRestore.mutationOptions({
			onSuccess: () => {
				latestWorkspaceSourceRef.current = "retry";
				void queryClient.invalidateQueries(
					trpc.projects.get.queryFilter({ id: projectId }),
				);
			},
		}),
	);

	// Fire ensure when D1 says ready. Keyed on projectId + sessionId.
	useEffect(() => {
		if (reensureTimerRef.current != null) {
			clearTimeout(reensureTimerRef.current);
			reensureTimerRef.current = null;
		}
		if (d1Status === "ready") {
			ensureWorkspace({ projectId, sessionId });
		}
		return () => {
			if (reensureTimerRef.current != null) {
				clearTimeout(reensureTimerRef.current);
				reensureTimerRef.current = null;
			}
		};
	}, [projectId, sessionId, d1Status, ensureWorkspace]);

	const ensureData = ensureWorkspaceMutation.data as
		| WorkspacePayload
		| undefined;
	const retryData = retryRestoreMutation.data as WorkspacePayload | undefined;

	const matchingRetry = workspaceMatches(retryData, projectId, sessionId)
		? retryData
		: undefined;
	const matchingEnsure = workspaceMatches(ensureData, projectId, sessionId)
		? ensureData
		: undefined;

	// Prefer the most recently settled matching payload.
	const matchingWorkspace =
		latestWorkspaceSourceRef.current === "retry"
			? (matchingRetry ?? matchingEnsure)
			: (matchingEnsure ?? matchingRetry);

	const ensurePending = ensureWorkspaceMutation.isPending;
	const retryPending = retryRestoreMutation.isPending;
	const readinessPending = ensurePending || retryPending;

	// Schedule one delayed re-ensure when server reports still provisioning.
	useEffect(() => {
		if (reensureTimerRef.current != null) {
			clearTimeout(reensureTimerRef.current);
			reensureTimerRef.current = null;
		}
		if (
			matchingWorkspace?.sandbox?.state === "provisioning" &&
			!readinessPending &&
			d1Status === "ready"
		) {
			reensureTimerRef.current = setTimeout(() => {
				reensureTimerRef.current = null;
				ensureWorkspace({ projectId, sessionId });
			}, 1_000);
		}
		return () => {
			if (reensureTimerRef.current != null) {
				clearTimeout(reensureTimerRef.current);
				reensureTimerRef.current = null;
			}
		};
	}, [
		matchingWorkspace,
		readinessPending,
		d1Status,
		projectId,
		sessionId,
		ensureWorkspace,
	]);

	const selectedSession = matchingWorkspace?.selectedSession ?? null;
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

	const sandboxState = matchingWorkspace?.sandbox?.state;
	const restoreFailed =
		Boolean(matchingWorkspace?.restoreFailed) || d1Status === "failed";
	const ensureError =
		ensureWorkspaceMutation.error && !matchingWorkspace
			? ensureWorkspaceMutation.error
			: null;
	const successReady =
		Boolean(sandboxState && SUCCESS_SANDBOX_STATES.has(sandboxState)) &&
		d1Status === "ready" &&
		!readinessPending;

	const isPreparing =
		!restoreFailed &&
		!ensureError &&
		!successReady &&
		(d1Status === "provisioning" ||
			d1Status === "ready" ||
			sandboxState === "provisioning");

	// One loading→success/error toast for the whole wake cycle.
	useEffect(() => {
		const settle = (type: "success" | "error", description: string) => {
			const pending = readinessToastRef.current;
			if (!pending) return;
			readinessToastRef.current = null;
			toast.update(pending.id, { type, description });
		};

		if (isPreparing) {
			if (!readinessToastRef.current) {
				const id = toast.add({
					id: `sandbox-ready-${projectId}`,
					type: "loading",
					description: "Preparing project sandbox...",
				});
				readinessToastRef.current = { id };
			}
			return;
		}

		if (successReady) {
			settle("success", "Project sandbox ready");
			return;
		}

		if (restoreFailed) {
			settle("error", "Workspace restore failed");
			return;
		}

		if (ensureError && d1Status === "ready" && !readinessPending) {
			settle(
				"error",
				ensureError instanceof Error
					? ensureError.message
					: "Project sandbox is not ready yet.",
			);
		}
	}, [
		isPreparing,
		successReady,
		restoreFailed,
		ensureError,
		d1Status,
		readinessPending,
		projectId,
	]);

	// Drop in-flight toast on project/session change or unmount.
	useEffect(() => {
		const routeKey = `${projectId}:${sessionId ?? ""}`;
		return () => {
			void routeKey;
			const pending = readinessToastRef.current;
			if (!pending) return;
			readinessToastRef.current = null;
			toast.close(pending.id);
		};
	}, [projectId, sessionId]);

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
	} else if (ensureError && d1Status === "ready" && !readinessPending) {
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
					message={ensureError?.message}
					pending={readinessPending}
					onRetryRestore={() =>
						retryRestoreMutation.mutate({ projectId, sessionId })
					}
					onRetryCheck={() => ensureWorkspace({ projectId, sessionId })}
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
