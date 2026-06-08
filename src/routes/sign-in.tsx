import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GithubIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/sign-in")({
	component: SignIn,
});

function SignIn() {
	const navigate = useNavigate();
	const { data: session, isPending } = authClient.useSession();
	const [isSigningIn, setIsSigningIn] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useEffect(() => {
		if (session?.user) {
			void navigate({ to: "/" });
		}
	}, [navigate, session?.user]);

	async function handleSignIn() {
		setIsSigningIn(true);
		setErrorMessage(null);

		try {
			const result = await authClient.signIn.social({
				provider: "github",
				callbackURL: "/",
			});

			if (result.error) {
				setErrorMessage(result.error.message || "Unable to start sign in.");
				setIsSigningIn(false);
			}
		} catch {
			setErrorMessage("Unable to start sign in.");
			setIsSigningIn(false);
		}
	}

	return (
		<main className="flex min-h-dvh w-full max-w-full items-center justify-center overflow-x-hidden bg-background px-6 py-12">
			<section className="flex w-full max-w-sm flex-col gap-8">
				<div className="flex flex-col gap-3 text-center">
					<div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<span className="text-sm font-semibold">D</span>
					</div>
					<div className="flex flex-col gap-2">
						<h1 className="text-2xl font-semibold tracking-normal text-foreground">
							Sign in to Ditto
						</h1>
						<p className="text-sm leading-6 text-muted-foreground">
							Use your GitHub account to continue.
						</p>
					</div>
				</div>

				<div className="flex flex-col gap-3">
					<Button
						type="button"
						size="lg"
						className="h-11 text-sm"
						disabled={isPending || isSigningIn}
						onClick={() => {
							void handleSignIn();
						}}
					>
						{isSigningIn ? (
							<LoaderCircleIcon
								className="animate-spin"
								data-icon="inline-start"
							/>
						) : (
							<GithubIcon data-icon="inline-start" />
						)}
						Continue with GitHub
					</Button>
					{errorMessage ? (
						<p className="text-center text-sm text-destructive" role="alert">
							{errorMessage}
						</p>
					) : null}
				</div>
			</section>
		</main>
	);
}
