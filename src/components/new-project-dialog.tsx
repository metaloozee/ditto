"use client";

import {
	ArrowLeftIcon,
	ArrowRightIcon,
	BookIcon,
	CodeIcon,
	GitBranchIcon,
	GithubIcon,
	GlobeIcon,
	LockIcon,
	PlusIcon,
	SparklesIcon,
	TrashIcon,
	UnlockIcon,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Separator } from "#/components/ui/separator";
import { Textarea } from "#/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import {
	type GitHubRepo,
	loadGitHubRepositories,
} from "#/lib/github-repositories";
import { cn } from "#/lib/utils";

const LANGUAGE_COLORS: Record<string, string> = {
	TypeScript: "bg-chart-1",
	JavaScript: "bg-chart-4",
	Go: "bg-chart-2",
	MDX: "bg-chart-5",
};

const GITHUB_AUTH_TIMEOUT_MS = 2 * 60 * 1000;

type OnboardingPath = "github" | "scratch" | null;
type Step = "choice" | "github" | "scratch" | "ready";

interface EnvVar {
	id: string;
	key: string;
	value: string;
}

function _waitForGithubLinkComplete(authWindow: Window): Promise<void> {
	return new Promise((resolve, reject) => {
		let intervalId: number | undefined;
		let timeoutId: number | undefined;

		const cleanup = () => {
			if (intervalId !== undefined) window.clearInterval(intervalId);
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
			window.removeEventListener("message", handleMessage);
		};

		const finish = () => {
			cleanup();
			resolve();
		};

		const fail = () => {
			cleanup();
			reject(new Error("GitHub authorization timed out. Please try again."));
		};

		const handleMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;
			if (event.data?.type !== "github-link-complete") return;
			finish();
		};

		window.addEventListener("message", handleMessage);
		intervalId = window.setInterval(() => {
			if (authWindow.closed) finish();
		}, 500);
		timeoutId = window.setTimeout(fail, GITHUB_AUTH_TIMEOUT_MS);
	});
}

