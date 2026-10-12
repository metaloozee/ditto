import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import type { Bare } from "./minimal-entry.ts";
declare module "cloudflare:test" { interface ProvidedEnv { Bare: DurableObjectNamespace<Bare>; } }
it("all-awaited KV RPC rejection with no abort or passive read", async () => {
 let message: unknown;
 try { await env.Bare.getByName("minimal").denied(); } catch (error) { message = (error as Error).message; }
 expect(message).toBe("minimal-denied");
});
