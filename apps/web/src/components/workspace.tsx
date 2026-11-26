import {
	Add01Icon,
	Alert02Icon,
	ComputerIcon,
	ComputerTerminal01Icon,
	Folder01Icon,
	GitCompareIcon,
	Logout01Icon,
	Settings01Icon,
	Settings02Icon,
	PinIcon,
	SidebarLeftIcon,
	UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import * as React from "react";

import type { Account } from "#/components/account.tsx";
import { DittoMark, DittoStage } from "#/components/ditto-mark.tsx";
import {
	COMPOSER_PLACEHOLDERS,
	type ComposerMode,
	SendOrStop,
} from "#/components/model-access.tsx";
import { Avatar, AvatarFallback } from "#/components/ui/avatar.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Conversation,
	ConversationBubble,
	ConversationContent,
} from "#/components/ui/conversation.tsx";
import { Drawer, DrawerContent, DrawerTitle } from "#/components/ui/drawer.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Kbd } from "#/components/ui/kbd.tsx";
import { ProgressiveBlur } from "#/components/ui/progressive-blur.tsx";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "#/components/ui/resizable.tsx";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarTrigger,
	useSidebar,
} from "#/components/ui/sidebar.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";
import type { Workspace } from "#/lib/workspace.ts";

const PANEL_ID = "workspace-panel";

/** Collapsed, the sidebar is a rail of 40px faces; expanded, each face gets its name. */
const SIDEBAR_STYLE = {
	"--sidebar-width": "16rem",
	"--sidebar-width-icon": "3.5rem",
} as React.CSSProperties;

/**
 * A face-sized menu row that stays a 40px square on the collapsed rail. Its corners and the
 * active surface match the inset main panel beside it, so the bot you're in reads as part of
 * that page.
 */
const FACE_ROW =
	"h-14 gap-3 rounded-xl px-2 data-active:bg-background data-active:shadow-sm data-active:hover:bg-background group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-0!";

/** Ditto's first words, the same on every visit until conversation arrives (#19). */
const GREETINGS = [
	"Hi, I’m Ditto, your Chief of Staff.",
	"Ask me for something, and I’ll hand it to the right bot and check the work before it comes back to you.",
	"We share one computer. It starts when there’s work to do.",
	"Chat is on its way. Until then, take a look around.",
];
/** Uneven, tightening gaps read as one arrival rather than a metronome. */
const GREETING_DELAYS_MS = [0, 70, 130, 180];

/** The docked panel needs room beside the conversation; narrower screens get a drawer. */
function useDocked() {
	return React.useSyncExternalStore(
		(onChange) => {
			const query = matchMedia(DOCKED);
			query.addEventListener("change", onChange);
			return () => query.removeEventListener("change", onChange);
		},
		() => matchMedia(DOCKED).matches,
		() => true,
	);
}
const DOCKED = "(min-width: 64rem)";

/** Up to two initials, from the first and last words, split by grapheme so emoji stay whole. */
function initials(name: string): string {
	const words = name
		.trim()
		.split(/\s+/)
		.filter((word) => word && !/^(jr|sr|ii|iii|iv)\.?$/i.test(word));
	const first = (word: string | undefined) =>
		word ? ([...new Intl.Segmenter().segment(word)][0]?.segment ?? "") : "";
	const picked = words.length > 1 ? [words[0], words.at(-1)] : [words[0]];
	return picked.map(first).join("").toUpperCase();
}

