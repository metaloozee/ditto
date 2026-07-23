"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
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
						<span className="relative size-2.5" aria-hidden="true">
							<CopyIcon
								className={cn(
									"absolute inset-0 size-2.5 transition-[opacity,transform,filter] duration-150 ease-out",
									"motion-reduce:transition-none",
									copied
										? "scale-90 opacity-0 blur-[2px]"
										: "scale-100 opacity-100 blur-0",
								)}
							/>
							<CheckIcon
								className={cn(
									"absolute inset-0 size-2.5 transition-[opacity,transform,filter] duration-150 ease-out",
									"motion-reduce:transition-none",
									copied
										? "scale-100 opacity-100 blur-0"
										: "scale-90 opacity-0 blur-[2px]",
								)}
							/>
						</span>
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
