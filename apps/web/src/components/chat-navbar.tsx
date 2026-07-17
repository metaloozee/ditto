import { GitBranchIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SessionGitActions } from "#/components/session-git-actions";
import { SidebarTrigger, useSidebar } from "#/components/ui/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";

type ChatNavbarProps = {
	projectId?: string;
	sessionId?: string | null;
	branchName?: string | null;
	gitExportEnabled?: boolean;
	disabled?: boolean;
};

const TRIGGER_SLOT_WIDTH = 40;

export function ChatNavbar({
	projectId,
	sessionId,
	branchName,
	gitExportEnabled = false,
	disabled = false,
}: ChatNavbarProps) {
	const { state } = useSidebar();
	const reduceMotion = useReducedMotion();
	const showSidebarTrigger = state === "collapsed";
	const duration = reduceMotion ? 0 : 0.2;
	const ease = [0.23, 1, 0.32, 1] as const;
	const branchLabel = branchName?.trim() || "—";
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
						initial={{ width: 0, opacity: 0, x: -12 }}
						animate={{ width: TRIGGER_SLOT_WIDTH, opacity: 1, x: 0 }}
						exit={{ width: 0, opacity: 0, x: -12 }}
						transition={{ duration, ease }}
						className="h-8 shrink-0 overflow-hidden"
					>
						<div className="flex size-8 items-center justify-center">
							<SidebarTrigger className="size-8 shrink-0 cursor-pointer" />
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
			className="absolute inset-x-0 top-0 z-10 flex w-full items-center bg-transparent px-3 pt-[max(1rem,env(safe-area-inset-top))] pb-2"
		>
			{gitExportEnabled && projectId && sessionId ? (
				<SessionGitActions
					projectId={projectId}
					sessionId={sessionId}
					disabled={disabled}
				>
					{left}
				</SessionGitActions>
			) : (
				<div className="min-w-0 flex-1">{left}</div>
			)}
		</nav>
	);
}
