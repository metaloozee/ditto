"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { GitBranchIcon, GithubIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
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
	FieldError,
	FieldGroup,
	FieldLabel,
} from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Skeleton } from "#/components/ui/skeleton";
import { Spinner } from "#/components/ui/spinner";
import { useTRPC } from "#/integrations/trpc/react";
import { ENV_VAR_KEY_DESCRIPTION, normalizeEnvVarKey } from "#/lib/env-vars";
import type { GitHubRepo } from "#/lib/github-repositories";
import { cn } from "#/lib/utils";

interface EnvVar {
	id: string;
	key: string;
	value: string;
}

export function NewProjectDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
	const [envVars, setEnvVars] = useState<EnvVar[]>([]);
	const [githubSetupError, setGithubSetupError] = useState<string | null>(null);

	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const createProjectMutation = useMutation(
		trpc.projects.create.mutationOptions(),
	);
	const importStateQuery = useQuery(
		trpc.github.importState.queryOptions(undefined, {
			enabled: open,
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000,
		}),
	);

	const githubLoading =
		importStateQuery.isLoading || importStateQuery.isFetching;
	const githubRepos = importStateQuery.data?.repositories ?? [];
	const installations = importStateQuery.data?.installations ?? [];
	const selectedRepository = githubRepos.find(
		(repo) => repo.name === selectedRepo,
	);
	const isPending = createProjectMutation.isPending;
	const isProvisioning = isPending;
	const invalidEnvVarIds = new Set<string>();
	for (const envVar of envVars) {
		if (
			envVar.key.trim().length > 0 &&
			normalizeEnvVarKey(envVar.key) === null
		) {
			invalidEnvVarIds.add(envVar.id);
		}
	}

	function resetState() {
		setSelectedRepo(null);
		setEnvVars([]);
		setGithubSetupError(null);
		createProjectMutation.reset();
	}

	function closeDialog() {
		onOpenChange(false);
		window.setTimeout(resetState, 150);
	}

	function handleOpenChange(nextOpen: boolean) {
		if (isProvisioning) return;
		if (nextOpen) onOpenChange(true);
		else closeDialog();
	}

	function addEnvVar() {
		setEnvVars((current) => [
			...current,
			{ id: crypto.randomUUID(), key: "", value: "" },
		]);
	}

	function updateEnvVar(id: string, field: "key" | "value", value: string) {
		setEnvVars((current) =>
			current.map((envVar) =>
				envVar.id === id ? { ...envVar, [field]: value } : envVar,
			),
		);
	}

	function removeEnvVar(id: string) {
		setEnvVars((current) => current.filter((envVar) => envVar.id !== id));
	}

	async function createProject() {
		if (!selectedRepository || invalidEnvVarIds.size > 0) return;

		try {
			const project = await createProjectMutation.mutateAsync({
				name: selectedRepository.repoName,
				githubRepo: selectedRepository.name,
				githubInstallationId: selectedRepository.installationId,
				envVars: envVars.map(({ key, value }) => ({ key, value })),
			});

			await queryClient.invalidateQueries(trpc.projects.list.queryFilter());
			closeDialog();
			await navigate({
				to: "/project/$projectId",
				params: { projectId: project.id },
			});
		} catch {
			// React Query exposes the error beside the action.
		}
	}

	function configureGitHub() {
		const installUrl = importStateQuery.data?.installUrl;
		if (!installUrl) return;

		setGithubSetupError(null);
		const width = 600;
		const height = 750;
		const popup = window.open(
			installUrl,
			"github-app-install",
			`width=${width},height=${height},left=${window.screen.width / 2 - width / 2},top=${window.screen.height / 2 - height / 2},resizable=yes,scrollbars=yes,status=yes`,
		);

		if (!popup) {
			setGithubSetupError(
				"Your browser blocked the GitHub window. Allow popups and try again.",
			);
			return;
		}

		const refreshRepositories = () => {
			window.clearInterval(interval);
			window.removeEventListener("message", handleMessage);
			void importStateQuery.refetch();
		};
		const handleMessage = (event: MessageEvent) => {
			if (
				event.origin === window.location.origin &&
				event.data?.type === "github-app-install-complete"
			) {
				refreshRepositories();
			}
		};
		const interval = window.setInterval(() => {
			if (popup.closed) refreshRepositories();
		}, 1000);
		window.addEventListener("message", handleMessage);
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				showCloseButton={!isProvisioning}
				className="flex max-h-[85vh] flex-col sm:max-w-xl"
			>
				<DialogHeader>
					<DialogTitle className="text-balance">Create project</DialogTitle>
					<DialogDescription className="text-pretty">
						Choose a GitHub repository. Ditto will clone it into a secure
						workspace and install its dependencies.
					</DialogDescription>
				</DialogHeader>

				<ScrollArea className="min-h-0 flex-1">
					<div className="flex flex-col gap-4 pr-3">
						<RepositoryPicker
							repositories={githubRepos}
							hasInstallation={installations.length > 0}
							installUrlAvailable={Boolean(importStateQuery.data?.installUrl)}
							selectedRepo={selectedRepo}
							loading={githubLoading}
							repositoryError={importStateQuery.error?.message ?? null}
							setupError={githubSetupError}
							isProvisioning={isProvisioning}
							onSelect={setSelectedRepo}
							onConfigure={configureGitHub}
							onRetry={() => void importStateQuery.refetch()}
						/>

						{selectedRepository ? (
							<EnvironmentVariables
								envVars={envVars}
								invalidIds={invalidEnvVarIds}
								disabled={isProvisioning}
								onAdd={addEnvVar}
								onUpdate={updateEnvVar}
								onRemove={removeEnvVar}
							/>
						) : null}
					</div>
				</ScrollArea>

				{createProjectMutation.error ? (
					<FieldError>{createProjectMutation.error.message}</FieldError>
				) : null}

				<DialogFooter className="items-center sm:justify-between">
					<p className="text-xs text-muted-foreground" aria-live="polite">
						{selectedRepository
							? `${selectedRepository.name} selected`
							: "Select a repository to continue"}
					</p>
					<Button
						type="button"
						onClick={() => void createProject()}
						disabled={
							isPending ||
							!selectedRepository ||
							isProvisioning ||
							invalidEnvVarIds.size > 0
						}
						aria-busy={isPending || undefined}
					>
						{isPending ? <Spinner /> : null}
						{isPending ? "Creating project…" : "Create project"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function RepositoryPicker({
	repositories,
	hasInstallation,
	installUrlAvailable,
	selectedRepo,
	loading,
	repositoryError,
	setupError,
	isProvisioning,
	onSelect,
	onConfigure,
	onRetry,
}: {
	repositories: GitHubRepo[];
	hasInstallation: boolean;
	installUrlAvailable: boolean;
	selectedRepo: string | null;
	loading: boolean;
	repositoryError: string | null;
	setupError: string | null;
	isProvisioning: boolean;
	onSelect: (repo: string) => void;
	onConfigure: () => void;
	onRetry: () => void;
}) {
	if (!hasInstallation && !loading && !repositoryError) {
		return (
			<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
				<div className="flex items-center gap-2">
					<GithubIcon aria-hidden="true" />
					<h3 className="text-sm font-medium">Connect GitHub</h3>
				</div>
				<p className="text-pretty text-xs text-muted-foreground">
					Install the Ditto GitHub App and choose which repositories it can
					access. You can change access later in GitHub.
				</p>
				<Button
					type="button"
					onClick={onConfigure}
					disabled={!installUrlAvailable}
				>
					<GithubIcon data-icon="inline-start" />
					Connect GitHub
				</Button>
				{setupError ? (
					<p className="text-pretty text-xs text-destructive" role="alert">
						{setupError}
					</p>
				) : null}
			</div>
		);
	}

	return (
		<>
			<Command className="rounded-lg border">
				<CommandInput
					aria-label="Search repositories"
					placeholder="Search repositories…"
				/>
				<CommandList>
					{loading ? (
						<div className="flex flex-col gap-2 p-2" aria-busy="true">
							<span className="sr-only">Loading repositories</span>
							<Skeleton className="h-8 w-full" />
							<Skeleton className="h-8 w-full" />
							<Skeleton className="h-8 w-full" />
						</div>
					) : repositoryError ? (
						<CommandEmpty>
							<span className="text-destructive" role="alert">
								{repositoryError}
							</span>
						</CommandEmpty>
					) : repositories.length === 0 ? (
						<CommandEmpty>
							Nothing found. No accessible repositories yet.
						</CommandEmpty>
					) : (
						<CommandGroup heading="Repositories">
							{repositories.map((repo) => (
								<CommandItem
									key={repo.id}
									value={repo.name}
									data-checked={selectedRepo === repo.name}
									onSelect={() => onSelect(repo.name)}
									className={cn(
										"min-h-9 cursor-pointer gap-3",
										selectedRepo === repo.name && "bg-muted",
									)}
								>
									<GitBranchIcon
										aria-hidden="true"
										className="text-muted-foreground"
									/>
									<span className="min-w-0 flex-1 truncate font-medium">
										{repo.name}
									</span>
									{repo.language ? (
										<span className="hidden text-muted-foreground sm:inline">
											{repo.language}
										</span>
									) : null}
									{repo.isPrivate ? (
										<Badge variant="secondary">Private</Badge>
									) : null}
								</CommandItem>
							))}
						</CommandGroup>
					)}
				</CommandList>
			</Command>

			{hasInstallation && !loading ? (
				<div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
					<span>Missing a repository?</span>
					<Button
						type="button"
						variant="link"
						size="sm"
						onClick={onConfigure}
						disabled={isProvisioning}
					>
						Configure GitHub access
					</Button>
				</div>
			) : null}

			{repositoryError ? (
				<Button type="button" variant="outline" size="sm" onClick={onRetry}>
					Try again
				</Button>
			) : null}

			{setupError ? (
				<p className="text-pretty text-xs text-destructive" role="alert">
					{setupError}
				</p>
			) : null}
		</>
	);
}

function EnvironmentVariables({
	envVars,
	invalidIds,
	disabled,
	onAdd,
	onUpdate,
	onRemove,
}: {
	envVars: EnvVar[];
	invalidIds: Set<string>;
	disabled: boolean;
	onAdd: () => void;
	onUpdate: (id: string, field: "key" | "value", value: string) => void;
	onRemove: (id: string) => void;
}) {
	return (
		<details className="rounded-lg border px-3 py-2">
			<summary className="cursor-pointer rounded-sm text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
				Environment variables
				<span className="ml-1 font-normal text-muted-foreground">
					(optional)
				</span>
			</summary>
			<div className="flex flex-col gap-3 pt-3">
				<div className="flex items-start justify-between gap-3">
					<p className="text-pretty text-xs text-muted-foreground">
						Available while Ditto installs dependencies and in agent sessions.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onAdd}
						disabled={disabled}
					>
						<PlusIcon data-icon="inline-start" />
						Add variable
					</Button>
				</div>

				{envVars.length > 0 ? (
					<FieldGroup className="gap-3">
						{envVars.map((envVar) => {
							const invalid = invalidIds.has(envVar.id);
							const nameId = `env-name-${envVar.id}`;
							const valueId = `env-value-${envVar.id}`;
							const errorId = `env-error-${envVar.id}`;

							return (
								<Field key={envVar.id} data-invalid={invalid}>
									<div className="flex items-center gap-2">
										<FieldLabel htmlFor={nameId} className="sr-only">
											Variable name
										</FieldLabel>
										<Input
											id={nameId}
											placeholder="VARIABLE_NAME"
											autoComplete="off"
											autoCapitalize="none"
											spellCheck={false}
											value={envVar.key}
											disabled={disabled}
											aria-invalid={invalid || undefined}
											aria-describedby={invalid ? errorId : undefined}
											className="min-w-0 flex-1 font-mono"
											onChange={(event) =>
												onUpdate(envVar.id, "key", event.target.value)
											}
										/>
										<FieldLabel htmlFor={valueId} className="sr-only">
											Variable value
										</FieldLabel>
										<Input
											id={valueId}
											type="password"
											placeholder="Value"
											autoComplete="new-password"
											spellCheck={false}
											value={envVar.value}
											disabled={disabled}
											className="min-w-0 flex-1 font-mono"
											onChange={(event) =>
												onUpdate(envVar.id, "value", event.target.value)
											}
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											onClick={() => onRemove(envVar.id)}
											disabled={disabled}
											aria-label={`Remove ${envVar.key || "environment variable"}`}
										>
											<TrashIcon aria-hidden="true" />
										</Button>
									</div>
									{invalid ? (
										<FieldError id={errorId}>
											{ENV_VAR_KEY_DESCRIPTION}
										</FieldError>
									) : null}
								</Field>
							);
						})}
					</FieldGroup>
				) : null}
			</div>
		</details>
	);
}
