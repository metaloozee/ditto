// Prototype of model access (#18): the Settings section, the pair select, bot settings and the
// interruption card. Nothing here talks to the Credentials or Bot objects yet: the choices only
// change the state their callers hold.

import { Popover } from "@base-ui/react/popover";
import {
	Add01Icon,
	Alert02Icon,
	Cancel01Icon,
	ArrowUp02Icon,
	ChatGptIcon,
	Search01Icon,
	SparklesIcon,
	StopIcon,
	Tick02Icon,
	UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { Ring } from "loading-dev";
import { useId, useRef, useState } from "react";

import { shake } from "#/components/auth.tsx";
import { BrandIcon } from "#/components/brand-icons.tsx";
import { Actions, Morph, Step } from "#/components/site-request.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/components/ui/button.tsx";
import { Card, CardPanel } from "#/components/ui/card.tsx";
import { ConversationBubble, ConversationContent } from "#/components/ui/conversation.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "#/components/ui/dialog.tsx";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "#/components/ui/drawer.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group.tsx";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import {
	type Connection,
	type ConnectionProvider,
	type Interruption,
	interruptionActions,
	type ModelAccess,
	type Pair,
	pairGroups,
	pairLabel,
	pairSource,
	PROVIDER_NAMES,
	stateView,
} from "#/lib/model-access.ts";

/* ------------------------------------------------------------------------------------------ */
/* State badge                                                                                 */

/** A connection's state as a label with a mark, so colour never carries the meaning alone. */
export function StateBadge({ connection }: { connection: Connection }) {
	const view = stateView(connection);
	if (view.tone === "destructive") {
		return (
			<Badge variant="destructive">
				<HugeiconsIcon icon={Alert02Icon} data-icon="inline-start" />
				{view.label}
			</Badge>
		);
	}
	return (
		<Badge variant="secondary">
			{view.tone === "busy" ? (
				<Ring size={10} color="currentColor" className="-ms-0.5 text-muted-foreground" />
			) : (
				<span
					aria-hidden
					className={cn(
						"size-1.5 rounded-full",
						view.tone === "success" ? "bg-success" : "bg-muted-foreground/60",
					)}
				/>
			)}
			{view.label}
		</Badge>
	);
}

/* ------------------------------------------------------------------------------------------ */
/* Pair select                                                                                 */

const pairKey = (pair: Pair) => `${pair.connectionId}/${pair.model}`;

/** A connection's mark: its brand where Simple Icons has one, HugeIcons' otherwise. */
function ConnectionMark({
	provider,
	className,
}: {
	provider?: ConnectionProvider;
	className?: string;
}) {
	if (provider === "opencode")
		return <BrandIcon brand="opencode" className={cn("size-4", className)} />;
	return (
		<HugeiconsIcon
			icon={provider === "chatgpt" ? ChatGptIcon : SparklesIcon}
			className={cn("size-4", className)}
		/>
	);
}

/**
 * Picks a connection and its model as one pair. A rail of connection marks sits beside a
 * searchable list of the chosen connection's models. A connection that can't be used stays on
 * the rail, dimmed and dotted, and says why instead of listing models. Search reaches every
 * usable connection at once.
 *
 * The popup sits on the trigger's own sunken surface and scales in from it (`pop-motion`). Its 14px corners hold the
 * rail's and the list's 10px rows at a 4px inset, so the radii stay concentric.
 */
