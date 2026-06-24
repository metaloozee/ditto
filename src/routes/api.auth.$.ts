import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "#/lib/auth";

export const Route = createFileRoute("/api/auth/$")({
    server: {
        handlers: {
            GET: ({ request }) => createAuth(env).handler(request),
            POST: ({ request }) => createAuth(env).handler(request),
        },
    },
});
