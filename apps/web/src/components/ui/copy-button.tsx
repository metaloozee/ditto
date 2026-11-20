import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";
import { TextMorph } from "torph/react";

import { Button } from "#/components/ui/button.tsx";

const RESET_AFTER_MS = 1600;

// Both icons stay mounted in one grid cell, so the swap animates in both
// directions. The entering icon grows from a quarter size out of a blur, which
// reads as one icon changing shape rather than two icons trading places.
const iconLayer =
	"[grid-area:1/1] transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:scale-100 motion-reduce:blur-none";
const shown = "scale-100 opacity-100 blur-none";
const hidden = "scale-[0.25] opacity-0 blur-[4px]";

function CopyButton({
	value,
	label,
	className,
	...props
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "children"> & {
	value: string;
	/** Shows a text label that morphs to "Copied". Without it the button is icon-only. */
	label?: string;
}) {
	const [copied, setCopied] = React.useState(false);
	const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

	React.useEffect(() => () => clearTimeout(timer.current), []);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			return;
		}
		setCopied(true);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setCopied(false), RESET_AFTER_MS);
	}

	const icon = (
		<span
			className="grid place-items-center"
			aria-hidden
			data-icon={label ? "inline-start" : undefined}
		>
			<span className={cn(iconLayer, copied ? hidden : shown)}>
				<HugeiconsIcon icon={Copy01Icon} />
			</span>
			<span className={cn(iconLayer, copied ? shown : hidden)}>
				<HugeiconsIcon icon={Tick02Icon} />
			</span>
		</span>
	);

	return (
		<Button
			variant="outline"
			size={label ? "default" : "icon"}
			aria-label={label ? undefined : copied ? "Copied" : "Copy"}
			onClick={copy}
			className={className}
			{...props}
		>
			{icon}
			{label && (
				<TextMorph duration={300} ease="cubic-bezier(0.23, 1, 0.32, 1)">
					{copied ? "Copied" : label}
				</TextMorph>
			)}
			<span className="sr-only" aria-live="polite">
				{copied ? "Copied to clipboard" : ""}
			</span>
		</Button>
	);
}

export { CopyButton };