export function PairSelect({
	access,
	value,
	onValueChange,
	defaultOpen,
	className,
	...labelling
}: {
	access: ModelAccess;
	value: Pair | undefined;
	onValueChange: (pair: Pair) => void;
	defaultOpen?: boolean;
	className?: string;
	id?: string;
	"aria-label"?: string;
	"aria-labelledby"?: string;
}) {
	const [open, setOpen] = useState(defaultOpen ?? false);
	const connectionOf = (key: string) => access.connections.find((each) => each.id === key);
	const current = value ? connectionOf(value.connectionId) : undefined;
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger
				{...labelling}
				className={cn(
					"flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg field ps-2.5 pe-2 text-start text-sm transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:border-ring/60",
					className,
				)}
			>
				{value ? (
					<>
						<ConnectionMark provider={current?.provider} className="text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate">{pairLabel(access, value)}</span>
					</>
				) : (
					<span className="flex-1 text-muted-foreground">Choose a model</span>
				)}
				<HugeiconsIcon icon={UnfoldMoreIcon} className="size-4 shrink-0 text-muted-foreground" />
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner
					side="bottom"
					align="start"
					sideOffset={6}
					collisionPadding={16}
					className="z-50"
				>
					<Popover.Popup
						aria-label="Models"
						className="pop-motion flex w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-(--field) text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none"
					>
						<PairPicker
							access={access}
							value={value}
							connectionOf={connectionOf}
							onPick={(pair) => {
								onValueChange(pair);
								setOpen(false);
							}}
						/>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function PairPicker({
	access,
	value,
	connectionOf,
	onPick,
}: {
	access: ModelAccess;
	value: Pair | undefined;
	connectionOf: (key: string) => Connection | undefined;
	onPick: (pair: Pair) => void;
}) {
	const id = useId();
	const groups = pairGroups(access);
	const [tab, setTab] = useState(
		value?.connectionId ?? groups.find((group) => !group.disabled)?.key ?? groups[0]?.key,
	);
	const [query, setQuery] = useState("");
	const searching = query.trim().length > 0;
	const group = groups.find((each) => each.key === tab) ?? groups[0];
	const options = searching
		? groups
				.filter((each) => !each.disabled)
				.flatMap((each) =>
					each.pairs.filter((pair) =>
						pair.model.toLowerCase().includes(query.trim().toLowerCase()),
					),
				)
		: group && !group.disabled
			? group.pairs
			: [];
	const [active, setActive] = useState(() =>
		Math.max(
			0,
			options.findIndex((pair) => pairKey(pair) === (value && pairKey(value))),
		),
	);
	const at = Math.min(active, options.length - 1);
	const optionId = (index: number) => `${id}-option-${index}`;
	const connection = group ? connectionOf(group.key) : undefined;

	return (
		<>
			{/* The rail: one mark per connection, the included model last. */}
			<div
				role="tablist"
				aria-orientation="vertical"
				aria-label="Connections"
				className="flex shrink-0 flex-col gap-1 border-e border-border p-1"
				onKeyDown={(event) => {
					if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
					event.preventDefault();
					const index = groups.findIndex((each) => each.key === tab);
					const next =
						groups[(index + (event.key === "ArrowDown" ? 1 : -1) + groups.length) % groups.length];
					if (!next) return;
					setTab(next.key);
					setActive(0);
					document.getElementById(`${id}-tab-${next.key}`)?.focus();
				}}
			>
				{groups.map((each) => {
					const selected = !searching && each.key === group?.key;
					const mark = connectionOf(each.key);
					return (
						<button
							key={each.key}
							id={`${id}-tab-${each.key}`}
							type="button"
							role="tab"
							aria-selected={selected}
							aria-controls={`${id}-panel`}
							aria-label={each.status ? `${each.label}, ${each.status}` : each.label}
							tabIndex={selected || (searching && each.key === groups[0]?.key) ? 0 : -1}
							onClick={() => {
								setTab(each.key);
								setQuery("");
								setActive(0);
							}}
							className={cn(
								"relative grid size-10 cursor-pointer touch-manipulation place-items-center rounded-lg text-muted-foreground transition-[background-color,color,scale] duration-150 ease-out outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/60 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
								selected && "bg-muted text-foreground",
							)}
						>
							<ConnectionMark
								provider={mark?.provider}
								className={cn(each.disabled && "opacity-45")}
							/>
							{each.disabled && (
								<span
									aria-hidden
									className={cn(
										"absolute end-1.5 top-1.5 size-2 rounded-full ring-2 ring-(--field)",
										mark?.state === "ReconnectNeeded" ? "bg-destructive" : "bg-muted-foreground",
									)}
								/>
							)}
							{/* The chosen connection's edge, like a tab's underline turned on its side. */}
							<span
								aria-hidden
								className={cn(
									"absolute -end-1 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-foreground transition-[opacity,scale] duration-200 ease-out-strong",
									selected ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0",
								)}
							/>
						</button>
					);
				})}
			</div>
			<div
				id={`${id}-panel`}
				role="tabpanel"
				aria-labelledby={group ? `${id}-tab-${group.key}` : undefined}
				className="flex min-w-0 flex-1 flex-col"
			>
				<label className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 text-muted-foreground focus-within:text-foreground">
					<HugeiconsIcon icon={Search01Icon} className="size-4 shrink-0" />
					<input
						autoFocus
						type="search"
						role="combobox"
						aria-expanded
						aria-controls={`${id}-list`}
						aria-activedescendant={options.length > 0 ? optionId(at) : undefined}
						aria-label="Search models"
						placeholder="Search models…"
						autoComplete="off"
						autoCorrect="off"
						spellCheck={false}
						enterKeyHint="go"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActive(0);
						}}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown" || event.key === "ArrowUp") {
								event.preventDefault();
								if (options.length === 0) return;
								const step = event.key === "ArrowDown" ? 1 : -1;
								setActive((at + step + options.length) % options.length);
							} else if (event.key === "Enter") {
								event.preventDefault();
								const pair = options[at];
								if (pair) onPick(pair);
							}
						}}
						className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm [&::-webkit-search-cancel-button]:hidden"
					/>
				</label>
				<div
					id={`${id}-list`}
					role="listbox"
					aria-label={searching ? "Matching models" : `${group?.label ?? ""} models`}
					className="flex max-h-64 min-h-36 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1"
				>
					{options.map((pair, index) => {
						const chosen = value !== undefined && pairKey(pair) === pairKey(value);
						return (
							<div
								key={pairKey(pair)}
								id={optionId(index)}
								role="option"
								aria-selected={chosen}
								data-active={index === at || undefined}
								onPointerMove={() => setActive(index)}
								onClick={() => onPick(pair)}
								className="flex h-9 shrink-0 cursor-pointer touch-manipulation items-center gap-2 rounded-lg px-2.5 select-none data-active:bg-muted"
							>
								<span className="min-w-0 flex-1 truncate">{pair.model}</span>
								{searching && (
									<span className="truncate text-caption text-muted-foreground">
										{pairSource(access, pair)}
									</span>
								)}
								<HugeiconsIcon
									icon={Tick02Icon}
									aria-hidden
									className={cn("size-4 shrink-0", chosen ? "opacity-100" : "opacity-0")}
								/>
							</div>
						);
					})}
					{options.length === 0 && (
						<div className="flex flex-1 flex-col items-start justify-center gap-1 px-2.5 py-3">
							{searching ? (
								<p className="text-muted-foreground">No models match “{query.trim()}”.</p>
							) : connection ? (
								<>
									<p className="font-medium">{group?.status}</p>
									<p className="text-caption text-pretty text-muted-foreground">
										{stateView(connection).detail}
									</p>
									<Link
										to="/settings"
										className={cn(buttonVariants({ variant: "link", size: "xs" }), "h-auto px-0")}
									>
										Open Model access
									</Link>
								</>
							) : null}
						</div>
					)}
				</div>
				{!searching && group && (
					<div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-caption text-muted-foreground">
						<span className="min-w-0 truncate">{group.label}</span>
						{connection && (
							<>
								<span aria-hidden>·</span>
								<span className="truncate">{stateView(connection).label}</span>
							</>
						)}
						{!connection && (
							<>
								<span aria-hidden>·</span>
								<span className="truncate">Provided by this deployment</span>
							</>
						)}
					</div>
				)}
			</div>
		</>
	);
}

