import { createFileRoute } from "@tanstack/react-router";
import { Chat } from "#/components/ai-chat";
import { getSession } from "@/lib/auth.functions";

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const session = await getSession();
		const conversationId: string = crypto.randomUUID();

		if (!session) {
			return { user: null, conversationId };
		}

		return { user: session.user, conversationId };
	},
	component: Home,
});

function Home() {
	const { conversationId } = Route.useRouteContext();

	return <Chat conversationId={conversationId} />;
}
