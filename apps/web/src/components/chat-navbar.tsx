import { GitBranchIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { SessionGitActions } from "#/components/session-git-actions";
import { SessionToolsTrigger } from "#/components/session-tools-trigger";
import { SidebarTrigger, useSidebar } from "#/components/ui/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip";

type ChatNavbarProps = {
	projectId?: string;
	sessionId?: string | null;
	branchName?: string | null;
	gitExportEnabled?: boolean;
	disabled?: boolean;
	toolsOpen?: boolean;
	onToolsOpenChange?: (open: boolean) => void;
	rightActions?: ReactNode;
};

/** size-6 trigger (24px) + 8px gap. Width-tweened so neighbors ease instead of snap. */
const TRIGGER_SLOT_WIDTH = 32;

export function ChatNavbar({
	projectId,
	sessionId,
	branchName,
	gitExportEnabled = false,
	disabled = false,
	toolsOpen = false,
	onToolsOpenChange,
	rightActions,
}: ChatNavbarProps) {
	const { state, isMobile } = useSidebar();
	const reduceMotion = useReducedMotion();
	const showSidebarTrigger = isMobile || state === "collapsed";
	const duration = reduceMotion ? 0 : 0.2;
	const ease = [0.23, 1, 0.32, 1] as const;
	const branchLabel = branchName?.trim() || "—";
	const hasSession = Boolean(sessionId);
	// Trigger lives on the pane while tools are open.
	const showToolsTrigger = !toolsOpen && Boolean(onToolsOpenChange);
	const branch = (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						className="inline-flex min-w-0 max-w-full cursor-default items-center gap-1.5 rounded-sm text-muted-foreground text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
						aria-label={`Branch ${branchLabel}`}
					>
						<GitBranchIcon className="size-3 shrink-0" aria-hidden />
						<span className="truncate font-medium font-mono">
							{branchLabel}
						</span>
					</button>
				}
			/>
			<TooltipContent side="bottom" className="max-w-xs">
				<span className="font-mono">{branchLabel}</span>
			</TooltipContent>
		</Tooltip>
	);
	const left = (
		<div className="flex h-8 min-w-0 items-center">
			<AnimatePresence initial={false}>
				{showSidebarTrigger ? (
					<motion.div
						key="sidebar-trigger"
						initial={{ opacity: 0, width: 0 }}
						animate={{ opacity: 1, width: TRIGGER_SLOT_WIDTH }}
						exit={{ opacity: 0, width: 0 }}
						transition={{ duration, ease }}
						className="h-6 shrink-0 overflow-hidden"
					>
						<div className="flex size-6 items-center justify-center">
							<SidebarTrigger className="size-6 shrink-0 cursor-pointer" />
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>
			{branch}
		</div>
	);

	return (
		<nav
			aria-label="Chat controls"
			className="pointer-events-none absolute inset-x-0 top-0 z-10 w-full bg-gradient-to-b from-background from-60% to-transparent pt-[max(1rem,env(safe-area-inset-top))] pb-6 sm:pb-8"
		>
			<div className="pointer-events-auto flex w-full items-center px-5 sm:px-6">
				<div className="min-w-0 flex-1">
					{gitExportEnabled && projectId && sessionId && !disabled ? (
						<SessionGitActions
							projectId={projectId}
							sessionId={sessionId}
							disabled={disabled}
						>
							{left}
						</SessionGitActions>
					) : (
						<div className="min-w-0">{left}</div>
					)}
				</div>
				{rightActions ? (
					<div className="ml-2 flex shrink-0 items-center">{rightActions}</div>
				) : null}
				<TooltipProvider delay={200}>
					<AnimatePresence initial={false}>
						{showToolsTrigger && onToolsOpenChange ? (
							<motion.div
								key="tools-trigger"
								initial={{ opacity: 0, width: 0 }}
								animate={{ opacity: 1, width: TRIGGER_SLOT_WIDTH }}
								exit={{ opacity: 0, width: 0 }}
								transition={{ duration, ease }}
								className="flex h-6 shrink-0 items-center justify-end overflow-hidden"
							>
								<SessionToolsTrigger
									open={false}
									onOpenChange={onToolsOpenChange}
									disabled={disabled || !hasSession}
								/>
							</motion.div>
						) : null}
					</AnimatePresence>
				</TooltipProvider>
			</div>
		</nav>
	);
}