/* ------------------------------------------------------------------------------------------ */
/* Dialog on desktop, drawer on phones                                                         */

/**
 * A short task over the page: a centred dialog where there's room, the bottom drawer on a
 * phone, where a thumb can reach it. Actions stack full width on the phone, primary first.
 */
export function TaskSheet({
	open,
	onOpenChange,
	title,
	description,
	children,
	actions,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: React.ReactNode;
	children?: React.ReactNode;
	actions?: React.ReactNode;
}) {
	const narrow = useIsMobile();
	if (narrow) {
		return (
			<Drawer open={open} onOpenChange={onOpenChange}>
				<DrawerContent>
					<div className="flex flex-col gap-1">
						<DrawerTitle className="text-heading font-semibold">{title}</DrawerTitle>
						{description && <p className="text-pretty text-muted-foreground">{description}</p>}
					</div>
					{children && <div className="mt-5">{children}</div>}
					{actions && (
						<div className="mt-6 flex flex-col gap-2 *:data-[slot=button]:h-10">{actions}</div>
					)}
				</DrawerContent>
			</Drawer>
		);
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-0 p-5 sm:max-w-md">
				<div className="flex flex-col gap-1 pe-8">
					<DialogTitle className="text-heading leading-snug font-semibold">{title}</DialogTitle>
					{description && (
						<DialogDescription className="text-pretty">{description}</DialogDescription>
					)}
				</div>
				{children && <div className="mt-5">{children}</div>}
				{actions && <div className="mt-6 flex flex-wrap items-center gap-2">{actions}</div>}
			</DialogContent>
		</Dialog>
	);
}

