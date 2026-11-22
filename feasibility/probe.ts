export default {
	fetch(request: Request): Response {
		if (new URL(request.url).pathname === "/probe") {
			return Response.json({ ok: true, stage: "feasibility" });
		}
		return new Response("Not found", { status: 404 });
	},
};
