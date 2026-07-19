import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2Icon,
	CircleAlertIcon,
	ExternalLinkIcon,
	LoaderIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CopyButton } from "#/components/copy-button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button, buttonVariants } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Field, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Skeleton } from "#/components/ui/skeleton";
import { TooltipProvider } from "#/components/ui/tooltip";
import { useTRPC } from "#/integrations/trpc/react";
import {
	answerProviderAuthPrompt,
	cancelProviderAuth,
	isOpenableAuthUrl,
	streamProviderAuthLogin,
} from "#/lib/provider-auth-client";

const PROVIDER_DETAILS: Record<string, { description: string; logo: string }> =
	{
		openai: {
			description: "Use OpenAI models with your own API key.",
			logo: "openai",
		},
		anthropic: {
			description: "Use an Anthropic API key or connect a Claude subscription.",
			logo: "anthropic",
		},
		"openai-codex": {
			description: "Connect your ChatGPT account for Codex models.",
			logo: "openai",
		},
	};

type AuthPrompt = {
	promptId: string;
	type: "text" | "secret" | "select" | "manual_code";
	message: string;
	placeholder?: string;
	options?: Array<{ id: string; label: string }>;
};

function AuthPromptForm({
	prompt,
	attemptId,
	onCancel,
	onSubmitted,
}: {
	prompt: AuthPrompt;
	attemptId: string;
	onCancel: () => void;
	onSubmitted: () => void;
}) {
	const form = useForm({
		defaultValues: { answer: "" },
		onSubmit: async ({ value }) => {
			await answerProviderAuthPrompt({
				attemptId,
				promptId: prompt.promptId,
				value: value.answer,
			});
			onSubmitted();
		},
	});

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="answer">
				{(field) => (
					<Field>
						<FieldLabel htmlFor={field.name}>{prompt.message}</FieldLabel>
						{prompt.type === "select" ? (
							<select
								id={field.name}
								name={field.name}
								className="h-7 w-full rounded-md border border-input bg-input/20 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 md:text-xs/relaxed"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							>
								<option value="">Select…</option>
								{prompt.options?.map((option) => (
									<option key={option.id} value={option.id}>
										{option.label}
									</option>
								))}
							</select>
						) : (
							<Input
								id={field.name}
								name={field.name}
								type={prompt.type === "secret" ? "password" : "text"}
								autoComplete="off"
								placeholder={prompt.placeholder}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						)}
					</Field>
				)}
			</form.Field>

			<DialogFooter className="mt-4">
				<Button type="button" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
				<form.Subscribe selector={(state) => state.values.answer}>
					{(answer) => (
						<Button type="submit" disabled={!answer}>
							Submit
						</Button>
					)}
				</form.Subscribe>
			</DialogFooter>
		</form>
	);
}

