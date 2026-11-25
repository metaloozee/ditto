import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { cn } from "cn";

/** A bottom sheet that the owner can swipe down to dismiss. */
function Drawer(props: DrawerPrimitive.Root.Props) {
	return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerContent({ className, children, ...props }: DrawerPrimitive.Popup.Props) {
	return (
		<DrawerPrimitive.Portal>
			<DrawerPrimitive.Backdrop
				data-slot="drawer-overlay"
				className="fixed inset-0 z-50 min-h-dvh bg-black/40 opacity-[calc(1-var(--drawer-swipe-progress))] transition-opacity duration-[450ms] ease-drawer data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:opacity-0 data-swiping:duration-0 supports-[-webkit-touch-callout:none]:absolute"
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

export { Drawer, DrawerContent, DrawerTitle };