export function WorkspaceView({
	account,
	workspace,
	sidebarPinned,
	panelOpen,
	onPanelOpenChange,
	onSignOut,
	messages,
	composer = "soon",
	onOpenBotSettings,
	botSettings,
}: {
	account: Account;
	workspace: Workspace;
	sidebarPinned: boolean;
	panelOpen: boolean;
	onPanelOpenChange: (open: boolean) => void;
	/** Replaces the fixed greetings; only `/design` passes it until conversation lands (#19). */
	messages?: React.ReactNode;
	onSignOut: () => void;
	composer?: ComposerMode;
	/** Shows the gear in the bot panel; the caller renders `botSettings` and opens it. */
	onOpenBotSettings?: () => void;
	botSettings?: React.ReactNode;
}) {
	const docked = useDocked();
	const name = workspace.chiefOfStaff.name;
	const conversation = (
		<ConversationPane
			name={name}
			panelOpen={panelOpen}
			onPanelOpenChange={onPanelOpenChange}
			messages={messages}
			composer={composer}
		/>
	);
	const panel = (
		<ComputerPanel name={name} computer={workspace.computer} onOpenSettings={onOpenBotSettings} />
	);
	return (
		<SidebarProvider defaultOpen={sidebarPinned} style={SIDEBAR_STYLE}>
			<WorkspaceSidebar account={account} name={name} onSignOut={onSignOut} />
			<SidebarInset className="h-dvh overflow-hidden md:h-[calc(100dvh-1rem)]">
				<h1 className="sr-only">
					{account.displayName ? `Welcome back, ${account.displayName}` : "Welcome back"}
				</h1>
				{docked && panelOpen ? (
					<ResizablePanelGroup orientation="horizontal">
						<ResizablePanel minSize={360}>{conversation}</ResizablePanel>
						<ResizableHandle withHandle />
						<ResizablePanel defaultSize={384} minSize={300} maxSize="55%">
							<aside
								id={PANEL_ID}
								aria-label="Computer"
								className="panel-in h-full overflow-y-auto overscroll-contain p-4"
							>
								{panel}
							</aside>
						</ResizablePanel>
					</ResizablePanelGroup>
				) : (
					conversation
				)}
			</SidebarInset>
			{docked ? null : (
				<Drawer open={panelOpen} onOpenChange={onPanelOpenChange}>
					<DrawerContent id={PANEL_ID}>
						<DrawerTitle className="sr-only">Computer</DrawerTitle>
						{panel}
					</DrawerContent>
				</Drawer>
			)}
			{botSettings}
		</SidebarProvider>
	);
}

/**
 * The shadcn sidebar collapsed to a rail of faces. Pinned, it holds its full width.
 * Collapsed, a mouse resting on the rail (or focus moving into it) opens it over the
 * conversation without moving it, until the pointer or focus leaves.
 */
function WorkspaceSidebar({
	account,
	name,
	onSignOut,
}: {
	account: Account;
	name: string;
	onSignOut: () => void;
}) {
	const { open: pinned, isMobile } = useSidebar();
	const [peek, setPeek] = React.useState(false);
	const timer = React.useRef<number>(undefined);
	const peekAfter = (next: boolean, ms: number) => {
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setPeek(next), ms);
	};
	React.useEffect(() => () => window.clearTimeout(timer.current), []);

	return (
		<Sidebar
			variant="inset"
			collapsible="icon"
			peeking={peek && !pinned && !isMobile}
			onPointerEnter={(event) => event.pointerType === "mouse" && peekAfter(true, 0)}
			onPointerLeave={(event) => event.pointerType === "mouse" && peekAfter(false, 200)}
			onFocus={() => peekAfter(true, 0)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) peekAfter(false, 0);
			}}
		>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							size="lg"
							isActive
							tooltip={`${name} · Chief of Staff`}
							className={cn(FACE_ROW, "group-has-data-[sidebar=menu-action]/menu-item:pe-14")}
							render={<Link to="/" />}
						>
							<DittoMark still className="size-10 shrink-0 *:size-full!" />
							<span className="grid min-w-0 flex-1 leading-tight">
								<span className="truncate font-medium">{name}</span>
								<span className="truncate text-caption text-muted-foreground">Chief of Staff</span>
							</span>
						</SidebarMenuButton>
						<SidebarPinAction />
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Bots</SidebarGroupLabel>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton size="lg" disabled tooltip="New bot" className={FACE_ROW}>
								<span className="grid size-10 shrink-0 place-items-center rounded-xl border border-dashed border-sidebar-border text-muted-foreground">
									<HugeiconsIcon icon={Add01Icon} />
								</span>
								<span className="grid min-w-0 flex-1 leading-tight">
									<span className="truncate font-medium">New bot</span>
									<span className="truncate text-caption text-muted-foreground">Coming soon</span>
								</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<AccountMenu account={account} onSignOut={onSignOut} />
			</SidebarFooter>
		</Sidebar>
	);
}

/**
 * Pins or collapses the sidebar from the Ditto row, shown while the pointer is on the row.
 * Collapsed, the rail opens on hover, so the action appears there as "keep open".
 */
function SidebarPinAction() {
	const { open: pinned, toggleSidebar } = useSidebar();
	const label = pinned ? "Collapse sidebar" : "Keep sidebar open";
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<SidebarMenuAction
						showOnHover
						aria-label={label}
						onClick={toggleSidebar}
						className="top-1/2! end-2 size-10 w-10 -translate-y-1/2 rounded-sm text-muted-foreground transition-[opacity,background-color,color] duration-150 ease-out hover:bg-sidebar-accent hover:text-foreground"
					/>
				}
			>
				<HugeiconsIcon icon={pinned ? SidebarLeftIcon : PinIcon} className="size-4" />
			</TooltipTrigger>
			<TooltipContent side="right">
				{label}
				<Kbd>⌘B</Kbd>
			</TooltipContent>
		</Tooltip>
	);
}

