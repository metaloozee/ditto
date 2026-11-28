import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { cn } from "cn";

/**
 * A sheet the owner can swipe away. Bottom by default; pass `swipeDirection="right"` with a
 * `side="end"` content for the floating side sheet.
 */
function Drawer(props: DrawerPrimitive.Root.Props) {
	return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

const BACKDROP =
	"fixed inset-0 z-50 min-h-dvh opacity-[calc(1-var(--drawer-swipe-progress))] transition-opacity duration-[450ms] ease-drawer data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:opacity-0 data-swiping:duration-0 supports-[-webkit-touch-callout:none]:absolute";

function DrawerContent({
	className,
	children,
	side = "bottom",
	...props
}: DrawerPrimitive.Popup.Props & { side?: "bottom" | "end" }) {
	if (side === "end") {
		return (
			<DrawerPrimitive.Portal>
				{/* The page dims behind the sheet, so attention moves to it. No blur: a backdrop-filter
				    mis-composites the Ditto mark's SVG layers in Chrome. */}
				<DrawerPrimitive.Backdrop
					data-slot="drawer-overlay"
					className={cn(BACKDROP, "bg-black/40 dark:bg-black/55")}
				/>
				{/* Floats 8px off the edges, like the inset main panel, and never moves the page. */}
				<DrawerPrimitive.Viewport className="pointer-events-none fixed inset-0 z-50 flex justify-end p-2">
					<DrawerPrimitive.Popup
						data-slot="drawer-content"
						data-side="end"
						className={cn(
							"sheet-motion pointer-events-auto flex h-full w-[min(26rem,100%)] flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none data-swiping:select-none",
							className,
						)}
						{...props}
					>
						<DrawerPrimitive.Content className="flex min-h-0 flex-1 flex-col">
							{children}
						</DrawerPrimitive.Content>
					</DrawerPrimitive.Popup>
				</DrawerPrimitive.Viewport>
			</DrawerPrimitive.Portal>
		);
	}
	return (
		<DrawerPrimitive.Portal>
			<DrawerPrimitive.Backdrop
				data-slot="drawer-overlay"
				className={cn(BACKDROP, "bg-black/40")}
			/>
			<DrawerPrimitive.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
				{/* The popup bleeds 3rem below the screen so an overshooting swipe never shows a gap. */}
				<DrawerPrimitive.Popup
					data-slot="drawer-content"
					className={cn(
						"-mb-12 flex max-h-[calc(85dvh+3rem)] w-full flex-col overflow-y-auto overscroll-contain rounded-t-xl bg-popover px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px)+3rem)] text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-drawer data-ending-style:[transform:translateY(calc(100%-3rem+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:[transform:translateY(calc(100%-3rem+2px))] data-swiping:select-none",
						className,
					)}
					{...props}
				>
					<div aria-hidden className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-muted" />
					<DrawerPrimitive.Content className="flex min-h-0 flex-col">
						{children}
					</DrawerPrimitive.Content>
				</DrawerPrimitive.Popup>
			</DrawerPrimitive.Viewport>
		</DrawerPrimitive.Portal>
	);
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
	return <DrawerPrimitive.Title data-slot="drawer-title" className={className} {...props} />;
}

function DrawerClose(props: DrawerPrimitive.Close.Props) {
	return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

export { Drawer, DrawerClose, DrawerContent, DrawerTitle };
