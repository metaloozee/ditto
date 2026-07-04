import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

type FlueBindings = {
	Sandbox: unknown;
	ProjectCoordinator: DurableObjectNamespace;
};

const flueApp = flue();
const app = new Hono<{ Bindings: FlueBindings }>();

app.post("/ditto/project-runs/start", async (c) => {
	const body = (await c.req.json()) as unknown;
	const url = new URL(c.req.url);
	url.pathname = "/workflows/ditto-project-run";
	url.search = "";

	return await flueApp.fetch(
		new Request(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
		c.env,
		c.executionCtx,
	);
});

app.route("/", flueApp);

export default app;
