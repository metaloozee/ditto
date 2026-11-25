// Adapted from Kobra's conversation (kobra.systems/r/conversation.json) onto Ditto's tokens.
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type * as React from "react";

function Conversation({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="conversation"
			className={cn("flex min-w-0 flex-col gap-1", className)}
			{...props}
		/>
	);
}

const bubbleVariants = cva(
	"group/bubble flex w-fit max-w-[80%] min-w-0 flex-col gap-1 data-[align=end]:self-end",
	{
		variants: {
			variant: {
				received:
					"*:data-[slot=conversation-content]:border-panel-border *:data-[slot=conversation-content]:bg-bubble-received",
				sent: "*:data-[slot=conversation-content]:bg-bubble-sent",
			},
		},
		defaultVariants: { variant: "received" },
	},
);

/** One message. A bot's message sits at the start; the owner's sits at the end. */
function ConversationBubble({
	variant = "received",
	className,
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof bubbleVariants>) {
	return (
		<div
			data-slot="conversation-bubble"
			data-variant={variant}
			data-align={variant === "sent" ? "end" : "start"}
			className={cn(bubbleVariants({ variant }), className)}
			{...props}
		/>
	);
}

function ConversationContent({ className, render, ...props }: useRender.ComponentProps<"div">) {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(
					"w-fit max-w-full min-w-0 rounded-2xl border border-transparent px-4 py-2.5 text-pretty wrap-break-word text-foreground [unicode-bidi:plaintext]",
					// The corner nearest the speaker tucks in, and so does the one a following
					// message from the same speaker meets.
					"group-data-[align=end]/bubble:self-end group-data-[align=end]/bubble:rounded-ee-md group-data-[align=start]/bubble:rounded-es-md",
					"[[data-slot=conversation-bubble][data-align=start]+[data-slot=conversation-bubble][data-align=start]>&]:rounded-ss-md",
					"[[data-slot=conversation-bubble][data-align=end]+[data-slot=conversation-bubble][data-align=end]>&]:rounded-se-md",
					className,
				),
			},
			props,
		),
		render,
		state: { slot: "conversation-content" },
	});
}

export { Conversation, ConversationBubble, ConversationContent };
