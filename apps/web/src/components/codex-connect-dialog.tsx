import { useEffect, useRef, useState } from "react";
import { CopyButton } from "#/components/copy-button";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { toast } from "#/components/ui/toast";
import {
	CODEX_SIGN_IN_FAILED,
	type PendingDeviceAuth,
	type useCodexConnection,
} from "#/lib/candidate-session-client";
import { CODEX_DEVICE_VERIFICATION_URI } from "#/lib/codex-device-login";

type CodexConnection = ReturnType<typeof useCodexConnection>;

const UNAVAILABLE_CODES = new Set([
	"codex_device_auth_unavailable",
	"codex_hosted_auth_unverified",
]);

/**
 * Copies the code and opens OpenAI's sign-in page in one click. Both calls
 * must start synchronously inside the click handler: the clipboard write needs
 * the focused Ditto tab, and browsers block pop-ups after an await.
 */
export function openCodexSignIn(
	deviceAuth: PendingDeviceAuth,
	onCopied: (copied: boolean) => void,
) {
	try {
		navigator.clipboard.writeText(deviceAuth.userCode).then(
			() => onCopied(true),
			() => onCopied(false),
		);
	} catch {
		onCopied(false);
	}
	if (deviceAuth.verificationUri === CODEX_DEVICE_VERIFICATION_URI) {
		window.open(CODEX_DEVICE_VERIFICATION_URI, "_blank", "noopener,noreferrer");
	}
}

function formatCountdown(ms: number) {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function CodexConnectDialog({
	open,
	onOpenChange,
	codex,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	codex: CodexConnection;
}) {
	const { deviceAuth, status, lastErrorCode, clearDeviceAuth, runAction } =
		codex;
	const [now, setNow] = useState(() => Date.now());
	const [copyResult, setCopyResult] = useState<{
		code: string;
		copied: boolean;
	} | null>(null);
	const latest = useRef({ clearDeviceAuth, onOpenChange });
	latest.current = { clearDeviceAuth, onOpenChange };

	const ticking = open && deviceAuth !== null;
	useEffect(() => {
		if (!ticking) return;
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [ticking]);

	const connected = open && deviceAuth !== null && status === "connected";
	useEffect(() => {
		if (!connected) return;
		toast.add({ description: "Codex connected." });
		latest.current.clearDeviceAuth();
		latest.current.onOpenChange(false);
	}, [connected]);

	function handleOpenChange(next: boolean) {
		// Closing stops polling but does not cancel the sign-in on OpenAI's side.
		if (!next) clearDeviceAuth();
		onOpenChange(next);
	}

	const remaining = deviceAuth ? deviceAuth.expiresAt - now : 0;
	const unavailable = !deviceAuth && UNAVAILABLE_CODES.has(lastErrorCode ?? "");
	const failed =
		(deviceAuth !== null && status === "reconnect_required") ||
		(!deviceAuth && lastErrorCode === CODEX_SIGN_IN_FAILED);
	const expired =
		deviceAuth !== null &&
		!failed &&
		(status === "disconnected" || remaining <= 0);
	const waiting = deviceAuth !== null && !failed && !expired;
	const trustedUri =
		deviceAuth?.verificationUri === CODEX_DEVICE_VERIFICATION_URI;
	const copyState =
		deviceAuth && copyResult?.code === deviceAuth.userCode
			? copyResult.copied
			: null;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle className="text-balance">Connect Codex</DialogTitle>
					<DialogDescription className="sr-only">
						Enter this code on OpenAI to connect your ChatGPT subscription.
					</DialogDescription>
				</DialogHeader>

				{waiting && deviceAuth ? (
					<div className="flex flex-col items-center gap-4">
						<p
							role="img"
							className="font-mono text-3xl font-semibold tracking-widest"
							aria-label={deviceAuth.userCode.split("").join(" ")}
						>
							{deviceAuth.userCode}
						</p>
						{trustedUri ? (
							<Button
								type="button"
								onClick={() =>
									openCodexSignIn(deviceAuth, (copied) =>
										setCopyResult({ code: deviceAuth.userCode, copied }),
									)
								}
							>
								Copy code and open OpenAI ↗
							</Button>
						) : null}
						{copyState === false || !trustedUri ? (
							<CopyButton value={deviceAuth.userCode} />
						) : null}
						<div
							className="flex flex-col items-center gap-1 text-muted-foreground"
							aria-live="polite"
						>
							{copyState ? (
								<p className="text-pretty">
									Code copied. Paste it on OpenAI's page.
								</p>
							) : null}
							<p>Waiting for approval…</p>
						</div>
						<p
							className="text-muted-foreground tabular-nums"
							aria-hidden="true"
						>
							{formatCountdown(remaining)}
						</p>
					</div>
				) : null}

				{expired ? <p className="text-pretty">This code expired.</p> : null}
				{failed ? (
					<p className="text-pretty">Sign-in didn't complete.</p>
				) : null}
				{unavailable ? (
					<p className="text-pretty">
						Codex sign-in isn't available right now.
					</p>
				) : null}

				{expired || failed || unavailable ? (
					<DialogFooter>
						{unavailable ? (
							<Button
								type="button"
								variant="outline"
								onClick={() => handleOpenChange(false)}
							>
								Close
							</Button>
						) : (
							<Button
								type="button"
								disabled={codex.actionPending}
								onClick={() => runAction("connect")}
							>
								{failed ? "Try again" : "Get a new code"}
							</Button>
						)}
					</DialogFooter>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