function AccountMenu({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
	const { isMobile } = useSidebar();
	const label = account.displayName || account.email;
	const identity = (
		<>
			<Avatar>
				<AvatarFallback>{initials(label) || "?"}</AvatarFallback>
			</Avatar>
			<span className="grid min-w-0 flex-1 text-start leading-tight">
				<span className="truncate font-medium">{label}</span>
				{account.displayName ? (
					<span className="truncate text-caption text-muted-foreground">{account.email}</span>
				) : null}
			</span>
		</>
	);
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								size="lg"
								aria-label="Account"
								className="rounded-xl data-popup-open:bg-sidebar-accent group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-1!"
							/>
						}
					>
						{identity}
						<HugeiconsIcon icon={UnfoldMoreIcon} className="ms-auto text-muted-foreground" />
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-60"
						side={isMobile ? "top" : "right"}
						align="end"
						sideOffset={8}
					>
						<DropdownMenuGroup>
							<DropdownMenuLabel className="flex items-center gap-2 p-1.5 text-body font-normal text-foreground">
								{identity}
							</DropdownMenuLabel>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem render={<Link to="/settings" />}>
								<HugeiconsIcon icon={Settings01Icon} />
								Settings
							</DropdownMenuItem>
							<DropdownMenuItem onClick={onSignOut}>
								<HugeiconsIcon icon={Logout01Icon} />
								Sign out
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

function ConversationPane({
	name,
	panelOpen,
	onPanelOpenChange,
	messages,
	composer,
}: {
	name: string;
	panelOpen: boolean;
	onPanelOpenChange: (open: boolean) => void;
	messages?: React.ReactNode;
	composer: ComposerMode;
}) {
	return (
		<section
			aria-label={`Conversation with ${name}`}
			className="relative flex h-full min-w-0 flex-1 flex-col"
		>
			{/* Messages scroll the full height, under the floating header and composer. */}
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-52 pb-32 [scrollbar-gutter:stable]">
				<Conversation aria-label="Messages" className="mx-auto w-full max-w-2xl">
					{messages ??
						GREETINGS.map((text, index) => (
							<ConversationBubble
								key={text}
								className="message-in"
								style={{ "--enter-delay": `${GREETING_DELAYS_MS[index]}ms` } as React.CSSProperties}
							>
								<ConversationContent>{text}</ConversationContent>
							</ConversationBubble>
						))}
				</Conversation>
			</div>
			<ProgressiveBlur side="top" className="h-56" />
			<SidebarTrigger className="absolute start-3 top-3 z-10 md:hidden" />
			<header className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center px-4 pt-8 *:pointer-events-auto">
				<DittoStage className="bot-in size-24" />
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="secondary"
								size="sm"
								className="bot-name-in relative -mt-3.5 h-8 rounded-full px-4 text-body font-semibold aria-expanded:brightness-110"
								aria-expanded={panelOpen}
								aria-controls={PANEL_ID}
								onClick={() => onPanelOpenChange(!panelOpen)}
							/>
						}
					>
						{name}
					</TooltipTrigger>
					<TooltipContent side="bottom">
						{panelOpen ? "Hide computer" : "Show computer"}
					</TooltipContent>
				</Tooltip>
				<p className="bot-name-in mt-2 text-caption text-muted-foreground">Chief of Staff</p>
			</header>
			<Composer name={name} mode={composer} />
		</section>
	);
}

function Composer({ name, mode }: { name: string; mode: ComposerMode }) {
	const off = mode === "soon" || mode === "no-model";
	return (
		<form
			className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pt-10 pb-4"
			onSubmit={(event) => event.preventDefault()}
		>
			<ProgressiveBlur side="bottom" className="h-full" />
			<div className="pointer-events-auto relative mx-auto flex w-full max-w-2xl items-end gap-1 rounded-3xl bg-popover p-1.5 shadow-lg ring-1 ring-foreground/10 transition-shadow focus-within:ring-ring/60">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="rounded-full"
					aria-label="Attach"
					disabled={off}
				>
					<HugeiconsIcon icon={Add01Icon} />
				</Button>
				<textarea
					aria-label={`Message ${name}`}
					placeholder={COMPOSER_PLACEHOLDERS[mode](name)}
					rows={1}
					disabled={off}
					className="field-sizing-content max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
				/>
				<SendOrStop mode={mode} />
			</div>
		</form>
	);
}