/* ------------------------------------------------------------------------------------------ */
/* Settings: model access                                                                      */

function ProviderTile({ provider }: { provider: ConnectionProvider | "add" }) {
	return (
		<span
			aria-hidden
			className={cn(
				"grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground",
				provider === "add"
					? "border border-dashed border-panel-border"
					: "border border-panel-border bg-card",
			)}
		>
			{provider === "add" ? (
				<HugeiconsIcon icon={Add01Icon} />
			) : (
				<ConnectionMark provider={provider} />
			)}
		</span>
	);
}

/** One row of the connections card: who, what it says, then its state and one action. */
function Row({
	provider,
	title,
	detail,
	trailing,
	muted,
}: {
	provider: ConnectionProvider | "add";
	title: React.ReactNode;
	detail?: React.ReactNode;
	trailing?: React.ReactNode;
	muted?: boolean;
}) {
	return (
		<CardPanel className="flex-row flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
			<ProviderTile provider={provider} />
			<div className="flex min-w-0 flex-1 basis-40 flex-col">
				<span className={cn("font-medium", muted && "text-muted-foreground")}>{title}</span>
				{detail && <span className="text-caption text-pretty text-muted-foreground">{detail}</span>}
			</div>
			{/* On a phone the state and action wrap under the name, lined up with it. */}
			{trailing && (
				<div className="ms-11 flex items-center gap-2 sm:ms-auto max-sm:w-full max-sm:justify-between">
					{trailing}
				</div>
			)}
		</CardPanel>
	);
}

function ConnectionRow({
	connection,
	onDisconnect,
	onCheck,
	onReconnect,
}: {
	connection: Connection;
	onDisconnect: () => void;
	onCheck: () => Promise<void> | void;
	onReconnect: () => void;
}) {
	const view = stateView(connection);
	const [checking, setChecking] = useState(false);
	const name = PROVIDER_NAMES[connection.provider];
	const title = connection.provider === "opencode" ? "OpenCode API key" : name;
	const action = view.action;
	return (
		<Row
			provider={connection.provider}
			title={title}
			detail={view.detail ?? connection.models.join(", ")}
			trailing={
				<>
					<StateBadge connection={connection} />
					{action && (
						<Button
							size="sm"
							variant={action.primary ? "default" : "outline"}
							loading={checking}
							onClick={async () => {
								if (action.kind === "disconnect") return onDisconnect();
								if (action.kind === "reconnect") return onReconnect();
								setChecking(true);
								try {
									await onCheck();
								} finally {
									setChecking(false);
								}
							}}
						>
							{action.label}
							<span className="sr-only"> {name}</span>
						</Button>
					)}
				</>
			}
		/>
	);
}

export interface ModelAccessSectionProps {
	access: ModelAccess;
	/** Whether this deployment offers Sign in with ChatGPT. */
	chatgptOffered: boolean;
	/** The models an OpenCode key can use, offered when connecting one. */
	opencodeModels: readonly string[];
	defaultPair: Pair | undefined;
	onDefaultPairChange: (pair: Pair) => void;
	onConnectKey: (key: string, model: string) => Promise<void> | void;
	onConnectChatGPT: () => void;
	onDisconnect: (connectionId: string) => void;
	onCheck: (connectionId: string) => Promise<void> | void;
	onReconnect: (connectionId: string) => void;
	/** For `/design`: open with the key form or the disconnect confirmation showing. */
	initialConnecting?: boolean;
	initialDisconnecting?: string;
	pairSelectOpen?: boolean;
}

