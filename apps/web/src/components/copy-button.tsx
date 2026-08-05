"use client";

import { Check, Copy } from "lucide";
import { MorphIcon } from "morphicons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";

type CopyButtonProps = {
	value: string;
	className?: string;
	label?: string;
	copiedLabel?: string;
};

export function CopyButton({
	value,
	className,
	label = "Copy",
	copiedLabel = "Copied",
}: CopyButtonProps) {
	const [copiedValue, setCopiedValue] = useState<string | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const copied = copiedValue === value;

	useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	async function handleCopy() {
		if (!value || copiedValue === value) {
			return;
		}

		try {
			await navigator.clipboard.writeText(value);
			setCopiedValue(value);
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
			timeoutRef.current = setTimeout(() => {
				setCopiedValue(null);
				timeoutRef.current = null;
			}, 2000);
		} catch {
			// Keep feedback in-button only; silent on clipboard denial.
		}
	}

	const tooltip = copied ? copiedLabel : label;

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						disabled={!value}
						aria-label={tooltip}
						onClick={handleCopy}
						className={cn(
							"relative text-muted-foreground transition-[transform,color,background-color,opacity] duration-150 ease-out",
							"hover:text-foreground",
							"active:scale-[0.97]",
							"motion-reduce:transition-none motion-reduce:active:scale-100",
							className,
						)}
					>
						<MorphIcon
							icon={copied ? Check : Copy}
							className="size-2.5"
							spring="snappy"
						/>
						<span className="sr-only" aria-live="polite">
							{copied ? copiedLabel : ""}
						</span>
					</Button>
				}
			/>
			<TooltipContent side="top">{tooltip}</TooltipContent>
		</Tooltip>
	);
}
