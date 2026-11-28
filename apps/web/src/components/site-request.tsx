// Prototype of the in-chat prompt the bot posts when the shared computer's filter blocks a site.
// Nothing here talks to the Workspace object yet: the choices only change local state.
import { Alert02Icon, MoreHorizontalIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import { Card, CardPanel } from "#/components/ui/card.tsx";
import { ConversationBubble, ConversationContent } from "#/components/ui/conversation.tsx";
import { Drawer, DrawerContent, DrawerTitle } from "#/components/ui/drawer.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";

export interface SiteSet {
	id: string;
	name: string;
	hosts: string[];
}

export const SITE_SETS: SiteSet[] = [
	{
		id: "reading",
		name: "Reading & news",
		hosts: [
			"news.ycombinator.com",
			"www.reddit.com",
			"old.reddit.com",
			"www.bbc.co.uk",
			"www.theguardian.com",
			"www.nytimes.com",
			"www.ft.com",
			"arstechnica.com",
			"www.theverge.com",
			"techcrunch.com",
			"en.wikipedia.org",
			"upload.wikimedia.org",
			"medium.com",
			"substack.com",
		],
	},
	{
		id: "google",
		name: "Google Workspace",
		hosts: [
			"accounts.google.com",
			"mail.google.com",
			"calendar.google.com",
			"docs.google.com",
			"drive.google.com",
			"ssl.gstatic.com",
			"www.gstatic.com",
			"fonts.gstatic.com",
			"lh3.googleusercontent.com",
		],
	},
	{
		id: "dev",
		name: "Developer docs",
		hosts: [
			"github.com",
			"api.github.com",
			"raw.githubusercontent.com",
			"developer.mozilla.org",
			"developers.cloudflare.com",
			"docs.python.org",
			"nodejs.org",
			"www.npmjs.com",
			"stackoverflow.com",
			"pypi.org",
			"docs.rs",
		],
	},
];

/** What a few everyday names mean as hosts. The real parse is the bot's; the owner confirms it. */
const KNOWN_NAMES: Record<string, { hosts: string[]; note?: string }> = {
	gmail: {
		hosts: ["mail.google.com", "accounts.google.com", "ssl.gstatic.com"],
		note: "Gmail also needs Google’s sign-in hosts, so they’re included.",
	},
	notion: { hosts: ["www.notion.so"] },
	slack: { hosts: ["app.slack.com", "slack.com"] },
	figma: { hosts: ["www.figma.com"] },
};

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface ParsedList {
	hosts: string[];
	notes: string[];
	unread: string[];
}

/** Turns what the owner typed into exact hosts, so nothing is applied without being shown first. */
export function parseSiteList(text: string): ParsedList {
	const hosts = new Set<string>();
	const notes: string[] = [];
	const unread: string[] = [];
	for (const raw of text.split(/[\s,;]+/)) {
		const entry = raw.trim().toLowerCase();
		if (!entry) continue;
		const known = Object.hasOwn(KNOWN_NAMES, entry) ? KNOWN_NAMES[entry] : undefined;
		if (known) {
			for (const host of known.hosts) hosts.add(host);
			if (known.note) notes.push(known.note);
			continue;
		}
		let host = entry;
		try {
			host = new URL(entry.includes("://") ? entry : `https://${entry}`).hostname;
		} catch {
			// Not a URL: keep it as typed and let the host check decide.
		}
		if (HOST.test(host)) hosts.add(host);
		else unread.push(raw.trim());
	}
	return { hosts: [...hosts], notes, unread };
}

type Choice = "set" | "list" | "all";
type Decision =
	| { kind: "site" }
	| { kind: "set"; set: SiteSet }
	| { kind: "list"; hosts: string[] }
	| { kind: "all" };

/*
 * Every variant of the card is one Step: a head, an optional body and an actions row.
 * The card pads 16px on every side and leaves 16px between slots; a body spaces its own
 * parts 12px apart. Wide, actions sit in a row with the primary first; narrow, they stack
 * full width in the same order. The card's height follows its step, so no variant leaves
 * space behind it.
 */

export function SiteRequest({
	host,
	task,
	initialChoice,
	initialDecision,
}: {
	host: string;
	task: string;
	initialChoice?: Choice;
	initialDecision?: Decision;
}) {
	const [choice, setChoice] = useState<Choice | null>(initialChoice ?? null);
	const [decision, setDecision] = useState<Decision | null>(initialDecision ?? null);
	const narrow = useIsMobile();

	const decide = (next: Decision) => {
		setDecision(next);
		setChoice(null);
	};
	const back = () => setChoice(null);
	const choiceStep = (inDrawer: boolean) =>
		choice && (
			<ChoiceStep
				choice={choice}
				host={host}
				narrow={narrow}
				inDrawer={inDrawer}
				onBack={back}
				onDecide={decide}
			/>
		);

	// On a phone the choice opens in a sheet, so the card itself stays on the request.
	const variant = decision ? "settled" : !narrow && choice ? choice : "waiting";

	return (
		<>
			<ConversationBubble>
				<ConversationContent>
					I need <span className="font-mono text-[0.8125rem]">{host}</span> to finish “{task}”. The
					internet is off for this computer.
				</ConversationContent>
			</ConversationBubble>
			{/* The prompt rides under the message as an attachment, so it reads as Ditto speaking. */}
			<ConversationBubble className="w-full max-w-md">
				<Card className="w-full">
					<CardPanel className="gap-0 py-0">
						<Morph id={variant}>
							{decision ? (
								<SettledStep host={host} decision={decision} onUndo={() => setDecision(null)} />
							) : variant === "waiting" ? (
								<WaitingStep
									host={host}
									narrow={narrow}
									onAllowSite={() => decide({ kind: "site" })}
									onChoose={setChoice}
								/>
							) : (
								choiceStep(false)
							)}
						</Morph>
					</CardPanel>
				</Card>
			</ConversationBubble>
			{narrow && (
				<Drawer open={!decision && choice !== null} onOpenChange={(open) => !open && back()}>
					<DrawerContent>{choiceStep(true)}</DrawerContent>
				</Drawer>
			)}
		</>
	);
}

/**
 * Animates the card's height between steps and blurs the new step in, so a change reads as the
 * same card settling rather than one card swapped for another.
 */
export function Morph({ id, children }: { id: string; children: React.ReactNode }) {
	const inner = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState<number>();
	useEffect(() => {
		const element = inner.current;
		if (!element) return;
		const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return (
		<div
			style={{ height }}
			className="overflow-hidden transition-[height] duration-250 ease-out-strong motion-reduce:transition-none"
		>
			<div ref={inner}>
				<div
					key={id}
					className="transition-[opacity,filter] duration-200 ease-out-strong starting:opacity-0 starting:blur-[2px] motion-reduce:starting:blur-none"
				>
					{children}
				</div>
			</div>
		</div>
	);
}

export function Step({
	head,
	children,
	actions,
	inDrawer = false,
}: {
	head: React.ReactNode;
	children?: React.ReactNode;
	actions: React.ReactNode;
	inDrawer?: boolean;
}) {
	return (
		<div className={cn("flex flex-col gap-4", !inDrawer && "p-4")}>
			{head}
			{children && <div className="flex flex-col gap-3">{children}</div>}
			{actions}
		</div>
	);
}

/** The blocked host and where the request stands: the head of every step before an answer. */
function RequestHead({ host }: { host: string }) {
	return (
		<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
			<span className="min-w-0 font-mono text-[0.8125rem] break-all">{host}</span>
			<span className="flex items-center gap-1.5 text-caption text-muted-foreground">
				<span aria-hidden className="size-1.5 rounded-full bg-signal" />
				Waiting for you
			</span>
		</div>
	);
}

export function Actions({ narrow, children }: { narrow: boolean; children: React.ReactNode }) {
	return (
		<div
			className={cn(
				"flex gap-2",
				narrow ? "flex-col *:data-[slot=button]:h-9" : "flex-wrap items-center",
			)}
		>
			{children}
		</div>
	);
}

function WaitingStep({
	host,
	narrow,
	onAllowSite,
	onChoose,
}: {
	host: string;
	narrow: boolean;
	onAllowSite: () => void;
	onChoose: (choice: Choice) => void;
}) {
	const more = (
		<DropdownMenuContent align="end" className="w-auto min-w-44">
			<DropdownMenuItem onClick={() => onChoose("list")}>Paste a list…</DropdownMenuItem>
			<DropdownMenuItem onClick={() => onChoose("all")}>Allow all sites…</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem>Not now</DropdownMenuItem>
		</DropdownMenuContent>
	);
	return (
		<Step
			head={<RequestHead host={host} />}
			actions={
				<Actions narrow={narrow}>
					<Button onClick={onAllowSite} aria-label={`Allow ${host}`}>
						Allow this site
					</Button>
					<Button variant="outline" onClick={() => onChoose("set")}>
						Choose a set
					</Button>
					<DropdownMenu>
						{narrow ? (
							<DropdownMenuTrigger render={<Button variant="ghost" />}>
								More options
							</DropdownMenuTrigger>
						) : (
							<DropdownMenuTrigger
								render={<Button variant="ghost" size="icon" className="ms-auto" />}
								aria-label="More options"
							>
								<HugeiconsIcon icon={MoreHorizontalIcon} />
							</DropdownMenuTrigger>
						)}
						{more}
					</DropdownMenu>
				</Actions>
			}
		/>
	);
}

const CHOICE_TITLES: Record<Choice, string> = {
	set: "Choose a set",
	list: "Paste a list",
	all: "Allow all sites",
};

/** One of the three deeper choices, in the card on a wide screen or in the sheet on a phone. */
function ChoiceStep({
	choice,
	host,
	narrow,
	inDrawer,
	onBack,
	onDecide,
}: {
	choice: Choice;
	host: string;
	narrow: boolean;
	inDrawer: boolean;
	onBack: () => void;
	onDecide: (decision: Decision) => void;
}) {
	const title = inDrawer ? (
		<DrawerTitle className="text-sm font-semibold">{CHOICE_TITLES[choice]}</DrawerTitle>
	) : (
		<h3 className="text-sm font-semibold">{CHOICE_TITLES[choice]}</h3>
	);
	const props = { host, narrow, inDrawer, title, onBack, onDecide };
	if (choice === "set") return <SetChoice {...props} />;
	if (choice === "list") return <ListChoice {...props} />;
	return <AllChoice {...props} />;
}

interface ChoiceProps {
	host: string;
	narrow: boolean;
	inDrawer: boolean;
	title: React.ReactNode;
	onBack: () => void;
	onDecide: (decision: Decision) => void;
}

/** The card keeps the request in view above the choice; the sheet has its own title instead. */
function ChoiceStepFrame({
	host,
	narrow,
	inDrawer,
	title,
	onBack,
	primary,
	children,
}: Omit<ChoiceProps, "onDecide"> & { primary: React.ReactNode; children: React.ReactNode }) {
	return (
		<Step
			inDrawer={inDrawer}
			head={inDrawer ? title : <RequestHead host={host} />}
			actions={
				<Actions narrow={narrow}>
					{primary}
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
				</Actions>
			}
		>
			{!inDrawer && title}
			{children}
		</Step>
	);
}

function SetChoice({ onDecide, ...frame }: ChoiceProps) {
	const { host } = frame;
	const [picked, setPicked] = useState<SiteSet | null>(
		SITE_SETS.find((set) => set.hosts.includes(host)) ?? null,
	);
	const [viewing, setViewing] = useState<string | null>(null);
	const total = picked ? picked.hosts.length + (picked.hosts.includes(host) ? 0 : 1) : 0;
	return (
		<ChoiceStepFrame
			{...frame}
			primary={
				<Button disabled={!picked} onClick={() => picked && onDecide({ kind: "set", set: picked })}>
					{picked ? `Allow ${total} sites` : "Allow"}
				</Button>
			}
		>
			<fieldset className="-mx-2 flex flex-col gap-1">
				<legend className="sr-only">Sets</legend>
				{SITE_SETS.map((set) => (
					<div key={set.id} className="flex flex-col rounded-lg has-checked:bg-muted">
						<div className="flex items-center gap-3 px-2 py-2">
							<label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
								<input
									type="radio"
									name="site-set"
									className="size-4 accent-(--color-signal)"
									checked={picked?.id === set.id}
									onChange={() => setPicked(set)}
								/>
								<span className="min-w-0 flex-1">{set.name}</span>
								<span className="text-caption text-muted-foreground tabular-nums">
									{set.hosts.length} sites
								</span>
							</label>
							<Button
								variant="link"
								size="xs"
								className="w-9 px-0"
								aria-expanded={viewing === set.id}
								onClick={() => setViewing(viewing === set.id ? null : set.id)}
							>
								{viewing === set.id ? "Hide" : "View"}
							</Button>
						</div>
						{viewing === set.id && (
							<p className="ps-9 pe-2 pb-2.5 font-mono text-[0.75rem] leading-relaxed text-muted-foreground">
								{set.hosts.join(" · ")}
							</p>
						)}
					</div>
				))}
			</fieldset>
			{picked && (
				<p className="flex items-start gap-1.5 text-caption text-muted-foreground">
					<HugeiconsIcon icon={Tick02Icon} className="mt-0.5 size-3.5 shrink-0 text-success" />
					<span>
						<span className="font-mono">{host}</span>{" "}
						{picked.hosts.includes(host)
							? `is in ${picked.name}.`
							: `isn’t in ${picked.name}, so it’s added too.`}
					</span>
				</p>
			)}
		</ChoiceStepFrame>
	);
}

function ListChoice({ onDecide, ...frame }: ChoiceProps) {
	const [text, setText] = useState("");
	const [removed, setRemoved] = useState<Set<string>>(new Set());
	const parsed = parseSiteList(text);
	const hosts = parsed.hosts.filter((host) => !removed.has(host));
	return (
		<ChoiceStepFrame
			{...frame}
			primary={
				<Button disabled={hosts.length === 0} onClick={() => onDecide({ kind: "list", hosts })}>
					{hosts.length > 0 ? `Allow ${hosts.length} sites` : "Allow"}
				</Button>
			}
		>
			<Textarea
				value={text}
				onChange={(event) => {
					const next = event.target.value;
					const stillTyped = new Set(parseSiteList(next).hosts);
					setText(next);
					setRemoved(new Set([...removed].filter((host) => stillTyped.has(host))));
				}}
				placeholder="gmail, notion, https://linear.app/team"
				aria-label="Sites to allow"
				autoCapitalize="none"
				autoCorrect="off"
				spellCheck={false}
				enterKeyHint="done"
				className="min-h-20 font-mono"
			/>
			{text.trim() && (
				<div className="flex flex-col gap-2">
					<p className="text-caption text-muted-foreground">Ditto read this as</p>
					{hosts.length > 0 ? (
						<ul className="flex flex-wrap gap-1.5">
							{hosts.map((host) => (
								<li key={host}>
									<button
										type="button"
										onClick={() => setRemoved(new Set(removed).add(host))}
										aria-label={`Remove ${host}`}
										className={cn(CHIP, "gap-1.5 pe-2 touch-manipulation select-none", CHIP_PRESS)}
									>
										{host}
										<span aria-hidden className="text-muted-foreground">
											×
										</span>
									</button>
								</li>
							))}
						</ul>
					) : (
						<p className="text-caption">No sites yet.</p>
					)}
					{parsed.notes.map((note) => (
						<p key={note} className="flex gap-1.5 text-caption text-muted-foreground">
							<HugeiconsIcon icon={Alert02Icon} className="mt-0.5 size-3.5 shrink-0" />
							{note}
						</p>
					))}
					{parsed.unread.length > 0 && (
						<p className="text-caption text-destructive">
							Couldn’t read: {parsed.unread.join(", ")}
						</p>
					)}
				</div>
			)}
		</ChoiceStepFrame>
	);
}

function AllChoice({ onDecide, ...frame }: ChoiceProps) {
	return (
		<ChoiceStepFrame
			{...frame}
			primary={
				<Button variant="destructive" onClick={() => onDecide({ kind: "all" })}>
					Allow all sites
				</Button>
			}
		>
			<p className="text-pretty text-muted-foreground">
				Ditto’s computer could open any site. Your saved logins stay on, so any page it opens can
				act as you on those accounts. You can go back to a list at any time.
			</p>
		</ChoiceStepFrame>
	);
}

const CHIP =
	"inline-flex h-6 items-center rounded-full bg-muted px-2.5 font-mono text-[0.75rem] leading-none";
const CHIP_PRESS =
	"transition-[scale,background-color] duration-150 ease-out active:scale-[0.96] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent";

function allowedHosts(host: string, decision: Decision): string[] {
	if (decision.kind === "site") return [host];
	if (decision.kind === "list") return decision.hosts;
	if (decision.kind === "set")
		return decision.set.hosts.includes(host) ? decision.set.hosts : [host, ...decision.set.hosts];
	return [];
}

/** What the owner allowed and the way back, in the card that asked. */
function SettledStep({
	host,
	decision,
	onUndo,
}: {
	host: string;
	decision: Decision;
	onUndo: () => void;
}) {
	const [showAll, setShowAll] = useState(false);
	const hosts = allowedHosts(host, decision);
	const shown = showAll ? hosts : hosts.slice(0, 3);
	const all = decision.kind === "all";
	const title =
		decision.kind === "site"
			? host
			: decision.kind === "set"
				? decision.set.name
				: decision.kind === "list"
					? "Your list"
					: "Every site";
	const detail = all
		? "Saved logins work everywhere"
		: hosts.length === 1
			? "1 site"
			: `${hosts.length} sites`;
	return (
		<Step
			head={
				<div className="flex items-start gap-3">
					<span
						aria-hidden
						className={cn(
							"grid size-8 shrink-0 place-items-center rounded-full",
							all ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success",
						)}
					>
						<HugeiconsIcon icon={all ? Alert02Icon : Tick02Icon} className="size-4" />
					</span>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<p className="font-medium text-balance">
							<span
								className={cn(decision.kind === "site" && "font-mono text-[0.8125rem] break-all")}
							>
								{title}
							</span>{" "}
							allowed
						</p>
						<p className="text-caption text-pretty text-muted-foreground">
							{detail} · Ditto is carrying on
						</p>
					</div>
					<Button variant="outline" size="sm" onClick={onUndo}>
						Undo
					</Button>
				</div>
			}
			actions={
				// Hangs off the title's edge: the 32px icon plus the 12px gap.
				<div className="ps-11">
					<Button variant="link" size="xs" className="h-auto px-0">
						Manage sites
					</Button>
				</div>
			}
		>
			{hosts.length > 1 && (
				<ul className="flex flex-wrap gap-1.5 ps-11" aria-label="Allowed sites">
					{shown.map((name) => (
						<li key={name} className={cn(CHIP, "gap-1 text-muted-foreground")}>
							{name === host && (
								<HugeiconsIcon icon={Tick02Icon} className="-ms-0.5 size-3 text-success" />
							)}
							<span className={cn(name === host && "text-foreground")}>{name}</span>
						</li>
					))}
					{hosts.length > shown.length && (
						<li>
							<button
								type="button"
								onClick={() => setShowAll(true)}
								className={cn(
									CHIP,
									"bg-transparent font-sans text-link ring-1 ring-panel-border touch-manipulation select-none",
									CHIP_PRESS,
								)}
							>
								+{hosts.length - shown.length} more
							</button>
						</li>
					)}
				</ul>
			)}
		</Step>
	);
}