/** Settings' model access: the included model, the default pair and one row per connection. */
export function ModelAccessSection({
	access,
	chatgptOffered,
	opencodeModels,
	defaultPair,
	onDefaultPairChange,
	onConnectKey,
	onConnectChatGPT,
	onDisconnect,
	onCheck,
	onReconnect,
	initialConnecting = false,
	initialDisconnecting,
	pairSelectOpen,
}: ModelAccessSectionProps) {
	const [connecting, setConnecting] = useState(initialConnecting);
	const [disconnecting, setDisconnecting] = useState<string | undefined>(initialDisconnecting);
	const labelId = useId();
	const opencode = access.connections.find((each) => each.provider === "opencode");
	const chatgpt = access.connections.find((each) => each.provider === "chatgpt");
	const pickable = pairGroups(access).length > 0;
	const leaving = access.connections.find((each) => each.id === disconnecting);
	const rowProps = (connection: Connection) => ({
		connection,
		onDisconnect: () => setDisconnecting(connection.id),
		onCheck: () => onCheck(connection.id),
		onReconnect: () => onReconnect(connection.id),
	});

	return (
		<section className="flex flex-col gap-4" aria-labelledby={`${labelId}-heading`}>
			<div className="flex flex-col gap-1">
				<h2 id={`${labelId}-heading`}>Model access</h2>
				<p className="text-pretty text-muted-foreground">
					Your bots think with these. Connecting one never changes how you sign in.
				</p>
			</div>
			{access.included && (
				<p className="flex items-start gap-2 text-caption text-muted-foreground">
					<HugeiconsIcon icon={SparklesIcon} className="mt-px size-3.5 shrink-0" />
					<span>
						Included model: <span className="text-foreground">{access.included}</span>, provided by
						this deployment
					</span>
				</p>
			)}
			{pickable && (
				<Card>
					<CardPanel className="grid gap-x-6 gap-y-2 px-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
						<Label id={labelId} className="text-muted-foreground">
							Default model
						</Label>
						<PairSelect
							access={access}
							value={defaultPair}
							onValueChange={onDefaultPairChange}
							aria-labelledby={labelId}
							defaultOpen={pairSelectOpen}
						/>
					</CardPanel>
				</Card>
			)}
			<Card>
				{opencode && <ConnectionRow {...rowProps(opencode)} />}
				{chatgpt ? (
					<ConnectionRow {...rowProps(chatgpt)} />
				) : chatgptOffered ? (
					<Row
						provider="chatgpt"
						title="ChatGPT plan"
						detail="Use your ChatGPT subscription’s allowance."
						trailing={
							<Button
								size="sm"
								variant="outline"
								className="max-sm:ms-auto"
								onClick={onConnectChatGPT}
							>
								Connect<span className="sr-only"> ChatGPT plan</span>
							</Button>
						}
					/>
				) : (
					<Row
						provider="chatgpt"
						title="ChatGPT plan"
						muted
						detail="Not offered on this deployment."
					/>
				)}
				{!opencode && (
					<ConnectKeyPanel
						open={connecting}
						onOpenChange={setConnecting}
						models={opencodeModels}
						onConnect={async (key, model) => {
							await onConnectKey(key, model);
							setConnecting(false);
						}}
					/>
				)}
			</Card>
			<TaskSheet
				open={leaving !== undefined}
				onOpenChange={(open) => !open && setDisconnecting(undefined)}
				title={leaving ? `Disconnect ${PROVIDER_NAMES[leaving.provider]}?` : ""}
				description="Ditto forgets this connection. Bots that use it stop at their next turn until you choose another model. You still sign in to Ditto the same way."
				actions={
					<>
						<Button
							variant="destructive"
							onClick={() => {
								if (leaving) onDisconnect(leaving.id);
								setDisconnecting(undefined);
							}}
						>
							Disconnect
						</Button>
						<Button variant="ghost" onClick={() => setDisconnecting(undefined)}>
							Cancel
						</Button>
					</>
				}
			/>
		</section>
	);
}

/** The last row opens into the key form in place, so the owner never leaves the list. */
function ConnectKeyPanel({
	open,
	onOpenChange,
	models,
	onConnect,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	models: readonly string[];
	onConnect: (key: string, model: string) => Promise<void>;
}) {
	return (
		<CardPanel className="gap-0 py-0">
			<Morph id={open ? "form" : "row"}>
				{open ? (
					<ConnectKeyForm
						models={models}
						onCancel={() => onOpenChange(false)}
						onConnect={onConnect}
					/>
				) : (
					<button
						type="button"
						onClick={() => onOpenChange(true)}
						className="flex w-full cursor-pointer touch-manipulation items-center gap-3 px-4 py-3 text-start transition-[background-color] duration-150 ease-out outline-none select-none focus-visible:bg-accent [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent"
					>
						<ProviderTile provider="add" />
						<span className="font-medium">Connect an OpenCode API key</span>
					</button>
				)}
			</Morph>
		</CardPanel>
	);
}

