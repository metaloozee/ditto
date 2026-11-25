import { cn } from "cn";
import * as ResizablePrimitive from "react-resizable-panels";

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
	return (
		<ResizablePrimitive.Group
			data-slot="resizable-panel-group"
			className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
			{...props}
		/>
	);
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
	return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

/**
 * A hairline between panels with a 12px hit area. With `withHandle`, a small grip pill sits on
 * the line; it brightens and grows while the pointer is on the line or the panels are dragged.
 */
function ResizableHandle({
	withHandle,
	className,
	...props
}: ResizablePrimitive.SeparatorProps & {
	withHandle?: boolean;
}) {
	return (
		<ResizablePrimitive.Separator
			data-slot="resizable-handle"
			className={cn(
				"group/handle relative flex w-px items-center justify-center bg-border outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 focus-visible:bg-ring aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-3 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
				className,
			)}
			{...props}
		>
			{withHandle && (
				<div className="z-10 h-8 w-1 shrink-0 rounded-full bg-panel-border transition-[height,background-color] duration-150 ease-out group-hover/handle:h-10 group-hover/handle:bg-muted-foreground group-active/handle:h-12 group-active/handle:bg-foreground group-focus-visible/handle:bg-ring" />
			)}
		</ResizablePrimitive.Separator>
	);
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
