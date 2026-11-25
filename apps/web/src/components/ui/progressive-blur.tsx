import { cn } from "cn";
import type * as React from "react";

const LAYERS = [1, 4, 12];

/**
 * Content scrolling under floating chrome blurs more the closer it gets to the edge. Each
 * layer blurs harder than the last and is masked to one band of the gradient, so the
 * blur ramps up instead of stopping at a hard line. A tint toward the page colour rides on
 * top so text over it stays legible.
 */
function ProgressiveBlur({
	side = "top",
	className,
	...props
}: React.ComponentProps<"div"> & { side?: "top" | "bottom" }) {
	const toward = side === "top" ? "to top" : "to bottom";
	const step = 100 / (LAYERS.length + 1);
	return (
		<div
			aria-hidden
			data-slot="progressive-blur"
			className={cn(
				"pointer-events-none absolute inset-x-0",
				side === "top" ? "top-0" : "bottom-0",
				className,
			)}
			{...props}
		>
			{LAYERS.map((blur, index) => {
				const mask = `linear-gradient(${toward}, transparent ${index * step}%, black ${(index + 1) * step}%, black ${(index + 2) * step}%, transparent ${Math.min((index + 3) * step, 100)}%)`;
				return (
					<div
						key={blur}
						className="absolute inset-0"
						style={{
							backdropFilter: `blur(${blur}px)`,
							WebkitBackdropFilter: `blur(${blur}px)`,
							maskImage: mask,
							WebkitMaskImage: mask,
						}}
					/>
				);
			})}
			<div
				className={cn(
					"absolute inset-0 from-background to-transparent",
					side === "top" ? "bg-linear-to-b" : "bg-linear-to-t",
				)}
			/>
		</div>
	);
}

export { ProgressiveBlur };
