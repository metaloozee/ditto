import { createFileRoute } from "@tanstack/react-router";
import { Chat } from "#/components/ai-chat";
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

	const conversationId = crypto.randomUUID();

	return <Chat conversationId={conversationId} />;
}
