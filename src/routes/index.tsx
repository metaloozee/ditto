import { createFileRoute } from "@tanstack/react-router";
import {
	GitBranchIcon,
	MicIcon,
	SendHorizonalIcon,
	ShieldAlertIcon,
} from "lucide-react";
import { Button } from "#/components/ui/button";
import { cn, RADIAL_BG } from "#/lib/utils";
import { getSession } from "@/lib/auth.functions";

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const session = await getSession();
		if (!session) {
			return { user: null };
		}

		return { user: session.user };
	},
	component: Home,
});

function Home() {
	const { user } = Route.useRouteContext();

	return (
		<main className="min-h-dvh">
			<section className="rounded-lg p-5 flex flex-col h-full justify-end gap-5 max-w-3xl mx-auto">
				<div
					className={cn(
						"p-1 ring-1 ring-accent-foreground/10 rounded-lg flex flex-col justify-center items-center gap-1",
						RADIAL_BG,
					)}
				>
					<div className="bg-card border h-32 rounded-md w-full flex items-end justify-end gap-2 p-2">
						<Button variant="ghost">
							<MicIcon />
						</Button>
						<Button variant="outline">
							<SendHorizonalIcon />
						</Button>
					</div>
					<div className="flex justify-between gap-5 w-full text-xs px-2 py-1 text-muted-foreground">
						<div className="flex items-center gap-1">
							<GitBranchIcon className="size-3" />
							<p>master</p>
						</div>
						<div className="flex items-center gap-1">
							<ShieldAlertIcon className="size-3" />
							<p>Full Access</p>
						</div>
					</div>
				</div>
			</section>
		</main>
	);
}
