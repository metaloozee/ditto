import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import {
	CircleCheckIcon,
	InfoIcon,
	Loader2Icon,
	OctagonXIcon,
	TriangleAlertIcon,
	XIcon,
} from "lucide-react";
import type * as React from "react";
import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

const toastManager = ToastPrimitive.createToastManager();

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
	return <ToastPrimitive.Provider toastManager={toastManager} {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
	return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
	return (
		<ToastPrimitive.Viewport
			data-slot="toast-viewport"
			className={cn(
				"pointer-events-none fixed inset-x-4 bottom-4 z-50 mx-auto w-auto max-w-sm outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full",
				className,
			)}
			{...props}
		/>
	);
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
	return (
		<ToastPrimitive.Root
			data-slot="toast"
			className={cn(
				"group/toast pointer-events-auto absolute right-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-bottom rounded-md border bg-popover text-popover-foreground shadow-lg outline-none select-none will-change-transform focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
				"h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
				"after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
				"data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
				"data-limited:opacity-0 data-starting-style:[transform:translateY(150%)]",
				"[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(150%)]",
				"data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
				"data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
				"data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
				"data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
				"data-expanded:data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
				"data-expanded:data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
				"data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
				"data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
				className,
			)}
			{...props}
		/>
	);
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
	return (
		<ToastPrimitive.Content
			data-slot="toast-content"
			className={cn(
				"flex h-full items-center gap-3 overflow-hidden p-4 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100",
				className,
			)}
			{...props}
		/>
	);
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
	return (
		<ToastPrimitive.Title
			data-slot="toast-title"
			className={cn("text-sm font-medium", className)}
			{...props}
		/>
	);
}

function ToastDescription({
	className,
	...props
}: ToastPrimitive.Description.Props) {
	return (
		<ToastPrimitive.Description
			data-slot="toast-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

function ToastAction({
	className,
	render = <Button variant="outline" size="sm" />,
	...props
}: ToastPrimitive.Action.Props) {
	return (
		<ToastPrimitive.Action
			data-slot="toast-action"
			render={render}
			className={cn("shrink-0", className)}
			{...props}
		/>
	);
}

function ToastClose({
	className,
	children,
	render = <Button variant="ghost" size="icon-sm" />,
	...props
}: ToastPrimitive.Close.Props) {
	return (
		<ToastPrimitive.Close
			data-slot="toast-close"
			aria-label="Close toast"
			render={render}
			className={cn(
				"relative shrink-0 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
				className,
			)}
			{...props}
		>
			{children ?? <XIcon className="size-4" aria-hidden="true" />}
		</ToastPrimitive.Close>
	);
}

function ToastIcon({ type }: { type: string | undefined }) {
	const className = "size-4";
	let icon: React.ReactNode = null;

	if (type === "success") {
		icon = <CircleCheckIcon className={className} aria-hidden="true" />;
	} else if (type === "info") {
		icon = <InfoIcon className={className} aria-hidden="true" />;
	} else if (type === "warning") {
		icon = <TriangleAlertIcon className={className} aria-hidden="true" />;
	} else if (type === "error") {
		icon = (
			<OctagonXIcon
				className={cn(className, "text-destructive")}
				aria-hidden="true"
			/>
		);
	} else if (type === "loading") {
		icon = (
			<Loader2Icon
				className={cn(className, "animate-spin")}
				aria-hidden="true"
			/>
		);
	}

	if (!icon) return null;

	return (
		<span
			data-slot="toast-icon"
			className="shrink-0 [&_svg]:pointer-events-none"
		>
			{icon}
		</span>
	);
}

function ToastList() {
	const { toasts } = ToastPrimitive.useToastManager();

	return toasts.map((toastItem) => (
		<Toast key={toastItem.id} toast={toastItem}>
			<ToastContent>
				<ToastIcon type={toastItem.type} />
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<ToastTitle />
					<ToastDescription />
				</div>
				<ToastAction />
				<ToastClose />
			</ToastContent>
		</Toast>
	));
}

function Toaster(props: ToastPrimitive.Provider.Props) {
	return (
		<ToastProvider {...props}>
			<ToastPortal>
				<ToastViewport>
					<ToastList />
				</ToastViewport>
			</ToastPortal>
		</ToastProvider>
	);
}

const toast = {
	add: toastManager.add.bind(toastManager),
	close: toastManager.close.bind(toastManager),
	update: toastManager.update.bind(toastManager),
	promise: toastManager.promise.bind(toastManager),
};

export {
	Toaster,
	Toast,
	ToastAction,
	ToastClose,
	ToastContent,
	ToastDescription,
	ToastPortal,
	ToastProvider,
	ToastTitle,
	ToastViewport,
	toast,
};