export function NewProjectDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [path, setPath] = useState<OnboardingPath>(null);
	const [step, setStep] = useState<Step>("choice");

	const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
	const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
	const [githubLoading, setGithubLoading] = useState(false);
	const [githubError, setGithubError] = useState<string | null>(null);
	const [envVars, setEnvVars] = useState<EnvVar[]>([]);

	const [projectName, setProjectName] = useState("");
	const [projectDescription, setProjectDescription] = useState("");
	const [projectOverview, setProjectOverview] = useState("");
	const [framework, setFramework] = useState("");

	const resetState = useCallback(() => {
		setPath(null);
		setStep("choice");
		setSelectedRepo(null);
		setGithubRepos([]);
		setGithubLoading(false);
		setGithubError(null);
		setEnvVars([]);
		setProjectName("");
		setProjectDescription("");
		setProjectOverview("");
		setFramework("");
	}, []);

	const handleClose = useCallback(() => {
		onOpenChange(false);
		setTimeout(resetState, 200);
	}, [onOpenChange, resetState]);

	const loadGithubRepos = useCallback(async () => {
		setGithubLoading(true);
		setGithubError(null);
		setSelectedRepo(null);

		try {
			const repos = await loadGitHubRepositories({});
			setGithubRepos(repos);
		} catch (error) {
			setGithubError(
				error instanceof Error
					? error.message
					: "Unable to load GitHub repositories.",
			);
			setGithubRepos([]);
		} finally {
			setGithubLoading(false);
		}
	}, []);

	const handleChoosePath = useCallback(
		(chosen: OnboardingPath) => {
			setPath(chosen);
			setStep(chosen === "github" ? "github" : "scratch");

			if (chosen === "github") {
				void loadGithubRepos();
			}
		},
		[loadGithubRepos],
	);

	const handleBack = useCallback(() => {
		if (step === "ready") {
			setStep(path === "github" ? "github" : "scratch");
		} else if (step === "github" || step === "scratch") {
			setStep("choice");
			setPath(null);
		}
	}, [step, path]);

	const handleContinue = useCallback(() => {
		if (step === "github" || step === "scratch") {
			setStep("ready");
		} else if (step === "ready") {
			handleClose();
		}
	}, [step, handleClose]);

	const addEnvVar = useCallback(() => {
		setEnvVars((prev) => [
			...prev,
			{ id: crypto.randomUUID(), key: "", value: "" },
		]);
	}, []);

	const removeEnvVar = useCallback((id: string) => {
		setEnvVars((prev) => prev.filter((v) => v.id !== id));
	}, []);

	const updateEnvVar = useCallback(
		(id: string, field: "key" | "value", val: string) => {
			setEnvVars((prev) =>
				prev.map((v) => (v.id === id ? { ...v, [field]: val } : v)),
			);
		},
		[],
	);

	const canContinue =
		step === "github"
			? selectedRepo !== null && !githubLoading && githubError === null
			: step === "scratch"
				? projectName.trim().length > 0 && framework.length > 0
				: true;

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent
				className={cn(
					"sm:max-w-lg",
					step === "github" && "flex max-h-[85vh] flex-col",
				)}
			>
				{step === "choice" && (
					<>
						<DialogHeader>
							<DialogTitle className="text-balance">
								Create a new project
							</DialogTitle>
							<DialogDescription>
								Choose how you'd like to get started.
							</DialogDescription>
						</DialogHeader>

						<div className="grid grid-cols-2 gap-3 py-2">
							<button
								type="button"
								onClick={() => handleChoosePath("github")}
								className={cn(
									"group flex cursor-pointer flex-col items-center gap-3 rounded-lg border border-border bg-card p-5 text-center transition-colors duration-150 ease-out",
									"hover:border-ring hover:bg-accent",
									"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								)}
							>
								<div className="flex size-10 items-center justify-center rounded-md bg-muted">
									<GithubIcon
										aria-hidden="true"
										className="size-5 text-foreground"
									/>
								</div>
								<div className="flex flex-col gap-1">
									<span className="text-sm font-medium">
										Import from GitHub
									</span>
									<span className="text-xs text-muted-foreground text-pretty">
										Clone an existing repository
									</span>
								</div>
							</button>

							<button
								type="button"
								onClick={() => handleChoosePath("scratch")}
								className={cn(
									"group flex cursor-pointer flex-col items-center gap-3 rounded-lg border border-border bg-card p-5 text-center transition-colors duration-150 ease-out",
									"hover:border-ring hover:bg-accent",
									"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								)}
							>
								<div className="flex size-10 items-center justify-center rounded-md bg-muted">
									<CodeIcon
										aria-hidden="true"
										className="size-5 text-foreground"
									/>
								</div>
								<div className="flex flex-col gap-1">
									<span className="text-sm font-medium">
										Start from Scratch
									</span>
									<span className="text-xs text-muted-foreground text-pretty">
										Set up a brand new project
									</span>
								</div>
							</button>
						</div>
					</>
				)}

				{step === "github" && (
					<>
						<DialogHeader>
							<DialogTitle className="text-balance">
								Import from GitHub
							</DialogTitle>
							<DialogDescription>
								Search and select a repository to import.
							</DialogDescription>
						</DialogHeader>

						<Command className="rounded-lg border border-border">
							<CommandInput placeholder="Search repositories…" />
							<CommandList>
								{githubLoading ? (
									<CommandEmpty>Loading repositories...</CommandEmpty>
								) : githubError ? (
									<CommandEmpty>{githubError}</CommandEmpty>
								) : githubRepos.length === 0 ? (
									<CommandEmpty>No repositories found.</CommandEmpty>
								) : (
									<CommandGroup heading="Your repositories">
										{githubRepos.map((repo) => (
											<CommandItem
												key={repo.name}
												value={repo.name}
												onSelect={() => setSelectedRepo(repo.name)}
												className={cn(
													"flex items-center gap-3 cursor-pointer",
													selectedRepo === repo.name && "bg-accent",
												)}
											>
												<BookIcon
													aria-hidden="true"
													className="size-4 shrink-0 text-muted-foreground"
												/>
												<div className="flex min-w-0 flex-1 items-center gap-2">
													<span className="truncate text-sm font-medium">
														{repo.name}
													</span>
													{repo.isPrivate ? (
														<LockIcon
															aria-hidden="true"
															className="size-3 shrink-0 text-muted-foreground"
														/>
													) : (
														<GlobeIcon
															aria-hidden="true"
															className="size-3 shrink-0 text-muted-foreground"
														/>
													)}
												</div>
												<div className="flex items-center gap-2">
													<div className="flex items-center gap-1.5">
														<span
															className={cn(
																"size-2.5 rounded-full",
																repo.language
																	? (LANGUAGE_COLORS[repo.language] ??
																			"bg-muted-foreground")
																	: "bg-muted-foreground",
															)}
															aria-hidden="true"
														/>
														<span className="text-xs text-muted-foreground">
															{repo.language ?? "Unknown"}
														</span>
													</div>
												</div>
											</CommandItem>
										))}
									</CommandGroup>
								)}
							</CommandList>
						</Command>

						{selectedRepo && (
							<div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
								<GitBranchIcon
									aria-hidden="true"
									className="size-4 text-muted-foreground"
								/>
								<span className="text-sm">
									Selected:{" "}
									<span className="font-medium">{selectedRepo}</span>
								</span>
							</div>
						)}

						<DialogFooter className="flex flex-row items-center gap-2 pt-1">
							<Button
								variant="ghost"
								onClick={handleBack}
								className="cursor-pointer"
							>
								<ArrowLeftIcon data-icon="inline-start" />
								Back
							</Button>
							<div className="flex-1" />
							<Button
								onClick={handleContinue}
								disabled={!canContinue}
								className="cursor-pointer"
							>
								Continue
								<ArrowRightIcon data-icon="inline-end" />
							</Button>
						</DialogFooter>
					</>
				)}

				{step === "scratch" && (
					<>
						<DialogHeader>
							<DialogTitle className="text-balance">
								Start from Scratch
							</DialogTitle>
							<DialogDescription>
								Tell us about the project you want to build.
							</DialogDescription>
						</DialogHeader>

						<ScrollArea className="max-h-[60vh]">
							<FieldGroup className="gap-4 py-1 pr-3">
								<Field>
									<FieldLabel htmlFor="project-name">Project Name</FieldLabel>
									<Input
										id="project-name"
										name="project-name"
										placeholder="my-awesome-project"
										autoComplete="off"
										spellCheck={false}
										value={projectName}
										onChange={(e) => setProjectName(e.target.value)}
									/>
								</Field>

								<Field>
									<FieldLabel htmlFor="project-description">
										Description
									</FieldLabel>
									<Input
										id="project-description"
										name="project-description"
										placeholder="A brief description of your project…"
										autoComplete="off"
										value={projectDescription}
										onChange={(e) => setProjectDescription(e.target.value)}
									/>
									<FieldDescription>
										Optional. Helps the AI understand your goals.
									</FieldDescription>
								</Field>

								<Field>
									<FieldLabel htmlFor="project-overview">
										Brief Overview / Workflow
									</FieldLabel>
									<Textarea
										id="project-overview"
										name="project-overview"
										placeholder="Describe the main features, user flows, or architecture…"
										autoComplete="off"
										value={projectOverview}
										onChange={(e) => setProjectOverview(e.target.value)}
									/>
									<FieldDescription>
										Optional. Provide context for the AI scaffolding agent.
									</FieldDescription>
								</Field>

								<Field>
									<FieldLabel id="framework-label">Framework</FieldLabel>
									<ToggleGroup
										value={framework ? [framework] : []}
										onValueChange={(val) => {
											const next = val.find((v) => v !== framework);
											if (next) setFramework(next);
										}}
										aria-labelledby="framework-label"
										className="flex w-full"
									>
										<ToggleGroupItem
											value="astro"
											className="flex-1 cursor-pointer"
										>
											Astro
										</ToggleGroupItem>
										<ToggleGroupItem
											value="nextjs"
											className="flex-1 cursor-pointer"
										>
											NextJS
										</ToggleGroupItem>
										<ToggleGroupItem
											value="tanstack-start"
											className="flex-1 cursor-pointer"
										>
											TanStack Start
										</ToggleGroupItem>
									</ToggleGroup>
								</Field>
							</FieldGroup>
						</ScrollArea>

						<DialogFooter className="flex flex-row items-center gap-2 pt-1">
							<Button
								variant="ghost"
								onClick={handleBack}
								className="cursor-pointer"
							>
								<ArrowLeftIcon data-icon="inline-start" />
								Back
							</Button>
							<div className="flex-1" />
							<Button
								onClick={handleContinue}
								disabled={!canContinue}
								className="cursor-pointer"
							>
								Continue
								<ArrowRightIcon data-icon="inline-end" />
							</Button>
						</DialogFooter>
					</>
				)}

				{step === "ready" && (
					<ReadyStep
						path={path}
						selectedRepo={selectedRepo}
						githubRepos={githubRepos}
						projectName={projectName}
						projectDescription={projectDescription}
						projectOverview={projectOverview}
						framework={framework}
						envVars={envVars}
						addEnvVar={addEnvVar}
						removeEnvVar={removeEnvVar}
						updateEnvVar={updateEnvVar}
						onBack={handleBack}
						onSubmit={handleContinue}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ReadyStep({
	path,
	selectedRepo,
	githubRepos,
	projectName,
	projectDescription,
	projectOverview,
	framework,
	envVars,
	addEnvVar,
	removeEnvVar,
	updateEnvVar,
	onBack,
	onSubmit,
}: {
	path: OnboardingPath;
	selectedRepo: string | null;
	githubRepos: GitHubRepo[];
	projectName: string;
	projectDescription: string;
	projectOverview: string;
	framework: string;
	envVars: EnvVar[];
	addEnvVar: () => void;
	removeEnvVar: (id: string) => void;
	updateEnvVar: (id: string, field: "key" | "value", val: string) => void;
	onBack: () => void;
	onSubmit: () => void;
}) {
	return (
		<>
			<DialogHeader>
				<DialogTitle className="text-balance">
					{path === "github" ? "Ready to initialize" : "Review & create"}
				</DialogTitle>
				<DialogDescription>
					{path === "github"
						? "Review your setup before we spin up the sandbox."
						: "Review your project details before the AI begins scaffolding."}
				</DialogDescription>
			</DialogHeader>

			<ScrollArea className="max-h-[60vh]">
				<div className="flex flex-col gap-4 pr-3">
					{path === "github" ? (
						<GitHubSummary repo={selectedRepo} repos={githubRepos} />
					) : (
						<ScratchSummary
							name={projectName}
							description={projectDescription}
							overview={projectOverview}
							framework={framework}
						/>
					)}

					<Separator />

					<div className="flex flex-col gap-2">
						<span className="text-xs font-medium text-muted-foreground">
							What happens next
						</span>
						{path === "github" ? (
							<ul className="flex flex-col gap-1.5 text-sm">
								<li className="flex items-start gap-2">
									<span
										className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
										aria-hidden="true"
									/>
									Initialize a secure sandbox environment
								</li>
								<li className="flex items-start gap-2">
									<span
										className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
										aria-hidden="true"
									/>
									Clone the repository into the sandbox
								</li>
								<li className="flex items-start gap-2">
									<span
										className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
										aria-hidden="true"
									/>
									Install dependencies automatically
								</li>
							</ul>
						) : (
							<div className="flex items-start gap-2 text-sm text-muted-foreground">
								<SparklesIcon
									aria-hidden="true"
									className="mt-0.5 size-4 shrink-0 text-primary"
								/>
								<p className="text-pretty">
									An AI agent will analyze your requirements and draft a
									plan for the initial scaffolding. You'll be able to review
									and adjust before any code is generated.
								</p>
							</div>
						)}
					</div>

					{path === "github" && (
						<>
							<Separator />
							<div className="flex flex-col gap-3">
								<div className="flex items-center justify-between">
									<div className="flex flex-col gap-0.5">
										<span className="text-xs font-medium text-muted-foreground">
											Environment Variables
										</span>
										<span className="text-xs text-muted-foreground">
											Optional. Written to{" "}
											<code className="rounded bg-muted px-1 py-0.5 text-[0.7rem] font-mono">
												.env
											</code>{" "}
											in the sandbox.
										</span>
									</div>
									<Button
										variant="outline"
										size="sm"
										onClick={addEnvVar}
										className="cursor-pointer shrink-0"
										aria-label="Add environment variable"
									>
										<PlusIcon data-icon="inline-start" />
										Add
									</Button>
								</div>

								{envVars.length > 0 && (
									<div className="flex flex-col gap-2">
										{envVars.map((envVar) => (
											<div
												key={envVar.id}
												className="flex items-center gap-2"
											>
												<Input
													placeholder="KEY"
													autoComplete="off"
													spellCheck={false}
													value={envVar.key}
													onChange={(e) =>
														updateEnvVar(envVar.id, "key", e.target.value)
													}
													className="flex-1 font-mono text-xs"
													aria-label="Variable name"
												/>
												<Input
													placeholder="value"
													autoComplete="off"
													spellCheck={false}
													value={envVar.value}
													onChange={(e) =>
														updateEnvVar(envVar.id, "value", e.target.value)
													}
													className="flex-1 font-mono text-xs"
													aria-label="Variable value"
												/>
												<Button
													variant="ghost"
													size="icon-sm"
													onClick={() => removeEnvVar(envVar.id)}
													className="cursor-pointer shrink-0"
													aria-label="Remove variable"
												>
													<TrashIcon aria-hidden="true" />
												</Button>
											</div>
										))}
									</div>
								)}
							</div>
						</>
					)}
				</div>
			</ScrollArea>

			<DialogFooter className="flex flex-row items-center gap-2 pt-1">
				<Button
					variant="ghost"
					onClick={onBack}
					className="cursor-pointer"
				>
					<ArrowLeftIcon data-icon="inline-start" />
					Back
				</Button>
				<div className="flex-1" />
				<Button onClick={onSubmit} className="cursor-pointer">
					{path === "github" ? "Initialize" : "Create Project"}
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			</DialogFooter>
		</>
	);
}

function GitHubSummary({
	repo,
	repos,
}: {
	repo: string | null;
	repos: GitHubRepo[];
}) {
	const repoData = repos.find((r) => r.name === repo);
	if (!repoData) return null;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-4">
				<div className="flex items-center gap-2">
					<GithubIcon
						aria-hidden="true"
						className="size-4 text-muted-foreground"
					/>
					<span className="text-sm font-medium">{repoData.name}</span>
					<Badge variant="secondary" className="text-xs">
						{repoData.isPrivate ? (
							<LockIcon className="size-5" />
						) : (
							<UnlockIcon className="size-5" />
						)}
					</Badge>
				</div>
				<div className="flex items-center gap-1.5">
					<span
						className={cn(
							"size-2.5 rounded-full",
							repoData.language
								? (LANGUAGE_COLORS[repoData.language] ?? "bg-muted-foreground")
								: "bg-muted-foreground",
						)}
						aria-hidden="true"
					/>
					{repoData.language ?? "Unknown"}
				</div>
			</div>
		</div>
	);
}

function ScratchSummary({
	name,
	description,
	overview,
	framework,
}: {
	name: string;
	description: string;
	overview: string;
	framework: string;
}) {
	const frameworkLabels: Record<string, string> = {
		astro: "Astro",
		nextjs: "NextJS",
		"tanstack-start": "TanStack Start",
	};

	return (
		<div className="flex flex-col gap-2.5">
			<div className="flex items-center justify-between">
				<span className="text-sm font-medium">{name}</span>
				{framework && (
					<Badge variant="secondary" className="text-xs">
						{frameworkLabels[framework] ?? framework}
					</Badge>
				)}
			</div>
			{description && (
				<p className="text-xs text-muted-foreground text-pretty">
					{description}
				</p>
			)}
			{overview && (
				<>
					<Separator />
					<p className="text-xs text-muted-foreground text-pretty line-clamp-3">
						{overview}
					</p>
				</>
			)}
		</div>
	);
}
