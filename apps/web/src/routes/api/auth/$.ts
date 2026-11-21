import { createFileRoute } from "@tanstack/react-router";

const handle = async ({ request }: { request: Request }) => {
	const { auth } = await import("#/lib/auth.server.ts");
	return auth.handler(request);
};

export const Route = createFileRoute("/api/auth/$")({
	server: { handlers: { GET: handle, POST: handle } },
});
