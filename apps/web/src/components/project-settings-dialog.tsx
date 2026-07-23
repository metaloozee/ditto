import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
	PlusIcon,
	SettingsIcon,
	TrashIcon,
	TriangleAlertIcon,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Separator } from "#/components/ui/separator";
import { Skeleton } from "#/components/ui/skeleton";
import { Spinner } from "#/components/ui/spinner";
import { useTRPC } from "#/integrations/trpc/react";
import { ENV_VAR_KEY_DESCRIPTION, normalizeEnvVarKey } from "#/lib/env-vars";

type SettingsProject = {
	id: string;
	name: string;
	status: "provisioning" | "ready" | "failed";
};

type ProjectSettingsDialogProps = {
	project: SettingsProject;
	trigger: React.ReactElement;
};

type DeleteProjectDialogProps = {
	project: SettingsProject;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDeleted: () => void;
};

export function ProjectSettingsDialog({
	project,
	trigger,
}: ProjectSettingsDialogProps): React.JSX.Element {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState(project.name);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [isAddingEnvVar, setIsAddingEnvVar] = useState(false);
	const [newEnvVarKey, setNewEnvVarKey] = useState("");
	const [newEnvVarValue, setNewEnvVarValue] = useState("");
	const [editingEnvVarKey, setEditingEnvVarKey] = useState<string | null>(null);
	const [editingEnvVarValue, setEditingEnvVarValue] = useState("");
	const [deletingEnvVarKey, setDeletingEnvVarKey] = useState<string | null>(
		null,
	);

	const envVarsQuery = useQuery(
		trpc.projects.listEnvVars.queryOptions(
			{ id: project.id },
			{
				enabled: open,
				refetchOnWindowFocus: false,
			},
		),
	);

	const renameProjectMutation = useMutation(
		trpc.projects.rename.mutationOptions(),
	);
	const setEnvVarMutation = useMutation(
		trpc.projects.setEnvVar.mutationOptions(),
	);
	const deleteEnvVarMutation = useMutation(
		trpc.projects.deleteEnvVar.mutationOptions(),
	);

	function resetNewEnvVarForm(): void {
		setIsAddingEnvVar(false);
		setNewEnvVarKey("");
		setNewEnvVarValue("");
	}

	function resetEditingEnvVarForm(): void {
		setEditingEnvVarKey(null);
		setEditingEnvVarValue("");
	}

	function startAddingEnvVar(): void {
		resetEditingEnvVarForm();
		setIsAddingEnvVar(true);
	}

	function startEditingEnvVar(key: string): void {
		resetNewEnvVarForm();
		setEditingEnvVarKey(key);
		setEditingEnvVarValue("");
	}

	function handleOpenChange(nextOpen: boolean): void {
		setOpen(nextOpen);
		if (nextOpen) {
			setName(project.name);
			return;
		}
		setConfirmOpen(false);
		resetNewEnvVarForm();
		resetEditingEnvVarForm();
		setDeletingEnvVarKey(null);
		renameProjectMutation.reset();
		setEnvVarMutation.reset();
		deleteEnvVarMutation.reset();
	}

	const trimmedName = name.trim();
	const hasNameChanges = trimmedName.length > 0 && trimmedName !== project.name;
	const envVarKeys = envVarsQuery.data ?? [];
	const trimmedNewEnvVarKey = newEnvVarKey.trim();
	const normalizedNewEnvVarKey = normalizeEnvVarKey(newEnvVarKey);
	const hasInvalidNewEnvVarKey =
		trimmedNewEnvVarKey.length > 0 && normalizedNewEnvVarKey === null;
	const isSavingName = renameProjectMutation.isPending;
	const isSavingEnvVar = setEnvVarMutation.isPending;
	const isDeletingEnvVar = deleteEnvVarMutation.isPending;
	const isMutatingEnvVars = isSavingEnvVar || isDeletingEnvVar;

	async function refreshEnvVars(): Promise<void> {
		await queryClient.invalidateQueries(
			trpc.projects.listEnvVars.queryFilter({ id: project.id }),
		);
	}

	async function handleRenameProject(): Promise<void> {
		if (!hasNameChanges) {
			return;
		}

		try {
			const updatedProject = await renameProjectMutation.mutateAsync({
				id: project.id,
				name: trimmedName,
			});
			setName(updatedProject.name);
			await queryClient.invalidateQueries(trpc.projects.list.queryFilter());
			await queryClient.invalidateQueries(
				trpc.projects.get.queryFilter({ id: project.id }),
			);
		} catch {
			// Mutation error state surfaces in the dialog.
		}
	}

	async function handleAddEnvVar(): Promise<void> {
		if (!isAddingEnvVar || !normalizedNewEnvVarKey) {
			return;
		}

		try {
			await setEnvVarMutation.mutateAsync({
				id: project.id,
				key: normalizedNewEnvVarKey,
				value: newEnvVarValue,
			});
			resetNewEnvVarForm();
			await refreshEnvVars();
		} catch {
			// Mutation error state surfaces in the dialog.
		}
	}

	async function handleReplaceEnvVar(): Promise<void> {
		if (!editingEnvVarKey) {
			return;
		}

		try {
			await setEnvVarMutation.mutateAsync({
				id: project.id,
				key: editingEnvVarKey,
				value: editingEnvVarValue,
			});
			resetEditingEnvVarForm();
			await refreshEnvVars();
		} catch {
			// Mutation error state surfaces in the dialog.
		}
	}

	async function handleDeleteEnvVar(key: string): Promise<void> {
		setDeletingEnvVarKey(key);

		try {
			await deleteEnvVarMutation.mutateAsync({
				id: project.id,
				key,
			});
			if (editingEnvVarKey === key) {
				resetEditingEnvVarForm();
			}
			await refreshEnvVars();
		} catch {
			// Mutation state surfaces the error in the dialog.
		}
		setDeletingEnvVarKey(null);
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={trigger}>
				<SettingsIcon aria-hidden="true" />
				<span className="sr-only">Open settings for {project.name}</span>
			</DialogTrigger>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle className="text-balance">Project settings</DialogTitle>
				</DialogHeader>

				<ScrollArea className="max-h-[70vh]">
					<div className="flex flex-col gap-5">
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor={`project-name-${project.id}`}>
									Project name
								</FieldLabel>
								<div className="flex gap-2">
									<Input
										id={`project-name-${project.id}`}
										value={name}
										onChange={(event) => setName(event.target.value)}
										disabled={isSavingName}
										autoComplete="off"
										aria-invalid={trimmedName.length === 0}
									/>
									<Button
										type="button"
										variant="outline"
										disabled={!hasNameChanges || isSavingName}
										onClick={() => {
											void handleRenameProject();
										}}
										className="shrink-0 cursor-pointer"
									>
										{isSavingName ? <Spinner /> : null}
										Save
									</Button>
								</div>
								{trimmedName.length === 0 ? (
									<FieldError>Project name is required.</FieldError>
								) : null}
								{renameProjectMutation.error ? (
									<FieldError>{renameProjectMutation.error.message}</FieldError>
								) : null}
							</Field>
						</FieldGroup>

						<Separator />

						<section
							className="flex flex-col gap-3"
							aria-labelledby="env-vars-title"
						>
							<div className="flex items-start justify-between gap-3">
								<div className="flex flex-col gap-1">
									<div className="flex items-center gap-2">
										<h3 id="env-vars-title" className="text-sm font-medium">
											Environment variables
										</h3>
										<Badge
											variant="secondary"
											className="font-mono text-[0.65rem]"
										>
											{envVarKeys.length}
										</Badge>
									</div>
									<p className="text-pretty text-xs text-muted-foreground">
										Stored encrypted and injected into agent sessions as process
										environment variables. Values stay hidden after save and can
										only be replaced.
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={startAddingEnvVar}
									disabled={
										envVarsQuery.isPending ||
										isMutatingEnvVars ||
										Boolean(envVarsQuery.error) ||
										isAddingEnvVar
									}
									className="shrink-0 cursor-pointer"
								>
									<PlusIcon data-icon="inline-start" />
									Add
								</Button>
							</div>

							{envVarsQuery.isPending ? (
								<div className="flex flex-col gap-2" aria-busy="true">
									<Skeleton className="h-8 w-full" />
									<Skeleton className="h-8 w-full" />
								</div>
							) : envVarsQuery.error ? (
								<p className="text-xs text-destructive" role="alert">
									{envVarsQuery.error.message}
								</p>
							) : envVarKeys.length === 0 ? (
								<div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
									No environment variables yet. Add one when this project needs
									secrets or runtime configuration.
								</div>
							) : (
								<FieldGroup className="gap-2">
									{envVarKeys.map(({ key }, index) => {
										const isEditing = editingEnvVarKey === key;

										return (
											<Field key={key}>
												<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
													<Input
														value={key}
														readOnly
														autoComplete="off"
														spellCheck={false}
														className="font-mono text-xs sm:flex-1"
														aria-label={`Variable ${index + 1} name`}
													/>
													{isEditing ? (
														<Input
															value={editingEnvVarValue}
															onChange={(event) =>
																setEditingEnvVarValue(event.target.value)
															}
															disabled={isMutatingEnvVars}
															autoComplete="off"
															spellCheck={false}
															className="font-mono text-xs sm:flex-1"
															aria-label={`Variable ${index + 1} replacement value`}
														/>
													) : (
														<div className="flex min-h-7 items-center rounded-md border border-dashed border-border bg-muted/20 px-3 text-xs text-muted-foreground sm:flex-1">
															Value hidden after save
														</div>
													)}
													<div className="flex items-center justify-end gap-2 sm:shrink-0">
														{isEditing ? (
															<>
																<Button
																	type="button"
																	variant="outline"
																	onClick={() => {
																		void handleReplaceEnvVar();
																	}}
																	disabled={isMutatingEnvVars}
																	className="cursor-pointer"
																>
																	{isSavingEnvVar ? <Spinner /> : null}
																	Save
																</Button>
																<Button
																	type="button"
																	variant="ghost"
																	onClick={resetEditingEnvVarForm}
																	disabled={isMutatingEnvVars}
																	className="cursor-pointer"
																>
																	Cancel
																</Button>
															</>
														) : (
															<>
																<Button
																	type="button"
																	variant="outline"
																	onClick={() => startEditingEnvVar(key)}
																	disabled={isMutatingEnvVars}
																	className="cursor-pointer"
																>
																	Replace
																</Button>
																<Button
																	type="button"
																	variant="ghost"
																	size="icon-sm"
																	onClick={() => {
																		void handleDeleteEnvVar(key);
																	}}
																	disabled={isMutatingEnvVars}
																	className="shrink-0 cursor-pointer"
																	aria-label={`Delete variable ${index + 1}`}
																>
																	{deletingEnvVarKey === key ? (
																		<Spinner />
																	) : (
																		<TrashIcon aria-hidden="true" />
																	)}
																</Button>
															</>
														)}
													</div>
												</div>
											</Field>
										);
									})}
								</FieldGroup>
							)}

							{isAddingEnvVar ? (
								<FieldGroup>
									<Field>
										<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
											<Input
												placeholder="KEY"
												value={newEnvVarKey}
												onChange={(event) =>
													setNewEnvVarKey(event.target.value)
												}
												disabled={isMutatingEnvVars}
												autoComplete="off"
												spellCheck={false}
												className="font-mono text-xs sm:flex-1"
												aria-label="New variable name"
												aria-invalid={hasInvalidNewEnvVarKey || undefined}
												aria-describedby={
													hasInvalidNewEnvVarKey
														? `new-env-var-key-error-${project.id}`
														: undefined
												}
											/>
											<Input
												placeholder="VALUE"
												value={newEnvVarValue}
												onChange={(event) =>
													setNewEnvVarValue(event.target.value)
												}
												disabled={isMutatingEnvVars}
												autoComplete="off"
												spellCheck={false}
												className="font-mono text-xs sm:flex-1"
												aria-label="New variable value"
											/>
											<div className="flex items-center justify-end gap-2 sm:shrink-0">
												<Button
													type="button"
													variant="outline"
													onClick={() => {
														void handleAddEnvVar();
													}}
													disabled={
														trimmedNewEnvVarKey.length === 0 ||
														hasInvalidNewEnvVarKey ||
														isMutatingEnvVars
													}
													className="cursor-pointer"
												>
													{isSavingEnvVar ? <Spinner /> : null}
													Save
												</Button>
												<Button
													type="button"
													variant="ghost"
													onClick={resetNewEnvVarForm}
													disabled={isMutatingEnvVars}
													className="cursor-pointer"
												>
													Cancel
												</Button>
											</div>
										</div>
										{hasInvalidNewEnvVarKey ? (
											<FieldError id={`new-env-var-key-error-${project.id}`}>
												{ENV_VAR_KEY_DESCRIPTION}
											</FieldError>
										) : null}
									</Field>
								</FieldGroup>
							) : null}

							{setEnvVarMutation.error ? (
								<p className="text-xs text-destructive" role="alert">
									{setEnvVarMutation.error.message}
								</p>
							) : null}

							{deleteEnvVarMutation.error ? (
								<p className="text-xs text-destructive" role="alert">
									{deleteEnvVarMutation.error.message}
								</p>
							) : null}
						</section>

						<Separator />

						<section
							className="rounded-lg border border-destructive/20 bg-destructive/5 p-3"
							aria-labelledby="danger-zone-title"
						>
							<div className="flex items-end gap-3">
								<div className="flex items-start gap-3">
									<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
										<TriangleAlertIcon aria-hidden="true" className="size-4" />
									</div>
									<div className="flex flex-col items-start gap-1">
										<h3 id="danger-zone-title" className="text-sm font-medium">
											Delete project
										</h3>
										<p className="text-pretty text-xs text-muted-foreground">
											Permanently removes this project and its chats. This
											action cannot be undone.
										</p>
									</div>
								</div>
								<Button
									type="button"
									variant="destructive"
									onClick={() => setConfirmOpen(true)}
									className="w-fit shrink-0 cursor-pointer"
								>
									Delete Project
								</Button>
							</div>
						</section>
					</div>
				</ScrollArea>

				<DeleteProjectDialog
					project={project}
					open={confirmOpen}
					onOpenChange={setConfirmOpen}
					onDeleted={() => handleOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}

function DeleteProjectDialog({
	project,
	open,
	onOpenChange,
	onDeleted,
}: DeleteProjectDialogProps): React.JSX.Element {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { projectId: activeProjectId } = useParams({ strict: false });
	const targetText = `DELETE ${project.name}`;
	const deleteProjectMutation = useMutation(
		trpc.projects.deleteProject.mutationOptions(),
	);

	const form = useForm({
		defaultValues: {
			confirmation: "",
		},
		onSubmit: async ({ value }) => {
			if (value.confirmation !== targetText) {
				return;
			}

			await deleteProjectMutation.mutateAsync({ id: project.id });
			await queryClient.invalidateQueries(trpc.projects.list.queryFilter());
			onOpenChange(false);
			onDeleted();

			if (activeProjectId === project.id) {
				await navigate({ to: "/" });
			}
		},
	});

	useEffect(() => {
		if (!open) {
			form.reset();
		}
	}, [form, open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-balance">
						Delete {project.name}?
					</DialogTitle>
					<DialogDescription>
						This removes the project, active sessions, and stored environment
						variables. Type the confirmation text to enable deletion.
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
					className="flex flex-col gap-4"
				>
					<FieldGroup>
						<form.Field
							name="confirmation"
							validators={{
								onChange: ({ value }) =>
									value === targetText
										? undefined
										: `Type ${targetText} to confirm.`,
							}}
						>
							{(field) => {
								const isInvalid =
									field.state.meta.isTouched && !field.state.meta.isValid;

								return (
									<Field data-invalid={isInvalid}>
										<FieldLabel htmlFor={field.name}>Confirmation</FieldLabel>
										<Input
											id={field.name}
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											placeholder={targetText}
											autoComplete="off"
											spellCheck={false}
											className="font-mono text-xs"
											aria-invalid={isInvalid}
											disabled={deleteProjectMutation.isPending}
										/>
										<FieldDescription>
											Type{" "}
											<code className="rounded bg-muted px-1 py-0.5 font-mono">
												{targetText}
											</code>
											.
										</FieldDescription>
										<FieldError
											errors={field.state.meta.errors.map((error) => ({
												message: String(error),
											}))}
										/>
									</Field>
								);
							}}
						</form.Field>
					</FieldGroup>

					{deleteProjectMutation.error ? (
						<p className="text-xs text-destructive" role="alert">
							{deleteProjectMutation.error.message}
						</p>
					) : null}

					<DialogFooter className="flex flex-row items-center gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={deleteProjectMutation.isPending}
							className="cursor-pointer"
						>
							Cancel
						</Button>
						<form.Subscribe selector={(state) => state.values.confirmation}>
							{(confirmation) => (
								<Button
									type="submit"
									variant="destructive"
									disabled={
										confirmation !== targetText ||
										deleteProjectMutation.isPending
									}
									className="min-w-20 cursor-pointer"
								>
									{deleteProjectMutation.isPending ? <Spinner /> : null}
									Delete
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