function ConnectKeyForm({
	models,
	onCancel,
	onConnect,
}: {
	models: readonly string[];
	onCancel: () => void;
	onConnect: (key: string, model: string) => Promise<void>;
}) {
	const id = useId();
	const field = useRef<HTMLInputElement>(null);
	const [key, setKey] = useState("");
	const [model, setModel] = useState(models[0] ?? "");
	const [attempted, setAttempted] = useState(false);
	const [pending, setPending] = useState(false);
	const error = attempted && !key.trim() ? "Paste your OpenCode API key." : undefined;
	return (
		<form
			noValidate
			className="flex flex-col gap-4 p-4"
			onSubmit={async (event) => {
				event.preventDefault();
				setAttempted(true);
				if (!key.trim()) {
					if (field.current) {
						shake(field.current);
						field.current.focus();
					}
					return;
				}
				setPending(true);
				try {
					await onConnect(key.trim(), model);
				} finally {
					setPending(false);
				}
			}}
		>
			<h3 className="font-semibold">Connect an OpenCode API key</h3>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${id}-key`}>API key</Label>
				<Input
					ref={field}
					id={`${id}-key`}
					name="key"
					type="password"
					autoComplete="off"
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					enterKeyHint="done"
					className="font-mono"
					value={key}
					onChange={(event) => setKey(event.target.value)}
					aria-invalid={error ? true : undefined}
					aria-describedby={`${id}-key-note`}
				/>
				<p
					id={`${id}-key-note`}
					className={cn(
						"text-caption text-pretty",
						error ? "text-destructive" : "text-muted-foreground",
					)}
				>
					{error ?? "Ditto keeps it encrypted. It never appears in a conversation."}
				</p>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label id={`${id}-model`}>Model</Label>
				<Select value={model} onValueChange={(next) => typeof next === "string" && setModel(next)}>
					<SelectTrigger className="w-full" aria-labelledby={`${id}-model`}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent
						alignItemWithTrigger={false}
						align="start"
						className="duration-200 ease-out-strong data-closed:duration-150"
					>
						<SelectGroup>
							{models.map((each) => (
								<SelectItem key={each} value={each} className="h-8">
									{each}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</div>
			<FormActions>
				<Button type="submit" loading={pending}>
					Connect
				</Button>
				<Button type="button" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
			</FormActions>
		</form>
	);
}

function FormActions({ children }: { children: React.ReactNode }) {
	return <Actions narrow={useIsMobile()}>{children}</Actions>;
}

/* ------------------------------------------------------------------------------------------ */
/* Bot settings                                                                                */

/**
 * A bot's own settings, opened from the gear in its bot panel. A floating sheet from the inline
 * end on wider screens, over a dimmed workspace that it never moves; the bottom drawer
 * on phones. Each setting is its own section in a body that scrolls, so the sheet has room to
 * grow. For now one section: the model, either the owner's default or a pair chosen for this
 * bot. Changes apply from the next turn, so there's no Save.
 */
export function BotSettings({
	name,
	role,
	face,
	access,
	defaultPair,
	override,
	onOverrideChange,
	open,
	onOpenChange,
}: {
	name: string;
	role: string;
	/** The bot's mark, shown with its name at the top of the sheet. */
	face: React.ReactNode;
	access: ModelAccess;
	defaultPair: Pair | undefined;
	override: Pair | undefined;
	onOverrideChange: (pair: Pair | undefined) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const narrow = useIsMobile();
	const header = (
		<div className="flex items-center gap-3">
			<span className="size-10 shrink-0 *:size-full!">{face}</span>
			<div className="flex min-w-0 flex-1 flex-col">
				<DrawerTitle className="truncate font-semibold">{`${name}’s settings`}</DrawerTitle>
				<span className="truncate text-caption text-muted-foreground">{role}</span>
			</div>
			{!narrow && (
				<DrawerClose
					render={<Button variant="ghost" size="icon" className="-me-1 text-muted-foreground" />}
					aria-label="Close"
				>
					<HugeiconsIcon icon={Cancel01Icon} />
				</DrawerClose>
			)}
		</div>
	);
	const body = (
		<ModelSetting
			name={name}
			access={access}
			defaultPair={defaultPair}
			override={override}
			onOverrideChange={onOverrideChange}
		/>
	);
	return (
		<Drawer open={open} onOpenChange={onOpenChange} swipeDirection={narrow ? "down" : "right"}>
			{narrow ? (
				<DrawerContent>
					{header}
					<div className="mt-5">{body}</div>
				</DrawerContent>
			) : (
				<DrawerContent side="end">
					<div className="shrink-0 border-b border-border p-4">{header}</div>
					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{body}</div>
				</DrawerContent>
			)}
		</Drawer>
	);
}

function ModelSetting({
	name,
	access,
	defaultPair,
	override,
	onOverrideChange,
}: {
	name: string;
	access: ModelAccess;
	defaultPair: Pair | undefined;
	override: Pair | undefined;
	onOverrideChange: (pair: Pair | undefined) => void;
}) {
	const id = useId();
	const [choosing, setChoosing] = useState(override !== undefined);
	const firstPickable = pairGroups(access).find((group) => !group.disabled)?.pairs[0];
	const choose = (next: boolean) => {
		if (next === choosing) return;
		setChoosing(next);
		onOverrideChange(next ? (override ?? defaultPair ?? firstPickable) : undefined);
	};
	return (
		<fieldset className="flex flex-col gap-3">
			<legend className="mb-1 flex w-full flex-col gap-0.5">
				<span className="font-semibold">Model</span>
				<span className="text-caption text-pretty text-muted-foreground">
					Changes apply from {name}’s next turn. A turn already running finishes on its model.
				</span>
			</legend>
			<RadioGroup
				value={choosing ? "choose" : "default"}
				onValueChange={(value) => choose(value === "choose")}
				className="-mx-2.5 w-auto gap-1"
			>
				<Choice
					id={`${id}-default`}
					value="default"
					label="Use the default"
					detail={defaultPair ? pairLabel(access, defaultPair) : "No default yet"}
					onSelect={() => choose(false)}
				/>
				<Choice
					id={`${id}-choose`}
					value="choose"
					label="Choose for this bot"
					detail={choosing ? undefined : "Pick a model only this bot uses."}
					control={
						choosing && (
							<PairSelect
								access={access}
								value={override}
								onValueChange={onOverrideChange}
								aria-label={`${name}’s model`}
							/>
						)
					}
					onSelect={() => choose(true)}
				/>
			</RadioGroup>
		</fieldset>
	);
}

/**
 * A radio with its label, a line under it and, optionally, a control of its own (the pair
 * select). The whole row takes the pointer and the tap; a press on the control stays with it.
 */
function Choice({
	id,
	value,
	label,
	detail,
	control,
	onSelect,
}: {
	id: string;
	value: string;
	label: string;
	detail?: React.ReactNode;
	control?: React.ReactNode;
	onSelect: () => void;
}) {
	return (
		<div
			onClick={(event) => {
				if (!(event.target as Element).closest("[data-choice-control]")) onSelect();
			}}
			className="flex cursor-pointer touch-manipulation gap-3 rounded-lg p-2.5 transition-[background-color] duration-150 ease-out select-none has-data-checked:bg-muted [@media(hover:hover)_and_(pointer:fine)]:not-has-data-checked:hover:bg-foreground/4"
		>
			<RadioGroupItem id={id} value={value} aria-labelledby={`${id}-label`} className="mt-0.5" />
			<div className="flex min-w-0 flex-1 flex-col">
				<span id={`${id}-label`} className="font-medium">
					{label}
				</span>
				{detail && <span className="text-caption text-muted-foreground">{detail}</span>}
				{control && (
					<div data-choice-control className="mt-1.5 cursor-auto">
						{control}
					</div>
				)}
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------------------------------ */
/* Conversation                                                                                */

/** An owner's message waiting behind an interrupted turn. */
export function QueuedBubble({ children }: { children: React.ReactNode }) {
	return (
		<ConversationBubble variant="sent">
			<ConversationContent>{children}</ConversationContent>
			<span className="self-end pe-1 text-caption text-muted-foreground">Queued</span>
		</ConversationBubble>
	);
}

/**
 * The card a bot posts under its message when a turn stops on a model problem, with the site
 * request's anatomy. Resuming on another pair settles it; there's no Undo, since a resumed turn
 * can't be taken back.
 */
export function InterruptionCard({
	access,
	interruption,
	turnPair,
	defaultPair,
	settledPair,
	onResume,
	onCheck,
}: {
	access: ModelAccess;
	interruption: Interruption;
	turnPair: Pair;
	defaultPair: Pair | undefined;
	/** The pair a settled turn carried on with. */
	settledPair?: Pair;
	onResume?: (pair: Pair) => void;
	onCheck?: () => Promise<void> | void;
}) {
	const narrow = useIsMobile();
	const [settled, setSettled] = useState<Pair | undefined>(
		interruption === "Settled" ? (settledPair ?? turnPair) : undefined,
	);
	const [checking, setChecking] = useState(false);
	const connection = access.connections.find((each) => each.id === turnPair.connectionId);
	const current: Interruption = settled ? "Settled" : interruption;
	const stopped = current === "Settled" ? undefined : current;
	const view = connection && stopped ? stateView({ ...connection, state: stopped }) : undefined;
	const actions = interruptionActions(current, turnPair, defaultPair);

	return (
		<ConversationBubble className="w-full max-w-md">
			<Card className="w-full">
				<CardPanel className="gap-0 py-0">
					<Morph id={current}>
						{settled ? (
							<div className="flex items-center gap-3 p-4" role="status">
								<span
									aria-hidden
									className="grid size-8 shrink-0 place-items-center rounded-full bg-success/15 text-success"
								>
									<HugeiconsIcon icon={Tick02Icon} className="size-4" />
								</span>
								<p className="min-w-0 text-pretty">
									Carried on with <span className="font-medium">{pairLabel(access, settled)}</span>
								</p>
							</div>
						) : (
							<Step
								head={
									<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
										<span className="min-w-0 font-medium">{pairLabel(access, turnPair)}</span>
										{connection && stopped && (
											<StateBadge connection={{ ...connection, state: stopped }} />
										)}
									</div>
								}
								actions={
									<Actions narrow={narrow}>
										{actions.map((action) => {
											switch (action.kind) {
												case "resume":
													return (
														<Button
															key="resume"
															onClick={() => {
																setSettled(action.pair);
																onResume?.(action.pair);
															}}
														>
															Resume on {pairLabel(access, action.pair)}
														</Button>
													);
												case "settings":
													return (
														<Link
															key="settings"
															to="/settings"
															className={buttonVariants({
																variant: actions.length > 1 ? "ghost" : "outline",
															})}
														>
															Model settings
														</Link>
													);
												case "check":
													return (
														<Button
															key="check"
															variant="outline"
															loading={checking}
															onClick={async () => {
																setChecking(true);
																try {
																	await onCheck?.();
																} finally {
																	setChecking(false);
																}
															}}
														>
															Check again
														</Button>
													);
												case "reconnect":
													return (
														<Link key="reconnect" to="/settings" className={buttonVariants()}>
															Reconnect
														</Link>
													);
											}
										})}
									</Actions>
								}
							>
								{view?.detail && <p className="text-pretty text-muted-foreground">{view.detail}</p>}
							</Step>
						)}
					</Morph>
				</CardPanel>
			</Card>
		</ConversationBubble>
	);
}

/** What the composer can do: not yet built, no model to use, ready, or a turn running. */
export type ComposerMode = "soon" | "no-model" | "ready" | "running";

export const COMPOSER_PLACEHOLDERS: Record<ComposerMode, (name: string) => string> = {
	soon: () => "Chat is on its way",
	"no-model": (name) => `Connect a model in Settings to message ${name}`,
	ready: (name) => `Message ${name}`,
	running: (name) => `Message ${name}`,
};

/**
 * Send and Stop share one round button. The icons stay mounted in one cell and morph (scale
 * 0.25, 4px blur, fade), so the button reads as the same control changing what it does.
 */
export function SendOrStop({ mode }: { mode: ComposerMode }) {
	const running = mode === "running";
	const icon = (shown: boolean) =>
		cn(
			"col-start-1 row-start-1 transition-[scale,opacity,filter] duration-300 ease-out-strong motion-reduce:transition-[opacity]",
			shown
				? "scale-100 opacity-100 blur-none"
				: "scale-25 opacity-0 blur-[4px] motion-reduce:scale-100 motion-reduce:blur-none",
		);
	return (
		<Button
			type={running ? "button" : "submit"}
			size="icon"
			className="grid rounded-full"
			aria-label={running ? "Stop" : "Send"}
			disabled={mode === "soon" || mode === "no-model"}
		>
			<HugeiconsIcon icon={ArrowUp02Icon} aria-hidden className={icon(!running)} />
			<HugeiconsIcon icon={StopIcon} aria-hidden className={icon(running)} />
		</Button>
	);
}