export function ProviderSettingsPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const catalogQuery = useQuery(trpc.providerAuth.catalog.queryOptions());
	const connectionsQuery = useQuery(
		trpc.providerAuth.connections.queryOptions(),
	);
	const disconnectMutation = useMutation(
		trpc.providerAuth.disconnect.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries(
						trpc.providerAuth.connections.queryFilter(),
					),
					queryClient.invalidateQueries(trpc.providerAuth.models.queryFilter()),
				]);
			},
		}),
	);

	const [connecting, setConnecting] = useState<{
		providerId: string;
		authType: "api_key" | "oauth";
	} | null>(null);
	const attemptIdRef = useRef<string | null>(null);
	const [status, setStatus] = useState("");
	const [prompt, setPrompt] = useState<AuthPrompt | null>(null);
	const [deviceCode, setDeviceCode] = useState<string | null>(null);
	const [authUrl, setAuthUrl] = useState<{
		url: string;
		clickable: boolean;
	} | null>(null);
	const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(
		null,
	);
	const abortRef = useRef<AbortController | null>(null);
	const cancellingRef = useRef(false);

	const clearLocalSecrets = () => {
		setPrompt(null);
		setDeviceCode(null);
		setAuthUrl(null);
	};

	const cancelActiveAttemptRef = useRef(async () => {});
	cancelActiveAttemptRef.current = async () => {
		if (cancellingRef.current) return;
		cancellingRef.current = true;
		try {
			abortRef.current?.abort();
			abortRef.current = null;
			const id = attemptIdRef.current;
			attemptIdRef.current = null;
			if (id) {
				try {
					await cancelProviderAuth({ attemptId: id });
				} catch {
					// Local attempt already closed; server cleanup is best-effort.
				}
			}
			setConnecting(null);
			setStatus("");
			clearLocalSecrets();
		} finally {
			cancellingRef.current = false;
		}
	};

	useEffect(() => {
		return () => {
			void cancelActiveAttemptRef.current();
		};
	}, []);

	const providers = catalogQuery.data?.providers ?? [];
	const connections = new Map(
		(connectionsQuery.data?.connections ?? []).map((connection) => [
			connection.providerId,
			connection,
		]),
	);

	const connectingProvider = connecting
		? providers.find(
				(provider) => provider.providerId === connecting.providerId,
			)
		: undefined;
	const connectingMethod = connectingProvider?.authMethods.find(
		(method) => method.type === connecting?.authType,
	);
	const connectingDetails = connectingProvider
		? (PROVIDER_DETAILS[connectingProvider.providerId] ?? {
				logo: connectingProvider.providerId,
			})
		: null;
	const isSubscriptionConnection = connecting?.authType === "oauth";
	const connectionName =
		connectingMethod?.label ?? connectingProvider?.name ?? "provider";

	const startConnect = async (
		providerId: string,
		authType: "api_key" | "oauth",
	) => {
		await cancelActiveAttemptRef.current();
		setConnecting({ providerId, authType });
		setStatus("Connecting…");
		const controller = new AbortController();
		abortRef.current = controller;

		try {
			await streamProviderAuthLogin({
				providerId,
				authType,
				signal: controller.signal,
				onEvent: (event) => {
					if (controller.signal.aborted) return;
					if (event.event === "meta") {
						attemptIdRef.current = event.data.attemptId;
					} else if (event.event === "prompt") {
						setPrompt({
							promptId: event.data.promptId,
							type: event.data.type,
							message: event.data.message,
							placeholder: event.data.placeholder,
							options: event.data.options,
						});
					} else if (event.event === "device_code") {
						setDeviceCode(event.data.userCode);
						setAuthUrl({
							url: event.data.verificationUri,
							clickable: isOpenableAuthUrl(
								event.data.verificationUri,
								event.data.clickable ?? false,
							),
						});
						setStatus("Enter the device code at the verification URL.");
					} else if (event.event === "auth_url") {
						const clickable = isOpenableAuthUrl(
							event.data.url,
							event.data.clickable,
						);
						setAuthUrl({
							url: event.data.url,
							clickable,
						});
						if (clickable) {
							window.open(event.data.url, "_blank", "noopener,noreferrer");
						}
						setStatus(
							event.data.instructions ??
								(clickable
									? "Complete sign-in in the opened window."
									: "Copy the URL and complete sign-in, then paste the redirect if asked."),
						);
					} else if (event.event === "info" || event.event === "progress") {
						setStatus(event.data.message);
					} else if (event.event === "error") {
						setStatus(event.data.message);
					} else if (event.event === "done") {
						abortRef.current = null;
						attemptIdRef.current = null;
						clearLocalSecrets();
						if (event.data.ok) {
							setStatus("Connected.");
							setConnecting(null);
							void Promise.all([
								queryClient.invalidateQueries(
									trpc.providerAuth.connections.queryFilter(),
								),
								queryClient.invalidateQueries(
									trpc.providerAuth.models.queryFilter(),
								),
							]);
						} else {
							setStatus((current) => current || "Connection failed.");
						}
					}
				},
			});
		} catch {
			if (controller.signal.aborted) return;
			setStatus("Connection failed.");
			setConnecting(null);
			clearLocalSecrets();
			abortRef.current = null;
			attemptIdRef.current = null;
		}
	};

	const disconnectProvider = async () => {
		if (!confirmDisconnect) return;
		try {
			await disconnectMutation.mutateAsync({
				providerId: confirmDisconnect,
			});
			setConfirmDisconnect(null);
		} catch {
			// Mutation state renders the error inside the confirmation dialog.
		}
	};

	const disconnectProviderName = providers.find(
		(provider) => provider.providerId === confirmDisconnect,
	)?.name;
	const isLoading = catalogQuery.isPending || connectionsQuery.isPending;
	const queryError = catalogQuery.error ?? connectionsQuery.error;

	return (
		<main className="min-h-dvh px-6 py-10 sm:px-10 lg:py-14">
			<div className="mx-auto w-full max-w-3xl">
				<header className="border-b border-border/70 pb-8">
					<p className="mb-2 text-xs font-medium text-muted-foreground">
						Account
					</p>
					<h1 className="text-2xl font-semibold text-balance">Settings</h1>
					<p className="mt-2 max-w-xl text-sm text-pretty text-muted-foreground">
						Manage the services Ditto can use on your behalf.
					</p>
				</header>

				<section id="ai-providers" className="mt-10 min-w-0 scroll-mt-10">
					<div className="border-b border-border/70 pb-5">
						<h2 className="text-lg font-semibold text-balance">AI Providers</h2>
						<p className="mt-1 max-w-2xl text-sm text-pretty text-muted-foreground">
							Connect an API key or provider subscription once and use it across
							all of your projects and sandboxes. Saved secrets are never shown
							again.
						</p>
					</div>

					{isLoading ? (
						<div aria-busy="true">
							<span className="sr-only">Loading AI providers</span>
							{["provider-1", "provider-2", "provider-3"].map((provider) => (
								<div
									key={provider}
									className="flex items-center gap-4 border-b border-border/70 py-5"
								>
									<Skeleton className="size-9 shrink-0" />
									<div className="flex flex-1 flex-col gap-2">
										<Skeleton className="h-4 w-28" />
										<Skeleton className="h-3 w-56 max-w-full" />
									</div>
									<Skeleton className="h-8 w-24 shrink-0" />
								</div>
							))}
						</div>
					) : queryError ? (
						<div
							className="flex items-start gap-3 border-b border-border/70 py-5 text-sm"
							role="alert"
						>
							<CircleAlertIcon
								className="mt-0.5 size-4 shrink-0 text-destructive"
								aria-hidden="true"
							/>
							<div>
								<p className="font-medium text-destructive">
									Providers could not be loaded
								</p>
								<p className="mt-1 text-pretty text-muted-foreground">
									{queryError.message}
								</p>
							</div>
						</div>
					) : (
						<ul className="divide-y divide-border/70 border-b border-border/70">
							{providers.map((provider) => {
								const connection = connections.get(provider.providerId);
								const isConnected = connection?.status === "connected";
								const details = PROVIDER_DETAILS[provider.providerId] ?? {
									description: "Use this provider across every Ditto project.",
									logo: provider.providerId,
								};
								const connectionLabel =
									connection?.status === "needs_relogin"
										? "Needs re-login"
										: isConnected
											? connection.authType === "oauth"
												? "Connected via subscription"
												: "Connected via API key"
											: "Not connected";

								return (
									<li key={provider.providerId} className="py-5">
										<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
											<div className="flex min-w-0 gap-3">
												<img
													src={`https://models.dev/logos/${details.logo}.svg`}
													alt=""
													loading="lazy"
													className="size-9 shrink-0 rounded-md bg-white p-1.5 ring-1 ring-black/10"
												/>
												<div className="min-w-0">
													<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
														<h3 className="font-medium text-balance">
															{provider.name}
														</h3>
														<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
															{isConnected ? (
																<CheckCircle2Icon
																	className="size-3.5"
																	aria-hidden="true"
																/>
															) : null}
															{connectionLabel}
														</span>
													</div>
													<p className="mt-1 text-sm text-pretty text-muted-foreground">
														{details.description}
													</p>
													{connection?.lastErrorCode ? (
														<p
															className="mt-1 text-xs text-pretty text-destructive"
															role="alert"
														>
															{connection.lastErrorCode}
														</p>
													) : null}
													{provider.providerId === "anthropic" ? (
														<p className="mt-2 max-w-xl text-xs text-pretty text-muted-foreground">
															Claude Pro/Max via PI uses Anthropic extra usage
															billed per token, not ordinary plan limits. After
															the auth URL opens, paste the localhost redirect
															URL or code below.
														</p>
													) : null}
												</div>
											</div>

											<div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
												{isConnected ? (
													<Button
														variant="destructive"
														disabled={Boolean(connecting)}
														onClick={() => {
															disconnectMutation.reset();
															setConfirmDisconnect(provider.providerId);
														}}
													>
														Disconnect
													</Button>
												) : (
													provider.authMethods.map((method) => (
														<Button
															key={method.type}
															variant="outline"
															disabled={Boolean(connecting)}
															onClick={() =>
																void startConnect(
																	provider.providerId,
																	method.type,
																)
															}
														>
															{connecting?.providerId === provider.providerId &&
															connecting.authType === method.type ? (
																<LoaderIcon
																	data-icon="inline-start"
																	className="animate-spin"
																/>
															) : null}
															{connection
																? `Reconnect with ${method.label}`
																: method.label}
														</Button>
													))
												)}
											</div>
										</div>
									</li>
								);
							})}
						</ul>
					)}
				</section>
			</div>

			<Dialog
				open={Boolean(connecting)}
				onOpenChange={(open) => {
					if (!open) void cancelActiveAttemptRef.current();
				}}
			>
				<DialogContent
					className="gap-0 overflow-hidden p-0 sm:max-w-md"
					showCloseButton
				>
					<DialogHeader className="px-5 pt-5 pr-12 pb-4">
						<div className="flex items-start gap-3">
							{connectingDetails ? (
								<img
									src={`https://models.dev/logos/${connectingDetails.logo}.svg`}
									alt=""
									className="size-10 shrink-0 rounded-lg bg-white p-2 ring-1 ring-black/10"
								/>
							) : null}
							<div className="min-w-0">
								<p className="mb-1 text-xs font-medium text-muted-foreground">
									{isSubscriptionConnection
										? "Subscription connection"
										: "API credential"}
								</p>
								<DialogTitle className="text-balance">
									Connect {connectionName}
								</DialogTitle>
								<DialogDescription className="mt-1">
									{isSubscriptionConnection
										? "Authorize Ditto once, then use this connection in every project."
										: "Your credential is encrypted and never shown again after you save it."}
								</DialogDescription>
							</div>
						</div>
					</DialogHeader>

					<div className="flex flex-col gap-5 border-t border-border/70 px-5 py-5">
						{!prompt && !deviceCode && !authUrl && status ? (
							<output
								aria-atomic="true"
								className="block min-h-8 text-sm text-pretty text-muted-foreground"
							>
								{status}
							</output>
						) : null}

						{deviceCode ? (
							<section
								className="flex items-center justify-between gap-4"
								aria-labelledby="provider-device-code-label"
							>
								<div className="min-w-0">
									<p
										id="provider-device-code-label"
										className="text-xs font-medium text-muted-foreground"
									>
										1 · Copy verification code
									</p>
									<p className="mt-1 truncate font-mono text-lg font-semibold tabular-nums">
										{deviceCode}
									</p>
								</div>
								<TooltipProvider>
									<CopyButton
										value={deviceCode}
										label="Copy code"
										className="size-10 shrink-0"
									/>
								</TooltipProvider>
							</section>
						) : null}

						{authUrl ? (
							<section
								className="flex flex-col gap-2 border-t border-border/70 pt-5"
								aria-labelledby="provider-auth-url-label"
							>
								<p
									id="provider-auth-url-label"
									className="text-xs font-medium text-muted-foreground"
								>
									{deviceCode
										? "2 · Continue in your browser"
										: "Continue in your browser"}
								</p>
								{status ? (
									<output
										aria-atomic="true"
										className="block text-sm text-pretty text-muted-foreground"
									>
										{status}
									</output>
								) : null}
								{authUrl.clickable ? (
									<a
										href={authUrl.url}
										target="_blank"
										rel="noreferrer"
										className={buttonVariants({
											size: "lg",
											className: "h-10 w-fit",
										})}
									>
										Open sign-in page
										<ExternalLinkIcon
											data-icon="inline-end"
											aria-hidden="true"
										/>
									</a>
								) : (
									<div className="flex items-start gap-2">
										<p className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
											{authUrl.url}
										</p>
										<TooltipProvider>
											<CopyButton
												value={authUrl.url}
												label="Copy authentication URL"
												className="size-10 shrink-0"
											/>
										</TooltipProvider>
									</div>
								)}
							</section>
						) : null}

						{prompt && attemptIdRef.current ? (
							<AuthPromptForm
								key={prompt.promptId}
								prompt={prompt}
								attemptId={attemptIdRef.current}
								onCancel={() => void cancelActiveAttemptRef.current()}
								onSubmitted={() => setPrompt(null)}
							/>
						) : (
							<DialogFooter className="border-t border-border/70 pt-4">
								<Button
									type="button"
									variant="ghost"
									onClick={() => void cancelActiveAttemptRef.current()}
								>
									Cancel
								</Button>
							</DialogFooter>
						)}
					</div>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={Boolean(confirmDisconnect)}
				onOpenChange={(open) => {
					if (!open) setConfirmDisconnect(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="text-balance">
							Disconnect {disconnectProviderName ?? "provider"}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							The credential will be removed from Ditto. Upstream token
							revocation is managed by the provider; your projects and chats
							will be kept.
						</AlertDialogDescription>
						{disconnectMutation.error ? (
							<p className="text-xs text-pretty text-destructive" role="alert">
								{disconnectMutation.error.message}
							</p>
						) : null}
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep connected</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={disconnectMutation.isPending}
							onClick={() => void disconnectProvider()}
						>
							{disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</main>
	);
}