const CONTROLS = [
	{ label: "Terminal", icon: ComputerTerminal01Icon },
	{ label: "Files", icon: Folder01Icon },
	{ label: "Changes", icon: GitCompareIcon },
];

/**
 * The bot panel: the computer's state and the bot's settings on the top row, then the screen
 * and its controls. The conversation already names the bot, and the screen says what it is.
 */
function ComputerPanel({
	name,
	computer,
	onOpenSettings,
}: {
	name: string;
	computer: Workspace["computer"];
	onOpenSettings?: () => void;
}) {
	const running = computer === "running";
	return (
		<div className="flex flex-col gap-4">
			<div className="flex min-h-8 items-center justify-between gap-3">
				<Badge variant="secondary">
					<span aria-hidden className="relative flex size-2">
						{running ? (
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-signal opacity-75 motion-reduce:animate-none" />
						) : null}
						<span
							className={`relative inline-flex size-2 rounded-full ${running ? "bg-signal" : "bg-muted-foreground/60"}`}
						/>
					</span>
					{running ? "Running" : "Stopped"}
				</Badge>
				{onOpenSettings && (
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon"
									aria-label={`${name}’s settings`}
									onClick={onOpenSettings}
									className="-me-1.5 text-muted-foreground hover:text-foreground"
								/>
							}
						>
							<HugeiconsIcon icon={Settings02Icon} />
						</TooltipTrigger>
						<TooltipContent side="bottom">Settings</TooltipContent>
					</Tooltip>
				)}
			</div>
			{/* The screen sits in a bezel, like the mark: a lit frame around a dark, sunken display. */}
			<div className="rounded-2xl bg-linear-to-b from-muted to-card p-1.5 ring-1 ring-foreground/10">
				<div className="grid aspect-video place-items-center overflow-hidden rounded-xl bg-sidebar bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] bg-size-[14px_14px] text-muted-foreground [box-shadow:var(--screen-inset)]">
					<div className="flex flex-col items-center gap-2 px-6 text-center">
						<span className="grid size-10 place-items-center rounded-full bg-card ring-1 ring-foreground/10">
							<HugeiconsIcon icon={ComputerIcon} className="size-5" />
						</span>
						<p className="text-caption text-pretty">
							{running ? "The computer is on." : "It’s off. It starts when a bot needs it."}
						</p>
					</div>
				</div>
			</div>
			<div className="grid grid-cols-3 gap-2">
				{CONTROLS.map(({ label, icon }) => (
					<Button key={label} variant="outline" className="h-auto flex-col gap-1.5 py-3" disabled>
						<HugeiconsIcon icon={icon} className="size-5" />
						<span className="text-caption">{label}</span>
					</Button>
				))}
			</div>
		</div>
	);
}

/** Shown while the workspace opens; a first visit also provisions it. */
export function WorkspacePending() {
	return (
		<div className="flex h-dvh bg-sidebar md:p-2" aria-busy="true">
			<span className="sr-only" role="status">
				Opening your workspace
			</span>
			<div className="hidden w-64 flex-col gap-2 p-2 md:flex">
				<div className="flex items-center gap-3 p-2">
					<Skeleton className="size-10 rounded-xl" />
					<div className="flex flex-1 flex-col gap-1.5">
						<Skeleton className="h-3.5 w-16" />
						<Skeleton className="h-3 w-24" />
					</div>
				</div>
			</div>
			<div className="flex flex-1 flex-col items-center gap-3 bg-background px-4 pt-8 md:rounded-xl">
				<Skeleton className="size-24 rounded-[30%]" />
				<Skeleton className="h-8 w-20 rounded-full" />
				<div className="mt-6 flex w-full max-w-2xl flex-col gap-1">
					<Skeleton className="h-10 w-2/5 rounded-2xl" />
					<Skeleton className="h-10 w-3/5 rounded-2xl" />
				</div>
			</div>
		</div>
	);
}

/** A failed open keeps the owner on the page with a way to try again. */
export function WorkspaceFailed({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
	return (
		<main className="grid min-h-dvh place-items-center px-4 py-10 sm:px-8">
			<div role="alert" className="flex max-w-sm flex-col items-start gap-4">
				<HugeiconsIcon icon={Alert02Icon} className="size-6 text-destructive" />
				<div className="flex flex-col gap-1.5">
					<h1>We couldn’t open your workspace</h1>
					<p className="text-muted-foreground">
						Something went wrong on our side. Try again in a moment.
					</p>
				</div>
				<Button loading={retrying} onClick={onRetry}>
					Try again
				</Button>
			</div>
		</main>
	);
}
