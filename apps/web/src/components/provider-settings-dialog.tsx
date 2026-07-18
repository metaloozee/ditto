import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useTRPC } from "#/integrations/trpc/react";
import {
	answerProviderAuthPrompt,
	cancelProviderAuth,
	isOpenableAuthUrl,
	streamProviderAuthLogin,
} from "#/lib/provider-auth-client";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export function ProviderSettingsDialog({ open, onOpenChange }: Props) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const titleId = useId();
	const statusRef = useRef<HTMLDivElement>(null);

	const catalogQuery = useQuery(trpc.providerAuth.catalog.queryOptions());
	const connectionsQuery = useQuery(
		trpc.providerAuth.connections.queryOptions(),
	);
	const disconnectMutation = useMutation(
		trpc.providerAuth.disconnect.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(
					trpc.providerAuth.connections.queryFilter(),
				);
				await queryClient.invalidateQueries(
					trpc.providerAuth.models.queryFilter(),
				);
			},
		}),
	);

	const [connecting, setConnecting] = useState<{
		providerId: string;
		authType: "api_key" | "oauth";
	} | null>(null);
	const [attemptId, setAttemptId] = useState<string | null>(null);
	const attemptIdRef = useRef<string | null>(null);
	const [status, setStatus] = useState("");
	const [prompt, setPrompt] = useState<{
		promptId: string;
		type: "text" | "secret" | "select" | "manual_code";
		message: string;
		placeholder?: string;
		options?: Array<{ id: string; label: string }>;
	} | null>(null);
	const [answer, setAnswer] = useState("");
	const [deviceCode, setDeviceCode] = useState<string | null>(null);
	const [authUrl, setAuthUrl] = useState<{
		url: string;
		clickable: boolean;
		instructions?: string;
	} | null>(null);
	const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(
		null,
	);
	const abortRef = useRef<AbortController | null>(null);
	const cancellingRef = useRef(false);

	const clearLocalSecrets = () => {
		setPrompt(null);
		setAnswer("");
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
			if (id) {
				try {
					await cancelProviderAuth({ attemptId: id });
				} catch {
					// ignore
				}
			}
			attemptIdRef.current = null;
			setAttemptId(null);
			setConnecting(null);
			setStatus("");
			clearLocalSecrets();
		} finally {
			cancellingRef.current = false;
		}
	};

	const cancelActiveAttempt = () => cancelActiveAttemptRef.current();

	useEffect(() => {
		if (!open) {
			void cancelActiveAttemptRef.current();
		}
	}, [open]);

	useEffect(() => {
		return () => {
			void cancelActiveAttemptRef.current();
		};
	}, []);

	const connections = new Map(
		(connectionsQuery.data?.connections ?? []).map((c) => [c.providerId, c]),
	);

	const startConnect = async (
		providerId: string,
		authType: "api_key" | "oauth",
	) => {
		await cancelActiveAttempt();
		setConnecting({ providerId, authType });
		setStatus("Connecting…");
		const ac = new AbortController();
		abortRef.current = ac;
		try {
			await streamProviderAuthLogin({
				providerId,
				authType,
				signal: ac.signal,
				onEvent: (event) => {
					if (event.event === "meta") {
						attemptIdRef.current = event.data.attemptId;
						setAttemptId(event.data.attemptId);
					} else if (event.event === "prompt") {
						setPrompt({
							promptId: event.data.promptId,
							type: event.data.type,
							message: event.data.message,
							placeholder: event.data.placeholder,
							options: event.data.options,
						});
						setAnswer("");
						setStatus(event.data.message);
					} else if (event.event === "device_code") {
						setDeviceCode(event.data.userCode);
						const clickable = isOpenableAuthUrl(
							event.data.verificationUri,
							event.data.clickable ?? false,
						);
						setAuthUrl({
							url: event.data.verificationUri,
							clickable,
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
							instructions: event.data.instructions,
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
						if (event.data.ok) {
							setStatus("Connected.");
							void queryClient.invalidateQueries(
								trpc.providerAuth.connections.queryFilter(),
							);
							void queryClient.invalidateQueries(
								trpc.providerAuth.models.queryFilter(),
							);
						}
						setConnecting(null);
						attemptIdRef.current = null;
						setAttemptId(null);
						clearLocalSecrets();
					}
				},
			});
		} catch {
			if (!ac.signal.aborted) {
				setStatus("Connection failed.");
			}
			setConnecting(null);
			clearLocalSecrets();
		}
	};

	const submitAnswer = async () => {
		if (!attemptId || !prompt) return;
		const value = answer;
		setAnswer("");
		await answerProviderAuthPrompt({
			attemptId,
			promptId: prompt.promptId,
			value,
		});
		setPrompt(null);
	};

	const closeDialog = () => {
		void cancelActiveAttempt();
		onOpenChange(false);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					void cancelActiveAttempt();
				}
				onOpenChange(next);
			}}
		>
			<DialogContent aria-labelledby={titleId} className="max-w-lg">
				<DialogHeader>
					<DialogTitle id={titleId}>Account provider settings</DialogTitle>
					<DialogDescription>
						Connections apply to all of your projects and sandboxes. Secrets are
						never shown after you save them.
					</DialogDescription>
				</DialogHeader>

				<div
					ref={statusRef}
					aria-live="polite"
					className="min-h-5 text-sm text-muted-foreground"
				>
					{status}
				</div>

				<ul className="max-h-80 space-y-3 overflow-y-auto">
					{(catalogQuery.data?.providers ?? []).map((provider) => {
						const conn = connections.get(provider.providerId);
						const state =
							conn?.status === "needs_relogin"
								? "needs re-login"
								: conn?.status === "connected"
									? conn.authType === "oauth"
										? "connected via subscription"
										: "connected via API key"
									: connecting?.providerId === provider.providerId
										? "connecting"
										: "not connected";
						return (
							<li
								key={provider.providerId}
								className="rounded-md border p-3 text-sm"
							>
								<div className="flex items-start justify-between gap-2">
									<div>
										<div className="font-medium">{provider.name}</div>
										<div className="text-muted-foreground">{state}</div>
										{conn?.lastErrorCode ? (
											<div className="text-destructive text-xs">
												{conn.lastErrorCode}
											</div>
										) : null}
										{provider.providerId === "anthropic" ? (
											<p className="mt-1 text-xs text-muted-foreground">
												Claude Pro/Max via PI uses Anthropic extra usage billed
												per token, not ordinary plan limits. After the auth URL
												opens, paste the localhost redirect URL/code here.
											</p>
										) : null}
									</div>
									<div className="flex flex-col gap-1">
										{provider.authMethods.map((method) => (
											<Button
												key={method.type}
												size="sm"
												variant="outline"
												disabled={!!connecting}
												onClick={() =>
													void startConnect(provider.providerId, method.type)
												}
											>
												{method.label}
											</Button>
										))}
										{conn ? (
											<Button
												size="sm"
												variant="destructive"
												disabled={!!connecting}
												onClick={() =>
													setConfirmDisconnect(provider.providerId)
												}
											>
												Disconnect
											</Button>
										) : null}
									</div>
								</div>
							</li>
						);
					})}
				</ul>

				{deviceCode ? (
					<div className="rounded-md border p-3 text-sm">
						<div className="font-medium">Device code</div>
						<code className="text-base tracking-wider">{deviceCode}</code>
						<Button
							className="mt-2"
							size="sm"
							variant="secondary"
							onClick={() => void navigator.clipboard.writeText(deviceCode)}
						>
							Copy code
						</Button>
					</div>
				) : null}

				{authUrl ? (
					<div className="rounded-md border p-3 text-sm break-all">
						{authUrl.clickable ? (
							<a
								href={authUrl.url}
								target="_blank"
								rel="noreferrer"
								className="underline"
							>
								{authUrl.url}
							</a>
						) : (
							<span>{authUrl.url}</span>
						)}
						{authUrl.instructions ? (
							<p className="mt-1 text-muted-foreground">
								{authUrl.instructions}
							</p>
						) : null}
					</div>
				) : null}

				{prompt ? (
					<div className="space-y-2 rounded-md border p-3">
						<Label htmlFor="provider-auth-answer">{prompt.message}</Label>
						{prompt.type === "select" ? (
							<select
								id="provider-auth-answer"
								className="w-full rounded-md border bg-background p-2"
								value={answer}
								onChange={(e) => setAnswer(e.target.value)}
							>
								<option value="">Select…</option>
								{prompt.options?.map((o) => (
									<option key={o.id} value={o.id}>
										{o.label}
									</option>
								))}
							</select>
						) : (
							<Input
								id="provider-auth-answer"
								type={prompt.type === "secret" ? "password" : "text"}
								autoComplete="off"
								placeholder={prompt.placeholder}
								value={answer}
								onChange={(e) => setAnswer(e.target.value)}
							/>
						)}
						<div className="flex gap-2">
							<Button size="sm" onClick={() => void submitAnswer()}>
								Submit
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => void cancelActiveAttempt()}
							>
								Cancel
							</Button>
						</div>
					</div>
				) : null}

				{confirmDisconnect ? (
					<div className="rounded-md border border-destructive/40 p-3 text-sm">
						<p>
							Disconnect {confirmDisconnect}? Upstream token revocation is
							provider-managed. Projects and chats are kept.
						</p>
						<div className="mt-2 flex gap-2">
							<Button
								size="sm"
								variant="destructive"
								onClick={() => {
									void disconnectMutation.mutateAsync({
										providerId: confirmDisconnect,
									});
									setConfirmDisconnect(null);
								}}
							>
								Confirm disconnect
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setConfirmDisconnect(null)}
							>
								Keep connected
							</Button>
						</div>
					</div>
				) : null}

				<DialogFooter>
					<Button variant="secondary" onClick={closeDialog}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
