import { ChevronRightIcon } from "lucide-react";
import { Task, TaskContent, TaskTrigger } from "#/components/ai-elements/task";
import { Spinner } from "#/components/ui/spinner";
import type { StreamToolCall } from "#/lib/agent-message-parts";
import {
	formatElapsedDuration,
	formatToolCallLabel,
	getToolGroupElapsedMs,
} from "#/lib/agent-tool-presentation";
import { cn } from "#/lib/utils";

export type ToolCallGroupProps = {
	tools: StreamToolCall[];
	/** When true, keep the group in the live Working state (newest streaming group). */
	active?: boolean;
};

export function ToolCallGroup({ tools, active = false }: ToolCallGroupProps) {
	const working = active || tools.some((tool) => tool.status === "running");
	const elapsedMs = working ? null : getToolGroupElapsedMs(tools);
	let title = "Worked";
	if (working) {
		title = "Working";
	} else if (elapsedMs !== null) {
		title = `Worked for ${formatElapsedDuration(elapsedMs)}`;
	}

	return (
		<Task className="border-b pb-2" defaultOpen={working}>
			<TaskTrigger title={title}>
				<div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
					{working ? <Spinner size="sm" className="size-3.5 shrink-0" /> : null}
					<span
						className={cn(
							"min-w-0 flex-1 truncate font-medium",
							working && "shimmer",
							elapsedMs !== null && "tabular-nums",
						)}
					>
						{title}
					</span>
					<ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
				</div>
			</TaskTrigger>
			<TaskContent>
				<div className="max-h-48 overflow-y-auto overscroll-contain pr-1">
					<ul className="flex flex-col gap-1">
						{tools.map((tool) => {
							const label = formatToolCallLabel(tool);
							const failed = tool.status === "error";
							return (
								<li
									key={tool.id}
									className={cn(
										"truncate font-mono text-[12px] leading-relaxed",
										failed ? "text-destructive" : "text-muted-foreground",
									)}
									title={label}
								>
									{label}
								</li>
							);
						})}
					</ul>
				</div>
			</TaskContent>
		</Task>
	);
}
