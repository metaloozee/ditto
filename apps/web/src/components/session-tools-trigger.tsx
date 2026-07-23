import { PanelRightIcon } from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";

export type SessionToolsTriggerProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	disabled?: boolean;
	className?: string;
};

/**
 * Shared open/close control for the session tools pane.
 * Renders in the chat navbar when closed; pane chrome owns close when open.
 */
export function SessionToolsTrigger({
	open,
	onOpenChange,
	disabled = false,
	className,
}: SessionToolsTriggerProps) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						disabled={disabled}
						aria-pressed={open}
						aria-label="Session tools"
						onClick={() => onOpenChange(!open)}
						className={cn(
							"inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none",
							"focus-visible:ring-2 focus-visible:ring-ring/40",
							"disabled:pointer-events-none disabled:opacity-40",
							"transition-colors duration-150 ease-out",
							open
								? "bg-secondary text-secondary-foreground"
								: "text-muted-foreground hover:bg-muted hover:text-foreground",
							className,
						)}
					/>
				}
			>
				<PanelRightIcon className="size-3 shrink-0" aria-hidden />
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{disabled
					? "Select a session to open tools"
					: open
						? "Close tools panel"
						: "Open tools panel"}
			</TooltipContent>
		</Tooltip>
	);
}
