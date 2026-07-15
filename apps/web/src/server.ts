import handler from "@tanstack/react-start/server-entry";

export { Sandbox } from "@cloudflare/sandbox";

export default {
	fetch: handler.fetch,
};
