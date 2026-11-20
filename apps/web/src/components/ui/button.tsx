import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Ring } from "loading-dev";

const buttonVariants = cva(
	"group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[scale,color,background-color,box-shadow,filter] duration-200 ease-out will-change-transform outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:not-disabled:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: "layer-primary",
				outline:
					"border-(--edge) bg-card hover:border-(--edge-hover) hover:bg-accent aria-expanded:border-(--edge-hover) aria-expanded:bg-accent",
				secondary: "layer-raised",
				ghost:
					"hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
				destructive:
					"border-destructive/25 bg-destructive/10 text-destructive shadow-[inset_0_1px_0_oklch(1_0_0/6%)] hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
				link: "text-link underline-offset-4 hover:underline",
			},
			size: {
				default:
					"h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
				xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-7 gap-1 px-3 text-[0.8rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
				icon: "size-8",
				"icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-7",
				"icon-lg": "size-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	loading = false,
	children,
	...props
}: ButtonPrimitive.Props &
	VariantProps<typeof buttonVariants> & {
		/** Swaps the content for a spinner. The content stays laid out, so the width holds. */
		loading?: boolean;
	}) {
	return (
		<ButtonPrimitive
			data-slot="button"
			data-loading={loading || undefined}
			aria-busy={loading || undefined}
			className={cn(
				buttonVariants({ variant, size, className }),
				loading && "pointer-events-none relative",
			)}
			{...props}
		>
			{loading ? (
				<>
					<span className="inline-flex items-center gap-[inherit] opacity-0">{children}</span>
					<span className="absolute inset-0 grid place-items-center">
						<Ring size={16} color="currentColor" />
					</span>
				</>
			) : (
				children
			)}
		</ButtonPrimitive>
	);
}

export { Button, buttonVariants };
