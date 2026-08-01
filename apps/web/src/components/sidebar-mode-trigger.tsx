import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SidebarTrigger, useSidebar } from "#/components/ui/sidebar";

/** size-6 trigger (24px) + 8px gap. Width-tweened so neighbors ease instead of snap. */
const TRIGGER_SLOT_WIDTH = 32;

/** Shows sidebar trigger on mobile or when the desktop sidebar is collapsed. */
export function SidebarModeTrigger() {
	const { state, isMobile } = useSidebar();
	const reduceMotion = useReducedMotion();
	const show = isMobile || state === "collapsed";
	const duration = reduceMotion ? 0 : 0.2;
	const ease = [0.23, 1, 0.32, 1] as const;

	return (
		<AnimatePresence initial={false}>
			{show ? (
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
	);
}
