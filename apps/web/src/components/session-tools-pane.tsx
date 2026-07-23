import { CodeIcon, MonitorPlayIcon, TerminalIcon } from "lucide-react";
import { SessionPreviewPane } from "#/components/session-preview-pane";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";

export type SessionToolsPaneProps = {
	projectId: string;
	sessionId: string;
	className?: string;
	onClose?: () => void;
};

function WindowLights({ onClose }: { onClose?: () => void }) {
	return (
		<div className="flex shrink-0 items-center gap-1.5">
			{onClose ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<button
								type="button"
								onClick={onClose}
								aria-label="Close tools panel"
								className={cn(
									"size-2.5 rounded-full bg-red-500/85 outline-none transition-opacity",
									"opacity-90 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40",
								)}
							/>
						}
					/>
					<TooltipContent side="bottom">Close</TooltipContent>
				</Tooltip>
			) : (
				<span
					className="size-2.5 rounded-full bg-muted-foreground/25"
					aria-hidden
				/>
			)}
			<span
				className="size-2.5 rounded-full bg-muted-foreground/20"
				aria-hidden
			/>
			<span
				className="size-2.5 rounded-full bg-muted-foreground/20"
				aria-hidden
			/>
		</div>
	);
}

export function SessionToolsPane({
	projectId,
	sessionId,
	className,
	onClose,
}: SessionToolsPaneProps) {
	return (
		<section
			aria-label="Session tools"
			className={cn(
				"flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-muted shadow-sm",
				className,
			)}
		>
			<TooltipProvider delay={300}>
				<Tabs
					defaultValue="preview"
					className="flex h-full min-h-0 flex-col gap-0"
				>
					{/* Browser titlebar — red light closes; views as plain tabs */}
					<header className="flex h-10 shrink-0 items-center gap-3 px-3">
						<WindowLights onClose={onClose} />
						<TabsList
							variant="line"
							aria-label="Session tool views"
							className="h-10 min-w-0 flex-1 justify-start gap-0 rounded-none bg-transparent p-0"
						>
							<TabsTrigger
								value="preview"
								className={cn(
									"h-10 gap-1.5 rounded-none px-3 text-xs shadow-none",
									"after:hidden data-active:bg-transparent data-active:shadow-none",
								)}
							>
								<MonitorPlayIcon data-icon="inline-start" aria-hidden />
								Preview
							</TabsTrigger>
							<TabsTrigger
								value="terminal"
								disabled
								title="Terminal (coming soon)"
								className="h-10 gap-1.5 rounded-none px-3 text-xs after:hidden"
							>
								<TerminalIcon data-icon="inline-start" aria-hidden />
								Terminal
							</TabsTrigger>
							<TabsTrigger
								value="code"
								disabled
								title="Code (coming soon)"
								className="h-10 gap-1.5 rounded-none px-3 text-xs after:hidden"
							>
								<CodeIcon data-icon="inline-start" aria-hidden />
								Code
							</TabsTrigger>
						</TabsList>
					</header>

					<TabsContent
						value="preview"
						className="m-0 min-h-0 flex-1 overflow-hidden text-sm"
					>
						<SessionPreviewPane
							projectId={projectId}
							sessionId={sessionId}
							className="h-full border-0 bg-transparent"
						/>
					</TabsContent>
				</Tabs>
			</TooltipProvider>
		</section>
	);
}
