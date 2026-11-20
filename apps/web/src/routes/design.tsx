import {
	Add01Icon,
	BubbleChatIcon,
	Delete02Icon,
	Folder01Icon,
	GitBranchIcon,
	MoreHorizontalIcon,
	PlayIcon,
	Robot01Icon,
	Search01Icon,
	Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { Arc, Blocks, Classic, LinearDots, Pulse, Ring } from "loading-dev";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardPanel,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { CopyButton } from "#/components/ui/copy-button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { TooltipProvider } from "#/components/ui/tooltip.tsx";

export const Route = createFileRoute("/design")({
	head: () => ({ meta: [{ title: "Design system · Ditto" }] }),
	component: DesignSystem,
});

const swatches = [
	["background", "bg-background"],
	["card", "bg-card"],
	["panel", "bg-panel"],
	["popover", "bg-popover"],
	["muted", "bg-muted"],
	["accent", "bg-accent"],
	["border", "bg-border"],
	["input", "bg-input"],
	["muted-foreground", "bg-muted-foreground"],
	["foreground", "bg-foreground"],
	["primary", "bg-primary"],
	["link", "bg-link"],
	["destructive", "bg-destructive"],
] as const;

const typeScale = [
	["display", "text-display", "Sandboxed agents for your projects"],
	["title", "text-title", "Session history"],
	["heading", "text-heading", "Recent runs"],
	["body", "text-body", "The agent rebuilt the worker and every test passed."],
	["caption", "text-caption text-muted-foreground", "Updated 2 minutes ago"],
] as const;

const sessions = [
	{ title: "Fix flaky upload test on CI", meta: "ditto/web · merged 1h ago" },
	{ title: "Upgrade Vite+ to 1.7", meta: "ditto/web · merged yesterday" },
	{ title: "Add rate limiting to sign-in", meta: "ditto/api · 2 tests failing" },
];

const loaders = [
	{ name: "Ring", Loader: Ring },
	{ name: "Arc", Loader: Arc },
	{ name: "Classic", Loader: Classic },
	{ name: "Linear dots", Loader: LinearDots },
	{ name: "Pulse", Loader: Pulse },
	{ name: "Blocks", Loader: Blocks },
];

const models = [
	{ label: "Fable 5.2", value: "fable" },
	{ label: "Opus 5.5", value: "opus" },
	{ label: "Sonnet 5.5", value: "sonnet" },
];

function DesignSystem() {
	return (
		<TooltipProvider>
			<main className="mx-auto flex max-w-4xl flex-col gap-12 px-4 py-12 sm:px-8">
				<header className="flex flex-col gap-2">
					<h1>Design system</h1>
					<p className="max-w-prose text-muted-foreground">
						Charcoal neutrals and one blue signal, built on shadcn with Base UI and HugeIcons. The
						written spec is at /design.md. Change your OS appearance to see the other mode.
					</p>
				</header>

				<Section title="Color">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{swatches.map(([name, className]) => (
							<div key={name} className="flex flex-col gap-1.5">
								<div className={`h-12 rounded-md ring-1 ring-foreground/10 ${className}`} />
								<code className="text-caption text-muted-foreground">{name}</code>
							</div>
						))}
					</div>
				</Section>

				<Section title="Type">
					<div className="flex flex-col gap-4">
						{typeScale.map(([name, className, sample]) => (
							<div key={name} className="grid gap-1 sm:grid-cols-[6rem_1fr] sm:items-baseline">
								<code className="text-caption text-muted-foreground">{name}</code>
								<p className={className}>{sample}</p>
							</div>
						))}
						<div className="grid gap-1 sm:grid-cols-[6rem_1fr] sm:items-baseline">
							<code className="text-caption text-muted-foreground">mono</code>
							<code className="text-body">pnpm vp run @ditto/web#build</code>
						</div>
					</div>
				</Section>

				<Section title="Buttons">
					<div className="flex flex-wrap items-center gap-2">
						<Button>
							<HugeiconsIcon icon={PlayIcon} data-icon="inline-start" />
							Run agent
						</Button>
						<Button variant="secondary">Secondary</Button>
						<Button variant="outline">Outline</Button>
						<Button variant="ghost">Ghost</Button>
						<Button variant="destructive">
							<HugeiconsIcon icon={Delete02Icon} data-icon="inline-start" />
							Delete
						</Button>
						<Button variant="link">View logs</Button>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<CopyButton value="pnpm vp run @ditto/web#build" />
						<CopyButton value="pnpm vp run @ditto/web#build" label="Copy command" />
						<span className="text-caption text-muted-foreground">
							Click to copy. The icon morphs to a check, and the label morphs with torph.
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button size="xs">Extra small</Button>
						<Button size="sm">Small</Button>
						<Button>Default</Button>
						<Button size="lg">Large</Button>
						<Button disabled>Disabled</Button>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Badge>Running</Badge>
						<Badge variant="secondary">Queued</Badge>
						<Badge variant="outline">Draft</Badge>
						<Badge variant="destructive">Failed</Badge>
					</div>
				</Section>

				<Section title="Loading">
					<div className="flex flex-wrap items-center gap-2">
						<DeployButton />
						<Button variant="secondary" loading>
							Saving
						</Button>
						<Button variant="outline" loading>
							Refreshing
						</Button>
					</div>
					<Card>
						<div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
							{loaders.map(({ name, Loader }) => (
								<CardPanel key={name} className="items-center gap-3 py-5">
									<Loader size={20} color="currentColor" />
									<span className="text-caption text-muted-foreground">{name}</span>
								</CardPanel>
							))}
						</div>
					</Card>
				</Section>

				<Section title="Forms">
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="ds-search">Search</Label>
							<div className="relative">
								<HugeiconsIcon
									icon={Search01Icon}
									className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
								/>
								<Input id="ds-search" placeholder="worker.ts" className="pl-7" />
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="ds-invalid">Branch name</Label>
							<Input id="ds-invalid" defaultValue="feat/ui" aria-invalid />
							<p className="text-caption text-destructive">That branch already exists.</p>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label>Model</Label>
							<Select items={models} defaultValue="opus">
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{models.map((model) => (
										<SelectItem key={model.value} value={model.value}>
											{model.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="ds-prompt">Prompt</Label>
							<Textarea id="ds-prompt" placeholder="Add a health check route to the worker" />
						</div>
						<div className="flex items-center gap-2">
							<Checkbox id="ds-tests" defaultChecked />
							<Label htmlFor="ds-tests">Run tests after each change</Label>
						</div>
						<div className="flex items-center gap-2">
							<Switch id="ds-sandbox" defaultChecked />
							<Label htmlFor="ds-sandbox">Network access in sandbox</Label>
						</div>
					</div>
				</Section>

				<Section title="Cards">
					<p className="max-w-prose text-muted-foreground">
						A card is a shell holding one or more panels. Compose panels in a column, a row, or a
						list; the footer is its own panel.
					</p>
					<div className="grid gap-4 md:grid-cols-2">
						<Card>
							<CardPanel className="min-h-48 justify-between">
								<CardHeader>
									<CardTitle>ditto/web</CardTitle>
									<CardDescription>2 agents running on main</CardDescription>
									<CardAction>
										<DropdownMenu>
											<DropdownMenuTrigger
												render={
													<Button variant="ghost" size="icon-sm" aria-label="Project actions" />
												}
											>
												<HugeiconsIcon icon={MoreHorizontalIcon} />
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end" className="w-44">
												<DropdownMenuItem>
													<HugeiconsIcon icon={Add01Icon} />
													New session
													<DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
												</DropdownMenuItem>
												<DropdownMenuItem>
													<HugeiconsIcon icon={GitBranchIcon} />
													Switch branch
												</DropdownMenuItem>
												<DropdownMenuItem>
													<HugeiconsIcon icon={Settings01Icon} />
													Settings
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem variant="destructive">
													<HugeiconsIcon icon={Delete02Icon} />
													Delete project
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</CardAction>
								</CardHeader>
								<CardContent className="flex flex-col gap-1">
									<Row icon={Folder01Icon} label="src/worker.ts" meta="2m ago" />
									<Row icon={Robot01Icon} label="Add health check" meta="Running" />
								</CardContent>
							</CardPanel>
							<CardFooter>
								<Dialog>
									<DialogTrigger render={<Button variant="outline" size="sm" />}>
										Stop agents
									</DialogTrigger>
									<DialogContent>
										<DialogHeader>
											<DialogTitle>Stop 2 agents?</DialogTitle>
											<DialogDescription>
												Uncommitted changes in their sandboxes are kept, but the runs end now.
											</DialogDescription>
										</DialogHeader>
										<DialogFooter showCloseButton>
											<Button variant="destructive">Stop agents</Button>
										</DialogFooter>
									</DialogContent>
								</Dialog>
							</CardFooter>
						</Card>

						<Card>
							<div className="grid flex-1 grid-cols-2 gap-1.5">
								<CardPanel className="min-h-48 items-center justify-center gap-3 px-4 text-center">
									<span className="flex size-10 items-center justify-center rounded-full bg-muted">
										<HugeiconsIcon icon={Robot01Icon} className="size-5" />
									</span>
									<span className="text-caption text-muted-foreground">Sandbox agent</span>
								</CardPanel>
								<CardPanel className="min-h-48 items-center justify-center gap-3 px-4 text-center">
									<span className="flex size-10 items-center justify-center rounded-lg bg-muted">
										<HugeiconsIcon icon={GitBranchIcon} className="size-5" />
									</span>
									<span className="text-caption text-muted-foreground">Own branch</span>
								</CardPanel>
							</div>
							<CardFooter>
								<Button variant="secondary" size="sm">
									Start a session
								</Button>
							</CardFooter>
						</Card>

						<Card>
							{sessions.map((session) => (
								<CardPanel key={session.title} className="flex-row items-center gap-3 px-4">
									<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
										<HugeiconsIcon icon={BubbleChatIcon} className="size-4" />
									</span>
									<div className="flex min-w-0 flex-col">
										<span className="truncate font-medium">{session.title}</span>
										<span className="truncate text-caption text-muted-foreground">
											{session.meta}
										</span>
									</div>
								</CardPanel>
							))}
						</Card>

						<Card>
							<Tabs
								defaultValue="diff"
								orientation="vertical"
								className="grid flex-1 grid-cols-[7rem_minmax(0,1fr)] gap-1.5"
							>
								<CardPanel className="px-1.5 py-1.5">
									<TabsList variant="line" className="w-full items-stretch">
										<TabsTrigger value="diff">Diff</TabsTrigger>
										<TabsTrigger value="logs">Logs</TabsTrigger>
										<TabsTrigger value="files">Files</TabsTrigger>
									</TabsList>
								</CardPanel>
								<CardPanel className="min-h-48 px-(--card-spacing)">
									<TabsContent value="diff">
										<pre className="text-caption break-words whitespace-pre-wrap">
											{"+ app.get('/health', () => ok())\n- // TODO: health check"}
										</pre>
									</TabsContent>
									<TabsContent value="logs">
										<pre className="text-caption break-words whitespace-pre-wrap">
											{"✓ 1 test passed\n✓ built in 240ms"}
										</pre>
									</TabsContent>
									<TabsContent value="files" className="text-muted-foreground">
										2 files changed
									</TabsContent>
								</CardPanel>
							</Tabs>
						</Card>
					</div>
				</Section>

				<Separator />
			</main>
		</TooltipProvider>
	);
}

function DeployButton() {
	const [loading, setLoading] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	return (
		<Button
			loading={loading}
			onClick={() => {
				setLoading(true);
				timer.current = setTimeout(() => setLoading(false), 2000);
			}}
		>
			<HugeiconsIcon icon={PlayIcon} data-icon="inline-start" />
			Deploy preview
		</Button>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-4">
			<h2>{title}</h2>
			{children}
		</section>
	);
}

function Row({ icon, label, meta }: { icon: typeof Folder01Icon; label: string; meta: string }) {
	return (
		<div className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
			<HugeiconsIcon icon={icon} className="size-3.5 text-muted-foreground" />
			<span className="flex-1 truncate font-mono text-caption">{label}</span>
			<span className="text-caption text-muted-foreground">{meta}</span>
		</div>
	);
}
