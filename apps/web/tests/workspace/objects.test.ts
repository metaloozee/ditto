import { describe, expect, inject, it } from "vite-plus/test";

const appUrl = inject("appUrl");
const probeUrl = `${appUrl}/__test/workspace`;

interface ProbeAnswer {
	object: string;
	container: boolean;
	running: boolean;
}

async function probe() {
	const response = await fetch(probeUrl);
	expect(response.status).toBe(200);
	return (await response.json()) as ProbeAnswer;
}

describe("the website Worker hosts the Workspace object", () => {
	it("forwards an HTTP request to a Container-backed Workspace without starting it", async () => {
		await expect(probe()).resolves.toEqual({
			object: "Workspace",
			container: true,
			running: false,
		});
	});

	it("forwards a WebSocket upgrade to the Workspace, which echoes a message", async () => {
		const socket = new WebSocket(probeUrl.replace(/^http/, "ws"));
		await new Promise((resolve, reject) => {
			socket.addEventListener("open", resolve, { once: true });
			socket.addEventListener("error", reject, { once: true });
		});

		const echoed = new Promise<unknown>((resolve) =>
			socket.addEventListener("message", (event) => resolve(event.data), { once: true }),
		);
		socket.send("hello, workspace");

		await expect(echoed).resolves.toBe("hello, workspace");
		socket.close();
		await expect(probe()).resolves.toMatchObject({ running: false });
	});
});
