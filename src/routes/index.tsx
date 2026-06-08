import { createFileRoute } from "@tanstack/react-router";
import { Composer } from "#/components/Composer";
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
	Route.useRouteContext();

	return (
		<main className="min-h-dvh">
			<Composer />
		</main>
	);
}
